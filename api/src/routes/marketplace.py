import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import settings
from ..database import Database, get_db
from ..schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    EvidenceImportRequest,
    EvidenceRun,
    EscrowStatus,
    MarketplaceListing,
    MarketplaceListingRequest,
    MarketplaceOrder,
    MarketplaceOrderRequest,
    TrustReport,
    TrustReportRequest,
    VerifiedBadge,
    WalletAccount,
    WalletConnectRequest,
    WalletConnectResponse,
    WalletKind,
)
from ..middleware.auth import mint_wallet_token, verify_wallet_ownership
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer
from ._durable import (
    claim_checkout,
    claim_tx_hash,
    hydrate_badge,
    hydrate_checkout,
    hydrate_evidence,
    hydrate_report,
    hydrate_repos,
    persist_badge,
    persist_checkout,
    persist_evidence,
    persist_report,
    tx_hash_consumed,
)


def _jsonable(model) -> dict:
    """Pydantic model -> plain JSON-safe dict (Decimals become strings)."""
    return json.loads(model.model_dump_json())

router = APIRouter(prefix="/marketplace", tags=["marketplace"])
evidence_router = APIRouter(prefix="/evidence", tags=["evidence"])
reports_router = APIRouter(prefix="/reports", tags=["reports"])
badges_router = APIRouter(prefix="/badges", tags=["badges"])
wallets_router = APIRouter(prefix="/wallets", tags=["wallets"])
coinbase_router = APIRouter(prefix="/payments/coinbase", tags=["payments"])


