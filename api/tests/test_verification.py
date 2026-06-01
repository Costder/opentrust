"""Differentiated verification tests.

Humans and agents verify through separate paths that map to different starting
trust levels:

- wallet signature challenge  -> creator_claimed (L2)
- human owner claim (GitHub)   -> seller_confirmed (L3), owner_github public
- $10 USDC fee (on-chain)      -> community_reviewed (L4)

These advance a passport's trust_status without OAuth gating the endpoints
themselves — proof is the mechanism (signature / on-chain tx), not a session.
"""
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app
from api.src.schemas.marketplace import WalletConnectRequest
from api.src.services.marketplace_store import store

TREASURY = "0x" + "7" * 40


_PASSPORT = {
    "tool_identity": {"slug": "verify-agent", "name": "Verify Agent"},
    "description": "An agent under test.",
    "trust_status": "auto_generated_draft",
    "version_hash": {"version": "1.0.0", "commit": "abc1234"},
    "capabilities": ["research"],
    "permission_manifest": {"network": True},
    "commercial_status": {"model": "free"},
    "agent_access": {"allowed": True},
}


@pytest.fixture
async def client(tmp_path):
    from api.src.config import settings

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "test.db")

    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    from api.src.routes.passport_verify import _reset_verification_state

    app.dependency_overrides[get_db] = _override
    store.reset()
    _reset_verification_state()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    store.reset()
    _reset_verification_state()
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


async def _create_passport(client):
    resp = await client.post("/api/v1/tools", json=_PASSPORT)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _connect_wallet(address):
    return store.connect_wallet(WalletConnectRequest(owner="agent", address=address, kind="byo"))


# ── Wallet signature challenge -> L2 ────────────────────────────────────────────

async def test_challenge_returns_message(client):
    await _create_passport(client)
    resp = await client.post("/api/v1/passports/verify-agent/challenge")
    assert resp.status_code == 200
    body = resp.json()
    assert "challenge" in body
    assert body["challenge"].startswith("opentrust-verify:verify-agent:")


