// packages/hands-and-feet/src/capabilities/body/index.ts
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ── Tool definitions ────────────────────────────────────────────
const GET_IDENTITY_TOOL: ToolDefinition     = { name: 'get_identity',        minTrustLevel: 2 };
const SET_IDENTITY_TOOL: ToolDefinition     = { name: 'set_identity_binding', minTrustLevel: 3 };
const GET_MEMORY_TOOL: ToolDefinition       = { name: 'get_memory',          minTrustLevel: 2 };
const SET_MEMORY_TOOL: ToolDefinition       = { name: 'set_memory',          minTrustLevel: 2 };
const LIST_MEMORY_TOOL: ToolDefinition      = { name: 'list_memory',         minTrustLevel: 2 };
const DELETE_MEMORY_TOOL: ToolDefinition    = { name: 'delete_memory',       minTrustLevel: 3 };

export const BODY_TOOLS = {
  get_identity: GET_IDENTITY_TOOL,
  set_identity_binding: SET_IDENTITY_TOOL,
  get_memory: GET_MEMORY_TOOL,
  set_memory: SET_MEMORY_TOOL,
  list_memory: LIST_MEMORY_TOOL,
  delete_memory: DELETE_MEMORY_TOOL,
};

// ── Row types ───────────────────────────────────────────────────
interface IdentityRow {
  agent_id: string;
  primary_wallet: string | null;
  email: string | null;
  phone: string | null;
  updated_at: string;
}

// ── Identity tools ───────────────────────────────────────────────
export async function getIdentity(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ identity: Omit<IdentityRow, 'agent_id'> | null }> {
  enforceTrust(claims, GET_IDENTITY_TOOL);
  const db = openDb();
  const row = db.prepare('SELECT * FROM agent_identity WHERE agent_id = ?').get(claims.agentId) as IdentityRow | undefined;
  if (!row) return { identity: null };
  const { agent_id: _id, ...rest } = row;
  return { identity: rest };
}

export async function setIdentityBinding(
  params: { field: 'primary_wallet' | 'email' | 'phone'; value: string },
  claims: PassportClaims,
): Promise<{ updated: boolean }> {
  enforceTrust(claims, SET_IDENTITY_TOOL);
  const db = openDb();
  const existing = db.prepare('SELECT * FROM agent_identity WHERE agent_id = ?').get(claims.agentId) as IdentityRow | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE agent_identity SET ${params.field} = ?, updated_at = ? WHERE agent_id = ?`)
      .run(params.value, now, claims.agentId);
  } else {
    const init: Record<string, string | null> = { primary_wallet: null, email: null, phone: null };
    init[params.field] = params.value;
    db.prepare('INSERT INTO agent_identity (agent_id, primary_wallet, email, phone, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(claims.agentId, init.primary_wallet, init.email, init.phone, now);
  }
  return { updated: true };
}

// ── Memory tools ─────────────────────────────────────────────────
export async function getMemory(
  params: { key: string },
  claims: PassportClaims,
): Promise<{ key: string; value: unknown }> {
  enforceTrust(claims, GET_MEMORY_TOOL);
  const db = openDb();
  const row = db.prepare('SELECT value_json FROM memory WHERE key = ?').get(params.key) as { value_json: string } | undefined;
  return { key: params.key, value: row ? (JSON.parse(row.value_json) as unknown) : null };
}

export async function setMemory(
  params: { key: string; value: unknown },
  claims: PassportClaims,
): Promise<{ key: string; saved: boolean }> {
  enforceTrust(claims, SET_MEMORY_TOOL);
  const db = openDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO memory (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(params.key, JSON.stringify(params.value), now);
  return { key: params.key, saved: true };
}

export async function listMemory(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ keys: string[] }> {
  enforceTrust(claims, LIST_MEMORY_TOOL);
  const db = openDb();
  const rows = db.prepare('SELECT key FROM memory ORDER BY updated_at DESC').all() as { key: string }[];
  return { keys: rows.map((r) => r.key) };
}

export async function deleteMemory(
  params: { key: string },
  claims: PassportClaims,
): Promise<{ key: string; deleted: boolean }> {
  enforceTrust(claims, DELETE_MEMORY_TOOL);
  const db = openDb();
  const result = db.prepare('DELETE FROM memory WHERE key = ?').run(params.key);
  return { key: params.key, deleted: result.changes > 0 };
}
