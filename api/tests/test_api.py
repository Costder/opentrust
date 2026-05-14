import pytest
from fastapi import HTTPException
from api.src.main import health
from api.src.routes.payments import checkout


@pytest.mark.asyncio
async def test_health():
    assert (await health())["status"] == "ok"


@pytest.mark.asyncio
async def test_payment_stub_returns_501():
    with pytest.raises(HTTPException) as exc:
        await checkout()
    assert exc.value.status_code == 501
    assert "opentrust-private" in exc.value.detail
