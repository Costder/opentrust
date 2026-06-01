"""Demo separation, soft-delete, and admin-gated registry management.

- passports carry is_demo + hidden flags (additive columns, default false)
- /tools excludes demo and hidden by default; ?include_demo / ?demo_only toggle
- admin endpoints (Bearer REGISTRY_ADMIN_TOKEN) add/edit/soft-delete passports
"""
import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app

ADMIN = "test-admin-token"

_REAL = {
    "tool_identity": {"slug": "real-mcp", "name": "Real MCP"},
    "description": "a real server",
    "trust_status": "community_reviewed",
    "version_hash": {"version": "1.0.0", "commit": "abc1234"},
    "capabilities": ["x"],
    "permission_manifest": {"network": True},
    "commercial_status": {"model": "free"},
    "agent_access": {"allowed": True},
}


@pytest.fixture
async def client(tmp_path, monkeypatch):
    from api.src.config import settings
    from api.src.routes import well_known as wk

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path, settings.registry_admin_token)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "r.db")
    settings.registry_admin_token = ADMIN
    monkeypatch.setattr(wk.settings, "registry_admin_token", ADMIN, raising=False)
    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, test_db
    app.dependency_overrides.clear()
    (settings.turso_url, settings.turso_auth_token, settings.sqlite_path, settings.registry_admin_token) = orig


def _auth():
    return {"Authorization": f"Bearer {ADMIN}"}


# ── is_demo flag + filtering ─────────────────────────────────────────────────────

async def test_passport_defaults_not_demo(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    body = (await c.get("/api/v1/tools/real-mcp")).json()
    assert body["is_demo"] is False


async def test_list_excludes_demo_by_default(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    # admin-create a demo one
    demo = dict(_REAL, tool_identity={"slug": "demo-tool", "name": "Demo Tool"})
    await c.post("/api/v1/admin/tools", json={**demo, "is_demo": True}, headers=_auth())

    default = (await c.get("/api/v1/tools?limit=100")).json()["items"]
    slugs = [t["slug"] for t in default]
    assert "real-mcp" in slugs
    assert "demo-tool" not in slugs


async def test_demo_only_filter(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    demo = dict(_REAL, tool_identity={"slug": "demo-tool", "name": "Demo Tool"})
    await c.post("/api/v1/admin/tools", json={**demo, "is_demo": True}, headers=_auth())

    demo_list = (await c.get("/api/v1/tools?demo_only=true&limit=100")).json()["items"]
    slugs = [t["slug"] for t in demo_list]
    assert slugs == ["demo-tool"]


# ── admin auth ────────────────────────────────────────────────────────────────

async def test_admin_create_requires_token(client):
    c, _ = client
    resp = await c.post("/api/v1/admin/tools", json=_REAL)
    assert resp.status_code == 401


async def test_admin_create_wrong_token_403(client):
    c, _ = client
    resp = await c.post("/api/v1/admin/tools", json=_REAL, headers={"Authorization": "Bearer nope"})
    assert resp.status_code == 403


async def test_admin_create_sets_trust_directly(client):
    c, _ = client
    payload = dict(_REAL, tool_identity={"slug": "vouched", "name": "Vouched"}, trust_status="reviewer_signed")
    resp = await c.post("/api/v1/admin/tools", json=payload, headers=_auth())
    assert resp.status_code == 201, resp.text
    assert resp.json()["trust_status"] == "reviewer_signed"


# ── soft delete ────────────────────────────────────────────────────────────────

async def test_admin_soft_delete_hides_from_list(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    resp = await c.request("DELETE", "/api/v1/admin/tools/real-mcp", headers=_auth())
    assert resp.status_code == 200, resp.text
    slugs = [t["slug"] for t in (await c.get("/api/v1/tools?limit=100")).json()["items"]]
    assert "real-mcp" not in slugs


async def test_admin_soft_delete_is_recoverable(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    await c.request("DELETE", "/api/v1/admin/tools/real-mcp", headers=_auth())
    # PATCH hidden back to false restores it
    resp = await c.patch("/api/v1/admin/tools/real-mcp", json={"hidden": False}, headers=_auth())
    assert resp.status_code == 200, resp.text
    slugs = [t["slug"] for t in (await c.get("/api/v1/tools?limit=100")).json()["items"]]
    assert "real-mcp" in slugs


async def test_admin_delete_requires_token(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    resp = await c.request("DELETE", "/api/v1/admin/tools/real-mcp")
    assert resp.status_code == 401


# ── admin patch trust / demo ────────────────────────────────────────────────────

async def test_admin_patch_trust_and_demo(client):
    c, _ = client
    await c.post("/api/v1/tools", json=_REAL)
    resp = await c.patch("/api/v1/admin/tools/real-mcp",
                         json={"trust_status": "security_checked", "is_demo": True}, headers=_auth())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["trust_status"] == "security_checked"
    assert body["is_demo"] is True
