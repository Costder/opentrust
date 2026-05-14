from fastapi import APIRouter, HTTPException

from api.src.config import settings
from api.src.schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    EvidenceImportRequest,
    EvidenceRun,
    MarketplaceListing,
    MarketplaceListingRequest,
    MarketplaceOrder,
    MarketplaceOrderRequest,
    TrustReport,
    TrustReportRequest,
    VerifiedBadge,
    WalletAccount,
    WalletConnectRequest,
)
from api.src.services.marketplace_store import store

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
    if settings.opentrust_custodial_wallets_enabled or settings.opentrust_escrow_enabled:
        raise HTTPException(status_code=501, detail="custody and escrow are intentionally disabled")
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
