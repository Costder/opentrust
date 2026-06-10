// packages/hands-body-and-feet/src/capabilities/bus/index.ts
// Coordination message bus for agents sharing this HBF instance.
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ── Tool definitions ──────────────────────────────────────────
const BUS_SEND_TOOL: ToolDefinition  = { name: 'bus_send',  minTrustLevel: 2 };
const BUS_POLL_TOOL: ToolDefinition  = { name: 'bus_poll',  minTrustLevel: 2 };
const BUS_WAIT_TOOL: ToolDefinition  = { name: 'bus_wait',  minTrustLevel: 2 };

export const BUS_TOOLS = {
  bus_send: BUS_SEND_TOOL,
  bus_poll: BUS_POLL_TOOL,
  bus_wait: BUS_WAIT_TOOL,
} as const;

// ── Row type ─────────────────────────────────────────────────
interface BusMessageRow {
  id: number;
  to_agent: string;
  from_agent: string | null;
  payload: string;
  created_at: string;
  claimed_at: string | null;
}

// ── Tools ────────────────────────────────────────────────────

export async function busSend(
  params: { to_agent: string; payload: unknown; from_agent?: string },
  claims: PassportClaims,
): Promise<{ message_id: number; queued: true }> {
  enforceTrust(claims, BUS_SEND_TOOL);
  const db = openDb();
  const result = db
    .prepare(
      `INSERT INTO bus_messages (to_agent, from_agent, payload, created_at, claimed_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(
      params.to_agent,
      params.from_agent ?? null,
      JSON.stringify(params.payload),
      new Date().toISOString(),
    );
  return { message_id: result.lastInsertRowid as number, queued: true };
}

export async function busPoll(
  params: { agent_id: string; limit?: number },
  claims: PassportClaims,
): Promise<{
  messages: Array<{ message_id: number; from_agent: string | null; payload: unknown; created_at: string }>;
  remaining: number;
}> {
  enforceTrust(claims, BUS_POLL_TOOL);
  const db = openDb();
  const limit = params.limit ?? 10;
  const now = new Date().toISOString();

  // Atomically fetch and mark claimed in one transaction
  const messages = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM bus_messages
         WHERE to_agent = ? AND claimed_at IS NULL
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(params.agent_id, limit) as BusMessageRow[];

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(
        `UPDATE bus_messages SET claimed_at = ? WHERE id IN (${placeholders})`,
      ).run(now, ...ids);
    }

    // Count remaining unclaimed after this batch
    const remaining = (
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM bus_messages
           WHERE to_agent = ? AND claimed_at IS NULL`,
        )
        .get(params.agent_id) as { cnt: number }
    ).cnt;

    return { rows, remaining };
  })();

  return {
    messages: messages.rows.map((r) => ({
      message_id: r.id,
      from_agent: r.from_agent,
      payload: JSON.parse(r.payload) as unknown,
      created_at: r.created_at,
    })),
    remaining: messages.remaining,
  };
}

export async function busWait(
  params: { agent_id: string; timeout_ms?: number; poll_interval_ms?: number },
  claims: PassportClaims,
): Promise<{
  messages: Array<{ message_id: number; from_agent: string | null; payload: unknown; created_at: string }>;
  timed_out?: true;
}> {
  enforceTrust(claims, BUS_WAIT_TOOL);
  const timeoutMs = params.timeout_ms ?? 60_000;
  const pollIntervalMs = params.poll_interval_ms ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await busPoll({ agent_id: params.agent_id, limit: 10 }, claims);
    if (result.messages.length > 0) {
      return { messages: result.messages };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((r) => setTimeout(r, Math.min(pollIntervalMs, remaining)));
  }

  return { messages: [], timed_out: true };
}
