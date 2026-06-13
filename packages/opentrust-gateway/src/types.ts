export type ExecutionMode =
  | "hosted_hbf"
  | "hosted_mcp"
  | "remote_mcp"
  | "api_oauth"
  | "local_connector";

export type RiskDecision = "allow" | "approval_required" | "deny";

export interface GatewayToolRisk {
  category: string;
  permissions: readonly string[];
  defaultDecision: RiskDecision;
  approvalRequiredFor: readonly string[];
}

export interface GatewayToolSpec {
  slug: string;
  name: string;
  providerSlug: string;
  executionMode: ExecutionMode;
  risk: GatewayToolRisk;
}

export interface GatewayPolicy {
  minTrustLevel: number;
  blockDisputed: boolean;
  spendCapUsdPerCall: number;
  autoApproveMaxUsd: number;
  blockedPermissions: readonly string[];
  approvalRequiredFor: readonly string[];
}

export interface GatewayCallContext {
  agentId: string;
  trustLevel: number;
  disputed: boolean;
  requestedCostUsd: number;
  toolArgs: Record<string, unknown>;
}

export interface GatewayPolicyDecision {
  allowed: boolean;
  approvalRequired: boolean;
  reason: string;
}

export interface GatewayToolCall {
  tool: GatewayToolSpec;
  context: GatewayCallContext;
}

export interface GatewayAdapterResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayAdapter {
  executionMode: ExecutionMode;
  callTool(call: GatewayToolCall): Promise<GatewayAdapterResult>;
}
