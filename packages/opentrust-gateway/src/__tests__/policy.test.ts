import { describe, expect, it } from "vitest";

import { evaluateGatewayPolicy } from "../policy.js";
import type {
  GatewayCallContext,
  GatewayToolSpec,
  RiskDecision,
} from "../types.js";

function tool({
  defaultDecision = "allow",
  permissions = [],
  approvalRequiredFor = [],
}: {
  defaultDecision?: RiskDecision;
  permissions?: string[];
  approvalRequiredFor?: string[];
} = {}): GatewayToolSpec {
  return {
    slug: "hands-body-and-feet.test_tool",
    name: "Test Tool",
    providerSlug: "hands-body-and-feet",
    executionMode: "hosted_hbf",
    risk: {
      category: "test",
      permissions,
      defaultDecision,
      approvalRequiredFor,
    },
  };
}

function context({
  trustLevel = 4,
  disputed = false,
  requestedCostUsd = 0.0,
}: {
  trustLevel?: number;
  disputed?: boolean;
  requestedCostUsd?: number;
} = {}): GatewayCallContext {
  return {
    agentId: "agent_scout",
    trustLevel,
    disputed,
    requestedCostUsd,
    toolArgs: {},
  };
}

describe("evaluateGatewayPolicy", () => {
  it("requires approval for HBF pay_with_usdc above the auto-approve cap", () => {
    const decision = evaluateGatewayPolicy({
      tool: {
        slug: "hands-body-and-feet.pay_with_usdc",
        name: "Pay with USDC",
        providerSlug: "hands-body-and-feet",
        executionMode: "hosted_hbf",
        risk: {
          category: "payment",
          permissions: ["wallet.spend", "network.write"],
          defaultDecision: "approval_required",
          approvalRequiredFor: ["wallet.spend"],
        },
      },
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: {
        agentId: "agent_scout",
        trustLevel: 4,
        disputed: false,
        requestedCostUsd: 10.0,
        toolArgs: {
          amount: 10.0,
          to_address: "0x0000000000000000000000000000000000000001",
        },
      },
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: true,
      reason: "approval_required_for_wallet.spend",
    });
  });

  it("denies when trust level is too low", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool(),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ trustLevel: 2 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "trust_level_too_low",
    });
  });

  it("denies disputed agents or tools", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool(),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ disputed: true }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "agent_or_tool_disputed",
    });
  });

  it("denies positive-cost calls with the default zero spend cap", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool(),
      policy: {},
      context: context({ requestedCostUsd: 0.01 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "spend_cap_exceeded",
    });
  });

  it("fails closed when runtime JSON is missing required context fields", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool(),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: {
        agentId: "agent_scout",
        disputed: false,
        requestedCostUsd: 0.0,
        toolArgs: {},
      } as GatewayCallContext,
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "invalid_gateway_call_context",
    });
  });

  it("fails closed for non-finite runtime money values", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool(),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: Number.NaN,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context(),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "invalid_gateway_call_context",
    });
  });

  it("fails closed for wrong-cased runtime context safety fields", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool(),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: {
        agentId: "agent_scout",
        trustLevel: 4,
        disputed: false,
        requestedCostUsd: 0.0,
        requested_cost_usd: 100.0,
        toolArgs: {},
      } as unknown as GatewayCallContext,
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "invalid_gateway_call_context",
    });
  });

  it("fails closed for wrong-cased runtime risk metadata", () => {
    const badTool = {
      ...tool({ permissions: ["network.write"] }),
      risk: {
        category: "test",
        permissions: ["network.write"],
        defaultDecision: "allow",
        approvalRequiredFor: [],
        approval_required_for: ["network.write"],
      },
    } as GatewayToolSpec;

    const decision = evaluateGatewayPolicy({
      tool: badTool,
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context(),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "invalid_gateway_call_context",
    });
  });

  it("fails closed for misspelled runtime policy safety fields", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({ permissions: ["network.write"] }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
        blockedPermisions: ["network.write"],
      } as unknown as Partial<import("../types.js").GatewayPolicy>,
      context: context(),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "invalid_gateway_call_context",
    });
  });

  it("denies blocked permissions", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({ permissions: ["network.write"] }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: ["network.write"],
        approvalRequiredFor: [],
      },
      context: context(),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "permission_blocked_network.write",
    });
  });

  it("gives hard deny precedence over approval-required permissions", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        defaultDecision: "deny",
        permissions: ["wallet.spend"],
        approvalRequiredFor: ["wallet.spend"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 10.0 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: false,
      reason: "tool_default_deny",
    });
  });

  it("requires approval for zero-cost non-monetary approval-required permissions", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        permissions: ["network.write"],
        approvalRequiredFor: ["network.write"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 0.0 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: true,
      reason: "approval_required_for_network.write",
    });
  });

  it("auto-approves low-dollar wallet.spend calls", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        permissions: ["wallet.spend"],
        approvalRequiredFor: ["wallet.spend"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 2.5 }),
    });

    expect(decision).toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "allowed",
    });
  });

  it("requires approval for default approval-required zero-cost tools", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({ defaultDecision: "approval_required" }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 0.0 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: true,
      reason: "tool_default_approval_required",
    });
  });

  it("enforces approval_required_for metadata even when missing from permissions", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        permissions: [],
        approvalRequiredFor: ["network.write"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 0.0 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: true,
      reason: "approval_required_for_network.write",
    });
  });

  it("auto-approves low-dollar card.spend calls", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        permissions: ["card.spend"],
        approvalRequiredFor: ["card.spend"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 2.5 }),
    });

    expect(decision).toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "allowed",
    });
  });

  it("does not treat walletish.spend as wallet auto-approval", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        permissions: ["walletish.spend"],
        approvalRequiredFor: ["walletish.spend"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 5.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 2.5 }),
    });

    expect(decision).toEqual({
      allowed: false,
      approvalRequired: true,
      reason: "approval_required_for_walletish.spend",
    });
  });

  it("allows calls under an explicit permissive policy", () => {
    const decision = evaluateGatewayPolicy({
      tool: tool({
        defaultDecision: "allow",
        permissions: ["network.read"],
      }),
      policy: {
        minTrustLevel: 3,
        blockDisputed: true,
        spendCapUsdPerCall: 25.0,
        autoApproveMaxUsd: 0.0,
        blockedPermissions: [],
        approvalRequiredFor: [],
      },
      context: context({ requestedCostUsd: 0.0 }),
    });

    expect(decision).toEqual({
      allowed: true,
      approvalRequired: false,
      reason: "allowed",
    });
  });
});
