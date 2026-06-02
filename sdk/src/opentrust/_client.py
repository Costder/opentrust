"""Internal async HTTP client wrapping httpx."""
from __future__ import annotations

import os
from typing import Any

import httpx

_DEFAULT_URL = "https://api.opentrust.infiniterealms.io"


class _Client:
    def __init__(
        self,
        base_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base = (
            base_url or os.getenv("OPENTRUST_API_URL") or _DEFAULT_URL
        ).rstrip("/")
        self._transport = transport

    async def get(self, path: str, **params: Any) -> Any:
        """GET /api/v1{path} with optional query params (None values are dropped)."""
        filtered = {k: v for k, v in params.items() if v is not None}
        async with httpx.AsyncClient(
            base_url=self._base, transport=self._transport
        ) as client:
            resp = await client.get(f"/api/v1{path}", params=filtered)
            resp.raise_for_status()
            return resp.json()
