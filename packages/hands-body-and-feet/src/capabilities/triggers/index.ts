// packages/hands-body-and-feet/src/capabilities/triggers/index.ts
import * as cron from 'node-cron';
import { randomUUID } from 'crypto';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import { executeUnderDelegation } from '../delegations/index.js';
import { dispatchTool } from '../../dispatch.js';
import type { PassportClaims, TrustLevel, TrustStatus, ToolDefinition } from '../../types.js';

// System-level claims for notify_human dispatch from triggers without a delegation
const TRIGGER_SYSTEM_CLAIMS: PassportClaims = {
  passportId: 'system',
  agentId: 'hands-body-and-feet-system',
  trustLevel: 2 as TrustLevel,
  trustStatus: 'creator_claimed' as TrustStatus,
  flags: [],
  isDisputed: false,
  version: '1',
};

// ── Tool definitions ────────────────────────────────────────────
const CREATE_TRIGGER_TOOL: ToolDefinition = { name: 'create_trigger', minTrustLevel: 3 };
const LIST_TRIGGERS_TOOL: ToolDefinition  = { name: 'list_triggers',  minTrustLevel: 2 };
const DELETE_TRIGGER_TOOL: ToolDefinition = { name: 'delete_trigger', minTrustLevel: 3 };
const PAUSE_TRIGGER_TOOL: ToolDefinition  = { name: 'pause_trigger',  minTrustLevel: 3 };

export const TRIGGER_TOOLS = {
  create_trigger: CREATE_TRIGGER_TOOL,
  list_triggers:  LIST_TRIGGERS_TOOL,
  delete_trigger: DELETE_TRIGGER_TOOL,
  pause_trigger:  PAUSE_TRIGGER_TOOL,
};

// ── Row type ────────────────────────────────────────────────────
interface TriggerRow {
  id: number;
  label: string;
  source: string;
  match_json: string;
  action_json: string;
  delegation_id: number | null;
  status: string;
  last_fired_at: string | null;
  last_fire_status: string | null;
}

const activeJobs = new Map<string, ReturnType<typeof cron.schedule>>();

// ── Template renderer (string substitution only) ─────────────────
export function renderTemplate(
  template: Record<string, unknown>,
  event: Record<string, unknown>,
): Record<string, unknown> {
  const rendered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v === 'string') {
      rendered[k] = v.replace(/\{\{event\.([^}]+)\}\}/g, (_match, field: string) => {
        const val = event[field];
        return val !== undefined ? String(val) : `{{event.${field}}}`;
      });
    } else {
      rendered[k] = v;
    }
  }
  return rendered;
}

