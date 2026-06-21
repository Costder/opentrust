// packages/hands-body-and-feet/src/capabilities/cloud-relay/index.ts
// Cloud agent relay — polls the bus for messages to registered cloud agents
// and forwards them via HTTP webhook. Replies written back to the bus.

import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ── Tool definitions ──────────────────────────────────────────────────────────

const RELAY_REGISTER_TOOL: ToolDefinition = { name: 'cloud_relay_register', minTrustLevel: 3 };
const RELAY_LIST_TOOL:     ToolDefinition = { name: 'cloud_relay_list',     minTrustLevel: 2 };
const RELAY_REMOVE_TOOL:   ToolDefinition = { name: 'cloud_relay_remove',   minTrustLevel: 3 };

export const CLOUD_RELAY_TOOLS = {
  cloud_relay_register: RELAY_REGISTER_TOOL,
  cloud_relay_list:     RELAY_LIST_TOOL,
  cloud_relay_remove:   RELAY_REMOVE_TOOL,
} as const;

// ── Schema migration (additive) ────────────────────────────────────────────────

export function ensureCloudRelayTable(): void {
  const db = openDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_relay (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL UNIQUE,
      webhook_url TEXT NOT NULL,
      poll_ms     INTEGER NOT NULL DEFAULT 3000,
      created_at  TEXT NOT NULL,
      last_poll   TEXT,
      last_error  TEXT
    );
  `);
}

// ── Tool functions ─────────────────────────────────────────────────────────────

export interface RelayRegisterParams {
  agent_id:    string;
  webhook_url: string;
  poll_ms?:    number;
}

export async function cloudRelayRegister(
  params: RelayRegisterParams,
  claims: PassportClaims,
): Promise<{ registered: true; agent_id: string; webhook_url: string; poll_ms: number }> {
  enforceTrust(claims, RELAY_REGISTER_TOOL);
  ensureCloudRelayTable();
  const db = openDb();
  const pollMs = params.poll_ms ?? 3000;
  db.prepare(`
    INSERT INTO cloud_relay (agent_id, webhook_url, poll_ms, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET webhook_url = excluded.webhook_url, poll_ms = excluded.poll_ms
  `).run(params.agent_id, params.webhook_url, pollMs, new Date().toISOString());

  // Kick off poller for this agent if not already running
  startRelayPoller(params.agent_id, params.webhook_url, pollMs);

  return { registered: true, agent_id: params.agent_id, webhook_url: params.webhook_url, poll_ms: pollMs };
}

export async function cloudRelayList(
  _params: Record<string, never>,
  claims: PassportClaims,
): Promise<{ relays: Array<{ agent_id: string; webhook_url: string; poll_ms: number; last_poll: string | null; last_error: string | null }> }> {
  enforceTrust(claims, RELAY_LIST_TOOL);
  ensureCloudRelayTable();
  const db = openDb();
  const rows = db.prepare('SELECT agent_id, webhook_url, poll_ms, last_poll, last_error FROM cloud_relay ORDER BY id').all() as Array<{
    agent_id: string; webhook_url: string; poll_ms: number; last_poll: string | null; last_error: string | null;
  }>;
  return { relays: rows };
}

export async function cloudRelayRemove(
  params: { agent_id: string },
  claims: PassportClaims,
): Promise<{ removed: boolean; agent_id: string }> {
  enforceTrust(claims, RELAY_REMOVE_TOOL);
  ensureCloudRelayTable();
  const db = openDb();
  const result = db.prepare('DELETE FROM cloud_relay WHERE agent_id = ?').run(params.agent_id);
  stopRelayPoller(params.agent_id);
  return { removed: result.changes > 0, agent_id: params.agent_id };
}

// ── Background poller ──────────────────────────────────────────────────────────

const _activePollers = new Map<string, ReturnType<typeof setInterval>>();

function stopRelayPoller(agentId: string): void {
  const timer = _activePollers.get(agentId);
  if (timer) { clearInterval(timer); _activePollers.delete(agentId); }
}

function startRelayPoller(agentId: string, webhookUrl: string, pollMs: number): void {
  stopRelayPoller(agentId); // clear existing if any

  const timer = setInterval(() => {
    void pollAndForward(agentId, webhookUrl);
  }, pollMs);

  _activePollers.set(agentId, timer);
}

async function pollAndForward(agentId: string, webhookUrl: string): Promise<void> {
  const db = openDb();
  const now = new Date().toISOString();

  // Atomically claim unclaimed messages for this agent
  const messages = db.transaction(() => {
    const rows = db.prepare(
      `SELECT id, from_agent, payload, created_at FROM bus_messages
       WHERE to_agent = ? AND claimed_at IS NULL ORDER BY id ASC LIMIT 10`,
    ).all(agentId) as Array<{ id: number; from_agent: string | null; payload: string; created_at: string }>;

    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(', ');
      db.prepare(
        `UPDATE bus_messages SET claimed_at = ? WHERE id IN (${placeholders})`,
      ).run(now, ...ids);
    }
    return rows;
  })();

  if (messages.length === 0) return;

  for (const msg of messages) {
    let payload: unknown;
    try { payload = JSON.parse(msg.payload); } catch { payload = { text: msg.payload }; }

    const body = JSON.stringify({
      message_id:  msg.id,
      from_agent:  msg.from_agent ?? 'unknown',
      to_agent:    agentId,
      payload,
      created_at:  msg.created_at,
    });

    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });

      db.prepare(`UPDATE cloud_relay SET last_poll = ?, last_error = NULL WHERE agent_id = ?`)
        .run(now, agentId);

      // If the webhook returns a reply, write it back to the bus
      if (res.ok) {
        const text = await res.text();
        if (text) {
          let reply: unknown;
          try { reply = JSON.parse(text); } catch { reply = { text }; }
          const replyText = (reply as Record<string, unknown>)?.text ?? text;
          if (replyText) {
            db.prepare(
              `INSERT INTO bus_messages (to_agent, from_agent, payload, created_at)
               VALUES (?, ?, ?, ?)`,
            ).run(
              msg.from_agent ?? 'unknown',
              agentId,
              JSON.stringify({ text: replyText, from: agentId }),
              now,
            );
          }
        }
      } else {
        const errText = await res.text().catch(() => '');
        db.prepare(`UPDATE cloud_relay SET last_error = ? WHERE agent_id = ?`)
          .run(`HTTP ${res.status}: ${errText.slice(0, 200)}`, agentId);
      }
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : String(err);
      db.prepare(`UPDATE cloud_relay SET last_error = ? WHERE agent_id = ?`)
        .run(msg2.slice(0, 200), agentId);
    }
  }
}

// ── Startup loader — called once at server init ───────────────────────────────

export function loadActiveRelays(): void {
  try {
    ensureCloudRelayTable();
    const db = openDb();
    const rows = db.prepare('SELECT agent_id, webhook_url, poll_ms FROM cloud_relay').all() as Array<{
      agent_id: string; webhook_url: string; poll_ms: number;
    }>;
    for (const { agent_id, webhook_url, poll_ms } of rows) {
      startRelayPoller(agent_id, webhook_url, poll_ms);
      console.log(`[cloud-relay] Started poller for ${agent_id} → ${webhook_url} (${poll_ms}ms)`);
    }
  } catch (err) {
    console.error('[cloud-relay] Failed to load active relays:', err instanceof Error ? err.message : String(err));
  }
}
