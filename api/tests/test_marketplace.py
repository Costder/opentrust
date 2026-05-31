"""Tests for real marketplace flows — escrow, embedded wallet generation, on-chain verification."""

import pytest
from decimal import Decimal
from unittest.mock import MagicMock, patch

from httpx import ASGITransport, AsyncClient

from api.src.main import app
from api.src.services.marketplace_store import store


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestEmbeddedWalletGeneration:
    async def test_generate_endpoint_returns_new_wallet(self, client):
        """POST /wallets/generate creates a fresh EVM wallet server-side."""
        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_customer_wallets_enabled = True
            mock_settings.opentrust_embedded_wallet_enabled = True
            mock_settings.opentrust_byo_wallet_enabled = True
            mock_settings.wallet_encryption_secret = "test-secret-32-chars-xxxxxxxxxxx"
            response = await client.post(
                "/api/v1/wallets/generate",
                json={"owner": "user-123"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["kind"] == "embedded"
        assert data["owner"] == "user-123"
        assert data["address"].startswith("0x")
        assert len(data["address"]) == 42
        assert data["custody"] == "opentrust_encrypted"

    async def test_generate_disabled_returns_403(self, client):
        """POST /wallets/generate returns 403 when embedded wallets are disabled."""
        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_embedded_wallet_enabled = False
            response = await client.post(
                "/api/v1/wallets/generate",
                json={"owner": "user-123"},
            )
        assert response.status_code == 403

    async def test_connect_byo_wallet_still_works(self, client):
        """POST /wallets/connect still works for BYO wallets."""
        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_customer_wallets_enabled = True
            mock_settings.opentrust_byo_wallet_enabled = True
            mock_settings.opentrust_embedded_wallet_enabled = False
            response = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "user-456", "address": "0x" + "a" * 40, "kind": "byo"},
            )
        assert response.status_code == 200


class TestEscrowOrderFlow:
    async def test_order_without_tx_hash_and_escrow_disabled_returns_501(self, client):
        """Orders without a tx_hash should return 501 when escrow is disabled."""
        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_custodial_wallets_enabled = False
            mock_settings.opentrust_escrow_enabled = False
            response = await client.post(
                "/api/v1/marketplace/orders",
                json={"listing_id": "any", "buyer_wallet_id": "any"},
            )
        assert response.status_code == 501

    async def test_order_with_valid_tx_hash_verifies_and_creates_order(self, client):
        """Orders with a valid tx_hash call verify_usdc_transfer and create the order."""
        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_customer_wallets_enabled = True
            mock_settings.opentrust_byo_wallet_enabled = True
            mock_settings.opentrust_embedded_wallet_enabled = False
            mock_settings.base_rpc_url = "https://mainnet.base.org"
            mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

            # Set up: connect buyer and seller wallets
            buyer_resp = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "buyer", "address": "0x" + "b" * 40, "kind": "byo"},
            )
            seller_resp = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "seller", "address": "0x" + "c" * 40, "kind": "byo"},
            )
            buyer_wallet_id = buyer_resp.json()["wallet_id"]
            seller_wallet_id = seller_resp.json()["wallet_id"]

            # Create a listing in the store directly (bypasses repo verification for test simplicity)
            from api.src.schemas.marketplace import MarketplaceListing
            listing = MarketplaceListing(
                listing_id="listing_test_001",
                seller_wallet_id=seller_wallet_id,
                repo_id="repo_test",
                title="Test Tool",
                price_usdc=Decimal("19.00"),
            )
            store.listings[listing.listing_id] = listing

            # Mock verify_usdc_transfer to succeed
            with patch("api.src.routes.marketplace.verify_usdc_transfer") as mock_verify:
                mock_verify.return_value = MagicMock(
                    verified=True,
                    amount_usdc=Decimal("19.00"),
                    sender="0x" + "b" * 40,
                    recipient="0x" + "c" * 40,
                )
                order_resp = await client.post(
                    "/api/v1/marketplace/orders",
                    json={
                        "listing_id": "listing_test_001",
                        "buyer_wallet_id": buyer_wallet_id,
                        "transaction_hash": "0x" + "a" * 64,
                    },
                )
        assert order_resp.status_code == 200
        data = order_resp.json()
        assert data["listing_id"] == "listing_test_001"
        assert data["transaction_hash"] == "0x" + "a" * 64

    async def test_order_with_bad_tx_hash_returns_402(self, client):
        """Orders with a failing on-chain verification return 402."""
        from api.src.schemas.marketplace import MarketplaceListing
        from api.src.services.onchain import OnchainVerificationError

        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_customer_wallets_enabled = True
            mock_settings.opentrust_byo_wallet_enabled = True
            mock_settings.opentrust_embedded_wallet_enabled = False
            mock_settings.base_rpc_url = "https://mainnet.base.org"
            mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

            # Set up wallets and listing
            buyer_resp = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "buyer", "address": "0x" + "b" * 40, "kind": "byo"},
            )
            seller_resp = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "seller", "address": "0x" + "c" * 40, "kind": "byo"},
            )
            buyer_wallet_id = buyer_resp.json()["wallet_id"]
            seller_wallet_id = seller_resp.json()["wallet_id"]

            listing = MarketplaceListing(
                listing_id="listing_test_002",
                seller_wallet_id=seller_wallet_id,
                repo_id="repo_test",
                title="Test Tool",
                price_usdc=Decimal("19.00"),
            )
            store.listings[listing.listing_id] = listing

            with patch("api.src.routes.marketplace.verify_usdc_transfer") as mock_verify:
                mock_verify.side_effect = OnchainVerificationError("amount mismatch")
                order_resp = await client.post(
                    "/api/v1/marketplace/orders",
                    json={
                        "listing_id": "listing_test_002",
                        "buyer_wallet_id": buyer_wallet_id,
                        "transaction_hash": "0x" + "a" * 64,
                    },
                )
        assert order_resp.status_code == 402
        assert "amount mismatch" in order_resp.json()["detail"]

    async def test_direct_order_rejected_when_listing_requires_escrow(self, client):
        """Escrow-required listings cannot be bypassed with direct seller payment."""
        from api.src.schemas.marketplace import DeliveryProofRequirement, MarketplaceListing

        with patch("api.src.routes.marketplace.settings") as mock_settings:
            mock_settings.opentrust_customer_wallets_enabled = True
            mock_settings.opentrust_byo_wallet_enabled = True
            mock_settings.opentrust_embedded_wallet_enabled = False
            mock_settings.base_rpc_url = "https://mainnet.base.org"
            mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

            buyer_resp = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "buyer", "address": "0x" + "b" * 40, "kind": "byo"},
            )
            seller_resp = await client.post(
                "/api/v1/wallets/connect",
                json={"owner": "seller", "address": "0x" + "c" * 40, "kind": "byo"},
            )
            buyer_wallet_id = buyer_resp.json()["wallet_id"]
            seller_wallet_id = seller_resp.json()["wallet_id"]

            listing = MarketplaceListing(
                listing_id="listing_requires_escrow",
                seller_wallet_id=seller_wallet_id,
                repo_id="repo_test",
                title="Escrowed Tool",
                price_usdc=Decimal("19.00"),
                escrow_required=True,
                delivery_proof=DeliveryProofRequirement(
                    type="hash_match",
                    standard="Deliver a result hash matching the agreed artifact.",
                    timeout_seconds=900,
                    result_hash_required=True,
                ),
                seller_passport_id="seller-passport",
                seller_trust_level=3,
                seller_trust_status="seller_confirmed",
            )
            store.listings[listing.listing_id] = listing

            with patch("api.src.routes.marketplace.verify_usdc_transfer") as mock_verify:
                mock_verify.return_value = MagicMock(verified=True)
                order_resp = await client.post(
                    "/api/v1/marketplace/orders",
                    json={
                        "listing_id": "listing_requires_escrow",
                        "buyer_wallet_id": buyer_wallet_id,
                        "transaction_hash": "0x" + "a" * 64,
                    },
                )

        assert order_resp.status_code == 403
        assert "requires escrow" in order_resp.json()["detail"]
        mock_verify.assert_not_called()