@coinbase_router.post("/checkouts", response_model=CheckoutResponse)
async def create_coinbase_checkout(request: CheckoutRequest, db: Database = Depends(get_db)):
    try:
        result = store.create_checkout(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await persist_checkout(db, result)
    return result


@coinbase_router.post("/webhooks")
async def coinbase_webhook(
    request: Request,
    x_cc_webhook_signature: str | None = Header(default=None, alias="X-CC-Webhook-Signature"),
):
    """Coinbase Commerce webhook. Verifies the HMAC-SHA256 signature against the
    raw body before processing — previously this was an unauthenticated
    accept-all stub that never verified anything and dropped real events."""
    secret = settings.coinbase_business_webhook_secret
    if not secret:
        raise HTTPException(status_code=503, detail="coinbase webhook secret is not configured")

    body = await request.body()
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not x_cc_webhook_signature or not hmac.compare_digest(expected, x_cc_webhook_signature):
        raise HTTPException(status_code=401, detail="invalid webhook signature")

    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid JSON body") from exc

    payload = event.get("event") or {}
    data = payload.get("data") or {}
    checkout_id = (data.get("metadata") or {}).get("checkout_id")
    if payload.get("type") == "charge:confirmed" and checkout_id:
        store.mark_checkout_paid(checkout_id)
    return {"status": "ok"}


@wallets_router.post("/connect", response_model=WalletConnectResponse)
async def connect_wallet(request: WalletConnectRequest, db: Database = Depends(get_db)):
    if not settings.opentrust_customer_wallets_enabled:
        raise HTTPException(status_code=403, detail="customer wallets are disabled")
    # A session token (party authority) is only issued when the caller proves
    # control of the address with a valid signature. Registration without a
    # signature still works but yields no token, so the wallet cannot act on
    # escrow/job/payment endpoints.
    if request.signature is not None and not verify_wallet_ownership(
        request.owner, request.address, request.signature
    ):
        raise HTTPException(status_code=403, detail="wallet ownership signature is invalid")
    try:
        wallet = store.connect_wallet(request)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    # Persist so the wallet survives a serverless cold start, like listings do.
    await db.save_object("wallet", wallet.wallet_id, _jsonable(wallet))
    session_token = mint_wallet_token(wallet.wallet_id) if request.signature is not None else None
    return WalletConnectResponse(**wallet.model_dump(), session_token=session_token)


@wallets_router.get("/{wallet_id}", response_model=WalletAccount)
async def get_wallet(wallet_id: str, db: Database = Depends(get_db)):
    """Resolve a wallet's public on-chain address.

    Buyers need the seller's address to send a direct USDC payment. The address
    is public on-chain data, so this is safe to expose; private keys are never
    returned.
    """
    await _hydrate_wallets(db)
    wallet = store.wallets.get(wallet_id)
    if wallet is None:
        raise HTTPException(status_code=404, detail="wallet not found")
    return wallet


class _GenerateWalletRequest(BaseModel):
    owner: str = Field(min_length=1)


@wallets_router.post("/generate", response_model=WalletConnectResponse)
async def generate_embedded_wallet(request: _GenerateWalletRequest, db: Database = Depends(get_db)):
    """Generate a new embedded wallet server-side. Requires OPENTRUST_EMBEDDED_WALLET_ENABLED=true."""
    if not settings.opentrust_embedded_wallet_enabled:
        raise HTTPException(status_code=403, detail="embedded wallet generation is disabled")
    if not settings.wallet_encryption_secret:
        raise HTTPException(status_code=503, detail="WALLET_ENCRYPTION_SECRET is not configured")
    from ..services.custody import encrypt_private_key, generate_wallet
    wallet_data = generate_wallet()
    encrypt_private_key(wallet_data["private_key"], settings.wallet_encryption_secret, request.owner)
    # NOTE: In production, store encrypted_key in the database with wallet_id as key.
    # For now (in-memory dev mode) we only store the public wallet account, not the private key.
    account = WalletAccount(
        wallet_id=f"emb_{wallet_data['address'][-8:]}",
        owner=request.owner,
        address=wallet_data["address"],
        kind=WalletKind.embedded,
        custody="opentrust_encrypted",
    )
    store.wallets[account.wallet_id] = account
    await db.save_object("wallet", account.wallet_id, _jsonable(account))
    # The registry generated and controls this key, so ownership is implicit —
    # issue a session token directly.
    return WalletConnectResponse(**account.model_dump(), session_token=mint_wallet_token(account.wallet_id))


async def _hydrate_listings(db: Database) -> None:
    """Load any DB-persisted listings missing from the in-memory working set.

    Makes the catalog correct after a cold start without a full reload on every
    request: anything already in memory is authoritative; the rest comes from DB.
    """
    for data in await db.load_objects("listing"):
        lid = data.get("listing_id")
        if lid and lid not in store.listings:
            try:
                store.listings[lid] = MarketplaceListing(**data)
            except Exception:
                continue  # skip malformed rows rather than 500 the whole list


async def _hydrate_wallets(db: Database) -> None:
    """Load any DB-persisted wallets missing from the in-memory working set.

    Wallet existence gates listing/order/escrow creation; without this a wallet
    connected on one instance vanishes after a serverless cold start, breaking
    every flow that references it (e.g. a seeded listing's seller).
    """
    for data in await db.load_objects("wallet"):
        wid = data.get("wallet_id")
        if wid and wid not in store.wallets:
            try:
                store.wallets[wid] = WalletAccount(**data)
            except Exception:
                continue  # skip malformed rows rather than 500 the whole flow


@router.get("/listings", response_model=list[MarketplaceListing])
async def list_listings(db: Database = Depends(get_db)):
    await _hydrate_listings(db)
    return list(store.listings.values())


@router.get("/orders", response_model=list[MarketplaceOrder])
async def list_orders(db: Database = Depends(get_db)):
    for data in await db.load_objects("order"):
        oid = data.get("order_id")
        if oid and oid not in store.orders:
            try:
                store.orders[oid] = MarketplaceOrder(**data)
            except Exception:
                continue
    return list(store.orders.values())


@router.post("/listings", response_model=MarketplaceListing)
async def create_listing(request: MarketplaceListingRequest, db: Database = Depends(get_db)):
    if not settings.opentrust_marketplace_enabled:
        raise HTTPException(status_code=403, detail="marketplace is disabled")
    await _hydrate_wallets(db)  # seller wallet may live only in the DB after a cold start
    try:
        listing = store.create_listing(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.save_object("listing", listing.listing_id, _jsonable(listing))
    return listing


class _DeleteListingRequest(BaseModel):
    seller_wallet_id: str


@router.delete("/listings/{listing_id}")
async def delete_listing(listing_id: str, request: _DeleteListingRequest, db: Database = Depends(get_db)):
    """Remove a listing. Only the seller who owns it may delete it."""
    await _hydrate_listings(db)
    listing = store.listings.get(listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="listing not found")
    if listing.seller_wallet_id != request.seller_wallet_id:
        raise HTTPException(status_code=403, detail="only the seller can delete this listing")
    store.listings.pop(listing_id, None)
    await db.delete_object("listing", listing_id)
    return {"deleted": listing_id}


@router.post("/orders", response_model=MarketplaceOrder)
async def create_order(request: MarketplaceOrderRequest, db: Database = Depends(get_db)):
    if not request.transaction_hash and not request.escrow_id and not (
        settings.opentrust_custodial_wallets_enabled or settings.opentrust_escrow_enabled
    ):
        raise HTTPException(status_code=501, detail="on-chain escrow and custody are not enabled")
    # Cold-start safety: the listing and its wallets may live only in the DB.
    await _hydrate_listings(db)
    await _hydrate_wallets(db)
    listing = store.listings.get(request.listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="listing not found")
    if listing.escrow_required and not request.escrow_id:
        raise HTTPException(status_code=403, detail="listing requires escrow")
    if request.escrow_id:
        escrow = store.escrows.get(request.escrow_id)
        if escrow is None:
            raise HTTPException(status_code=404, detail="escrow not found")
        if escrow.status != EscrowStatus.released:
            raise HTTPException(status_code=409, detail="escrow must be released before order creation")
        if escrow.listing_id != request.listing_id or escrow.buyer_wallet_id != request.buyer_wallet_id:
            raise HTTPException(status_code=409, detail="escrow does not match order")
    if request.transaction_hash:
        # On-chain escrow: verify the USDC transfer before creating the order
        if await tx_hash_consumed(db, request.transaction_hash):
            raise HTTPException(status_code=409, detail="transaction has already been used")
        buyer_wallet = store.wallets.get(request.buyer_wallet_id)
        seller_wallet = store.wallets.get(listing.seller_wallet_id)
        if buyer_wallet is None or seller_wallet is None:
            raise HTTPException(status_code=404, detail="wallet not found")
        try:
            verify_usdc_transfer(
                tx_hash=request.transaction_hash,
                expected_sender=buyer_wallet.address,
                expected_recipient=seller_wallet.address,
                expected_amount_usdc=listing.price_usdc,
                rpc_url=settings.base_rpc_url,
                usdc_contract=settings.base_usdc_contract,
            )
        except OnchainVerificationError as exc:
            raise HTTPException(status_code=402, detail=f"payment verification failed: {exc}") from exc
    elif not (settings.opentrust_custodial_wallets_enabled or settings.opentrust_escrow_enabled):
        raise HTTPException(status_code=501, detail="on-chain escrow and custody are not enabled")
    # Atomically claim the funding tx hash before creating the order; the loser
    # of a concurrent replay gets 409 here rather than a second order.
    if request.transaction_hash and not await claim_tx_hash(
        db, request.transaction_hash, {"listing_id": request.listing_id}
    ):
        raise HTTPException(status_code=409, detail="transaction has already been used")
    try:
        order = store.create_order(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.save_object("order", order.order_id, _jsonable(order))
    return order


@evidence_router.post("/import", response_model=EvidenceRun)
async def import_evidence(request: EvidenceImportRequest, db: Database = Depends(get_db)):
    await hydrate_repos(db)  # repo may live only in the DB (cold start)
    try:
        evidence = store.import_evidence(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await persist_evidence(db, evidence)
    return evidence


@reports_router.post("", response_model=TrustReport)
async def create_report(request: TrustReportRequest, db: Database = Depends(get_db)):
    # The repo, checkout and evidence may all have been created on a different
    # instance — hydrate before validating/redeeming.
    await hydrate_repos(db)
    await hydrate_checkout(db, request.checkout_id)
    await hydrate_evidence(db)
    try:
        report = store.create_report(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    # Durable, atomic redemption: one paid checkout → one report, even across
    # concurrent instances. The loser of a race is rejected and not persisted.
    if not await claim_checkout(db, request.checkout_id):
        raise HTTPException(status_code=409, detail="checkout has already been redeemed")
    await persist_report(db, report)
    badge = next((b for b in store.badges.values() if b.report_id == report.report_id), None)
    if badge is not None:
        await persist_badge(db, badge)
    return report


@reports_router.get("/{report_id}", response_model=TrustReport)
async def get_report(report_id: str, db: Database = Depends(get_db)):
    await hydrate_report(db, report_id)
    report = store.reports.get(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report does not exist")
    return report


@reports_router.get("/badges/{badge_id}", response_model=VerifiedBadge)
async def get_badge(badge_id: str, db: Database = Depends(get_db)):
    await hydrate_badge(db, badge_id)
    badge = store.badges.get(badge_id)
    if badge is None:
        raise HTTPException(status_code=404, detail="badge does not exist")
    return badge


@badges_router.get("/{badge_id}", response_model=VerifiedBadge)
async def get_badge_alias(badge_id: str, db: Database = Depends(get_db)):
    return await get_badge(badge_id, db)
