from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
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
    WalletKind,
)
from ..services.marketplace_store import store
from ..services.onchain import OnchainVerificationError, verify_usdc_transfer

router = APIRouter(prefix="/marketplace", tags=["marketplace"])
evidence_router = APIRouter(prefix="/evidence", tags=["evidence"])
reports_router = APIRouter(prefix="/reports", tags=["reports"])
badges_router = APIRouter(prefix="/badges", tags=["badges"])
wallets_router = APIRouter(prefix="/wallets", tags=["wallets"])
coinbase_router = APIRouter(prefix="/payments/coinbase", tags=["payments"])


@coinbase_router.post("/checkouts", response_model=CheckoutResponse)
async def create_coinbase_checkout(request: CheckoutRequest):
    try:
        return store.create_checkout(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@coinbase_router.post("/webhooks")
async def coinbase_webhook():
    # Webhook verification and payment processing is handled by the full
    # payment integration layer. Set COINBASE_BUSINESS_WEBHOOK_SECRET in .env.
    return {
        "status": "webhook_endpoint_active",
        "verified": bool(settings.coinbase_business_webhook_secret),
    }


@wallets_router.post("/connect", response_model=WalletAccount)
async def connect_wallet(request: WalletConnectRequest):
    if not settings.opentrust_customer_wallets_enabled:
        raise HTTPException(status_code=403, detail="customer wallets are disabled")
    try:
        return store.connect_wallet(request)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


class _GenerateWalletRequest(BaseModel):
    owner: str = Field(min_length=1)


@wallets_router.post("/generate", response_model=WalletAccount)
async def generate_embedded_wallet(request: _GenerateWalletRequest):
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
    return account


@router.get("/listings", response_model=list[MarketplaceListing])
async def list_listings():
    return list(store.listings.values())


@router.get("/orders", response_model=list[MarketplaceOrder])
async def list_orders():
    return list(store.orders.values())


@router.post("/listings", response_model=MarketplaceListing)
async def create_listing(request: MarketplaceListingRequest):
    if not settings.opentrust_marketplace_enabled:
        raise HTTPException(status_code=403, detail="marketplace is disabled")
    try:
        return store.create_listing(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/orders", response_model=MarketplaceOrder)
async def create_order(request: MarketplaceOrderRequest):
    if not request.transaction_hash and not request.escrow_id and not (
        settings.opentrust_custodial_wallets_enabled or settings.opentrust_escrow_enabled
    ):
        raise HTTPException(status_code=501, detail="on-chain escrow and custody are not enabled")
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
    try:
        return store.create_order(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@evidence_router.post("/import", response_model=EvidenceRun)
async def import_evidence(request: EvidenceImportRequest):
    try:
        return store.import_evidence(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@reports_router.post("", response_model=TrustReport)
async def create_report(request: TrustReportRequest):
    try:
        return store.create_report(request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc


@reports_router.get("/{report_id}", response_model=TrustReport)
async def get_report(report_id: str):
    report = store.reports.get(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report does not exist")
    return report


@reports_router.get("/badges/{badge_id}", response_model=VerifiedBadge)
async def get_badge(badge_id: str):
    badge = store.badges.get(badge_id)
    if badge is None:
        raise HTTPException(status_code=404, detail="badge does not exist")
    return badge


@badges_router.get("/{badge_id}", response_model=VerifiedBadge)
async def get_badge_alias(badge_id: str):
    return await get_badge(badge_id)
