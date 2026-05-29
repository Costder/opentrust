// packages/hands-and-feet/src/capabilities/delegations/index.ts
import { randomUUID } from 'crypto';
import { openDb } from '../../spend-tracker.js';
import { readConfig } from '../../config.js';
import { isPaused } from '../../state.js';
import { enforceTrust } from '../../trust.js';
import { dispatchTool } from '../../dispatch.js';
import { validateTaskPassport } from '../tasks/revocation.js';
import type { PassportClaims, TrustLevel, TrustStatus, ToolDefinition } from '../../types.js';
import type { DispatchResult } from '../../dispatch.js';

// ── Tool definitions ────────────────────────────────────────────
const CREATE_DELEGATION_TOOL: ToolDefinition = { name: 'create_delegation', minTrustLevel: 3 };
const LIST_DELEGATIONS_TOOL: ToolDefinition  = { name: 'list_delegations',  minTrustLevel: 2 };
const REVOKE_DELEGATION_TOOL: ToolDefinition = { name: 'revoke_delegation', minTrustLevel: 3 };

export const DELEGATION_TOOLS = {
  create_delegation: CREATE_DELEGATION_TOOL,
  list_delegations:  LIST_DELEGATIONS_TOOL,
  revoke_delegation: REVOKE_DELEGATION_TOOL,
};

// ── Row types ───────────────────────────────────────────────────
interface DelegationRow {
  id: number;
  label: string;
  passport_id: string;
  passport_version: string;
  agent_id: string;
  trust_level: number;
  trust_status: string;
  tool_allowlist: string; // JSON string[]
  spend_caps: string;     // JSON {maxPerCallUsdc?: number, dailyCapUsdc?: number}
  action_budgets: string; // JSON Record<string, number>
  status: string;
  created_at: string;
}

interface UsageRow {
  id: number;
  delegation_id: number;
  tool: string;
  call_count: number;
  spent_usdc: number;
  window_start: string;
}

