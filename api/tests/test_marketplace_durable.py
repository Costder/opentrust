"""Marketplace listings/orders are durable and repo-optional.

A real catalog: sellers create listings without needing a GitHub-verified repo,
listings persist to the DB and are served from it (surviving cold starts), and
the catalog is visible to a fresh store backed by the same DB.
"""
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app
from api.src.services.marketplace_store import store


@pytest.fixture
async def client(tmp_path):
    from api.src.config import settings

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "mkt.db")
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


async def _connect_seller(c):
    resp = await c.post("/api/v1/wallets/connect", json={"owner": "seller", "address": "0x" + "c" * 40, "kind": "byo"})
    return resp.json()["wallet_id"]


async def test_create_listing_without_repo(client):
    c, _ = client
    seller = await _connect_seller(c)
    resp = await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller,
        "title": "Standalone Tool",
        "price_usdc": "5.00",
        "provider_kind": "tool",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Standalone Tool"
    assert body["repo_id"] is None


async def test_listing_persists_to_db(client):
    c, test_db = client
    seller = await _connect_seller(c)
    created = (await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller, "title": "Durable Tool", "price_usdc": "9.00",
    })).json()
    stored = await test_db.get_object("listing", created["listing_id"])
    assert stored is not None
    assert stored["title"] == "Durable Tool"


async def test_get_wallet_returns_public_address(client):
    c, _ = client
    seller = await _connect_seller(c)
    resp = await c.get(f"/api/v1/wallets/{seller}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["wallet_id"] == seller
    assert body["address"] == "0x" + "c" * 40


async def test_get_wallet_404_for_unknown(client):
    c, _ = client
    resp = await c.get("/api/v1/wallets/wallet_nope")
    assert resp.status_code == 404


async def test_seller_can_delete_own_listing(client):
    c, test_db = client
    seller = await _connect_seller(c)
    created = (await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller, "title": "Temp", "price_usdc": "2.00",
    })).json()
    lid = created["listing_id"]
    resp = await c.request("DELETE", f"/api/v1/marketplace/listings/{lid}",
                           json={"seller_wallet_id": seller})
    assert resp.status_code == 200, resp.text
    assert await test_db.get_object("listing", lid) is None
    listings = (await c.get("/api/v1/marketplace/listings")).json()
    assert all(l["listing_id"] != lid for l in listings)


async def test_cannot_delete_another_sellers_listing(client):
    c, _ = client
    seller = await _connect_seller(c)
    created = (await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller, "title": "Owned", "price_usdc": "2.00",
    })).json()
    other = (await c.post("/api/v1/wallets/connect", json={
        "owner": "mallory", "address": "0x" + "d" * 40, "kind": "byo"})).json()["wallet_id"]
    resp = await c.request("DELETE", f"/api/v1/marketplace/listings/{created['listing_id']}",
                           json={"seller_wallet_id": other})
    assert resp.status_code == 403


async def test_delete_unknown_listing_404(client):
    c, _ = client
    seller = await _connect_seller(c)
    resp = await c.request("DELETE", "/api/v1/marketplace/listings/listing_nope",
                           json={"seller_wallet_id": seller})
    assert resp.status_code == 404


async def test_listings_served_from_db_after_store_reset(client):
    """Simulates a cold start: clear the in-memory store, listings still appear."""
    c, _ = client
    seller = await _connect_seller(c)
    await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller, "title": "Survivor", "price_usdc": "3.00",
    })
    store.listings.clear()  # cold start: working set is empty
    resp = await c.get("/api/v1/marketplace/listings")
    assert resp.status_code == 200
    titles = [l["title"] for l in resp.json()]
    assert "Survivor" in titles


# ── Wallet durability (regression: wallets were in-memory only) ──────────────
# Wallet existence gates listing/order/escrow creation. Listings persisted to the
# DB but wallets did not, so after a serverless cold start a seeded listing's
# seller wallet no longer resolved and every downstream money flow 404'd.


async def _connect_wallet(c, owner: str, addr: str) -> str:
    resp = await c.post("/api/v1/wallets/connect", json={"owner": owner, "address": addr, "kind": "byo"})
    assert resp.status_code == 200, resp.text
    return resp.json()["wallet_id"]


async def test_wallet_persists_to_db(client):
    c, test_db = client
    seller = await _connect_seller(c)
    stored = await test_db.get_object("wallet", seller)
    assert stored is not None
    assert stored["address"] == "0x" + "c" * 40


async def test_seller_wallet_resolves_after_cold_start(client):
    """Cold start: in-memory wallets are gone, but a connected wallet resolves from DB."""
    c, _ = client
    seller = await _connect_seller(c)
    store.reset()  # cold start: working set is empty
    resp = await c.get(f"/api/v1/wallets/{seller}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["wallet_id"] == seller
    assert resp.json()["address"] == "0x" + "c" * 40


async def test_create_listing_resolves_seller_after_cold_start(client):
    """A listing's seller wallet, connected before a cold start, must still be found."""
    c, _ = client
    seller = await _connect_seller(c)
    store.reset()  # cold start
    resp = await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller, "title": "Post-coldstart", "price_usdc": "7.00",
    })
    assert resp.status_code == 200, resp.text
    assert resp.json()["seller_wallet_id"] == seller


