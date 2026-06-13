"""Machine-readable install metadata + agent-driven human signup.

- GET /tools/{slug}/install  -> install instructions an agent/human can act on
  (MCP client config, npx/pip command, source URL). Free tools only need this;
  paid tools include a note that payment is required first.
- POST /signup/start         -> an agent gets a GitHub sign-in link to hand to
  its human, who only has to click "Sign in with GitHub".
"""
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.database import Database, get_db
from api.src.main import app


@pytest.fixture
async def client(tmp_path):
    from api.src.config import settings

    orig = (settings.turso_url, settings.turso_auth_token, settings.sqlite_path)
    settings.turso_url = ""
    settings.turso_auth_token = ""
    settings.sqlite_path = str(tmp_path / "inst.db")
    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


_MCP = {
    "tool_identity": {"slug": "github-mcp-server", "name": "GitHub", "source_url": "https://github.com/github/github-mcp-server"},
    "description": "GitHub MCP server",
    "trust_status": "community_reviewed",
    "version_hash": {"version": "1.0.0", "commit": "abc1234"},
    "capabilities": ["github"],
    "permission_manifest": {"network": True},
    "commercial_status": {"model": "free"},
    "agent_access": {"allowed": True, "kind": "mcp_server"},
}


async def _create(client, payload):
    return await client.post("/api/v1/tools", json=payload)


# ── Install ──────────────────────────────────────────────────────────────────

async def test_install_returns_metadata_for_free_mcp(client):
    await _create(client, _MCP)
    resp = await client.get("/api/v1/tools/github-mcp-server/install")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["slug"] == "github-mcp-server"
    assert body["kind"] == "mcp_server"
    assert body["free"] is True
    assert body["source_url"] == "https://github.com/github/github-mcp-server"
    # MCP servers expose a client config block agents/humans can paste
    assert "mcp_config" in body
    assert "github-mcp-server" in str(body["mcp_config"])


async def test_install_404_for_unknown(client):
    resp = await client.get("/api/v1/tools/nope/install")
    assert resp.status_code == 404


async def test_install_flags_paid_tools(client):
    paid = dict(_MCP, tool_identity={"slug": "paid-mcp", "name": "Paid"}, commercial_status={"model": "paid"})
    await _create(client, paid)
    resp = await client.get("/api/v1/tools/paid-mcp/install")
    assert resp.status_code == 200
    body = resp.json()
    assert body["free"] is False
    assert "payment" in body["note"].lower()


# ── Agent-driven signup ──────────────────────────────────────────────────────

async def test_signup_start_returns_github_link(client):
    with patch("api.src.routes.auth.settings") as mock_settings:
        mock_settings.github_client_id = "Iv1.testid"
        mock_settings.oauth_allowed_redirect_hosts = "app.test"
        mock_settings.cors_origins = "http://localhost:3000"
        resp = await client.post("/api/v1/signup/start", json={
            "agent_id": "acme/research-agent",
            "redirect_uri": "https://app.test/signup/github",
        })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "github.com/login/oauth/authorize" in body["signin_url"]
    assert "Iv1.testid" in body["signin_url"]
    assert body["pending_token"]
    assert body["instructions"]  # human-facing instruction string


async def test_signup_start_rejects_unallowed_redirect(client):
    """An attacker-controlled redirect_uri host must be rejected (open-redirect / code interception)."""
    with patch("api.src.routes.auth.settings") as mock_settings:
        mock_settings.github_client_id = "Iv1.testid"
        mock_settings.oauth_allowed_redirect_hosts = "opentrust.infiniterealms.io"
        mock_settings.cors_origins = "http://localhost:3000"
        resp = await client.post("/api/v1/signup/start", json={
            "agent_id": "acme/research-agent",
            "redirect_uri": "https://evil.example/steal",
        })
    assert resp.status_code == 400
    assert "not allowed" in resp.json()["detail"]


async def test_signup_start_requires_oauth_configured(client):
    with patch("api.src.routes.auth.settings") as mock_settings:
        mock_settings.github_client_id = ""
        resp = await client.post("/api/v1/signup/start", json={"agent_id": "acme/x"})
    assert resp.status_code == 503
