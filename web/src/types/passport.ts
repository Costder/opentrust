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
  tool_identity: {
    slug: string;
    name: string;
    version?: string;
    publisher?: string;
    source_url?: string;
    [key: string]: unknown;
  };
  creator_identity?: {
    creator?: string;
    verification_state?: string;
    [key: string]: unknown;
  } | null;
  version_hash?: {
    version?: string;
    commit?: string;
    artifact_hash?: string;
    [key: string]: unknown;
  };
  capabilities: string[];
  permission_manifest: Record<string, boolean | string | Record<string, unknown>>;
  evidence?: {
    scanner?: string;
    run_at?: string;
    commit?: string;
    findings?: { critical: number; high: number; medium: number; low: number };
    reviewer?: { identity: string; signature: string };
    dependency_snapshot?: string;
    [key: string]: unknown;
  } | null;
  risk_summary?: Record<string, unknown> | null;
  review_history?: Record<string, unknown>[];
  commercial_status: {
    status: string;
    pricing?: { amount: number; currency: string };
    payment_config?: {
      network: string;
      wallet_address: string;
      supported_tokens: string[];
    };
    fee_schedule?: Record<string, unknown>;
    [key: string]: unknown;
  };
  billing_plan?: { tier: string; interval: string; amount_usdc: number } | null;
  fee_schedule?: Record<string, unknown> | null;
  agent_access: Record<string, unknown>;
};