async def test_wallet_signature_advances_to_l2(client):
    await _create_passport(client)
    acct = Account.create()
    wallet = _connect_wallet(acct.address)

    challenge = (await client.post("/api/v1/passports/verify-agent/challenge")).json()["challenge"]
    signed = acct.sign_message(encode_defunct(text=challenge))

    resp = await client.post(
        "/api/v1/passports/verify-agent/verify-wallet",
        json={"wallet_id": wallet.wallet_id, "signature": "0x" + signed.signature.hex()},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["trust_status"] == "creator_claimed"


async def test_wrong_signer_rejected(client):
    await _create_passport(client)
    real = Account.create()
    attacker = Account.create()
    wallet = _connect_wallet(real.address)  # wallet claims real's address

    challenge = (await client.post("/api/v1/passports/verify-agent/challenge")).json()["challenge"]
    signed = attacker.sign_message(encode_defunct(text=challenge))  # signed by someone else

    resp = await client.post(
        "/api/v1/passports/verify-agent/verify-wallet",
        json={"wallet_id": wallet.wallet_id, "signature": "0x" + signed.signature.hex()},
    )
    assert resp.status_code == 403


async def test_challenge_is_one_time(client):
    await _create_passport(client)
    acct = Account.create()
    wallet = _connect_wallet(acct.address)
    challenge = (await client.post("/api/v1/passports/verify-agent/challenge")).json()["challenge"]
    signed = acct.sign_message(encode_defunct(text=challenge))
    sig = "0x" + signed.signature.hex()

    first = await client.post(
        "/api/v1/passports/verify-agent/verify-wallet",
        json={"wallet_id": wallet.wallet_id, "signature": sig},
    )
    assert first.status_code == 200
    # Re-using the consumed challenge fails
    second = await client.post(
        "/api/v1/passports/verify-agent/verify-wallet",
        json={"wallet_id": wallet.wallet_id, "signature": sig},
    )
    assert second.status_code == 400


# ── Human owner claim -> L3 ─────────────────────────────────────────────────────

async def test_owner_claim_advances_to_l3_and_shows_github(client):
    await _create_passport(client)
    with patch("api.src.routes.passport_verify.validate_github_token", return_value="octocat"):
        resp = await client.post(
            "/api/v1/passports/verify-agent/claim-owner",
            json={"github_handle": "octocat", "oauth_token": "gho_validtoken"},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["trust_status"] == "seller_confirmed"
    assert body["creator_identity"]["owner_github"] == "octocat"
    assert body["creator_identity"]["verification_path"] == "human_claimed"


async def test_owner_claim_rejects_mismatched_token(client):
    await _create_passport(client)
    # Token belongs to a different handle than claimed
    with patch("api.src.routes.passport_verify.validate_github_token", return_value="someone-else"):
        resp = await client.post(
            "/api/v1/passports/verify-agent/claim-owner",
            json={"github_handle": "octocat", "oauth_token": "gho_validtoken"},
        )
    assert resp.status_code == 403


async def test_owner_claim_rejects_invalid_token(client):
    await _create_passport(client)
    with patch("api.src.routes.passport_verify.validate_github_token", return_value=None):
        resp = await client.post(
            "/api/v1/passports/verify-agent/claim-owner",
            json={"github_handle": "octocat", "oauth_token": "bad"},
        )
    assert resp.status_code == 401


# ── Fee verification -> L4 ──────────────────────────────────────────────────────

async def test_fee_verification_advances_to_l4(client):
    await _create_passport(client)
    acct = Account.create()
    wallet = _connect_wallet(acct.address)

    with patch("api.src.routes.passport_verify.settings") as mock_settings:
        mock_settings.opentrust_registry_treasury_address = TREASURY
        mock_settings.opentrust_verification_fee_usdc = "10.00"
        mock_settings.base_rpc_url = "https://mainnet.base.org"
        mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        with patch("api.src.routes.passport_verify.verify_usdc_transfer") as mock_verify:
            mock_verify.return_value = MagicMock(verified=True, amount_usdc=Decimal("10.00"))
            resp = await client.post(
                "/api/v1/passports/verify-agent/fee-verify",
                json={"wallet_id": wallet.wallet_id, "tx_hash": "0x" + "a" * 64},
            )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["trust_status"] == "community_reviewed"
    assert body["creator_identity"]["verification_path"] == "fee_verified"


async def test_fee_tx_cannot_be_reused(client):
    await _create_passport(client)
    # second passport to try to reuse the same tx on
    second = dict(_PASSPORT)
    second["tool_identity"] = {"slug": "verify-agent-2", "name": "Verify Agent 2"}
    await client.post("/api/v1/tools", json=second)

    acct = Account.create()
    wallet = _connect_wallet(acct.address)
    tx = "0x" + "b" * 64

    with patch("api.src.routes.passport_verify.settings") as mock_settings:
        mock_settings.opentrust_registry_treasury_address = TREASURY
        mock_settings.opentrust_verification_fee_usdc = "10.00"
        mock_settings.base_rpc_url = "https://mainnet.base.org"
        mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        with patch("api.src.routes.passport_verify.verify_usdc_transfer") as mock_verify:
            mock_verify.return_value = MagicMock(verified=True, amount_usdc=Decimal("10.00"))
            first = await client.post(
                "/api/v1/passports/verify-agent/fee-verify",
                json={"wallet_id": wallet.wallet_id, "tx_hash": tx},
            )
            assert first.status_code == 200
            reuse = await client.post(
                "/api/v1/passports/verify-agent-2/fee-verify",
                json={"wallet_id": wallet.wallet_id, "tx_hash": tx},
            )
    assert reuse.status_code == 409


async def test_fee_rejects_failed_onchain(client):
    from api.src.services.onchain import OnchainVerificationError

    await _create_passport(client)
    acct = Account.create()
    wallet = _connect_wallet(acct.address)

    with patch("api.src.routes.passport_verify.settings") as mock_settings:
        mock_settings.opentrust_registry_treasury_address = TREASURY
        mock_settings.opentrust_verification_fee_usdc = "10.00"
        mock_settings.base_rpc_url = "https://mainnet.base.org"
        mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        with patch("api.src.routes.passport_verify.verify_usdc_transfer") as mock_verify:
            mock_verify.side_effect = OnchainVerificationError("amount mismatch")
            resp = await client.post(
                "/api/v1/passports/verify-agent/fee-verify",
                json={"wallet_id": wallet.wallet_id, "tx_hash": "0x" + "c" * 64},
            )
    assert resp.status_code == 402
