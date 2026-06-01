export type TrustStatus =
  | 'auto_generated_draft'   // L1
  | 'creator_claimed'        // L2
  | 'seller_confirmed'       // L3
  | 'community_reviewed'     // L4
  | 'reviewer_signed'        // L5
  | 'security_checked'       // L6
  | 'continuously_monitored' // L7
  | 'disputed';

/** Numeric trust level 1-7 derived from trust_status */
export type TrustLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const TRUST_STATUS_TO_LEVEL: Record<TrustStatus, TrustLevel | 0> = {
  auto_generated_draft: 1,
  creator_claimed: 2,
  seller_confirmed: 3,
  community_reviewed: 4,
  reviewer_signed: 5,
  security_checked: 6,
  continuously_monitored: 7,
  disputed: 0, // special: always denied
};

export interface PassportClaims {
  passportId: string;
  agentId: string;
  trustLevel: TrustLevel;
  trustStatus: TrustStatus;
  flags: string[];
  spendCaps?: {
    maxPerCallUsdc: number;
    dailyCapUsdc: number;
  };
  isDisputed: boolean;
  version: string;
}

export interface SpendPolicy {
  maxPerCallUsdc?: number;
  dailyCapUsdc?: number;
  requiresGasReserve?: boolean;
}

export interface ToolDefinition {
  name: string;
  minTrustLevel: TrustLevel;
  spendPolicy?: SpendPolicy;
}

export interface HandsAndFeetConfig {
  version: 1;
  instanceId: string;
  registryUrl: string;
  passphraseHash: string;
  capabilities: {
    notify?: {
      topic: string;
      serverUrl: string;
    };
    cards?: {
      sandbox: boolean;
    };
    phone?: {
      provider: 'twilio' | 'signalwire';
    };
    email?: {
      transport: 'local' | 'postmark' | 'resend' | 'agentmail';
      localPort?: number;
    };
    github?: {
      defaultOwner?: string;
    };
  };
  allowLocalFallback?: boolean;
}

export interface KillSwitchState {
  paused: boolean;
  pausedAt?: string;
  pausedBy?: string;
  resumedAt?: string;
}
