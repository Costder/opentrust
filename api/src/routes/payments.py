from fastapi import APIRouter, HTTPException

from api.src.schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    PaymentStatus,
    PaymentVerificationRequest,
    PaymentVerificationResponse,
    ProductCode,
)
from api.src.services.marketplace_store import store

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


@escrow_router.post("/create")
async def create_escrow():
    raise HTTPException(status_code=501, detail="escrow is outside the open-source demo payment flow")
