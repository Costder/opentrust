from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..config import settings
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
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer

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
async def checkout(request: CheckoutRequest):
    try:
        return store.create_checkout(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/verify", response_model=PaymentVerificationResponse)
async def verify(request: PaymentVerificationRequest):
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
async def create_subscription(repo_id: str | None = None):
    return store.create_checkout(CheckoutRequest(product_code=ProductCode.monitoring_monthly, repo_id=repo_id))


def _map_escrow_store_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=500, detail="unexpected escrow error")


@escrow_router.post("/create", response_model=EscrowRecord)
async def create_escrow(request: EscrowCreateRequest):
    if not settings.opentrust_escrow_enabled:
        raise HTTPException(status_code=403, detail="escrow is disabled")
    try:
        return store.create_escrow(
            request,
            token_contract=settings.base_usdc_contract,
        )
    except ValueError as exc:
        if "delivery proof" in str(exc):
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        raise _map_escrow_store_error(exc) from exc
    except (KeyError, PermissionError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.get("/{escrow_id}", response_model=EscrowRecord)
async def get_escrow(escrow_id: str):
    escrow = store.escrows.get(escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    return escrow


@escrow_router.post("/{escrow_id}/verify-deposit", response_model=EscrowRecord)
async def verify_escrow_deposit(escrow_id: str, request: EscrowDepositVerificationRequest):
    escrow = store.escrows.get(escrow_id)
    if escrow is None:
        raise HTTPException(status_code=404, detail="escrow does not exist")
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
        return store.verify_escrow_deposit(escrow_id, request.tx_hash)
    except OnchainVerificationError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.post("/{escrow_id}/deliver", response_model=EscrowRecord)
async def deliver_escrow(escrow_id: str, request: EscrowDeliveryRequest):
    try:
        return store.mark_escrow_delivered(
            escrow_id,
            result_hash=request.result_hash,
            artifact_uri=request.artifact_uri,
        )
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.post("/{escrow_id}/release", response_model=EscrowRecord)
async def release_escrow(escrow_id: str):
    try:
        return store.release_escrow(escrow_id)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.post("/{escrow_id}/refund", response_model=EscrowRecord)
async def refund_escrow(escrow_id: str):
    try:
        return store.refund_escrow(escrow_id)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.post("/{escrow_id}/disputes", response_model=EscrowRecord)
async def dispute_escrow(escrow_id: str, request: EscrowDisputeRequest):
    try:
        return store.mark_escrow_disputed(escrow_id, request.reason)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.post("/{escrow_id}/ratings", response_model=CounterpartyRating)
async def rate_escrow(escrow_id: str, request: CounterpartyRatingRequest):
    """Bidirectional counterparty rating, allowed only after the escrow settles."""
    try:
        return store.add_rating(escrow_id, request)
    except (KeyError, PermissionError, ValueError) as exc:
        raise _map_escrow_store_error(exc) from exc


@escrow_router.get("/{escrow_id}/ratings", response_model=list[CounterpartyRating])
async def list_escrow_ratings(escrow_id: str):
    if escrow_id not in store.escrows:
        raise HTTPException(status_code=404, detail="escrow does not exist")
    return store.list_ratings_for_escrow(escrow_id)


@router.post("/verify-onchain", response_model=OnchainVerifyResponse)
async def verify_onchain_payment(request: OnchainVerifyRequest):
    """Verify a USDC payment on Base L2 by inspecting the transaction receipt."""
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
