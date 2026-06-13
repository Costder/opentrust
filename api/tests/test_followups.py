"""Tests for the security follow-up fixes:

- Coinbase webhook HMAC signature verification (was an unauthenticated accept-all)
- one paid checkout can only mint one trust report (checkout reuse)
- list_tools total uses SELECT COUNT(*) (no full-table scan)
"""
import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app
from api.src.schemas.marketplace import (
    CheckoutRequest,
    PaymentStatus,
    ProductCode,
    TrustReportRequest,
    VerifiedRepo,
)
from api.src.services.marketplace_store import store


@pytest.fixture(autouse=True)
def reset_store():
    store.reset()
    yield
    store.reset()


@pytest.fixture
async def client(tmp_path):
    from api.src.config import settings

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "followups.db")
    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


# ── Checkout reuse ────────────────────────────────────────────────────────────


def test_create_report_consumes_checkout():
    store.repos["repo_test"] = VerifiedRepo(
        repo_id="repo_test", installation_id=1, repo_full_name="acme/tool", branch="main", commit_sha="abc1234"
    )
    chk = store.create_checkout(CheckoutRequest(product_code=ProductCode.trust_report, repo_id="repo_test"))
    assert chk.status == PaymentStatus.paid
    req = TrustReportRequest(repo_id="repo_test", checkout_id=chk.checkout_id)

    store.create_report(req)  # first redemption is fine
    with pytest.raises(PermissionError):
        store.create_report(req)  # the same checkout cannot be reused


# ── Coinbase webhook signature verification ───────────────────────────────────

WEBHOOK_PATH = "/api/v1/payments/coinbase/webhooks"
SECRET = "coinbase-webhook-secret"


def _sign(body: bytes) -> str:
    return hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


async def test_webhook_missing_secret_returns_503(client):
    with patch("api.src.routes.marketplace.settings") as ms:
        ms.coinbase_business_webhook_secret = ""
        resp = await client.post(WEBHOOK_PATH, content=b"{}", headers={"X-CC-Webhook-Signature": "x"})
    assert resp.status_code == 503


async def test_webhook_bad_signature_returns_401(client):
    body = json.dumps({"event": {"type": "charge:confirmed"}}).encode()
    with patch("api.src.routes.marketplace.settings") as ms:
        ms.coinbase_business_webhook_secret = SECRET
        resp = await client.post(WEBHOOK_PATH, content=body, headers={"X-CC-Webhook-Signature": "deadbeef"})
    assert resp.status_code == 401


async def test_webhook_valid_signature_marks_checkout_paid(client):
    chk = store.create_checkout(CheckoutRequest(product_code=ProductCode.trust_report))
    chk.status = PaymentStatus.created  # pretend it is awaiting payment
    body = json.dumps(
        {"event": {"type": "charge:confirmed", "data": {"metadata": {"checkout_id": chk.checkout_id}}}}
    ).encode()
    with patch("api.src.routes.marketplace.settings") as ms:
        ms.coinbase_business_webhook_secret = SECRET
        resp = await client.post(WEBHOOK_PATH, content=body, headers={"X-CC-Webhook-Signature": _sign(body)})
    assert resp.status_code == 200
    assert store.checkouts[chk.checkout_id].status == PaymentStatus.paid


# ── list_tools total via COUNT(*) ─────────────────────────────────────────────


async def test_claim_object_is_atomic_and_unique(tmp_path):
    """claim_object inserts once and reports False on any later claim of the same
    (kind, obj_id) — the atomic guard behind replay protection."""
    from api.src.config import settings
    from api.src.database import Database

    orig = settings.sqlite_path
    settings.sqlite_path = str(tmp_path / "claim.db")
    try:
        d = Database()
        await d.init()
        assert await d.claim_object("consumed_tx", "0xabc", {"n": 1}) is True
        assert await d.claim_object("consumed_tx", "0xabc", {"n": 2}) is False
        # The original value is preserved (the second claim did not overwrite it).
        assert (await d.get_object("consumed_tx", "0xabc")) == {"n": 1}
    finally:
        settings.sqlite_path = orig


async def test_list_tools_total_counts_all_matches(client):
    payload = {
        "tool_identity": {"slug": "count-me", "name": "Count Me"},
        "description": "x",
        "trust_status": "community_reviewed",
        "version_hash": {"version": "1.0.0", "commit": "abc1234"},
        "capabilities": ["x"],
        "permission_manifest": {"network": True},
        "commercial_status": {"model": "free"},
        "agent_access": {"allowed": True, "kind": "mcp_server"},
    }
    created = await client.post("/api/v1/tools", json=payload)
    assert created.status_code in (200, 201), created.text
    listing = await client.get("/api/v1/tools?q=Count")
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] == len(body["items"]) == 1