// ── CRUD tools ──────────────────────────────────────────────────
export async function createDelegation(
  params: {
    label?: string;
    tool_allowlist: string[];
    spend_caps: { maxPerCallUsdc?: number; dailyCapUsdc?: number };
    action_budgets: Record<string, number>;
  },
  claims: PassportClaims,
): Promise<{ label: string; status: string }> {
  enforceTrust(claims, CREATE_DELEGATION_TOOL);

  const label = params.label ?? `del-${randomUUID().slice(0, 8)}`;
  const db = openDb();

  db.prepare(`
    INSERT INTO delegations
      (label, passport_id, passport_version, agent_id, trust_level, trust_status,
       tool_allowlist, spend_caps, action_budgets, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    label,
    claims.passportId,
    claims.version,
    claims.agentId,
    claims.trustLevel,
    claims.trustStatus,
    JSON.stringify(params.tool_allowlist),
    JSON.stringify(params.spend_caps),
    JSON.stringify(params.action_budgets),
    new Date().toISOString(),
  );

  return { label, status: 'active' };
}

export async function listDelegations(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ delegations: Array<Omit<DelegationRow, 'id'>> }> {
  enforceTrust(claims, LIST_DELEGATIONS_TOOL);
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM delegations WHERE status != 'deleted' ORDER BY created_at ASC")
    .all() as DelegationRow[];
  return { delegations: rows.map(({ id: _id, ...rest }) => rest) };
}

export async function revokeDelegation(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; revoked: boolean }> {
  enforceTrust(claims, REVOKE_DELEGATION_TOOL);
  const db = openDb();
  const result = db
    .prepare("UPDATE delegations SET status = 'revoked' WHERE label = ? AND status = 'active'")
    .run(params.label);
  return { label: params.label, revoked: result.changes > 0 };
}

// ── Execution wrapper ───────────────────────────────────────────
export async function executeUnderDelegation(
  delegationLabel: string,
  tool: string,
  args: unknown,
): Promise<DispatchResult> {
  const db = openDb();

  // Load delegation
  const delegation = db
    .prepare('SELECT * FROM delegations WHERE label = ?')
    .get(delegationLabel) as DelegationRow | undefined;

  if (!delegation) return { content: [{ type: 'text', text: `Delegation not found: ${delegationLabel}` }], isError: true };
  if (delegation.status !== 'active') return { content: [{ type: 'text', text: `Delegation is ${delegation.status}` }], isError: true };

  // 1. Kill switch
  if (isPaused()) return { content: [{ type: 'text', text: 'PAUSED: Hands and Feet is paused' }], isError: true };

  // 2. Re-validate passport against live registry
  let config: { registryUrl?: string };
  try { config = readConfig() as { registryUrl?: string }; } catch { config = {}; }
  const registryUrl = config.registryUrl ?? 'http://localhost:8000';

  const validation = await validateTaskPassport(
    delegation.passport_id,
    delegation.passport_version,
    { tool, spendCaps: JSON.parse(delegation.spend_caps) as { maxPerCallUsdc?: number; dailyCapUsdc?: number } },
    registryUrl,
  );

  if (validation.decision === 'deny') {
    return { content: [{ type: 'text', text: `Passport denied: ${validation.reason}` }], isError: true };
  }

  // 3. Check tool allowlist
  const allowlist = JSON.parse(delegation.tool_allowlist) as string[];
  if (!allowlist.includes(tool)) {
    return { content: [{ type: 'text', text: `Tool '${tool}' not in allowlist for delegation '${delegationLabel}'` }], isError: true };
  }

  // 4. Check & increment action budget
  const budgets = JSON.parse(delegation.action_budgets) as Record<string, number>;
  const toolBudget = budgets[tool];
  if (toolBudget !== undefined) {
    const usage = db
      .prepare('SELECT call_count FROM delegation_usage WHERE delegation_id = ? AND tool = ?')
      .get(delegation.id, tool) as UsageRow | undefined;
    const currentCount = usage?.call_count ?? 0;
    if (currentCount >= toolBudget) {
      db.prepare("UPDATE delegations SET status = 'exhausted' WHERE id = ?").run(delegation.id);
      return { content: [{ type: 'text', text: `Action budget exhausted for tool '${tool}' in delegation '${delegationLabel}'` }], isError: true };
    }
    // Atomically increment
    db.prepare(`
      INSERT INTO delegation_usage (delegation_id, tool, call_count, spent_usdc, window_start)
      VALUES (?, ?, 1, 0, ?)
      ON CONFLICT(delegation_id, tool) DO UPDATE SET call_count = call_count + 1
    `).run(delegation.id, tool, new Date().toISOString());
  }

  // 5. Narrower-wins on spend caps: min(delegation.spend_caps, effectiveSnapshot.spendCaps)
  const delCaps = JSON.parse(delegation.spend_caps) as { maxPerCallUsdc?: number; dailyCapUsdc?: number };
  const regCaps = validation.effectiveSnapshot.spendCaps;
  const effectiveCaps = {
    maxPerCallUsdc: Math.min(delCaps.maxPerCallUsdc ?? Infinity, regCaps?.maxPerCallUsdc ?? Infinity),
    dailyCapUsdc:   Math.min(delCaps.dailyCapUsdc   ?? Infinity, regCaps?.dailyCapUsdc   ?? Infinity),
  };

  // 6. Reconstruct claims and dispatch
  const reconstructedClaims: PassportClaims = {
    passportId:  delegation.passport_id,
    agentId:     delegation.agent_id,
    trustLevel:  delegation.trust_level as TrustLevel,
    trustStatus: delegation.trust_status as TrustStatus,
    flags:       [],
    spendCaps: {
      maxPerCallUsdc: isFinite(effectiveCaps.maxPerCallUsdc) ? effectiveCaps.maxPerCallUsdc : 9999,
      dailyCapUsdc:   isFinite(effectiveCaps.dailyCapUsdc)   ? effectiveCaps.dailyCapUsdc   : 9999,
    },
    isDisputed: false,
    version:    delegation.passport_version,
  };

  return dispatchTool(tool, args, reconstructedClaims);
}
