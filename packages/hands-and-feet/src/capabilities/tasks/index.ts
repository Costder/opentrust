import * as cron from 'node-cron';
import { randomUUID } from 'crypto';
import { enforceTrust } from '../../trust.js';
import { openDb } from '../../spend-tracker.js';
import { readConfig } from '../../config.js';
import type { PassportClaims, ToolDefinition, TrustLevel, TrustStatus } from '../../types.js';
import { validateTaskPassport } from './revocation.js';
import type { PermissionSnapshot } from './revocation.js';
import { dispatchTool } from '../../dispatch.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const CREATE_TASK_TOOL: ToolDefinition = { name: 'create_task', minTrustLevel: 3 };
const LIST_TASKS_TOOL: ToolDefinition = { name: 'list_tasks', minTrustLevel: 2 };
const DELETE_TASK_TOOL: ToolDefinition = { name: 'delete_task', minTrustLevel: 3 };
const PAUSE_TASK_TOOL: ToolDefinition = { name: 'pause_task', minTrustLevel: 3 };

export const TASK_TOOLS = {
  create_task: CREATE_TASK_TOOL,
  list_tasks: LIST_TASKS_TOOL,
  delete_task: DELETE_TASK_TOOL,
  pause_task: PAUSE_TASK_TOOL,
};

// ────────────────────────────────────────────────────────────
// In-memory job registry
// ────────────────────────────────────────────────────────────
const activeJobs = new Map<string, ReturnType<typeof cron.schedule>>();

// ────────────────────────────────────────────────────────────
// DB row type
// ────────────────────────────────────────────────────────────
interface TaskRow {
  id: number;
  label: string;
  cron_expression: string;
  tool_name: string;
  tool_args: string;
  passport_id: string;
  passport_version: string;
  permission_snapshot: string;
  status: string;
  created_at: string;
  last_fired_at: string | null;
  last_fire_status: string | null;
}

// ────────────────────────────────────────────────────────────
// Task execution helper
// ────────────────────────────────────────────────────────────
async function fireTask(label: string): Promise<void> {
  const db = openDb();
  const row = db
    .prepare('SELECT * FROM scheduled_tasks WHERE label = ? AND status = ?')
    .get(label, 'active') as TaskRow | undefined;

  if (!row) return; // deleted or paused

  let config: { registryUrl?: string };
  try {
    config = readConfig() as { registryUrl?: string };
  } catch {
    config = {};
  }

  const registryUrl = config.registryUrl ?? 'http://localhost:8000';
  const storedSnapshot = JSON.parse(row.permission_snapshot) as PermissionSnapshot;

  const validation = await validateTaskPassport(
    row.passport_id,
    row.passport_version,
    storedSnapshot,
    registryUrl,
  );

  if (validation.decision === 'deny') {
    db.prepare(
      'UPDATE scheduled_tasks SET last_fired_at = ?, last_fire_status = ? WHERE label = ?',
    ).run(new Date().toISOString(), `skipped_${validation.reason ?? 'revoked'}`, label);
    console.warn(`[tasks] skipping task '${label}': ${validation.reason}`);
    return;
  }

  // Reconstruct claims from stored passport snapshot
  const effectiveCaps = validation.effectiveSnapshot.spendCaps;
  const reconstructedClaims = {
    passportId: row.passport_id,
    agentId: row.passport_id,
    trustLevel: 3 as TrustLevel,
    trustStatus: 'seller_confirmed' as TrustStatus,
    flags: [] as string[],
    spendCaps: effectiveCaps
      ? { maxPerCallUsdc: effectiveCaps.maxPerCallUsdc ?? Infinity, dailyCapUsdc: effectiveCaps.dailyCapUsdc ?? Infinity }
      : undefined,
    isDisputed: false,
    version: row.passport_version,
  };

  const toolArgs = JSON.parse(row.tool_args) as Record<string, unknown>;
  await dispatchTool(row.tool_name, toolArgs, reconstructedClaims);

  db.prepare(
    'UPDATE scheduled_tasks SET last_fired_at = ?, last_fire_status = ? WHERE label = ?',
  ).run(new Date().toISOString(), 'success', label);
}

