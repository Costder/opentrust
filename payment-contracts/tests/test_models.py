from decimal import Decimal
from payment_contracts.models import (
    BillingPlan,
    CheckoutSession,
    FeeSchedule,
    MarketplaceListing,
    MarketplaceOrder,
    RepoVerification,
    WalletAccount,
)


def test_checkout_session_validation():
    session = CheckoutSession(session_id="s1", tool_id="tool", checkout_url="https://example.com", amount_usdc=Decimal("10"))
    assert session.status == "created"


def test_billing_plan_accepts_fee_schedule():
    plan = BillingPlan(tier="verification", amount_usdc=Decimal("25"), fee_schedule=FeeSchedule(kind="flat_fee", amount_usdc=Decimal("25")))
    assert plan.fee_schedule is not None


def test_marketplace_contract_models_are_non_custodial():
    repo = RepoVerification(
        repo_id="repo_1",
        installation_id=123,
        repo_full_name="octo/tool",
        branch="main",
        commit_sha="abc1234567",
    )
    wallet = WalletAccount(
        wallet_id="wallet_1",
        owner="seller",
        address="0x1111111111111111111111111111111111111111",
        mode="byo",
    )
    listing = MarketplaceListing(
        listing_id="listing_1",
        seller_wallet_id=wallet.wallet_id,
        repo_id=repo.repo_id,
        title="Verified package",
        price_usdc=Decimal("10"),
    )
    order = MarketplaceOrder(
        order_id="order_1",
        listing_id=listing.listing_id,
        buyer_wallet_id="wallet_2",
        seller_wallet_id=wallet.wallet_id,
        amount_usdc=Decimal("10"),
    )
    assert listing.custody == "none"
    assert order.custody == "none"
