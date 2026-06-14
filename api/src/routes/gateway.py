from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.src.schemas.gateway import (
    GatewayCallContext,
    GatewayPolicy,
    GatewayPolicyDecision,
    GatewayToolSpec,
)
from api.src.services.gateway_policy import evaluate_gateway_policy

router = APIRouter(prefix="/gateway", tags=["gateway"])


class GatewayConnectorSummary(BaseModel):
    slug: str
    name: str
    description: str
    execution_modes: list[str]
    tool_slugs: list[str]
    risk_categories: list[str]


class GatewayConnectorList(BaseModel):
    items: list[GatewayConnectorSummary]


class GatewayPolicySimulationRequest(BaseModel):
    tool: GatewayToolSpec
    policy: GatewayPolicy
    context: GatewayCallContext


class LocalConnectorRegisterRequest(BaseModel):
    machine_name: str = Field(min_length=1)
    connector_version: str = Field(min_length=1)
    supported_modes: list[str]


class LocalConnectorRegisterResponse(BaseModel):
    connector_id: str
    status: str


SEED_CONNECTORS = [
    GatewayConnectorSummary(
        slug="hands-body-and-feet",
        name="Hands Body and Feet",
        description=(
            "OpenTrust-hosted real-world agent capabilities: email, SMS, payments, "
            "cards, GitHub, tasks, webhooks, and more."
        ),
        execution_modes=["hosted_hbf"],
        tool_slugs=[
            "notify_human",
            "send_email",
            "send_sms",
            "pay_with_usdc",
            "create_virtual_card",
            "create_pull_request",
            "create_task",
            "create_webhook",
        ],
        risk_categories=["communication", "payment", "card", "code", "automation"],
    ),
    GatewayConnectorSummary(
        slug="remote-mcp-example",
        name="Remote MCP Example",
        description="Template for a vendor-hosted HTTP MCP server proxied through OpenTrust policy.",
        execution_modes=["remote_mcp"],
        tool_slugs=["list_tools", "call_tool"],
        risk_categories=["network"],
    ),
    GatewayConnectorSummary(
        slug="local-connector",
        name="OpenTrust Local Connector",
        description=(
            "Outbound local bridge for filesystem, browser, localhost apps, "
            "and local-only stdio MCP servers."
        ),
        execution_modes=["local_connector"],
        tool_slugs=["register_machine", "heartbeat"],
        risk_categories=["file", "browser", "terminal", "private_network"],
    ),
]


@router.get("/connectors", response_model=GatewayConnectorList)
async def list_gateway_connectors() -> GatewayConnectorList:
    return GatewayConnectorList(items=SEED_CONNECTORS)


@router.post("/policy/simulate", response_model=GatewayPolicyDecision)
async def simulate_gateway_policy(request: GatewayPolicySimulationRequest) -> GatewayPolicyDecision:
    return evaluate_gateway_policy(tool=request.tool, policy=request.policy, context=request.context)


@router.post("/local-connectors/register", response_model=LocalConnectorRegisterResponse)
async def register_local_connector(
    request: LocalConnectorRegisterRequest,
) -> LocalConnectorRegisterResponse:
    return LocalConnectorRegisterResponse(
        connector_id=f"lc_{uuid4().hex[:16]}",
        status="registered",
    )
