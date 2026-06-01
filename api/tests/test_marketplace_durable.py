"""Marketplace listings/orders are durable and repo-optional.

A real catalog: sellers create listings without needing a GitHub-verified repo,
listings persist to the DB and are served from it (surviving cold starts), and
the catalog is visible to a fresh store backed by the same DB.
"""
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
