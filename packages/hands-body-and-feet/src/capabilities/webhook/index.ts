import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { enforceTrust } from '../../trust.js';
import { openDb } from '../../spend-tracker.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';
import { matchAndFire } from '../triggers/index.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const CREATE_WEBHOOK_TOOL: ToolDefinition = { name: 'create_webhook', minTrustLevel: 3 };
const GET_WEBHOOK_URL_TOOL: ToolDefinition = { name: 'get_webhook_url', minTrustLevel: 2 };
const READ_WEBHOOK_EVENTS_TOOL: ToolDefinition = { name: 'read_webhook_events', minTrustLevel: 2 };
const WAIT_FOR_WEBHOOK_TOOL: ToolDefinition = { name: 'wait_for_webhook', minTrustLevel: 2 };
const DELETE_WEBHOOK_TOOL: ToolDefinition = { name: 'delete_webhook', minTrustLevel: 3 };

export const WEBHOOK_TOOLS = {
  create_webhook: CREATE_WEBHOOK_TOOL,
  get_webhook_url: GET_WEBHOOK_URL_TOOL,
  read_webhook_events: READ_WEBHOOK_EVENTS_TOOL,
  wait_for_webhook: WAIT_FOR_WEBHOOK_TOOL,
  delete_webhook: DELETE_WEBHOOK_TOOL,
};

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────
interface WebhookRow {
  label: string;
  path: string;
  secret_token: string;
  max_payload_bytes: number;
  retention_days: number;
  created_at: string;
}

interface WebhookEventRow {
  id: number;
  webhook_label: string;
  headers: string;
  body: string;
  received_at: string;
}

// ────────────────────────────────────────────────────────────
// Purge job
// ────────────────────────────────────────────────────────────
let purgeJobHandle: ReturnType<typeof setInterval> | null = null;

export function purgeOldEvents(): void {
  const db = openDb();
  const webhooks = db.prepare('SELECT label, retention_days FROM webhooks').all() as Array<{
    label: string;
    retention_days: number;
  }>;
  for (const wh of webhooks) {
    const cutoff = new Date(Date.now() - wh.retention_days * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM webhook_events WHERE webhook_label = ? AND received_at < ?').run(
      wh.label,
      cutoff,
    );
  }
}

export function startPurgeJob(): void {
  if (purgeJobHandle) return;
  purgeJobHandle = setInterval(() => {
    try {
      purgeOldEvents();
    } catch (err: unknown) {
      console.error('webhook purge error:', err instanceof Error ? err.message : String(err));
    }
  }, 60 * 60 * 1000); // hourly
  // Allow process to exit even with this interval running
  if (typeof purgeJobHandle === 'object' && purgeJobHandle !== null && 'unref' in purgeJobHandle) {
    (purgeJobHandle as { unref: () => void }).unref();
  }
}

