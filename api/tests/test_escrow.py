"""Tests for trust-verified marketplace escrow flows."""

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.main import app
from api.src.middleware.auth import mint_wallet_token
from api.src.schemas.marketplace import (
    DeliveryProofRequirement,
    MarketplaceListing,
    WalletAccount,
    WalletKind,
)
from api.src.services.marketplace_store import store


def _auth(wallet_id: str) -> dict:
    """Authorization header carrying a party session token for ``wallet_id``."""
    return {"Authorization": f"Bearer {mint_wallet_token(wallet_id)}"}


BUYER_ADDRESS = "0x" + "b" * 40
SELLER_ADDRESS = "0x" + "c" * 40
ESCROW_ADDRESS = "0x" + "e" * 40
TX_HASH = "0x" + "a" * 64


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def seed_wallets() -> tuple[str, str]:
    buyer = WalletAccount(
        wallet_id="wallet_buyer",
        owner="buyer",
        address=BUYER_ADDRESS,
        kind=WalletKind.byo,
    )
    seller = WalletAccount(
        wallet_id="wallet_seller",
        owner="seller",
        address=SELLER_ADDRESS,
        kind=WalletKind.byo,
    )
    store.wallets[buyer.wallet_id] = buyer
    store.wallets[seller.wallet_id] = seller
    return buyer.wallet_id, seller.wallet_id


def seed_listing(
    *,
    seller_wallet_id: str = "wallet_seller",
    delivery_proof: DeliveryProofRequirement | None = None,
    seller_trust_level: int | None = 3,
    seller_trust_status: str | None = "seller_confirmed",
    escrow_required: bool = True,
) -> str:
    listing = MarketplaceListing(
        listing_id="listing_escrow",
        seller_wallet_id=seller_wallet_id,
        repo_id="repo_test",
        title="Agent work package",
        price_usdc=Decimal("25.00"),
        escrow_required=escrow_required,
        delivery_proof=delivery_proof,
        seller_passport_id="seller-passport",
        seller_trust_level=seller_trust_level,
        seller_trust_status=seller_trust_status,
    )
    store.listings[listing.listing_id] = listing
    return listing.listing_id


def proof() -> DeliveryProofRequirement:
    return DeliveryProofRequirement(
        type="hash_match",
        standard="Provider must submit the SHA-256 result hash for the delivered work.",
        timeout_seconds=900,
        result_hash_required=True,
    )


async def create_escrow(client, *, enabled: bool = True) -> dict:
    buyer_wallet_id, _ = seed_wallets()
    listing_id = seed_listing(delivery_proof=proof())
    with patch("api.src.routes.payments.settings") as mock_settings:
        mock_settings.opentrust_escrow_enabled = enabled
        mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        response = await client.post(
            "/api/v1/escrow/create",
            json={"listing_id": listing_id, "buyer_wallet_id": buyer_wallet_id},
        )
    return response.json()


