"""HTTP layer for metered billing: fund (on-chain verified), meter, reads, earnings.

Mirrors the escrow tests' style: patch settings + verify_usdc_transfer so no real
chain access is needed. Uses a temp-DB client so persistence is exercised too.
"""
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app
from api.src.services.marketplace_store import store

TX = "0x" + "a" * 64
BUYER = "0x" + "b" * 40
SELLER = "0x" + "c" * 40


@pytest.fixture
async def client(tmp_path):
    from api.src.config import settings

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "u.db")
    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    store.reset()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, test_db
    app.dependency_overrides.clear()
    store.reset()
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


async def _setup(c):
    buyer = (await c.post("/api/v1/wallets/connect", json={"owner": "b", "address": BUYER, "kind": "byo"})).json()
    seller = (await c.post("/api/v1/wallets/connect", json={"owner": "s", "address": SELLER, "kind": "byo"})).json()
    listing = (await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller["wallet_id"], "title": "Metered", "price_usdc": "1.00",
        "provider_kind": "tool", "pricing_model": "per_call", "unit_price_usdc": "0.01", "unit_label": "call",
    })).json()
    return buyer, seller, listing


async def _fund(c, listing, buyer, amount="1.00"):
    with patch("api.src.routes.usage.settings") as ms, patch("api.src.routes.usage.verify_usdc_transfer") as mv:
        ms.base_rpc_url = "https://mainnet.base.org"
        ms.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        mv.return_value = MagicMock(verified=True, amount_usdc=Decimal(amount))
        return await c.post("/api/v1/usage/fund", json={
            "listing_id": listing["listing_id"], "buyer_wallet_id": buyer["wallet_id"],
            "amount_usdc": amount, "transaction_hash": TX,
        })


async def test_fund_verifies_onchain_and_credits(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    resp = await _fund(c, listing, buyer, "1.00")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["balance_usdc"] == "1.00"
    assert body["seller_wallet_id"] == seller["wallet_id"]


async def test_fund_bad_onchain_returns_402(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    from api.src.services.onchain import OnchainVerificationError
    with patch("api.src.routes.usage.settings") as ms, patch("api.src.routes.usage.verify_usdc_transfer") as mv:
        ms.base_rpc_url = "x"; ms.base_usdc_contract = "y"
        mv.side_effect = OnchainVerificationError("amount mismatch")
        resp = await c.post("/api/v1/usage/fund", json={
            "listing_id": listing["listing_id"], "buyer_wallet_id": buyer["wallet_id"],
            "amount_usdc": "1.00", "transaction_hash": TX,
        })
    assert resp.status_code == 402


async def test_meter_drawdown_via_http(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    acct = (await _fund(c, listing, buyer, "0.05")).json()
    resp = await c.post("/api/v1/usage/meter", json={
        "account_id": acct["account_id"], "quantity": 1, "idempotency_key": "k1",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["allowed"] is True
    assert str(resp.json()["balance_after_usdc"]) == "0.04"


async def test_meter_insufficient_returns_402(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    acct = (await _fund(c, listing, buyer, "0.005")).json()  # less than one 0.01 call
    resp = await c.post("/api/v1/usage/meter", json={
        "account_id": acct["account_id"], "quantity": 1, "idempotency_key": "k1",
    })
    assert resp.status_code == 402
    assert "balance" in resp.json()["detail"].lower()


async def test_get_account_and_events(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    acct = (await _fund(c, listing, buyer, "1.00")).json()
    await c.post("/api/v1/usage/meter", json={"account_id": acct["account_id"], "quantity": 3, "idempotency_key": "e1"})
    got = await c.get(f"/api/v1/usage/accounts/{acct['account_id']}")
    assert got.status_code == 200
    assert got.json()["calls_count"] == 1
    events = await c.get(f"/api/v1/usage/accounts/{acct['account_id']}/events")
    assert len(events.json()) == 1


async def test_find_account_by_listing_and_buyer(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    await _fund(c, listing, buyer, "1.00")
    resp = await c.get(f"/api/v1/usage/accounts?listing_id={listing['listing_id']}&buyer_wallet_id={buyer['wallet_id']}")
    assert resp.status_code == 200
    assert resp.json()["listing_id"] == listing["listing_id"]


async def test_seller_earnings(client):
    c, _ = client
    buyer, seller, listing = await _setup(c)
    acct = (await _fund(c, listing, buyer, "1.00")).json()
    await c.post("/api/v1/usage/meter", json={"account_id": acct["account_id"], "quantity": 10, "idempotency_key": "x"})
    resp = await c.get(f"/api/v1/usage/earnings?seller_wallet_id={seller['wallet_id']}")
    assert resp.status_code == 200
    assert resp.json()["consumed_usdc"] == "0.10"


async def test_account_persists_across_cold_start(client):
    c, test_db = client
    buyer, seller, listing = await _setup(c)
    acct = (await _fund(c, listing, buyer, "1.00")).json()
    # cold start: clear the in-memory working set
    store.usage_accounts.clear()
    got = await c.get(f"/api/v1/usage/accounts/{acct['account_id']}")
    assert got.status_code == 200
    assert got.json()["balance_usdc"] == "1.00"
