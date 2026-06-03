"""Usage-based (metered) billing: pricing models, prepaid balances, drawdown.

The model: buyers fund a prepaid balance (on-chain USDC transfer, verified), and
each call meters the balance down by the listing's unit price (off-chain, instant,
idempotent). Insufficient balance -> 402. Everything persists across cold starts.
"""
from decimal import Decimal

import pytest

from api.src.schemas.marketplace import (
    MarketplaceListingRequest,
    PricingModel,
    VerifiedRepo,
    WalletConnectRequest,
)
from api.src.services.marketplace_store import store


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


def _wallets():
    buyer = store.connect_wallet(WalletConnectRequest(owner="buyer", address="0x" + "1" * 40, kind="byo"))
    seller = store.connect_wallet(WalletConnectRequest(owner="seller", address="0x" + "2" * 40, kind="byo"))
    return buyer, seller


def _per_call_listing(seller, unit_price="0.01"):
    return store.create_listing(
        MarketplaceListingRequest(
            seller_wallet_id=seller.wallet_id,
            title="Metered Tool",
            price_usdc="1.00",
            provider_kind="tool",
            pricing_model=PricingModel.per_call,
            unit_price_usdc=unit_price,
            unit_label="call",
        )
    )


# ── Pricing fields on listings ──────────────────────────────────────────────────

def test_listing_defaults_to_flat(reset_store):
    _, seller = _wallets()
    listing = store.create_listing(
        MarketplaceListingRequest(seller_wallet_id=seller.wallet_id, title="Flat", price_usdc="5.00")
    )
    assert listing.pricing_model == PricingModel.flat
    assert listing.unit_price_usdc is None


def test_listing_can_be_per_call():
    _, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.002")
    assert listing.pricing_model == PricingModel.per_call
    assert listing.unit_price_usdc == Decimal("0.002")
    assert listing.unit_label == "call"


# ── Fund a balance ──────────────────────────────────────────────────────────────

def test_fund_creates_account_and_credits_balance():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller)
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("1.00"))
    assert acct.balance_usdc == Decimal("1.00")
    assert acct.funded_total_usdc == Decimal("1.00")
    assert acct.consumed_usdc == Decimal("0")
    assert acct.status == "active"


def test_fund_again_tops_up_same_account():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller)
    a1 = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("1.00"))
    a2 = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("0.50"))
    assert a1.account_id == a2.account_id  # same buyer+listing -> same account
    assert a2.balance_usdc == Decimal("1.50")
    assert a2.funded_total_usdc == Decimal("1.50")


# ── Meter drawdown ──────────────────────────────────────────────────────────────

def test_meter_draws_down_balance():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.01")
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("0.05"))
    r = store.meter_usage(acct.account_id, quantity=1, idempotency_key="k1")
    assert r["allowed"] is True
    assert r["balance_after_usdc"] == Decimal("0.04")
    assert r["amount_usdc"] == Decimal("0.01")


def test_meter_quantity_multiplies():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.01")
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("1.00"))
    r = store.meter_usage(acct.account_id, quantity=5, idempotency_key="k1")
    assert r["amount_usdc"] == Decimal("0.05")
    assert r["balance_after_usdc"] == Decimal("0.95")


def test_meter_insufficient_balance_denied():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.10")
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("0.05"))
    r = store.meter_usage(acct.account_id, quantity=1, idempotency_key="k1")
    assert r["allowed"] is False
    assert r["reason"] == "insufficient_balance"
    # balance untouched on denial
    assert store.get_usage_account(acct.account_id).balance_usdc == Decimal("0.05")


def test_meter_is_idempotent():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.01")
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("1.00"))
    r1 = store.meter_usage(acct.account_id, quantity=1, idempotency_key="same")
    r2 = store.meter_usage(acct.account_id, quantity=1, idempotency_key="same")
    # second call with same key returns the same result, does NOT double-charge
    assert r1["balance_after_usdc"] == r2["balance_after_usdc"] == Decimal("0.99")
    assert store.get_usage_account(acct.account_id).calls_count == 1


def test_meter_records_events():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.01")
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("1.00"))
    store.meter_usage(acct.account_id, quantity=1, idempotency_key="a")
    store.meter_usage(acct.account_id, quantity=2, idempotency_key="b")
    events = store.list_usage_events(acct.account_id)
    assert len(events) == 2
    assert sum(e.quantity for e in events) == 3


# ── Earnings ────────────────────────────────────────────────────────────────────

def test_seller_earnings_sum_consumed():
    buyer, seller = _wallets()
    listing = _per_call_listing(seller, unit_price="0.01")
    acct = store.fund_usage(listing.listing_id, buyer.wallet_id, Decimal("1.00"))
    store.meter_usage(acct.account_id, quantity=10, idempotency_key="x")
    earnings = store.seller_earnings(seller.wallet_id)
    assert earnings["consumed_usdc"] == Decimal("0.10")
    assert earnings["accounts"] == 1
