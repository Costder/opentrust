"""Tests for platform fee structure.

Fee schedule:
  - Marketplace:  5% seller-side fee on orders / escrow settlements
  - Job board:    $2 flat listing fee + 4% settlement fee
  - Launch waiver: settlement fees are 0 during the waiver window
"""
from decimal import Decimal
from unittest.mock import patch

import pytest

from api.src.schemas.jobs import JobEngageRequest, JobPostingRequest
from api.src.schemas.marketplace import (
    DeliveryProofRequirement,
    EscrowStatus,
    MarketplaceListingRequest,
    MarketplaceOrderRequest,
    WalletConnectRequest,
)
from api.src.services.escrow_provider import MockEscrowProvider
from api.src.services.fee_calculator import (
    job_listing_fee,
    job_settlement_fee,
    marketplace_settlement_fee,
)
from api.src.services.marketplace_store import store


BUYER_ADDRESS = "0x" + "b" * 40
SELLER_ADDRESS = "0x" + "a" * 40
DEPOSIT_TX = "0x" + "d" * 64


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


def _proof():
    return DeliveryProofRequirement(
        type="http_endpoint",
        standard="opentrust/delivery-proof@v1",
        timeout_seconds=3600,
        result_hash_required=False,
    )


def _wallets():
    buyer = store.connect_wallet(WalletConnectRequest(owner="buyer", address=BUYER_ADDRESS, kind="byo"))
    seller = store.connect_wallet(WalletConnectRequest(owner="seller", address=SELLER_ADDRESS, kind="byo"))
    return buyer, seller


def _listing(seller, price="100.00"):
    return store.create_listing(
        MarketplaceListingRequest(
            seller_wallet_id=seller.wallet_id,
            title="Test Tool",
            price_usdc=price,
            provider_kind="tool",
            escrow_required=False,
        )
    )


# ── fee_calculator unit tests ────────────────────────────────────────────────