// ────────────────────────────────────────────────────────────
// Load active tasks on startup
// ────────────────────────────────────────────────────────────
export function loadActiveTasks(): void {
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM scheduled_tasks WHERE status = 'active'")
    .all() as TaskRow[];

  for (const row of rows) {
    if (!cron.validate(row.cron_expression)) {
      console.warn(`[tasks] invalid cron expression for task '${row.label}': ${row.cron_expression}`);
      continue;
    }
    const job = cron.schedule(row.cron_expression, () =>
      fireTask(row.label).catch((err: unknown) => {
        console.error(
          `[tasks] error firing task '${row.label}':`,
          err instanceof Error ? err.message : String(err),
        );
      }),
    );
    activeJobs.set(row.label, job);
  }
}

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────
export async function createTask(
  params: {
    label?: string;
    cron_expression: string;
    tool_name: string;
    tool_args?: Record<string, unknown>;
    passport_id: string;
    passport_version: string;
    permission_snapshot: PermissionSnapshot;
  },
  claims: PassportClaims,
): Promise<{ label: string; cron_expression: string; status: string }> {
  enforceTrust(claims, CREATE_TASK_TOOL);

  if (!cron.validate(params.cron_expression)) {
    throw new Error(`Invalid cron expression: ${params.cron_expression}`);
  }

  const label = params.label ?? `task-${randomUUID().slice(0, 8)}`;
  const db = openDb();

  db.prepare(`
    INSERT INTO scheduled_tasks
      (label, cron_expression, tool_name, tool_args, passport_id, passport_version,
       permission_snapshot, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    label,
    params.cron_expression,
    params.tool_name,
    JSON.stringify(params.tool_args ?? {}),
    params.passport_id,
    params.passport_version,
    JSON.stringify(params.permission_snapshot),
    new Date().toISOString(),
  );

  const job = cron.schedule(params.cron_expression, () =>
    fireTask(label).catch((err: unknown) => {
      console.error(
        `[tasks] error firing task '${label}':`,
        err instanceof Error ? err.message : String(err),
      );
    }),
  );
  activeJobs.set(label, job);

  return { label, cron_expression: params.cron_expression, status: 'active' };
}

export async function listTasks(
  _params: Record<string, never>,
  claims: PassportClaims,
): Promise<{ tasks: Array<Omit<TaskRow, 'id'>> }> {
  enforceTrust(claims, LIST_TASKS_TOOL);

  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM scheduled_tasks WHERE status != 'deleted' ORDER BY created_at ASC")
    .all() as TaskRow[];

  return {
    tasks: rows.map(({ id: _id, ...rest }) => rest),
  };
}

export async function deleteTask(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; deleted: boolean }> {
  enforceTrust(claims, DELETE_TASK_TOOL);

  const job = activeJobs.get(params.label);
  if (job) {
    job.stop();
    activeJobs.delete(params.label);
  }

  const db = openDb();
  const result = db
    .prepare("UPDATE scheduled_tasks SET status = 'deleted' WHERE label = ?")
    .run(params.label);

  return { label: params.label, deleted: result.changes > 0 };
}

export async function pauseTask(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; paused: boolean }> {
  enforceTrust(claims, PAUSE_TASK_TOOL);

  const job = activeJobs.get(params.label);
  if (job) {
    job.stop();
    // Keep in map so we can detect it's paused
  }

  const db = openDb();
  const result = db
    .prepare("UPDATE scheduled_tasks SET status = 'paused' WHERE label = ? AND status = 'active'")
    .run(params.label);

  return { label: params.label, paused: result.changes > 0 };
}
