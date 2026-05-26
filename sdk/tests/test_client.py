import pytest
import httpx
from opentrust._client import _Client


def _transport(data: dict, status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=data)
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_get_returns_json():
    client = _Client(base_url="http://test", transport=_transport({"slug": "t"}))
    result = await client.get("/tools/t")
    assert result["slug"] == "t"


@pytest.mark.asyncio
async def test_get_raises_on_404():
    client = _Client(base_url="http://test", transport=_transport({"detail": "not found"}, 404))
    with pytest.raises(httpx.HTTPStatusError):
        await client.get("/tools/missing")


@pytest.mark.asyncio
async def test_get_strips_none_params():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"items": [], "total": 0, "page": 1, "limit": 20})

    client = _Client(base_url="http://test", transport=httpx.MockTransport(handler))
    await client.get("/tools", q=None, trust_status=None, page=1)
    assert "q=" not in seen[0]
    assert "trust_status=" not in seen[0]
    assert "page=1" in seen[0]


@pytest.mark.asyncio
async def test_get_includes_non_none_params():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"items": [], "total": 0, "page": 1, "limit": 20})

    client = _Client(base_url="http://test", transport=httpx.MockTransport(handler))
    await client.get("/tools", q="github", trust_status="community_reviewed")
    assert "q=github" in seen[0]
    assert "trust_status=community_reviewed" in seen[0]