class TestFeeCalculator:
    def test_marketplace_fee_disabled_returns_zero(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = False
            fee, waived = marketplace_settlement_fee(Decimal("100.00"))
        assert fee == Decimal("0.00")
        assert waived is False

    def test_marketplace_fee_5_pct(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_marketplace_fee_pct = "5.00"
            s.opentrust_fee_waiver_enabled = False
            s.opentrust_fee_waiver_end_date = ""
            fee, waived = marketplace_settlement_fee(Decimal("100.00"))
        assert fee == Decimal("5.00")
        assert waived is False

    def test_marketplace_fee_waived_in_window(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_marketplace_fee_pct = "5.00"
            s.opentrust_fee_waiver_enabled = True
            s.opentrust_fee_waiver_end_date = "2099-01-01"
            fee, waived = marketplace_settlement_fee(Decimal("100.00"))
        assert fee == Decimal("0.00")
        assert waived is True

    def test_marketplace_fee_not_waived_after_window(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_marketplace_fee_pct = "5.00"
            s.opentrust_fee_waiver_enabled = True
            s.opentrust_fee_waiver_end_date = "2000-01-01"  # in the past
            fee, waived = marketplace_settlement_fee(Decimal("100.00"))
        assert fee == Decimal("5.00")
        assert waived is False

    def test_job_settlement_fee_4_pct(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_job_settlement_fee_pct = "4.00"
            s.opentrust_fee_waiver_enabled = False
            s.opentrust_fee_waiver_end_date = ""
            fee, waived = job_settlement_fee(Decimal("100.00"))
        assert fee == Decimal("4.00")
        assert waived is False

    def test_job_settlement_fee_waived_in_window(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_job_settlement_fee_pct = "4.00"
            s.opentrust_fee_waiver_enabled = True
            s.opentrust_fee_waiver_end_date = "2099-01-01"
            fee, waived = job_settlement_fee(Decimal("100.00"))
        assert fee == Decimal("0.00")
        assert waived is True

    def test_job_listing_fee_flat_2(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_job_listing_fee_usdc = "2.00"
            assert job_listing_fee() == Decimal("2.00")

    def test_job_listing_fee_zero_when_disabled(self):
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = False
            assert job_listing_fee() == Decimal("0.00")

    def test_fee_rounding(self):
        """Fee rounds to 2 decimal places (ROUND_HALF_UP)."""
        with patch("api.src.services.fee_calculator.settings") as s:
            s.opentrust_marketplace_fee_enabled = True
            s.opentrust_marketplace_fee_pct = "5.00"
            s.opentrust_fee_waiver_enabled = False
            s.opentrust_fee_waiver_end_date = ""
            # 5% of 33.33 = 1.6665 → rounds to 1.67
            fee, _ = marketplace_settlement_fee(Decimal("33.33"))
        assert fee == Decimal("1.67")


# ── Marketplace order fee integration ───────────────────────────────────────


class TestMarketplaceOrderFees:
    def _enable_fees(self, settings_mock, fee_pct="5.00", waiver_end=""):
        settings_mock.opentrust_marketplace_fee_enabled = True
        settings_mock.opentrust_marketplace_fee_pct = fee_pct
        settings_mock.opentrust_job_listing_fee_usdc = "2.00"
        settings_mock.opentrust_job_settlement_fee_pct = "4.00"
        settings_mock.opentrust_fee_waiver_enabled = bool(waiver_end)
        settings_mock.opentrust_fee_waiver_end_date = waiver_end

    def test_order_records_5pct_fee(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_pct", "5.00")
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_enabled", False)
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_end_date", "")

        buyer, seller = _wallets()
        listing = _listing(seller, price="100.00")
        tx = "0x" + "f" * 64
        order = store.create_order(
            MarketplaceOrderRequest(
                listing_id=listing.listing_id,
                buyer_wallet_id=buyer.wallet_id,
                transaction_hash=tx,
            )
        )
        assert order.platform_fee_usdc == Decimal("5.00")
        assert order.seller_receives_usdc == Decimal("95.00")
        assert order.fee_waived is False

    def test_order_fee_zero_when_disabled(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", False)

        buyer, seller = _wallets()
        listing = _listing(seller, price="100.00")
        tx = "0x" + "e" * 64
        order = store.create_order(
            MarketplaceOrderRequest(
                listing_id=listing.listing_id,
                buyer_wallet_id=buyer.wallet_id,
                transaction_hash=tx,
            )
        )
        assert order.platform_fee_usdc == Decimal("0.00")
        assert order.seller_receives_usdc == Decimal("100.00")

    def test_order_fee_waived_in_window(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_pct", "5.00")
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_end_date", "2099-01-01")

        buyer, seller = _wallets()
        listing = _listing(seller, price="100.00")
        tx = "0x" + "c" * 64
        order = store.create_order(
            MarketplaceOrderRequest(
                listing_id=listing.listing_id,
                buyer_wallet_id=buyer.wallet_id,
                transaction_hash=tx,
            )
        )
        assert order.platform_fee_usdc == Decimal("0.00")
        assert order.seller_receives_usdc == Decimal("100.00")
        assert order.fee_waived is True


# ── Escrow release fee integration ──────────────────────────────────────────


def _escrow_listing(seller, price="200.00"):
    return store.create_listing(
        MarketplaceListingRequest(
            seller_wallet_id=seller.wallet_id,
            title="Escrow Tool",
            price_usdc=price,
            provider_kind="tool",
            escrow_required=True,
            seller_trust_level=5,
            seller_trust_status="seller_confirmed",
            delivery_proof=_proof(),
        )
    )


class TestEscrowReleaseFees:
    def _full_escrow(self, buyer, seller, price="200.00"):
        from api.src.schemas.marketplace import EscrowCreateRequest
        listing = _escrow_listing(seller, price)
        escrow = store.create_escrow(
            EscrowCreateRequest(
                listing_id=listing.listing_id,
                buyer_wallet_id=buyer.wallet_id,
            ),
            token_contract="0x" + "0" * 40,
            provider=MockEscrowProvider(),
        )
        store.verify_escrow_deposit(escrow.escrow_id, DEPOSIT_TX)
        store.mark_escrow_delivered(escrow.escrow_id, result_hash=None, artifact_uri=None)
        return escrow

    def test_escrow_release_deducts_5pct_fee(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_pct", "5.00")
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_enabled", False)
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_end_date", "")

        buyer, seller = _wallets()
        escrow = self._full_escrow(buyer, seller, price="200.00")
        released = store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())
        assert released.platform_fee_usdc == Decimal("10.00")    # 5% of 200
        assert released.seller_receives_usdc == Decimal("190.00")
        assert released.fee_waived is False
        assert released.status == EscrowStatus.released

    def test_escrow_release_fee_waived(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_pct", "5.00")
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_end_date", "2099-01-01")

        buyer, seller = _wallets()
        escrow = self._full_escrow(buyer, seller)
        released = store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())
        assert released.platform_fee_usdc == Decimal("0.00")
        assert released.seller_receives_usdc == Decimal("200.00")
        assert released.fee_waived is True

    def test_escrow_release_fee_zero_when_disabled(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", False)

        buyer, seller = _wallets()
        escrow = self._full_escrow(buyer, seller)
        released = store.release_escrow(escrow.escrow_id, provider=MockEscrowProvider())
        assert released.platform_fee_usdc == Decimal("0.00")
        assert released.seller_receives_usdc == Decimal("200.00")


# ── Job board fee integration ────────────────────────────────────────────────


class TestJobFees:
    def test_job_listing_fee_recorded(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_job_listing_fee_usdc", "2.00")

        client = store.connect_wallet(WalletConnectRequest(owner="client", address=BUYER_ADDRESS, kind="byo"))
        job = store.create_job(
            JobPostingRequest(
                client_wallet_id=client.wallet_id,
                title="Test Job",
                budget_usdc="50.00",
                provider_kind="tool",
                delivery_proof=_proof(),
            )
        )
        assert job.listing_fee_usdc == Decimal("2.00")

    def test_job_listing_fee_zero_when_disabled(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", False)

        client = store.connect_wallet(WalletConnectRequest(owner="client", address=BUYER_ADDRESS, kind="byo"))
        job = store.create_job(
            JobPostingRequest(
                client_wallet_id=client.wallet_id,
                title="Test Job",
                budget_usdc="50.00",
                provider_kind="tool",
                delivery_proof=_proof(),
            )
        )
        assert job.listing_fee_usdc == Decimal("0.00")

    def test_job_escrow_release_deducts_4pct_fee(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_pct", "5.00")
        monkeypatch.setattr(real_settings, "opentrust_job_settlement_fee_pct", "4.00")
        monkeypatch.setattr(real_settings, "opentrust_job_listing_fee_usdc", "2.00")
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_enabled", False)
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_end_date", "")

        client = store.connect_wallet(WalletConnectRequest(owner="client", address=BUYER_ADDRESS, kind="byo"))
        provider = store.connect_wallet(WalletConnectRequest(owner="provider", address=SELLER_ADDRESS, kind="byo"))

        job = store.create_job(
            JobPostingRequest(
                client_wallet_id=client.wallet_id,
                title="Summarize PDFs",
                budget_usdc="100.00",
                provider_kind="tool",
                delivery_proof=_proof(),
            )
        )
        result = store.engage_job(
            job.job_id,
            JobEngageRequest(
                provider_wallet_id=provider.wallet_id,
                provider_trust_level=5,
                provider_trust_status="seller_confirmed",
            ),
            provider=MockEscrowProvider(),
        )
        escrow_id = result.escrow.escrow_id
        store.verify_escrow_deposit(escrow_id, DEPOSIT_TX)
        store.mark_escrow_delivered(escrow_id, result_hash=None, artifact_uri=None)
        released = store.release_escrow(escrow_id, provider=MockEscrowProvider())

        # Job escrow → 4% (not 5%)
        assert released.platform_fee_usdc == Decimal("4.00")    # 4% of 100
        assert released.seller_receives_usdc == Decimal("96.00")
        assert released.fee_waived is False

    def test_job_escrow_release_fee_waived(self, monkeypatch):
        from api.src.config import settings as real_settings
        monkeypatch.setattr(real_settings, "opentrust_marketplace_fee_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_job_settlement_fee_pct", "4.00")
        monkeypatch.setattr(real_settings, "opentrust_job_listing_fee_usdc", "2.00")
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_enabled", True)
        monkeypatch.setattr(real_settings, "opentrust_fee_waiver_end_date", "2099-01-01")

        client = store.connect_wallet(WalletConnectRequest(owner="client", address=BUYER_ADDRESS, kind="byo"))
        provider = store.connect_wallet(WalletConnectRequest(owner="provider", address=SELLER_ADDRESS, kind="byo"))

        job = store.create_job(
            JobPostingRequest(
                client_wallet_id=client.wallet_id,
                title="Waived Fee Job",
                budget_usdc="100.00",
                provider_kind="tool",
                delivery_proof=_proof(),
            )
        )
        # Listing fee is still charged ($2) even during waiver
        assert job.listing_fee_usdc == Decimal("2.00")

        result = store.engage_job(
            job.job_id,
            JobEngageRequest(
                provider_wallet_id=provider.wallet_id,
                provider_trust_level=5,
                provider_trust_status="seller_confirmed",
            ),
            provider=MockEscrowProvider(),
        )
        escrow_id = result.escrow.escrow_id
        store.verify_escrow_deposit(escrow_id, DEPOSIT_TX)
        store.mark_escrow_delivered(escrow_id, result_hash=None, artifact_uri=None)
        released = store.release_escrow(escrow_id, provider=MockEscrowProvider())

        assert released.platform_fee_usdc == Decimal("0.00")
        assert released.seller_receives_usdc == Decimal("100.00")
        assert released.fee_waived is True
