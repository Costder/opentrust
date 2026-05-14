from decimal import Decimal
from payment_contracts.models import BillingPlan, CheckoutSession, FeeSchedule


def test_checkout_session_validation():
    session = CheckoutSession(session_id="s1", tool_id="tool", checkout_url="https://example.com", amount_usdc=Decimal("10"))
    assert session.status == "created"


def test_billing_plan_accepts_fee_schedule():
    plan = BillingPlan(tier="verification", amount_usdc=Decimal("25"), fee_schedule=FeeSchedule(kind="flat_fee", amount_usdc=Decimal("25")))
    assert plan.fee_schedule is not None
