import type {
  GatewayCallContext,
  GatewayPolicy,
  GatewayPolicyDecision,
  GatewayToolSpec,
  RiskDecision,
} from "./types.js";
import { z } from "zod";

interface NormalizedPolicy {
  minTrustLevel: number;
  blockDisputed: boolean;
  spendCapUsdPerCall: number;
  autoApproveMaxUsd: number;
  blockedPermissions: readonly string[];
  approvalRequiredFor: readonly string[];
}

interface NormalizedContext {
  agentId: string;
  trustLevel: number;
  disputed: boolean;
  requestedCostUsd: number;
  toolArgs: Record<string, unknown>;
}

export interface EvaluateGatewayPolicyInput {
  tool: GatewayToolSpec;
  policy?: Partial<GatewayPolicy>;
  context: GatewayCallContext;
}

export const executionModeSchema = z.enum([
  "hosted_hbf",
  "hosted_mcp",
  "remote_mcp",
  "api_oauth",
  "local_connector",
]);

export const riskDecisionSchema = z.enum(["allow", "approval_required", "deny"]);

export const gatewayToolRiskSchema = z.object({
  category: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  defaultDecision: riskDecisionSchema.default("approval_required"),
  approvalRequiredFor: z.array(z.string()).default([]),
}).strict();

export const gatewayToolSpecSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  providerSlug: z.string().min(1),
  executionMode: executionModeSchema,
  risk: gatewayToolRiskSchema,
}).strict();

export const gatewayPolicySchema = z.object({
  minTrustLevel: z.number().int().min(1).max(7).default(3),
  blockDisputed: z.boolean().default(true),
  spendCapUsdPerCall: z.number().finite().nonnegative().default(0.0),
  autoApproveMaxUsd: z.number().finite().nonnegative().default(0.0),
  blockedPermissions: z.array(z.string()).default([]),
  approvalRequiredFor: z.array(z.string()).default([]),
}).strict();

export const gatewayCallContextSchema = z.object({
  agentId: z.string().min(1),
  trustLevel: z.number().int().min(1).max(7),
  disputed: z.boolean().default(false),
  requestedCostUsd: z.number().finite().nonnegative().default(0.0),
  toolArgs: z.record(z.string(), z.unknown()).default({}),
}).strict();

const DEFAULT_RISK_DECISION: RiskDecision = "approval_required";

function normalizePolicy(policy: Partial<GatewayPolicy> = {}): NormalizedPolicy {
  return {
    minTrustLevel: policy.minTrustLevel ?? 3,
    blockDisputed: policy.blockDisputed ?? true,
    spendCapUsdPerCall: policy.spendCapUsdPerCall ?? 0.0,
    autoApproveMaxUsd: policy.autoApproveMaxUsd ?? 0.0,
    blockedPermissions: policy.blockedPermissions ?? [],
    approvalRequiredFor: policy.approvalRequiredFor ?? [],
  };
}

function normalizeContext(context: GatewayCallContext): NormalizedContext {
  return {
    agentId: context.agentId,
    trustLevel: context.trustLevel,
    disputed: context.disputed ?? false,
    requestedCostUsd: context.requestedCostUsd ?? 0.0,
    toolArgs: context.toolArgs ?? {},
  };
}

function isMonetaryAutoApprovalPermission(permission: string): boolean {
  return permission.startsWith("wallet.") || permission === "card.spend";
}

function canAutoApprovePermission({
  permission,
  policy,
  context,
}: {
  permission: string;
  policy: NormalizedPolicy;
  context: NormalizedContext;
}): boolean {
  return (
    isMonetaryAutoApprovalPermission(permission) &&
    context.requestedCostUsd > 0.0 &&
    context.requestedCostUsd <= policy.autoApproveMaxUsd
  );
}

function canAutoApproveDefaultDecision({
  tool,
  policy,
  context,
}: {
  tool: GatewayToolSpec;
  policy: NormalizedPolicy;
  context: NormalizedContext;
}): boolean {
  const permissions = tool.risk.permissions ?? [];

  return (
    permissions.length > 0 &&
    permissions.every(isMonetaryAutoApprovalPermission) &&
    context.requestedCostUsd > 0.0 &&
    context.requestedCostUsd <= policy.autoApproveMaxUsd
  );
}

function approvalPermissionCandidates({
  tool,
  policy,
}: {
  tool: GatewayToolSpec;
  policy: NormalizedPolicy;
}): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const permission of [
    ...(tool.risk.permissions ?? []),
    ...(tool.risk.approvalRequiredFor ?? []),
    ...policy.approvalRequiredFor,
  ]) {
    if (seen.has(permission)) {
      continue;
    }

    candidates.push(permission);
    seen.add(permission);
  }

  return candidates;
}

export function evaluateGatewayPolicy({
  tool: toolInput,
  policy: policyInput = {},
  context: contextInput,
}: EvaluateGatewayPolicyInput): GatewayPolicyDecision {
  const parsed = z
    .object({
      tool: gatewayToolSpecSchema,
      policy: gatewayPolicySchema.partial().default({}),
      context: gatewayCallContextSchema,
    })
    .strict()
    .safeParse({ tool: toolInput, policy: policyInput, context: contextInput });

  if (!parsed.success) {
    return {
      allowed: false,
      approvalRequired: false,
      reason: "invalid_gateway_call_context",
    };
  }

  const tool = parsed.data.tool;
  const policy = normalizePolicy(parsed.data.policy);
  const context = normalizeContext(parsed.data.context);
  const permissions = tool.risk.permissions ?? [];
  const defaultDecision = tool.risk.defaultDecision ?? DEFAULT_RISK_DECISION;

  if (context.trustLevel < policy.minTrustLevel) {
    return {
      allowed: false,
      approvalRequired: false,
      reason: "trust_level_too_low",
    };
  }

  if (policy.blockDisputed && context.disputed) {
    return {
      allowed: false,
      approvalRequired: false,
      reason: "agent_or_tool_disputed",
    };
  }

  if (context.requestedCostUsd > policy.spendCapUsdPerCall) {
    return {
      allowed: false,
      approvalRequired: false,
      reason: "spend_cap_exceeded",
    };
  }

  for (const permission of permissions) {
    if (policy.blockedPermissions.includes(permission)) {
      return {
        allowed: false,
        approvalRequired: false,
        reason: `permission_blocked_${permission}`,
      };
    }
  }

  if (defaultDecision === "deny") {
    return {
      allowed: false,
      approvalRequired: false,
      reason: "tool_default_deny",
    };
  }

  const approvalPermissions = new Set([
    ...policy.approvalRequiredFor,
    ...(tool.risk.approvalRequiredFor ?? []),
  ]);

  for (const permission of approvalPermissionCandidates({ tool, policy })) {
    if (!approvalPermissions.has(permission)) {
      continue;
    }

    if (canAutoApprovePermission({ permission, policy, context })) {
      continue;
    }

    return {
      allowed: false,
      approvalRequired: true,
      reason: `approval_required_for_${permission}`,
    };
  }

  if (defaultDecision === "approval_required") {
    if (canAutoApproveDefaultDecision({ tool, policy, context })) {
      return {
        allowed: true,
        approvalRequired: false,
        reason: "allowed",
      };
    }

    return {
      allowed: false,
      approvalRequired: true,
      reason: "tool_default_approval_required",
    };
  }

  return {
    allowed: true,
    approvalRequired: false,
    reason: "allowed",
  };
}
