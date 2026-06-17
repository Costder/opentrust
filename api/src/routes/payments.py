from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..config import settings
from ..database import Database, get_db
from ..middleware.auth import current_wallet
from ..schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    EscrowCreateRequest,
    EscrowDeliveryRequest,
    EscrowDepositVerificationRequest,
    EscrowDisputeRequest,
    EscrowRecord,
    PaymentStatus,
    PaymentVerificationRequest,
    PaymentVerificationResponse,
    ProductCode,
)
from ..schemas.reputation import CounterpartyRating, CounterpartyRatingRequest
from ..services.coinbase import CoinbaseError
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer
from ._durable import (
    claim_tx_hash,
    hydrate_checkout,
    hydrate_escrow,
    persist_checkout,
    hydrate_jobs,
    hydrate_ratings,
    hydrate_reputation,
    persist_escrow,
    persist_rating,
    persist_reputation_all,
    persist_settlement,
    tx_hash_consumed,
)

class OnchainVerifyRequest(BaseModel):
    tx_hash: str = Field(min_length=66, max_length=66, pattern=r"^0x[0-9a-fA-F]{64}$")
    expected_sender: str = Field(
        min_length=42,
        max_length=42,
        pattern=r"^0x[0-9a-fA-F]{40}$",
    )
    expected_recipient: str = Field(
        min_length=42,
        max_length=42,
        pattern=r"^0x[0-9a-fA-F]{40}$",
    )
    expected_amount_usdc: str  # string to avoid float precision issues

    @field_validator("expected_amount_usdc")
    @classmethod
    def validate_decimal_string(cls, v: str) -> str:
        try:
            Decimal(v)
        except Exception:
            raise ValueError("expected_amount_usdc must be a valid decimal string (e.g. '25.00')")
        return v


class OnchainVerifyResponse(BaseModel):
    verified: bool
    tx_hash: str
    sender: str
    recipient: str
    amount_usdc: str


router = APIRouter(prefix="/payments", tags=["payments"])
subscriptions_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
escrow_router = APIRouter(prefix="/escrow", tags=["escrow"])


