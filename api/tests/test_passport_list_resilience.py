"""The tool list must not 500 when a single passport row is malformed.

Leftover/demo rows missing required fields previously crashed the entire
/tools listing (one bad row -> 500 for everyone). The list endpoint must skip
unserializable rows and return the valid ones.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app

_GOOD = {
    "tool_identity": {"slug": "good-tool", "name": "Good Tool"},
    "description": "valid",
    "trust_status": "auto_generated_draft",
    "version_hash": {"version": "1.0.0", "commit": "abc1234"},
    "capabilities": ["x"],
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
    settings.sqlite_path = str(tmp_path / "t.db")
    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, test_db
    app.dependency_overrides.clear()
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


async def test_list_skips_malformed_row(client):
    c, test_db = client
    # one valid passport via the API
    await c.post("/api/v1/tools", json=_GOOD)
    # one malformed row written straight to the table (missing required JSON cols)
    await test_db._execute(
        "INSERT INTO passports (id, slug, name, description, trust_status, "
        "tool_identity, version_hash, capabilities, permission_manifest, "
        "commercial_status, agent_access) VALUES "
        "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["bad1", "bad-demo", "Bad Demo", "", "auto_generated_draft",
         "{}", "{}", "null", "null", "{}", "{}"],
    )
    resp = await c.get("/api/v1/tools?limit=100")
    assert resp.status_code == 200, resp.text
    slugs = [t["slug"] for t in resp.json()["items"]]
    assert "good-tool" in slugs
    assert "bad-demo" not in slugs  # malformed row skipped, not crashing the list
