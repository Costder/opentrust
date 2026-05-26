export type TrustStatus =
  | "auto_generated_draft"
  | "creator_claimed"
  | "seller_confirmed"
  | "community_reviewed"
  | "reviewer_signed"
  | "security_checked"
  | "continuously_monitored"
  | "disputed";

export interface Passport {
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
    [key: string]: unknown;
  } | null;
  risk_summary?: Record<string, unknown> | null;
  commercial_status: {
    status: string;
    pricing?: { amount: number; currency: string };
    payment_config?: {
      network: string;
      wallet_address: string;
      supported_tokens: string[];
    };
    [key: string]: unknown;
  };
  agent_access: Record<string, unknown>;
}

export interface VerifyResult {
  slug: string;
  trustStatus: string;
  trustLevel: number;
  isDisputed: boolean;
  recommendation: string;
  risk: "low" | "medium" | "high";
  passport: Passport;
  permissions: Record<string, unknown>;
}

export interface ToolsPage {
  items: Passport[];
  total: number;
  page: number;
  limit: number;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  trustStatus?: string;
}

export interface SearchOptions {
  trustStatus?: string;
}
