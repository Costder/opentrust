// Keep this list in lockstep with passport-schema/passport.schema.json.
// The cross-language contract tests fail if either declaration changes alone.
export const TRUST_STATUSES = [
  "auto_generated_draft",
  "creator_claimed",
  "owner_confirmed",
  "community_reviewed",
  "reviewer_signed",
  "security_checked",
  "continuously_monitored",
  "disputed",
] as const;

export type TrustStatus = (typeof TRUST_STATUSES)[number];

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
