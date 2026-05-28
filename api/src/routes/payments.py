from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..config import settings
from ..schemas.marketplace import (
    CheckoutRequest,
    CheckoutResponse,
    PaymentStatus,
    PaymentVerificationRequest,
    PaymentVerificationResponse,
    ProductCode,
)
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


@escrow_router.post("/create")
async def create_escrow():
    raise HTTPException(status_code=501, detail="escrow is outside the open-source demo payment flow")


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
