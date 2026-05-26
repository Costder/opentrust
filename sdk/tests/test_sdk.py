import pytest
from unittest.mock import AsyncMock, patch
from opentrust import verify, get, search, list as list_tools, verify_sync, VerifyResult, ToolsPage

FAKE_PASSPORT = {
    "id": "abc123",
    "slug": "github-file-search",
    "name": "GitHub File Search",
    "description": "Search repos",
    "trust_status": "community_reviewed",
    "tool_identity": {"slug": "github-file-search", "name": "GitHub File Search"},
    "version_hash": {"version": "1.0.0"},
    "capabilities": ["search"],
    "permission_manifest": {"network": True, "file": False, "terminal": False, "wallet": False},
    "commercial_status": {"status": "free"},
    "agent_access": {"allowed": True},
}

FAKE_PAGE = {"items": [FAKE_PASSPORT], "total": 1, "page": 1, "limit": 20}


@pytest.mark.asyncio
async def test_verify_returns_verify_result():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = FAKE_PASSPORT
        result = await verify("github-file-search")
    assert isinstance(result, VerifyResult)
    assert result.slug == "github-file-search"
    assert result.trust_status == "community_reviewed"
    assert result.trust_level == 4
    assert result.is_disputed is False
    assert "Community reviewed" in result.recommendation
    assert result.risk == "medium"


@pytest.mark.asyncio
async def test_verify_disputed_sets_is_disputed_and_level_zero():
    disputed = {**FAKE_PASSPORT, "trust_status": "disputed"}
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = disputed
        result = await verify("github-file-search")
    assert result.is_disputed is True
    assert result.trust_level == 0
    assert result.risk == "high"
    assert "dispute" in result.recommendation.lower()


@pytest.mark.asyncio
async def test_get_returns_raw_passport_dict():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = FAKE_PASSPORT
        result = await get("github-file-search")
    assert result["slug"] == "github-file-search"


@pytest.mark.asyncio
async def test_search_returns_list_of_dicts():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = FAKE_PAGE
        result = await search("github")
    assert isinstance(result, list)
    assert result[0]["slug"] == "github-file-search"


@pytest.mark.asyncio
async def test_list_returns_tools_page():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = FAKE_PAGE
        result = await list_tools(trust_status="community_reviewed")
    assert isinstance(result, ToolsPage)
    assert result.total == 1
    assert result.page == 1
    assert result.limit == 20


@pytest.mark.asyncio
async def test_list_passes_none_trust_status_when_not_given():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = FAKE_PAGE
        await list_tools()
    _, kwargs = m.call_args
    assert kwargs.get("trust_status") is None


def test_verify_sync_returns_verify_result():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = FAKE_PASSPORT
        result = verify_sync("github-file-search")
    assert isinstance(result, VerifyResult)
    assert result.trust_level == 4
