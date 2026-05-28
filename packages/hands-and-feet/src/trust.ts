import type { PassportClaims, ToolDefinition } from './types.js';

export class TrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustError';
  }
}

export class DisputedError extends Error {
  constructor(passportId: string) {
    super(`Passport ${passportId} is in disputed status — all operations halted`);
    this.name = 'DisputedError';
  }
}

/**
 * Enforces trust level and disputed overlay for a tool call.
 * Throws TrustError or DisputedError if access is denied.
 */
export function enforceTrust(
  claims: PassportClaims,
  tool: ToolDefinition,
): void {
  // Disputed overlay: halt all ops
  if (claims.isDisputed || claims.trustStatus === 'disputed') {
    throw new DisputedError(claims.passportId);
  }

  // Level check
  if (claims.trustLevel < tool.minTrustLevel) {
    throw new TrustError(
      `Tool '${tool.name}' requires trust level ${tool.minTrustLevel}, ` +
      `passport has level ${claims.trustLevel} (${claims.trustStatus})`,
    );
  }
}

/**
 * Checks a proposed spend amount against the passport's spend caps.
 * Throws TrustError if the amount would exceed limits.
 * @param proposedAmountUsdc amount in USDC (e.g. 10.5 = $10.50)
 */
export function enforceSpend(
  claims: PassportClaims,
  tool: ToolDefinition,
  proposedAmountUsdc: number,
): void {
  const passportCap = claims.spendCaps?.maxPerCallUsdc;
  const toolCap = tool.spendPolicy?.maxPerCallUsdc;

  // Apply the lower of passport cap vs tool cap (whichever is defined)
  const effectiveCap = [passportCap, toolCap]
    .filter((v): v is number => v !== undefined)
    .reduce((min, v) => Math.min(min, v), Infinity);

  if (isFinite(effectiveCap) && proposedAmountUsdc > effectiveCap) {
    throw new TrustError(
      `Amount ${proposedAmountUsdc} USDC exceeds cap ${effectiveCap} USDC for tool '${tool.name}'`,
    );
  }
}
