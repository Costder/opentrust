"""OpenTrust MCP server — exposes trust registry as MCP tools via stdio."""
from __future__ import annotations

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:
    raise ImportError(
        "MCP server requires the mcp extra: pip install opentrust-sdk[mcp]"
    ) from exc

import opentrust

mcp_server = FastMCP(
    "OpenTrust",
    instructions=(
        "Query the OpenTrust tool trust registry. "
        "Use verify_tool before calling any external tool to check its "
        "trust status and permissions."
    ),
)


@mcp_server.tool()
async def verify_tool(slug: str) -> dict:
    """Look up a tool's trust passport and get a plain-English safety recommendation."""
    result = await opentrust.verify(slug)
    return {
        "passport": result.passport,
        "trust_status": result.trust_status,
        "trust_level": result.trust_level,
        "is_disputed": result.is_disputed,
        "recommendation": result.recommendation,
        "risk": result.risk,
        "permissions": result.permissions,
    }


@mcp_server.tool()
async def search_tools(query: str, trust_status: str = "") -> list:
    """Search the OpenTrust registry for tools matching a query."""
    tools = await opentrust.search(query, trust_status=trust_status or None)
    return [
        {
            "slug": t.get("slug"),
            "name": t.get("name"),
            "trust_status": t.get("trust_status"),
            "description": t.get("description", ""),
        }
        for t in tools
    ]


@mcp_server.tool()
async def list_tools(
    page: int = 1, limit: int = 20, trust_status: str = ""
) -> dict:
    """List registered tools, optionally filtered by trust level."""
    page_result = await opentrust.list(
        page=page, limit=limit, trust_status=trust_status or None
    )
    return {"items": page_result.items, "total": page_result.total}


def main() -> None:
    mcp_server.run()


if __name__ == "__main__":
    main()