class TestOnchainPaymentVerificationEndpoint:
    async def test_valid_tx_returns_verified_true(self, client):
        """POST /payments/verify-onchain returns 200 and verified=True for a valid tx."""
        with patch("api.src.routes.payments.verify_usdc_transfer") as mock_verify:
            mock_verify.return_value = MagicMock(
                verified=True,
                amount_usdc=Decimal("25.00"),
                sender="0x" + "a" * 40,
                recipient="0x" + "b" * 40,
                tx_hash="0x" + "c" * 64,
            )
            response = await client.post(
                "/api/v1/payments/verify-onchain",
                json={
                    "tx_hash": "0x" + "c" * 64,
                    "expected_sender": "0x" + "a" * 40,
                    "expected_recipient": "0x" + "b" * 40,
                    "expected_amount_usdc": "25.00",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["verified"] is True
        assert data["amount_usdc"] == "25.00"
        assert data["sender"] == "0x" + "a" * 40
        assert data["recipient"] == "0x" + "b" * 40

    async def test_invalid_tx_returns_400(self, client):
        """POST /payments/verify-onchain returns 400 when on-chain verification fails."""
        from api.src.services.onchain import OnchainVerificationError

        with patch("api.src.routes.payments.verify_usdc_transfer") as mock_verify:
            mock_verify.side_effect = OnchainVerificationError("amount mismatch: expected 25.00 USDC, got 10.00 USDC")
            response = await client.post(
                "/api/v1/payments/verify-onchain",
                json={
                    "tx_hash": "0x" + "c" * 64,
                    "expected_sender": "0x" + "a" * 40,
                    "expected_recipient": "0x" + "b" * 40,
                    "expected_amount_usdc": "25.00",
                },
            )
        assert response.status_code == 400
        assert "amount mismatch" in response.json()["detail"]

    async def test_malformed_tx_hash_returns_422(self, client):
        """POST /payments/verify-onchain returns 422 for a malformed tx_hash (schema validation)."""
        response = await client.post(
            "/api/v1/payments/verify-onchain",
            json={
                "tx_hash": "not-a-hash",
                "expected_sender": "0x" + "a" * 40,
                "expected_recipient": "0x" + "b" * 40,
                "expected_amount_usdc": "25.00",
            },
        )
        assert response.status_code == 422

    async def test_invalid_amount_string_returns_422(self, client):
        """POST /payments/verify-onchain returns 422 for a non-numeric amount string."""
        response = await client.post(
            "/api/v1/payments/verify-onchain",
            json={
                "tx_hash": "0x" + "c" * 64,
                "expected_sender": "0x" + "a" * 40,
                "expected_recipient": "0x" + "b" * 40,
                "expected_amount_usdc": "not-a-number",
            },
        )
        assert response.status_code == 422