// ────────────────────────────────────────────────────────────
// Express receiver (public route — no auth middleware)
// ────────────────────────────────────────────────────────────
export async function webhookReceiver(req: Request, res: Response): Promise<void> {
  const { label, token } = req.params as { label: string; token: string };
  const db = openDb();

  const wh = db
    .prepare('SELECT * FROM webhooks WHERE label = ?')
    .get(label) as WebhookRow | undefined;

  if (!wh || wh.secret_token !== token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const bodyStr = JSON.stringify(req.body);
  if (Buffer.byteLength(bodyStr, 'utf8') > wh.max_payload_bytes) {
    res.status(413).json({ error: 'payload_too_large' });
    return;
  }

  const headersStr = JSON.stringify(req.headers);
  db.prepare(
    'INSERT INTO webhook_events (webhook_label, headers, body, received_at) VALUES (?, ?, ?, ?)',
  ).run(label, headersStr, bodyStr, new Date().toISOString());

  matchAndFire('webhook', {
    webhook_label: label,
    body: bodyStr,
    headers: headersStr,
  }).catch((e: unknown) => console.error('[triggers] webhook matchAndFire error:', e instanceof Error ? e.message : String(e)));

  res.status(200).json({ ok: true });
}

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────
export async function createWebhook(
  params: { label: string; max_payload_bytes?: number; retention_days?: number },
  claims: PassportClaims,
): Promise<{ label: string; path: string; secret_token: string }> {
  enforceTrust(claims, CREATE_WEBHOOK_TOOL);

  const secretToken = randomUUID();
  const path = `/webhooks/${params.label}/${secretToken}`;
  const maxPayloadBytes = params.max_payload_bytes ?? 1_048_576;
  const retentionDays = params.retention_days ?? 30;

  const db = openDb();
  db.prepare(`
    INSERT INTO webhooks (label, path, secret_token, max_payload_bytes, retention_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params.label, path, secretToken, maxPayloadBytes, retentionDays, new Date().toISOString());

  return { label: params.label, path, secret_token: secretToken };
}

export async function getWebhookUrl(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; url: string | null; local_path: string | null }> {
  enforceTrust(claims, GET_WEBHOOK_URL_TOOL);

  const db = openDb();
  const wh = db
    .prepare('SELECT path FROM webhooks WHERE label = ?')
    .get(params.label) as { path: string } | undefined;

  if (!wh) {
    return { label: params.label, url: null, local_path: null };
  }

  // Check if there's an active tunnel
  const tunnel = db
    .prepare('SELECT url FROM tunnels WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1')
    .get() as { url: string } | undefined;

  const url = tunnel ? `${tunnel.url}${wh.path}` : null;
  return { label: params.label, url, local_path: wh.path };
}

export async function readWebhookEvents(
  params: { label: string; since?: string; limit?: number },
  claims: PassportClaims,
): Promise<{
  events: Array<{ id: number; headers: unknown; body: unknown; received_at: string }>;
  count: number;
}> {
  enforceTrust(claims, READ_WEBHOOK_EVENTS_TOOL);

  const db = openDb();
  const limit = params.limit ?? 50;

  let rows: WebhookEventRow[];
  if (params.since) {
    rows = db
      .prepare(
        'SELECT * FROM webhook_events WHERE webhook_label = ? AND received_at > ? ORDER BY received_at ASC LIMIT ?',
      )
      .all(params.label, params.since, limit) as WebhookEventRow[];
  } else {
    rows = db
      .prepare(
        'SELECT * FROM webhook_events WHERE webhook_label = ? ORDER BY received_at ASC LIMIT ?',
      )
      .all(params.label, limit) as WebhookEventRow[];
  }

  const events = rows.map((row) => ({
    id: row.id,
    headers: JSON.parse(row.headers) as unknown,
    body: JSON.parse(row.body) as unknown,
    received_at: row.received_at,
  }));

  return { events, count: events.length };
}

export async function waitForWebhook(
  params: {
    label: string;
    filter?: { body_contains?: string };
    timeout_ms?: number;
  },
  claims: PassportClaims,
): Promise<{ event: { id: number; headers: unknown; body: unknown; received_at: string } | null; timed_out: boolean }> {
  enforceTrust(claims, WAIT_FOR_WEBHOOK_TOOL);

  const timeoutMs = params.timeout_ms ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const db = openDb();
  const since = new Date().toISOString();

  while (Date.now() < deadline) {
    const rows = db
      .prepare(
        'SELECT * FROM webhook_events WHERE webhook_label = ? AND received_at >= ? ORDER BY received_at ASC LIMIT 50',
      )
      .all(params.label, since) as WebhookEventRow[];

    for (const row of rows) {
      let bodyObj: unknown;
      try {
        bodyObj = JSON.parse(row.body) as unknown;
      } catch {
        bodyObj = row.body;
      }

      if (params.filter?.body_contains) {
        if (!row.body.includes(params.filter.body_contains)) continue;
      }

      return {
        event: {
          id: row.id,
          headers: JSON.parse(row.headers) as unknown,
          body: bodyObj,
          received_at: row.received_at,
        },
        timed_out: false,
      };
    }

    // Poll every 1 second
    await new Promise<void>((r) => setTimeout(r, 1_000));
  }

  return { event: null, timed_out: true };
}

export async function deleteWebhook(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; deleted: boolean }> {
  enforceTrust(claims, DELETE_WEBHOOK_TOOL);

  const db = openDb();
  const result = db.prepare('DELETE FROM webhooks WHERE label = ?').run(params.label);

  return { label: params.label, deleted: result.changes > 0 };
}
