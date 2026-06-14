import type { AutonomyMode, SpendCaps } from './types.js';

export interface ModeMetadata {
  mode: AutonomyMode;
  tier: 1 | 2 | 3 | 4;
  label: string;
  subtitle: string;
  description: string;
  alwaysOn: boolean;
}

export const AUTONOMY_MODES: ModeMetadata[] = [
  {
    mode: 'manager',
    tier: 1,
    label: 'Manager Mode',
    subtitle: 'Detail-oriented control',
    description: 'Safest mode. The agent plans, drafts, and asks before meaningful external action.',
    alwaysOn: false,
  },
  {
    mode: 'operator',
    tier: 2,
    label: 'Operator Mode',
    subtitle: 'Hands-on execution',
    description: 'The agent handles routine work and asks before risky actions outside configured policy.',
    alwaysOn: false,
  },
  {
    mode: 'shopkeeper',
    tier: 3,
    label: 'Shopkeeper Mode',
    subtitle: 'Hands-off daily operations',
    description: 'The agent runs day-to-day work inside budgets, policies, and exception rules.',
    alwaysOn: true,
  },
  {
    mode: 'founder',
    tier: 4,
    label: 'Founder Mode',
    subtitle: 'Mission-level autonomy',
    description: 'The agent runs continuously toward a broad mission until stopped.',
    alwaysOn: true,
  },
];

export function getModeMetadata(mode: AutonomyMode): ModeMetadata {
  const metadata = AUTONOMY_MODES.find((item) => item.mode === mode);
  if (!metadata) throw new Error(`Unknown autonomy mode: ${mode}`);
  return metadata;
}

export interface SpendDecision {
  allowed: boolean;
  reason: string;
  remainingDaily: number;
  remainingMission: number;
}

export function decideSpendWithinCaps(
  amount: number,
  caps: SpendCaps,
  spentToday = 0,
  spentMission = 0,
): SpendDecision {
  const remainingDaily = Math.max(caps.daily - spentToday, 0);
  const remainingMission = Math.max(caps.missionTotal - spentMission, 0);

  if (amount < 0) {
    return { allowed: false, reason: 'Amount must be positive.', remainingDaily, remainingMission };
  }

  if (amount > 0 && caps.perCall <= 0 && caps.daily <= 0 && caps.missionTotal <= 0) {
    return {
      allowed: false,
      reason: 'No hard spend budget configured.',
      remainingDaily,
      remainingMission,
    };
  }

  if (caps.perCall > 0 && amount > caps.perCall) {
    return { allowed: false, reason: 'Amount exceeds per-call hard cap.', remainingDaily, remainingMission };
  }

  if (caps.daily > 0 && amount > remainingDaily) {
    return { allowed: false, reason: 'Amount exceeds remaining daily hard cap.', remainingDaily, remainingMission };
  }

  if (caps.missionTotal > 0 && amount > remainingMission) {
    return { allowed: false, reason: 'Amount exceeds remaining mission hard cap.', remainingDaily, remainingMission };
  }

  return {
    allowed: true,
    reason: 'Allowed inside hard budget caps; no per-action approval required.',
    remainingDaily,
    remainingMission,
  };
}

export function defaultSpendCaps(overrides: Partial<SpendCaps> = {}): SpendCaps {
  return {
    perCall: overrides.perCall ?? 0,
    daily: overrides.daily ?? 0,
    missionTotal: overrides.missionTotal ?? 0,
    currency: overrides.currency ?? 'USDC',
  };
}
