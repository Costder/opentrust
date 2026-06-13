from decimal import Decimal

from api.src.schemas.gateway import (
    GatewayCallContext,
    GatewayPolicy,
    GatewayPolicyDecision,
    GatewayToolSpec,
)


ZERO_USD = Decimal("0")


def _is_monetary_auto_approval_permission(permission: str) -> bool:
    return permission.startswith("wallet.") or permission == "card.spend"


def _can_auto_approve_permission(
    *,
    permission: str,
    policy: GatewayPolicy,
    context: GatewayCallContext,
) -> bool:
    return (
        _is_monetary_auto_approval_permission(permission)
        and ZERO_USD < context.requested_cost_usd <= policy.auto_approve_max_usd
    )


def _can_auto_approve_default_decision(
    *,
    tool: GatewayToolSpec,
    policy: GatewayPolicy,
    context: GatewayCallContext,
) -> bool:
    return (
        bool(tool.risk.permissions)
        and all(
            _is_monetary_auto_approval_permission(permission)
            for permission in tool.risk.permissions
        )
        and ZERO_USD < context.requested_cost_usd <= policy.auto_approve_max_usd
    )


def _approval_permission_candidates(
    *,
    tool: GatewayToolSpec,
    policy: GatewayPolicy,
) -> list[str]:
    candidates = []
    seen = set()
    for permission in (
        *tool.risk.permissions,
        *tool.risk.approval_required_for,
        *policy.approval_required_for,
    ):
        if permission in seen:
            continue
        candidates.append(permission)
        seen.add(permission)
    return candidates


def evaluate_gateway_policy(
    *,
    tool: GatewayToolSpec,
    policy: GatewayPolicy,
    context: GatewayCallContext,
) -> GatewayPolicyDecision:
    if context.trust_level < policy.min_trust_level:
        return GatewayPolicyDecision(
            allowed=False,
            approval_required=False,
            reason="trust_level_too_low",
        )

    if policy.block_disputed and context.disputed:
        return GatewayPolicyDecision(
            allowed=False,
            approval_required=False,
            reason="agent_or_tool_disputed",
        )

    if context.requested_cost_usd > policy.spend_cap_usd_per_call:
        return GatewayPolicyDecision(
            allowed=False,
            approval_required=False,
            reason="spend_cap_exceeded",
        )

    for permission in tool.risk.permissions:
        if permission in policy.blocked_permissions:
            return GatewayPolicyDecision(
                allowed=False,
                approval_required=False,
                reason=f"permission_blocked_{permission}",
            )

    if tool.risk.default_decision == "deny":
        return GatewayPolicyDecision(allowed=False, approval_required=False, reason="tool_default_deny")

    approval_permissions = set(policy.approval_required_for) | set(tool.risk.approval_required_for)
    for permission in _approval_permission_candidates(tool=tool, policy=policy):
        if permission in approval_permissions:
            if _can_auto_approve_permission(
                permission=permission,
                policy=policy,
                context=context,
            ):
                continue
            return GatewayPolicyDecision(
                allowed=False,
                approval_required=True,
                reason=f"approval_required_for_{permission}",
            )

    if tool.risk.default_decision == "approval_required":
        if _can_auto_approve_default_decision(
            tool=tool,
            policy=policy,
            context=context,
        ):
            return GatewayPolicyDecision(allowed=True, approval_required=False, reason="allowed")
        return GatewayPolicyDecision(
            allowed=False,
            approval_required=True,
            reason="tool_default_approval_required",
        )

    return GatewayPolicyDecision(allowed=True, approval_required=False, reason="allowed")
