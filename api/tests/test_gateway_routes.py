import pytest
from httpx import ASGITransport, AsyncClient

from api.src.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_gateway_lists_seed_connectors(client):
    resp = await client.get("/api/v1/gateway/connectors")
    assert resp.status_code == 200
    body = resp.json()
    connectors = {item["slug"]: item for item in body["items"]}
    assert set(connectors) == {"hands-body-and-feet", "remote-mcp-example", "local-connector"}

    hbf = connectors["hands-body-and-feet"]
    assert hbf["execution_modes"] == ["hosted_hbf"]
    assert "pay_with_usdc" in hbf["tool_slugs"]
    assert connectors["remote-mcp-example"]["execution_modes"] == ["remote_mcp"]
    assert connectors["local-connector"]["execution_modes"] == ["local_connector"]


async def test_gateway_policy_simulation_requires_approval_for_payment(client):
    resp = await client.post(
        "/api/v1/gateway/policy/simulate",
        json={
            "tool": {
                "slug": "hands-body-and-feet.pay_with_usdc",
                "name": "Pay with USDC",
                "provider_slug": "hands-body-and-feet",
                "execution_mode": "hosted_hbf",
                "risk": {
                    "category": "payment",
                    "permissions": ["wallet.spend"],
                    "default_decision": "approval_required",
                    "approval_required_for": ["wallet.spend"],
                },
            },
            "policy": {
                "min_trust_level": 3,
                "block_disputed": True,
                "spend_cap_usd_per_call": 25,
                "auto_approve_max_usd": 5,
            },
            "context": {
                "agent_id": "agent_scout",
                "trust_level": 4,
                "disputed": False,
                "requested_cost_usd": 10,
                "tool_args": {"amount": 10},
            },
        },
    )
    assert resp.status_code == 200
    assert resp.json()["allowed"] is False
    assert resp.json()["approval_required"] is True
    assert resp.json()["reason"] == "approval_required_for_wallet.spend"


async def test_local_connector_registration_contract(client):
    resp = await client.post(
        "/api/v1/gateway/local-connectors/register",
        json={
            "machine_name": "joshua-laptop",
            "connector_version": "0.1.0",
            "supported_modes": ["stdio_mcp", "filesystem", "browser"],
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["connector_id"].startswith("lc_")
    assert body["status"] == "registered"
