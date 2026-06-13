from decimal import Decimal

from api.src.schemas.gateway import (
    GatewayCallContext,
    GatewayPolicy,
    GatewayToolRisk,
    GatewayToolSpec,
)
from api.src.services.gateway_policy import evaluate_gateway_policy


def _tool(
    *,
    default_decision="allow",
    permissions=None,
    approval_required_for=None,
) -> GatewayToolSpec:
    return GatewayToolSpec(
        slug="hands-body-and-feet.test_tool",
        name="Test Tool",
        provider_slug="hands-body-and-feet",
        execution_mode="hosted_hbf",
        risk=GatewayToolRisk(
            category="test",
            permissions=permissions or [],
            default_decision=default_decision,
            approval_required_for=approval_required_for or [],
        ),
    )


def _context(
    *,
    trust_level=4,
    disputed=False,
    requested_cost_usd=0,
) -> GatewayCallContext:
    return GatewayCallContext(
        agent_id="agent_scout",
        trust_level=trust_level,
        disputed=disputed,
        requested_cost_usd=requested_cost_usd,
    )


def test_risky_payment_requires_approval_by_default():
    tool = GatewayToolSpec(
        slug="hands-body-and-feet.pay_with_usdc",
        name="Pay with USDC",
        provider_slug="hands-body-and-feet",
        execution_mode="hosted_hbf",
        risk=GatewayToolRisk(
            category="payment",
            permissions=["wallet.spend", "network.write"],
            default_decision="approval_required",
            approval_required_for=["wallet.spend"],
        ),
    )
    policy = GatewayPolicy(
        min_trust_level=3,
        block_disputed=True,
        spend_cap_usd_per_call=25,
        auto_approve_max_usd=5,
    )
    context = GatewayCallContext(
        agent_id="agent_scout",
        trust_level=4,
        disputed=False,
        requested_cost_usd=10,
        tool_args={"amount": 10, "to_address": "0x0000000000000000000000000000000000000001"},
    )

    decision = evaluate_gateway_policy(tool=tool, policy=policy, context=context)

    assert decision.allowed is False
    assert decision.approval_required is True
    assert decision.reason == "approval_required_for_wallet.spend"


def test_trust_level_too_low_is_denied():
    decision = evaluate_gateway_policy(
        tool=_tool(),
        policy=GatewayPolicy(min_trust_level=3, spend_cap_usd_per_call=25),
        context=_context(trust_level=2),
    )

    assert decision.allowed is False
    assert decision.approval_required is False
    assert decision.reason == "trust_level_too_low"


def test_disputed_agent_or_tool_is_denied():
    decision = evaluate_gateway_policy(
        tool=_tool(),
        policy=GatewayPolicy(
            min_trust_level=3,
            block_disputed=True,
            spend_cap_usd_per_call=25,
        ),
        context=_context(disputed=True),
    )

    assert decision.allowed is False
    assert decision.approval_required is False
    assert decision.reason == "agent_or_tool_disputed"


def test_default_zero_spend_cap_denies_paid_requests():
    decision = evaluate_gateway_policy(
        tool=_tool(),
        policy=GatewayPolicy(),
        context=_context(requested_cost_usd=0.01),
    )

    assert decision.allowed is False
    assert decision.approval_required is False
    assert decision.reason == "spend_cap_exceeded"


def test_blocked_permission_is_denied():
    decision = evaluate_gateway_policy(
        tool=_tool(permissions=["network.write"]),
        policy=GatewayPolicy(spend_cap_usd_per_call=25, blocked_permissions=["network.write"]),
        context=_context(),
    )

    assert decision.allowed is False
    assert decision.approval_required is False
    assert decision.reason == "permission_blocked_network.write"


def test_hard_deny_precedes_approval_required_permission():
    decision = evaluate_gateway_policy(
        tool=_tool(
            default_decision="deny",
            permissions=["wallet.spend"],
            approval_required_for=["wallet.spend"],
        ),
        policy=GatewayPolicy(spend_cap_usd_per_call=25, auto_approve_max_usd=5),
        context=_context(requested_cost_usd=10),
    )

    assert decision.allowed is False
    assert decision.approval_required is False
    assert decision.reason == "tool_default_deny"


def test_default_approval_required_denies_over_auto_approve_max():
    decision = evaluate_gateway_policy(
        tool=_tool(default_decision="approval_required"),
        policy=GatewayPolicy(spend_cap_usd_per_call=25, auto_approve_max_usd=5),
        context=_context(requested_cost_usd=10),
    )

    assert decision.allowed is False
    assert decision.approval_required is True
    assert decision.reason == "tool_default_approval_required"


def test_zero_cost_non_monetary_approval_permission_still_requires_approval():
    decision = evaluate_gateway_policy(
        tool=_tool(
            permissions=["network.write"],
            approval_required_for=["network.write"],
        ),
        policy=GatewayPolicy(spend_cap_usd_per_call=25, auto_approve_max_usd=5),
        context=_context(requested_cost_usd=0),
    )

    assert decision.allowed is False
    assert decision.approval_required is True
    assert decision.reason == "approval_required_for_network.write"


