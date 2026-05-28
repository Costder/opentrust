export interface PermissionSnapshot {
  tool: string;
  spendCaps?: {
    maxPerCallUsdc?: number;
    dailyCapUsdc?: number;
  };
}

interface PassportResponse {
  id: string;
  version: string;
  status: string; // 'active' | 'revoked' | 'disputed' | ...
  spendCaps?: {
    maxPerCallUsdc?: number;
    dailyCapUsdc?: number;
  };
}

function narrowerCaps(
  stored: PermissionSnapshot['spendCaps'],
  current: PermissionSnapshot['spendCaps'],
): PermissionSnapshot['spendCaps'] {
  if (!stored && !current) return undefined;
  if (!stored) return current;
  if (!current) return stored;

  return {
    maxPerCallUsdc:
      stored.maxPerCallUsdc !== undefined && current.maxPerCallUsdc !== undefined
        ? Math.min(stored.maxPerCallUsdc, current.maxPerCallUsdc)
        : stored.maxPerCallUsdc ?? current.maxPerCallUsdc,
    dailyCapUsdc:
      stored.dailyCapUsdc !== undefined && current.dailyCapUsdc !== undefined
        ? Math.min(stored.dailyCapUsdc, current.dailyCapUsdc)
        : stored.dailyCapUsdc ?? current.dailyCapUsdc,
  };
}

export async function validateTaskPassport(
  passportId: string,
  storedVersion: string,
  storedSnapshot: PermissionSnapshot,
  registryUrl: string,
): Promise<{
  decision: 'allow' | 'deny';
  reason?: string;
  effectiveSnapshot: PermissionSnapshot;
}> {
  let response: Response;
  try {
    response = await fetch(`${registryUrl}/api/v1/passports/${passportId}`);
  } catch (err: unknown) {
    return {
      decision: 'deny',
      reason: 'registry_unreachable',
      effectiveSnapshot: storedSnapshot,
    };
  }

  if (!response.ok) {
    return {
      decision: 'deny',
      reason: `registry_error:${response.status}`,
      effectiveSnapshot: storedSnapshot,
    };
  }

  let passport: PassportResponse;
  try {
    passport = (await response.json()) as PassportResponse;
  } catch {
    return {
      decision: 'deny',
      reason: 'registry_invalid_response',
      effectiveSnapshot: storedSnapshot,
    };
  }

  // Check for revocation / disputed
  if (passport.status === 'revoked' || passport.status === 'disputed') {
    return {
      decision: 'deny',
      reason: `passport_${passport.status}`,
      effectiveSnapshot: storedSnapshot,
    };
  }

  // Version mismatch — apply narrower-wins
  if (passport.version !== storedVersion) {
    const currentSnapshot: PermissionSnapshot = {
      tool: storedSnapshot.tool,
      spendCaps: passport.spendCaps,
    };
    const effectiveCaps = narrowerCaps(storedSnapshot.spendCaps, currentSnapshot.spendCaps);
    const effectiveSnapshot: PermissionSnapshot = {
      tool: storedSnapshot.tool,
      spendCaps: effectiveCaps,
    };
    return { decision: 'allow', reason: 'version_mismatch_narrower_wins', effectiveSnapshot };
  }

  return { decision: 'allow', effectiveSnapshot: storedSnapshot };
}
