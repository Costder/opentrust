"""Public on-ramp: submit a GitHub repo URL -> auto-created L1 draft passport.

This is the registry's intake path. Anyone can paste a GitHub repo and get a
draft passport (auto_generated_draft / L1) created, which they can later claim
and advance. Fixes the dead-end where a repo lookup just said "not found".
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
    settings.sqlite_path = str(tmp_path / "submit.db")
    test_db = Database()
    await test_db.init()

    async def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    settings.turso_url, settings.turso_auth_token, settings.sqlite_path = orig


_REPO_META = {
    "name": "file-search-mcp",
    "full_name": "acme/file-search-mcp",
    "description": "An MCP server for searching files",
    "html_url": "https://github.com/acme/file-search-mcp",
}


async def test_submit_github_creates_draft_passport(client):
    with patch("api.src.routes.passports.fetch_github_repo", return_value=_REPO_META):
        resp = await client.post("/api/v1/tools/submit", json={"github_url": "https://github.com/acme/file-search-mcp"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["trust_status"] == "auto_generated_draft"
    assert body["slug"] == "file-search-mcp"
    assert body["tool_identity"]["source_url"] == "https://github.com/acme/file-search-mcp"


async def test_submitted_passport_is_listed(client):
    with patch("api.src.routes.passports.fetch_github_repo", return_value=_REPO_META):
        await client.post("/api/v1/tools/submit", json={"github_url": "https://github.com/acme/file-search-mcp"})
    listed = (await client.get("/api/v1/tools?limit=100")).json()["items"]
    assert any(t["slug"] == "file-search-mcp" for t in listed)


async def test_submit_accepts_bare_owner_repo(client):
    with patch("api.src.routes.passports.fetch_github_repo", return_value=_REPO_META) as mock:
        resp = await client.post("/api/v1/tools/submit", json={"github_url": "acme/file-search-mcp"})
    assert resp.status_code == 201, resp.text
    # normalized to owner/repo for the GitHub fetch
    mock.assert_called_once_with("acme/file-search-mcp")


async def test_submit_rejects_non_github_url(client):
    resp = await client.post("/api/v1/tools/submit", json={"github_url": "https://example.com/not/github"})
    assert resp.status_code == 422


async def test_submit_unknown_repo_returns_404(client):
    with patch("api.src.routes.passports.fetch_github_repo", return_value=None):
        resp = await client.post("/api/v1/tools/submit", json={"github_url": "https://github.com/acme/does-not-exist"})
    assert resp.status_code == 404


async def test_submit_duplicate_returns_existing(client):
    with patch("api.src.routes.passports.fetch_github_repo", return_value=_REPO_META):
        first = await client.post("/api/v1/tools/submit", json={"github_url": "https://github.com/acme/file-search-mcp"})
        second = await client.post("/api/v1/tools/submit", json={"github_url": "https://github.com/acme/file-search-mcp"})
    assert first.status_code == 201
    # Re-submitting an existing repo returns the existing passport (200), not a 409 error
    assert second.status_code == 200
    assert second.json()["slug"] == "file-search-mcp"