class TestCreateEscrow:
    async def test_create_escrow_disabled_returns_403(self, client):
        buyer_wallet_id, _ = seed_wallets()
        listing_id = seed_listing(delivery_proof=proof())

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.opentrust_escrow_enabled = False
            response = await client.post(
                "/api/v1/escrow/create",
                json={"listing_id": listing_id, "buyer_wallet_id": buyer_wallet_id},
            )

        assert response.status_code == 403
        assert response.json()["detail"] == "escrow is disabled"

    async def test_create_escrow_requires_delivery_proof(self, client):
        buyer_wallet_id, _ = seed_wallets()
        listing_id = seed_listing(delivery_proof=None)

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.opentrust_escrow_enabled = True
            response = await client.post(
                "/api/v1/escrow/create",
                json={"listing_id": listing_id, "buyer_wallet_id": buyer_wallet_id},
            )

        assert response.status_code == 422
        assert "delivery proof" in response.json()["detail"]

    async def test_create_escrow_requires_seller_trust_level_three(self, client):
        buyer_wallet_id, _ = seed_wallets()
        listing_id = seed_listing(delivery_proof=proof(), seller_trust_level=2)

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.opentrust_escrow_enabled = True
            response = await client.post(
                "/api/v1/escrow/create",
                json={"listing_id": listing_id, "buyer_wallet_id": buyer_wallet_id},
            )

        assert response.status_code == 403
        assert "seller trust level" in response.json()["detail"]

    async def test_create_escrow_rejects_disputed_seller(self, client):
        buyer_wallet_id, _ = seed_wallets()
        listing_id = seed_listing(delivery_proof=proof(), seller_trust_status="disputed")

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.opentrust_escrow_enabled = True
            response = await client.post(
                "/api/v1/escrow/create",
                json={"listing_id": listing_id, "buyer_wallet_id": buyer_wallet_id},
            )

        assert response.status_code == 403
        assert response.json()["detail"] == "seller passport is disputed"

    async def test_create_escrow_returns_deposit_instructions(self, client):
        buyer_wallet_id, _ = seed_wallets()
        listing_id = seed_listing(delivery_proof=proof())

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.opentrust_escrow_enabled = True
            mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
            response = await client.post(
                "/api/v1/escrow/create",
                json={"listing_id": listing_id, "buyer_wallet_id": buyer_wallet_id},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "created"
        assert data["amount_usdc"] == "25.00"
        assert data["deposit"]["recipient_address"] == ESCROW_ADDRESS
        assert data["deposit"]["token"] == "USDC"


class TestEscrowLifecycle:
    async def test_verify_deposit_uses_onchain_usdc_transfer(self, client):
        escrow = await create_escrow(client)

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.base_rpc_url = "https://mainnet.base.org"
            mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
            with patch("api.src.routes.payments.verify_usdc_transfer") as mock_verify:
                mock_verify.return_value = MagicMock(verified=True)
                response = await client.post(
                    f"/api/v1/escrow/{escrow['escrow_id']}/verify-deposit",
                    json={"tx_hash": TX_HASH},
                    headers=_auth("wallet_buyer"),
                )

        assert response.status_code == 200
        assert response.json()["status"] == "funded"
        mock_verify.assert_called_once()
        call = mock_verify.call_args.kwargs
        assert call["expected_sender"] == BUYER_ADDRESS
        assert call["expected_recipient"] == ESCROW_ADDRESS
        assert call["expected_amount_usdc"] == Decimal("25.00")

    async def test_failed_deposit_verification_returns_402(self, client):
        from api.src.services.onchain import OnchainVerificationError

        escrow = await create_escrow(client)

        with patch("api.src.routes.payments.settings") as mock_settings:
            mock_settings.base_rpc_url = "https://mainnet.base.org"
            mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
            with patch("api.src.routes.payments.verify_usdc_transfer") as mock_verify:
                mock_verify.side_effect = OnchainVerificationError("amount mismatch")
                response = await client.post(
                    f"/api/v1/escrow/{escrow['escrow_id']}/verify-deposit",
                    json={"tx_hash": TX_HASH},
                    headers=_auth("wallet_buyer"),
                )

        assert response.status_code == 402
        assert "amount mismatch" in response.json()["detail"]

    async def test_delivery_before_funding_returns_409(self, client):
        escrow = await create_escrow(client)

        response = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/deliver",
            json={"result_hash": "sha256:abc"},
            headers=_auth("wallet_seller"),
        )

        assert response.status_code == 409
        assert "funded" in response.json()["detail"]

    async def test_deliver_release_and_read_escrow(self, client):
        escrow = await create_escrow(client)
        store.verify_escrow_deposit(escrow["escrow_id"], TX_HASH)

        deliver = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/deliver",
            json={"result_hash": "sha256:abc", "artifact_uri": "https://example.test/out"},
            headers=_auth("wallet_seller"),
        )
        # Buyer approves release immediately (allowed at any time).
        release = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/release",
            headers=_auth("wallet_buyer"),
        )
        read = await client.get(f"/api/v1/escrow/{escrow['escrow_id']}")

        assert deliver.status_code == 200
        assert deliver.json()["status"] == "delivered"
        assert release.status_code == 200
        assert release.json()["status"] == "released"
        assert release.json()["settlement_tx_hash"].startswith("mock_release_")
        assert read.status_code == 200
        assert read.json()["status"] == "released"

    async def test_dispute_blocks_release_and_allows_refund(self, client):
        escrow = await create_escrow(client)
        store.verify_escrow_deposit(escrow["escrow_id"], TX_HASH)

        dispute = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/disputes",
            json={"reason": "delivery missing required files"},
            headers=_auth("wallet_buyer"),
        )
        release = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/release",
            headers=_auth("wallet_buyer"),
        )
        refund = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/refund",
            headers=_auth("wallet_buyer"),
        )

        assert dispute.status_code == 200
        assert dispute.json()["status"] == "disputed"
        assert release.status_code == 409
        assert refund.status_code == 200
        assert refund.json()["status"] == "refunded"
        assert refund.json()["refund_tx_hash"].startswith("mock_refund_")

    async def test_unauthenticated_requests_are_rejected(self, client):
        escrow = await create_escrow(client)
        store.verify_escrow_deposit(escrow["escrow_id"], TX_HASH)
        # No bearer token at all.
        resp = await client.post(f"/api/v1/escrow/{escrow['escrow_id']}/deliver", json={"result_hash": "x"})
        assert resp.status_code == 401

    async def test_deliver_rejected_for_non_seller(self, client):
        escrow = await create_escrow(client)
        store.verify_escrow_deposit(escrow["escrow_id"], TX_HASH)
        # Buyer (not the seller) attempts to mark delivery.
        resp = await client.post(
            f"/api/v1/escrow/{escrow['escrow_id']}/deliver",
            json={"result_hash": "sha256:abc"},
            headers=_auth("wallet_buyer"),
        )
        assert resp.status_code == 403
        assert "seller" in resp.json()["detail"]

    async def test_seller_self_release_blocked_until_window_then_allowed(self, client):
        escrow = await create_escrow(client)
        eid = escrow["escrow_id"]
        store.verify_escrow_deposit(eid, TX_HASH)
        await client.post(
            f"/api/v1/escrow/{eid}/deliver",
            json={"result_hash": "sha256:abc"},
            headers=_auth("wallet_seller"),
        )
        # Seller tries to self-release before the dispute window elapses → 403.
        early = await client.post(f"/api/v1/escrow/{eid}/release", headers=_auth("wallet_seller"))
        assert early.status_code == 403
        assert "dispute window" in early.json()["detail"]

        # Simulate the window elapsing, then seller self-release succeeds.
        store.escrows[eid].release_available_at = "2000-01-01T00:00:00+00:00"
        late = await client.post(f"/api/v1/escrow/{eid}/release", headers=_auth("wallet_seller"))
        assert late.status_code == 200
        assert late.json()["status"] == "released"
