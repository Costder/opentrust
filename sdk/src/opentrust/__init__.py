"""opentrust — Python SDK for the OpenTrust tool trust registry."""
from __future__ import annotations

import asyncio

from ._client import _Client
from ._recommend import TRUST_LEVELS, recommend, risk_level
from ._types import ToolsPage, VerifyResult

__version__ = "0.1.0"
__all__ = [
    "verify", "get", "search", "list",
    "verify_sync", "get_sync",
    "VerifyResult", "ToolsPage",
]


def _build_result(passport: dict) -> VerifyResult:
    status = passport.get("trust_status", "auto_generated_draft")
    level = TRUST_LEVELS.get(status, 1)
    perms = passport.get("permission_manifest") or {}
    return VerifyResult(
        slug=passport.get("slug", ""),
        trust_status=status,
        trust_level=level,
        is_disputed=(status == "disputed"),
        recommendation=recommend(status, perms),
        risk=risk_level(status, perms),
        passport=passport,
        permissions=perms,
    )


async def verify(slug: str, *, api_url: str | None = None) -> VerifyResult:
    """Fetch a passport and return a VerifyResult with recommendation and risk level."""
    passport = await get(slug, api_url=api_url)
    return _build_result(passport)


async def get(slug: str, *, api_url: str | None = None) -> dict:
    """Fetch the raw passport dict for a slug."""
    client = _Client(base_url=api_url)
    return await client.get(f"/tools/{slug}")


async def search(
    query: str,
    *,
    trust_status: str | None = None,
    api_url: str | None = None,
) -> list[dict]:
    """Search tools by query. Returns list of raw passport dicts."""
    client = _Client(base_url=api_url)
    page = await client.get("/tools", q=query, trust_status=trust_status)
    return page.get("items", [])


async def list(  # noqa: A001
    *,
    page: int = 1,
    limit: int = 20,
    trust_status: str | None = None,
    api_url: str | None = None,
) -> ToolsPage:
    """List tools with optional filters. Returns a ToolsPage."""
    client = _Client(base_url=api_url)
    data = await client.get(
        "/tools", page=page, limit=limit, trust_status=trust_status
    )
    return ToolsPage(
        items=data.get("items", []),
        total=data.get("total", 0),
        page=data.get("page", page),
        limit=data.get("limit", limit),
    )


def verify_sync(slug: str, *, api_url: str | None = None) -> VerifyResult:
    """Synchronous wrapper for verify(). Do not call from an async context."""
    return asyncio.run(verify(slug, api_url=api_url))


def get_sync(slug: str, *, api_url: str | None = None) -> dict:
    """Synchronous wrapper for get(). Do not call from an async context."""
    return asyncio.run(get(slug, api_url=api_url))
