"""Tests for the MCP server tools. Calls tool functions directly — no MCP transport."""
import pytest
from unittest.mock import AsyncMock, patch

try:
    from opentrust.mcp import verify_tool, search_tools, list_tools
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

from opentrust._types import ToolsPage, VerifyResult

pytestmark = pytest.mark.skipif(not MCP_AVAILABLE, reason="mcp extra not installed")

FAKE_RESULT = VerifyResult(
    slug="test-tool",
    trust_status="community_reviewed",
    trust_level=4,
    is_disputed=False,
    recommendation="Community reviewed. Safe for low-risk tasks.",
    risk="medium",
    passport={"slug": "test-tool", "name": "Test"},
    permissions={"network": True},
)


@pytest.mark.asyncio
async def test_verify_tool_returns_all_expected_keys():
    with patch("opentrust.mcp.opentrust.verify", new_callable=AsyncMock) as m:
        m.return_value = FAKE_RESULT
        result = await verify_tool("test-tool")
    assert result["trust_status"] == "community_reviewed"
    assert result["trust_level"] == 4
    assert result["is_disputed"] is False
    assert "recommendation" in result
    assert "permissions" in result
    assert "passport" in result
    assert result["risk"] == "medium"


@pytest.mark.asyncio
async def test_search_tools_returns_list_of_dicts():
    with patch("opentrust.mcp.opentrust.search", new_callable=AsyncMock) as m:
        m.return_value = [
            {"slug": "t", "name": "T", "trust_status": "community_reviewed", "description": "x"}
        ]
        result = await search_tools("test")
    assert isinstance(result, list)
    assert result[0]["slug"] == "t"


@pytest.mark.asyncio
async def test_search_tools_converts_empty_trust_status_to_none():
    with patch("opentrust.mcp.opentrust.search", new_callable=AsyncMock) as m:
        m.return_value = []
        await search_tools("test", trust_status="")
    m.assert_called_once_with("test", trust_status=None)


@pytest.mark.asyncio
async def test_search_tools_passes_trust_status_when_given():
    with patch("opentrust.mcp.opentrust.search", new_callable=AsyncMock) as m:
        m.return_value = []
        await search_tools("test", trust_status="security_checked")
    m.assert_called_once_with("test", trust_status="security_checked")


@pytest.mark.asyncio
async def test_list_tools_returns_dict_with_items_and_total():
    with patch("opentrust.mcp.opentrust.list", new_callable=AsyncMock) as m:
        m.return_value = ToolsPage(
            items=[{"slug": "a", "name": "A"}], total=1, page=1, limit=20
        )
        result = await list_tools(page=1, limit=20)
    assert result["total"] == 1
    assert isinstance(result["items"], list)


@pytest.mark.asyncio
async def test_list_tools_converts_empty_trust_status_to_none():
    with patch("opentrust.mcp.opentrust.list", new_callable=AsyncMock) as m:
        m.return_value = ToolsPage(items=[], total=0, page=1, limit=20)
        await list_tools(trust_status="")
    _, kwargs = m.call_args
    assert kwargs["trust_status"] is None
