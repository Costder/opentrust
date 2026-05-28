import { randomUUID } from 'crypto';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims } from '../../types.js';

// Across Protocol bridge integration deferred.
// Requires SpokePool contract address config, Across SDK, and EVM signing.
// Currently implements: intent storage + status tracking.
// See: https://across.to and spec section on Bridge Behavior.
// Across Protocol SDK integration deferred — requires SpokePool contract address config and EVM signing

export const BRIDGE_TOOLS = {
  bridge_to_polygon: { name: 'bridge_to_polygon', minTrustLevel: 4 as const },
  bridge_to_base: { name: 'bridge_to_base', minTrustLevel: 4 as const },
  get_bridge_status: { name: 'get_bridge_status', minTrustLevel: 2 as const },
} as const;

export async function bridgeToPolygon(
  params: { from_label: string; amount: number },
  claims: PassportClaims,
): Promise<{ bridge_id: string; status: string; note: string }> {
  enforceTrust(claims, BRIDGE_TOOLS.bridge_to_polygon);
  const db = openDb();
  const bridgeId = randomUUID();
  db.prepare(`
    INSERT INTO bridge_log (bridge_id, direction, from_label, amount_usdc, status, initiated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(bridgeId, 'base_to_polygon', params.from_label, params.amount, 'pending', new Date().toISOString());
  return {
    bridge_id: bridgeId,
    status: 'pending',
    note: 'Across Protocol SDK integration pending. Bridge intent logged. Poll get_bridge_status.',
  };
}

export async function bridgeToBase(
  params: { from_label: string; amount: number },
  claims: PassportClaims,
): Promise<{ bridge_id: string; status: string; note: string }> {
  enforceTrust(claims, BRIDGE_TOOLS.bridge_to_base);
  const db = openDb();
  const bridgeId = randomUUID();
  db.prepare(`
    INSERT INTO bridge_log (bridge_id, direction, from_label, amount_usdc, status, initiated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(bridgeId, 'polygon_to_base', params.from_label, params.amount, 'pending', new Date().toISOString());
  return {
    bridge_id: bridgeId,
    status: 'pending',
    note: 'Across Protocol SDK integration pending. Bridge intent logged.',
  };
}

export type BridgeStatus = 'pending' | 'locked' | 'in-flight' | 'minted' | 'stuck' | 'failed';

export async function getBridgeStatus(
  params: { bridge_id: string },
  claims: PassportClaims,
): Promise<{ bridge_id: string; status: BridgeStatus; direction: string; amount_usdc: number }> {
  enforceTrust(claims, BRIDGE_TOOLS.get_bridge_status);
  const db = openDb();
  const row = db.prepare('SELECT * FROM bridge_log WHERE bridge_id = ?').get(params.bridge_id) as {
    bridge_id: string; direction: string; amount_usdc: number; status: string;
  } | undefined;
  if (!row) throw new Error(`Bridge ${params.bridge_id} not found`);
  return {
    bridge_id: row.bridge_id,
    status: row.status as BridgeStatus,
    direction: row.direction,
    amount_usdc: row.amount_usdc,
  };
}
