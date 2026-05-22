"""Tests for the passport CRUD routes and Database layer.

Uses a per-test temporary SQLite file so tests are fully isolated and
never touch the production Turso database.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app


# ── Minimal valid passport payload ───────────────────────────────────────────

_PASSPORT = {
    "tool_identity": {
        "slug": "test-tool",
        "name": "Test Tool",
        "version": "1.0.0",
        "publisher": "test-org",
    },
    "description": "A test tool for unit tests.",
    "trust_status": "auto_generated_draft",
    "version_hash": {"version": "1.0.0", "commit": "abc1234567"},
    "capabilities": ["read_files"],
    "permission_manifest": {"filesystem": {"read": True}},
    "commercial_status": {"model": "free"},
    "agent_access": {"allowed": True},
}


# ── Fixture: isolated ASGI client with a fresh SQLite DB ─────────────────────

@pytest.fixture
async def client(tmp_path):
    """Return an AsyncClient backed by a fresh temp-file SQLite database.

    Overrides the `get_db` FastAPI dependency so no test ever touches
    the production Turso database or the shared dev SQLite file.
    """
    from api.src.config import settings

    orig_url = settings.turso_url
    orig_token = settings.turso_auth_token
    orig_path = settings.sqlite_path

    # Point the Database class at a temp file and clear Turso creds.
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "test.db")

    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    settings.turso_url = orig_url
    settings.turso_auth_token = orig_token
    settings.sqlite_path = orig_path


# ── Tests ────────────────────────────────────────────────────────────────────

class TestListPassports:
    async def test_empty_db_returns_empty_list(self, client):
        resp = await client.get("/api/v1/tools")
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0
        assert body["page"] == 1

    async def test_after_create_list_returns_one_item(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["slug"] == "test-tool"

    async def test_search_filter_returns_match(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools", params={"q": "Test"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1

    async def test_trust_status_filter(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools", params={"trust_status": "auto_generated_draft"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    async def test_trust_status_filter_no_match(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools", params={"trust_status": "security_checked"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    async def test_pagination_limit(self, client):
        # Create two tools, then fetch page 1 with limit=1
        await client.post("/api/v1/tools", json=_PASSPORT)
        second = {**_PASSPORT, "tool_identity": {**_PASSPORT["tool_identity"], "slug": "test-tool-2", "name": "Test Tool 2"}}
        await client.post("/api/v1/tools", json=second)
        resp = await client.get("/api/v1/tools", params={"page": 1, "limit": 1})
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        assert len(body["items"]) == 1
        assert body["page"] == 1


class TestGetPassport:
    async def test_missing_passport_returns_404(self, client):
        resp = await client.get("/api/v1/tools/does-not-exist")
        assert resp.status_code == 404

    async def test_get_returns_created_passport(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools/test-tool")
        assert resp.status_code == 200
        body = resp.json()
        assert body["slug"] == "test-tool"
        assert body["name"] == "Test Tool"
        assert body["trust_status"] == "auto_generated_draft"
        assert body["capabilities"] == ["read_files"]


class TestCreatePassport:
    async def test_create_returns_201(self, client):
        resp = await client.post("/api/v1/tools", json=_PASSPORT)
        assert resp.status_code == 201

    async def test_created_passport_has_expected_fields(self, client):
        resp = await client.post("/api/v1/tools", json=_PASSPORT)
        body = resp.json()
        assert body["id"]  # UUID assigned
        assert body["slug"] == "test-tool"
        assert body["name"] == "Test Tool"
        assert body["description"] == "A test tool for unit tests."
        assert isinstance(body["capabilities"], list)
        assert isinstance(body["permission_manifest"], dict)

    async def test_auto_draft_passport_carries_warning(self, client):
        resp = await client.post("/api/v1/tools", json=_PASSPORT)
        body = resp.json()
        assert body["warning"] is not None
        assert "not been verified" in body["warning"]

    async def test_duplicate_slug_returns_409(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp2 = await client.post("/api/v1/tools", json=_PASSPORT)
        assert resp2.status_code == 409
        assert "already exists" in resp2.json()["detail"]

    async def test_json_columns_round_trip_correctly(self, client):
        """tool_identity (dict), capabilities (list), etc. survive the JSON→SQLite→JSON round trip."""
        resp = await client.post("/api/v1/tools", json=_PASSPORT)
        body = resp.json()
        assert body["tool_identity"]["slug"] == "test-tool"
        assert body["tool_identity"]["publisher"] == "test-org"
        assert body["commercial_status"] == {"model": "free"}


class TestUpdatePassport:
    async def test_update_nonexistent_returns_404(self, client):
        resp = await client.put("/api/v1/tools/no-such-tool", json=_PASSPORT)
        assert resp.status_code == 404

    async def test_update_changes_description(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        updated = {**_PASSPORT, "description": "Updated description."}
        resp = await client.put("/api/v1/tools/test-tool", json=updated)
        assert resp.status_code == 200
        assert resp.json()["description"] == "Updated description."

    async def test_update_changes_trust_status(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        updated = {**_PASSPORT, "trust_status": "creator_claimed"}
        resp = await client.put("/api/v1/tools/test-tool", json=updated)
        assert resp.status_code == 200
        assert resp.json()["trust_status"] == "creator_claimed"

    async def test_update_preserves_id(self, client):
        create_resp = await client.post("/api/v1/tools", json=_PASSPORT)
        original_id = create_resp.json()["id"]
        updated = {**_PASSPORT, "description": "Changed."}
        update_resp = await client.put("/api/v1/tools/test-tool", json=updated)
        assert update_resp.json()["id"] == original_id


class TestSearchPassports:
    async def test_search_finds_by_name(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools/search/local", params={"q": "Test Tool"})
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_search_finds_by_description(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools/search/local", params={"q": "unit tests"})
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    async def test_search_returns_empty_for_no_match(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        resp = await client.get("/api/v1/tools/search/local", params={"q": "zzz-no-match-xyz"})
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_search_is_case_insensitive_via_like(self, client):
        await client.post("/api/v1/tools", json=_PASSPORT)
        # SQLite LIKE is case-insensitive for ASCII by default
        resp = await client.get("/api/v1/tools/search/local", params={"q": "TEST TOOL"})
        assert resp.status_code == 200
        assert len(resp.json()) >= 1
