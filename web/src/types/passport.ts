export type TrustStatus =
  | "auto_generated_draft"
  | "creator_claimed"
  | "seller_confirmed"
  | "community_reviewed"
  | "reviewer_signed"
  | "security_checked"
  | "continuously_monitored"
  | "disputed";

export type Passport = {
  id: string;
  slug: string;
  name: string;
  description: string;
  trust_status: TrustStatus;
  warning?: string | null;
  capabilities: string[];
  permission_manifest: Record<string, unknown>;
  risk_summary?: Record<string, unknown> | null;
  commercial_status: { status: string; fee_schedule?: Record<string, unknown> };
  billing_plan?: { tier: string; interval: string; amount_usdc: number } | null;
  agent_access: Record<string, unknown>;
};