// ── CRUD ─────────────────────────────────────────────────────────
export async function createTrigger(
  params: {
    label?: string;
    source: 'cron' | 'webhook' | 'email' | 'sms' | 'rss';
    match: Record<string, unknown>;
    action: { tool_name: string; tool_args_template: Record<string, unknown> };
    delegation_label: string | null;
  },
  claims: PassportClaims,
): Promise<{ label: string; status: string }> {
  enforceTrust(claims, CREATE_TRIGGER_TOOL);

  const label = params.label ?? `trigger-${randomUUID().slice(0, 8)}`;
  const db = openDb();

  // Resolve delegation_id
  let delegationId: number | null = null;
  if (params.delegation_label) {
    const row = db.prepare('SELECT id FROM delegations WHERE label = ?').get(params.delegation_label) as { id: number } | undefined;
    delegationId = row?.id ?? null;
  }

  db.prepare(`
    INSERT INTO triggers (label, source, match_json, action_json, delegation_id, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(
    label,
    params.source,
    JSON.stringify(params.match),
    JSON.stringify(params.action),
    delegationId,
  );

  // For cron triggers, schedule immediately
  if (params.source === 'cron') {
    const expr = (params.match as { cron_expression?: string }).cron_expression;
    if (expr && cron.validate(expr)) {
      const job = cron.schedule(expr, () => {
        matchAndFire('cron', { trigger_label: label }).catch((e: unknown) => {
          console.error(`[triggers] cron fire error for '${label}':`, e instanceof Error ? e.message : String(e));
        });
      });
      activeJobs.set(label, job);
    }
  }

  return { label, status: 'active' };
}

export async function listTriggers(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ triggers: Array<Omit<TriggerRow, 'id'>> }> {
  enforceTrust(claims, LIST_TRIGGERS_TOOL);
  const db = openDb();
  const rows = db.prepare("SELECT * FROM triggers WHERE status != 'deleted' ORDER BY rowid ASC").all() as TriggerRow[];
  return { triggers: rows.map(({ id: _id, ...rest }) => rest) };
}

export async function deleteTrigger(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; deleted: boolean }> {
  enforceTrust(claims, DELETE_TRIGGER_TOOL);
  const job = activeJobs.get(params.label);
  if (job) { job.stop(); activeJobs.delete(params.label); }
  const db = openDb();
  const result = db.prepare("UPDATE triggers SET status = 'deleted' WHERE label = ?").run(params.label);
  return { label: params.label, deleted: result.changes > 0 };
}

export async function pauseTrigger(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; paused: boolean }> {
  enforceTrust(claims, PAUSE_TRIGGER_TOOL);
  const job = activeJobs.get(params.label);
  if (job) job.stop();
  const db = openDb();
  const result = db.prepare("UPDATE triggers SET status = 'paused' WHERE label = ? AND status = 'active'").run(params.label);
  return { label: params.label, paused: result.changes > 0 };
}

// ── Fire engine ──────────────────────────────────────────────────
/**
 * Called by receiver hooks (webhook, email, sms, rss) and cron jobs.
 * source: 'cron'|'webhook'|'email'|'sms'|'rss'
 * event: source-specific payload used for matching + template rendering
 */
export async function matchAndFire(
  source: string,
  event: Record<string, unknown>,
): Promise<void> {
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM triggers WHERE source = ? AND status = 'active'")
    .all(source) as TriggerRow[];

  for (const row of rows) {
    const match = JSON.parse(row.match_json) as Record<string, unknown>;
    if (!matchesPredicate(match, event)) continue;

    const action = JSON.parse(row.action_json) as { tool_name: string; tool_args_template: Record<string, unknown> };
    const renderedArgs = renderTemplate(action.tool_args_template, event);

    let fireStatus = 'success';
    try {
      if (row.delegation_id !== null) {
        const del = db.prepare('SELECT label FROM delegations WHERE id = ?').get(row.delegation_id) as { label: string } | undefined;
        if (del) {
          const result = await executeUnderDelegation(del.label, action.tool_name, renderedArgs);
          if (result.isError) fireStatus = `error:${result.content[0]?.text ?? 'unknown'}`;
        } else {
          fireStatus = 'error:delegation_not_found';
        }
      } else {
        // No delegation — only allow notify_human (HITL)
        if (action.tool_name !== 'notify_human') {
          fireStatus = 'error:no_delegation_required';
        } else {
          // Fire notify_human with system claims — HITL alert, no passport required
          const result = await dispatchTool('notify_human', renderedArgs, TRIGGER_SYSTEM_CLAIMS);
          if (result.isError) fireStatus = `error:${result.content[0]?.text ?? 'unknown'}`;
        }
      }
    } catch (e) {
      fireStatus = `error:${e instanceof Error ? e.message : String(e)}`;
    }

    db.prepare("UPDATE triggers SET last_fired_at = ?, last_fire_status = ? WHERE id = ?")
      .run(new Date().toISOString(), fireStatus, row.id);
  }
}

function matchesPredicate(match: Record<string, unknown>, event: Record<string, unknown>): boolean {
  // For cron: trigger_label match
  if ('trigger_label' in match) return match['trigger_label'] === event['trigger_label'];
  // For webhook: webhook_label
  if ('webhook_label' in match) return match['webhook_label'] === event['webhook_label'];
  // For email: from_contains
  if ('from_contains' in match) {
    const from = String(event['from'] ?? '');
    return from.includes(String(match['from_contains']));
  }
  // For sms: from_number match
  if ('from_number' in match) return match['from_number'] === event['from_number'];
  // For rss: feed_label + optional keyword
  if ('feed_label' in match) {
    if (match['feed_label'] !== event['feed_label']) return false;
    if ('keyword' in match) return String(event['title'] ?? '').includes(String(match['keyword']));
    return true;
  }
  return false;
}

// ── Boot loader ──────────────────────────────────────────────────
export function loadActiveTriggers(): void {
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM triggers WHERE source = 'cron' AND status = 'active'")
    .all() as TriggerRow[];

  for (const row of rows) {
    const match = JSON.parse(row.match_json) as { cron_expression?: string };
    const expr = match.cron_expression;
    if (!expr || !cron.validate(expr)) {
      console.warn(`[triggers] invalid cron expression for trigger '${row.label}'`);
      continue;
    }
    const job = cron.schedule(expr, () => {
      matchAndFire('cron', { trigger_label: row.label }).catch((e: unknown) => {
        console.error(`[triggers] cron fire error for '${row.label}':`, e instanceof Error ? e.message : String(e));
      });
    });
    activeJobs.set(row.label, job);
  }
}