def test_mismatched_approval_metadata_fails_closed():
    decision = evaluate_gateway_policy(
        tool=_tool(
            permissions=[],
            approval_required_for=["network.write"],
            default_decision="allow",
        ),
        policy=GatewayPolicy(spend_cap_usd_per_call=25, auto_approve_max_usd=5),
        context=_context(requested_cost_usd=0),
    )

    assert decision.allowed is False
    assert decision.approval_required is True
    assert decision.reason == "approval_required_for_network.write"


def test_low_dollar_wallet_spend_can_be_auto_approved():
    decision = evaluate_gateway_policy(
        tool=_tool(permissions=["wallet.spend"], approval_required_for=["wallet.spend"]),
        policy=GatewayPolicy(
            spend_cap_usd_per_call=Decimal("25.00"),
            auto_approve_max_usd=Decimal("5.00"),
        ),
        context=_context(requested_cost_usd=Decimal("2.50")),
    )

    assert decision.allowed is True
    assert decision.approval_required is False
    assert decision.reason == "allowed"


def test_low_dollar_card_spend_can_be_auto_approved():
    decision = evaluate_gateway_policy(
        tool=_tool(permissions=["card.spend"], approval_required_for=["card.spend"]),
        policy=GatewayPolicy(
            spend_cap_usd_per_call=Decimal("25.00"),
            auto_approve_max_usd=Decimal("5.00"),
        ),
        context=_context(requested_cost_usd=Decimal("2.50")),
    )

    assert decision.allowed is True
    assert decision.approval_required is False
    assert decision.reason == "allowed"


def test_walletish_spend_is_not_monetary_auto_approval_candidate():
    decision = evaluate_gateway_policy(
        tool=_tool(
            permissions=["walletish.spend"],
            approval_required_for=["walletish.spend"],
        ),
        policy=GatewayPolicy(
            spend_cap_usd_per_call=Decimal("25.00"),
            auto_approve_max_usd=Decimal("5.00"),
        ),
        context=_context(requested_cost_usd=Decimal("2.50")),
    )

    assert decision.allowed is False
    assert decision.approval_required is True
    assert decision.reason == "approval_required_for_walletish.spend"


def test_zero_cost_default_approval_required_still_requires_approval():
    decision = evaluate_gateway_policy(
        tool=_tool(default_decision="approval_required"),
        policy=GatewayPolicy(spend_cap_usd_per_call=25, auto_approve_max_usd=5),
        context=_context(requested_cost_usd=0),
    )

    assert decision.allowed is False
    assert decision.approval_required is True
    assert decision.reason == "tool_default_approval_required"


def test_default_approval_required_wallet_spend_can_be_auto_approved():
    decision = evaluate_gateway_policy(
        tool=_tool(
            default_decision="approval_required",
            permissions=["wallet.spend"],
        ),
        policy=GatewayPolicy(
            spend_cap_usd_per_call=Decimal("25.00"),
            auto_approve_max_usd=Decimal("5.00"),
        ),
        context=_context(requested_cost_usd=Decimal("2.50")),
    )

    assert decision.allowed is True
    assert decision.approval_required is False
    assert decision.reason == "allowed"


def test_decimal_usd_json_fields_preserve_exact_at_cap():
    policy = GatewayPolicy.model_validate_json(
        '{"spend_cap_usd_per_call":"0.30","auto_approve_max_usd":"0.10"}'
    )
    context = GatewayCallContext.model_validate_json(
        '{"agent_id":"agent_scout","trust_level":4,"requested_cost_usd":"0.30"}'
    )

    assert policy.spend_cap_usd_per_call == Decimal("0.30")
    assert policy.auto_approve_max_usd == Decimal("0.10")
    assert context.requested_cost_usd == Decimal("0.30")

    decision = evaluate_gateway_policy(
        tool=_tool(default_decision="allow"),
        policy=policy,
        context=context,
    )

    assert decision.allowed is True
    assert decision.approval_required is False
    assert decision.reason == "allowed"


def test_decimal_usd_fields_preserve_exact_at_cap():
    policy = GatewayPolicy(
        spend_cap_usd_per_call=Decimal("0.30"),
        auto_approve_max_usd=Decimal("0.10"),
    )
    context = _context(requested_cost_usd=Decimal("0.30"))

    assert isinstance(policy.spend_cap_usd_per_call, Decimal)
    assert isinstance(policy.auto_approve_max_usd, Decimal)
    assert isinstance(context.requested_cost_usd, Decimal)

    decision = evaluate_gateway_policy(
        tool=_tool(default_decision="allow"),
        policy=policy,
        context=context,
    )

    assert decision.allowed is True
    assert decision.approval_required is False
    assert decision.reason == "allowed"


def test_explicit_allow_policy_allows_safe_call():
    decision = evaluate_gateway_policy(
        tool=_tool(default_decision="allow", permissions=["network.read"]),
        policy=GatewayPolicy(spend_cap_usd_per_call=25),
        context=_context(requested_cost_usd=0),
    )

    assert decision.allowed is True
    assert decision.approval_required is False
    assert decision.reason == "allowed"