async def test_escrow_creatable_on_seeded_listing_after_cold_start(client):
    """The reported bug end-to-end: escrow on a seeded listing fails after a cold start.

    Without wallet+listing hydration this 404s ('listing does not exist' or
    'seller wallet is not connected'); with it, escrow creation succeeds.
    """
    c, _ = client
    seller = await _connect_wallet(c, "seller", "0x" + "c" * 40)
    buyer = await _connect_wallet(c, "buyer", "0x" + "b" * 40)
    created = await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller,
        "title": "Agent work package",
        "price_usdc": "25.00",
        "escrow_required": True,
        "seller_passport_id": "seller-passport",
        "seller_trust_level": 3,
        "seller_trust_status": "seller_confirmed",
        "delivery_proof": {
            "type": "hash_match",
            "standard": "Provider submits SHA-256 of the delivered work.",
            "timeout_seconds": 900,
            "result_hash_required": True,
        },
    })
    assert created.status_code == 200, created.text
    listing_id = created.json()["listing_id"]

    store.reset()  # cold start: wallets + listing gone from memory, still in DB

    with patch("api.src.routes.payments.settings") as mock_settings:
        mock_settings.opentrust_escrow_enabled = True
        mock_settings.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        resp = await c.post("/api/v1/escrow/create", json={
            "listing_id": listing_id, "buyer_wallet_id": buyer,
        })
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "created"
    assert resp.json()["amount_usdc"] == "25.00"


# ── Lifecycle durability (escrow + jobs + reputation across cold starts) ──────


async def test_escrow_lifecycle_survives_cold_start(client):
    """Full escrow lifecycle with a serverless cold start before EVERY step:
    create -> verify-deposit -> deliver -> release, then read escrow + reputation.
    Each transition must hydrate from the DB and re-persist its result."""
    c, _ = client
    seller = await _connect_wallet(c, "seller", "0x" + "c" * 40)
    buyer = await _connect_wallet(c, "buyer", "0x" + "b" * 40)
    created = await c.post("/api/v1/marketplace/listings", json={
        "seller_wallet_id": seller,
        "title": "Agent work package",
        "price_usdc": "25.00",
        "escrow_required": True,
        "seller_passport_id": "seller-passport",
        "seller_trust_level": 3,
        "seller_trust_status": "seller_confirmed",
        "delivery_proof": {
            "type": "hash_match",
            "standard": "SHA-256 of the delivered work.",
            "timeout_seconds": 900,
            "result_hash_required": True,
        },
    })
    assert created.status_code == 200, created.text
    listing_id = created.json()["listing_id"]

    with patch("api.src.routes.payments.settings") as ms:
        ms.opentrust_escrow_enabled = True
        ms.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        resp = await c.post("/api/v1/escrow/create", json={
            "listing_id": listing_id, "buyer_wallet_id": buyer,
        })
    assert resp.status_code == 200, resp.text
    escrow_id = resp.json()["escrow_id"]

    store.reset()  # cold start before verify-deposit (needs escrow + buyer wallet from DB)
    with patch("api.src.routes.payments.settings") as ms, \
         patch("api.src.routes.payments.verify_usdc_transfer") as mock_verify:
        ms.base_rpc_url = "https://mainnet.base.org"
        ms.base_usdc_contract = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        mock_verify.return_value = MagicMock(verified=True)
        resp = await c.post(f"/api/v1/escrow/{escrow_id}/verify-deposit", json={"tx_hash": "0x" + "a" * 64})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "funded"

    store.reset()  # cold start before deliver
    resp = await c.post(f"/api/v1/escrow/{escrow_id}/deliver", json={"result_hash": "sha256:abc"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "delivered"

    store.reset()  # cold start before release (mutates escrow + reputation)
    resp = await c.post(f"/api/v1/escrow/{escrow_id}/release")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "released"

    store.reset()  # cold start before reading escrow + seller reputation
    read = await c.get(f"/api/v1/escrow/{escrow_id}")
    assert read.status_code == 200
    assert read.json()["status"] == "released"
    rep = await c.get("/api/v1/reputation/seller-passport", params={"kind": "server"})
    assert rep.status_code == 200, rep.text
    assert rep.json()["deals_released"] >= 1


async def test_jobs_board_survives_cold_start(client):
    """A posted job must still be listable and fetchable after a cold start."""
    c, _ = client
    client_wallet = await _connect_wallet(c, "client", "0x" + "1" * 40)
    created = await c.post("/api/v1/jobs", json={
        "client_wallet_id": client_wallet,
        "title": "Summarize 100 PDFs",
        "description": "Need an agent to summarize a corpus.",
        "budget_usdc": "25.00",
        "provider_kind": "agent_service",
        "delivery_proof": {
            "type": "http_endpoint",
            "standard": "opentrust/delivery-proof@v1",
            "timeout_seconds": 3600,
            "result_hash_required": False,
        },
    })
    assert created.status_code == 200, created.text
    job_id = created.json()["job_id"]

    store.reset()  # cold start
    listed = await c.get("/api/v1/jobs")
    assert listed.status_code == 200
    assert any(j["job_id"] == job_id for j in listed.json())
    got = await c.get(f"/api/v1/jobs/{job_id}")
    assert got.status_code == 200
    assert got.json()["title"] == "Summarize 100 PDFs"
