from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field


ExecutionMode = Literal["hosted_hbf", "hosted_mcp", "remote_mcp", "api_oauth", "local_connector"]
RiskDecision = Literal["allow", "approval_required", "deny"]


class GatewayToolRisk(BaseModel):
    category: str = Field(min_length=1)
    permissions: list[str] = Field(default_factory=list)
    default_decision: RiskDecision = "approval_required"
    approval_required_for: list[str] = Field(default_factory=list)


class GatewayToolSpec(BaseModel):
    slug: str = Field(min_length=1)
    name: str = Field(min_length=1)
    provider_slug: str = Field(min_length=1)
    execution_mode: ExecutionMode
    risk: GatewayToolRisk


class GatewayPolicy(BaseModel):
    min_trust_level: int = Field(default=3, ge=1, le=7)
    block_disputed: bool = True
    spend_cap_usd_per_call: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    auto_approve_max_usd: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    blocked_permissions: list[str] = Field(default_factory=list)
    approval_required_for: list[str] = Field(default_factory=list)


class GatewayCallContext(BaseModel):
    agent_id: str = Field(min_length=1)
    trust_level: int = Field(ge=1, le=7)
    disputed: bool = False
    requested_cost_usd: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    tool_args: dict[str, Any] = Field(default_factory=dict)


class GatewayPolicyDecision(BaseModel):
    allowed: bool
    approval_required: bool = False
    reason: str