@router.post("/checkout", response_model=CheckoutResponse)
async def checkout(request: CheckoutRequest, db: Database = Depends(get_db)):
    try:
        result = store.create_checkout(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (ValueError, CoinbaseError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await persist_checkout(db, result)
    return result


@router.post("/verify", response_model=PaymentVerificationResponse)
async def verify(request: PaymentVerificationRequest, db: Database = Depends(get_db)):
    await hydrate_checkout(db, request.checkout_id)  # may live only in the DB (cold start)
    payment = store.checkouts.get(request.checkout_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="checkout does not exist")
    return PaymentVerificationResponse(
        checkout_id=payment.checkout_id,
        verified=payment.status == PaymentStatus.paid,
        status=payment.status,
        amount_usdc=payment.amount_usdc,
        provider=payment.provider,
    )


@subscriptions_router.post("/create", response_model=CheckoutResponse)
async def create_subscription(repo_id: str | None = None, db: Database = Depends(get_db)):
    result = store.create_checkout(CheckoutRequest(product_code=ProductCode.monitoring_monthly, repo_id=repo_id))
    await persist_checkout(db, result)
    return result


def _map_escrow_store_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=500, detail="unexpected escrow error")


@escrow_router.post("/create", response_model=EscrowRecord)
async def create_escrow(request: EscrowCreateRequest, db: Database = Depends(get_db)):
    if not settings.opentrust_escrow_enabled:
        raise HTTPException(status_code=403, detail="escrow is disabled")
    # Cold-start safety: the seeded listing and its buyer/seller wallets may live
    # only in the DB after a serverless recycle. Hydrate before validating them.
    from ..routes.marketplace import _hydrate_listings, _hydrate_wallets
    await _hydrate_listings(db)
    await _hydrate_wallets(db)
    await hydrate_reputation(db)  # the reputation gate must see prior history
    try:
        escrow = store.create_escrow(
            request,
            token_contract=settings.base_usdc_contract,
        )
    except ValueError as exc:
        if "delivery proof" in str(exc):
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        raise _map_escrow_store_error(exc) from exc
    except (KeyError, PermissionError) as exc:
        raise _map_escrow_store_error(exc) from exc
    await persist_escrow(db, escrow)
    return escrow


@escrow_router.get("/{escrow_id}", response_model=EscrowRecord)
async def get_escrow(escrow_id: str, db: Database = Depends(get_db)):
    escrow = await hydrate_escrow(db, escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    return escrow


@escrow_router.post("/{escrow_id}/verify-deposit", response_model=EscrowRecord)
async def verify_escrow_deposit(
    escrow_id: str,
    request: EscrowDepositVerificationRequest,
    db: Database = Depends(get_db),
    wallet_id: str = Depends(current_wallet),
):
    from ..routes.marketplace import _hydrate_wallets
    escrow = await hydrate_escrow(db, escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    if wallet_id != escrow.buyer_wallet_id:
        raise HTTPException(status_code=403, detail="only the buyer may verify the deposit")
    if await tx_hash_consumed(db, request.tx_hash):
        raise HTTPException(status_code=409, detail="transaction has already been used")
    await _hydrate_wallets(db)
    buyer_wallet = store.wallets.get(escrow.buyer_wallet_id)
    if buyer_wallet is None:
        raise HTTPException(status_code=404, detail="buyer wallet is not connected")
    try:
        verify_usdc_transfer(
            tx_hash=request.tx_hash,
            expected_sender=buyer_wallet.address,
            expected_recipient=escrow.deposit.recipient_address,
            expected_amount_usdc=escrow.amount_usdc,
            rpc_url=settings.base_rpc_url,
            usdc_contract=settings.base_usdc_contract,
        )
        # Atomically claim the tx hash before crediting; loser of a concurrent
        # replay gets 409 here, preventing double-funding.
        if not await claim_tx_hash(db, request.tx_hash, {"escrow_id": escrow_id}):
            raise HTTPException(status_code=409, detail="transaction has already been used")
        updated = store.verify_escrow_deposit(escrow_id, request.tx_hash)
        await persist_escrow(db, updated)
        return updated
    except OnchainVerificationError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.post("/{escrow_id}/deliver", response_model=EscrowRecord)
async def deliver_escrow(
    escrow_id: str,
    request: EscrowDeliveryRequest,
    db: Database = Depends(get_db),
    wallet_id: str = Depends(current_wallet),
):
    escrow = await hydrate_escrow(db, escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    if wallet_id != escrow.seller_wallet_id:
        raise HTTPException(status_code=403, detail="only the seller may mark delivery")
    try:
        escrow = store.mark_escrow_delivered(
            escrow_id,
            result_hash=request.result_hash,
            artifact_uri=request.artifact_uri,
        )
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc
    await persist_escrow(db, escrow)
    return escrow


@escrow_router.post("/{escrow_id}/release", response_model=EscrowRecord)
async def release_escrow(
    escrow_id: str,
    db: Database = Depends(get_db),
    wallet_id: str = Depends(current_wallet),
):
    escrow = await hydrate_escrow(db, escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    is_buyer = wallet_id == escrow.buyer_wallet_id
    is_seller = wallet_id == escrow.seller_wallet_id
    if not (is_buyer or is_seller):
        raise HTTPException(status_code=403, detail="only a party to this escrow may release it")
    # Buyer can approve release at any time. The seller may only self-release once
    # the dispute window (release_available_at) has elapsed.
    if is_seller and not is_buyer and escrow.release_available_at:
        if datetime.now(timezone.utc).isoformat() < escrow.release_available_at:
            raise HTTPException(
                status_code=403,
                detail=f"release not available until the dispute window ends ({escrow.release_available_at})",
            )
    await hydrate_reputation(db)  # accrual must build on existing history
    await hydrate_jobs(db)        # so a linked job can be completed
    try:
        escrow = store.release_escrow(escrow_id)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc
    await persist_settlement(db, escrow)
    return escrow


@escrow_router.post("/{escrow_id}/refund", response_model=EscrowRecord)
async def refund_escrow(
    escrow_id: str,
    db: Database = Depends(get_db),
    wallet_id: str = Depends(current_wallet),
):
    escrow = await hydrate_escrow(db, escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    if wallet_id != escrow.buyer_wallet_id:
        raise HTTPException(status_code=403, detail="only the buyer may request a refund")
    await hydrate_reputation(db)
    try:
        escrow = store.refund_escrow(escrow_id)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc
    await persist_settlement(db, escrow)
    return escrow


@escrow_router.post("/{escrow_id}/disputes", response_model=EscrowRecord)
async def dispute_escrow(
    escrow_id: str,
    request: EscrowDisputeRequest,
    db: Database = Depends(get_db),
    wallet_id: str = Depends(current_wallet),
):
    escrow = await hydrate_escrow(db, escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    if wallet_id not in (escrow.buyer_wallet_id, escrow.seller_wallet_id):
        raise HTTPException(status_code=403, detail="only a party to this escrow may dispute it")
    await hydrate_reputation(db)
    try:
        escrow = store.mark_escrow_disputed(escrow_id, request.reason)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc
    await persist_settlement(db, escrow)
    return escrow


@escrow_router.post("/{escrow_id}/ratings", response_model=CounterpartyRating)
async def rate_escrow(escrow_id: str, request: CounterpartyRatingRequest, db: Database = Depends(get_db)):
    """Bidirectional counterparty rating, allowed only after the escrow settles."""
    await hydrate_escrow(db, escrow_id)
    await hydrate_reputation(db)
    try:
        rating = store.add_rating(escrow_id, request)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc
    await persist_rating(db, rating)
    await persist_reputation_all(db)
    return rating


@escrow_router.get("/{escrow_id}/ratings", response_model=list[CounterpartyRating])
async def list_escrow_ratings(escrow_id: str, db: Database = Depends(get_db)):
    if await hydrate_escrow(db, escrow_id) is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    await hydrate_ratings(db)
    return store.list_ratings_for_escrow(escrow_id)


@router.post("/verify-onchain", response_model=OnchainVerifyResponse)
async def verify_onchain_payment(
    request: OnchainVerifyRequest,
    _wallet_id: str = Depends(current_wallet),
):
    """Verify a USDC payment on Base L2 by inspecting the transaction receipt.

    Authenticated-only: this is a chain oracle, so leaving it open let anyone
    probe arbitrary tx/sender/recipient/amount combinations.
    """
    try:
        result = verify_usdc_transfer(
            tx_hash=request.tx_hash,
            expected_sender=request.expected_sender,
            expected_recipient=request.expected_recipient,
            expected_amount_usdc=Decimal(request.expected_amount_usdc),
            rpc_url=settings.base_rpc_url,
            usdc_contract=settings.base_usdc_contract,
        )
    except OnchainVerificationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return OnchainVerifyResponse(
        verified=result.verified,
        tx_hash=result.tx_hash,
        sender=result.sender,
        recipient=result.recipient,
        amount_usdc=str(result.amount_usdc),
    )
