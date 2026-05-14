from decimal import Decimal
from enum import Enum
from pydantic import BaseModel, Field


class FeeKind(str, Enum):
    free = "free"
    flat_fee = "flat_fee"
    percentage = "percentage"


class FeeSchedule(BaseModel):
    kind: FeeKind
    amount_usdc: Decimal | None = Field(default=None, ge=0)
    percentage: Decimal | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class BillingPlan(BaseModel):
    tier: str
    interval: str = "one_time"
    amount_usdc: Decimal = Field(ge=0)
    fee_schedule: FeeSchedule | None = None


class CheckoutSession(BaseModel):
    session_id: str
    tool_id: str
    checkout_url: str
    amount_usdc: Decimal = Field(ge=0)
    status: str = "created"


class PaymentResult(BaseModel):
    payment_id: str
    session_id: str
    verified: bool
    amount_usdc: Decimal = Field(ge=0)
    status: str


class RefundResult(BaseModel):
    refund_id: str
    payment_id: str
    amount_usdc: Decimal = Field(ge=0)
    status: str


class Subscription(BaseModel):
    subscription_id: str
    tool_id: str
    customer: str
    plan: BillingPlan
    active: bool = True


class EscrowId(BaseModel):
    escrow_id: str


class DisputeCase(BaseModel):
    case_id: str
    escrow_id: str
    reason: str
    status: str = "open"


class Resolution(BaseModel):
    case_id: str
    winner: str
    released: bool
