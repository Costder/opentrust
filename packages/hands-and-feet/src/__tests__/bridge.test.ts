import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Mock openDb with an in-memory SQLite via better-sqlite3
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3';

let _testDb: Database.Database | null = null;

vi.mock('../spend-tracker.js', () => ({
  openDb: vi.fn(() => {
    if (!_testDb) {
      _testDb = new Database(':memory:');
      _testDb.exec(`
        CREATE TABLE IF NOT EXISTS bridge_log (
          bridge_id TEXT PRIMARY KEY,
          direction TEXT NOT NULL,
          from_label TEXT NOT NULL,
          amount_usdc REAL NOT NULL,
          status TEXT NOT NULL,
          initiated_at TEXT NOT NULL,
          completed_at TEXT,
          tx_hash TEXT
        );
      `);
    }
    return _testDb;
  }),
}));

import {
  bridgeToPolygon,
  bridgeToBase,
  getBridgeStatus,
} from '../capabilities/bridge/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeL4Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'test-passport',
    agentId: 'test-agent',
    trustLevel: 4,
    trustStatus: 'community_reviewed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return { ...makeL4Claims(), trustLevel: 2, trustStatus: 'creator_claimed', ...overrides };
}

describe('bridge capability', () => {
  beforeEach(() => {
    // Reset the in-memory DB between tests
    if (_testDb) {
      _testDb.exec('DELETE FROM bridge_log');
    }
  });

  // -------------------------------------------------------------------------
  // bridge_to_polygon
  // -------------------------------------------------------------------------

  describe('bridgeToPolygon', () => {
    it('requires L4 trust — rejects L3', async () => {
      const l3 = { ...makeL4Claims(), trustLevel: 3 as const, trustStatus: 'seller_confirmed' as const };
      await expect(bridgeToPolygon({ from_label: 'x', amount: 10 }, l3)).rejects.toThrow(TrustError);
    });

    it('rejects disputed passport', async () => {
      await expect(
        bridgeToPolygon({ from_label: 'x', amount: 10 }, makeL4Claims({ isDisputed: true })),
      ).rejects.toThrow();
    });

    it('stores bridge intent and returns bridge_id + pending status', async () => {
      const result = await bridgeToPolygon({ from_label: 'my-wallet', amount: 100 }, makeL4Claims());
      expect(result.bridge_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.status).toBe('pending');
      expect(result.note).toContain('Across Protocol');
    });

    it('persists the bridge record in the database', async () => {
      const result = await bridgeToPolygon({ from_label: 'test-label', amount: 50 }, makeL4Claims());
      const row = _testDb!.prepare('SELECT * FROM bridge_log WHERE bridge_id = ?').get(
        result.bridge_id,
      ) as { direction: string; amount_usdc: number; status: string; from_label: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.direction).toBe('base_to_polygon');
      expect(row!.amount_usdc).toBe(50);
      expect(row!.status).toBe('pending');
      expect(row!.from_label).toBe('test-label');
    });
  });

  // -------------------------------------------------------------------------
  // bridge_to_base
  // -------------------------------------------------------------------------

  describe('bridgeToBase', () => {
    it('requires L4 trust', async () => {
      const l3 = { ...makeL4Claims(), trustLevel: 3 as const, trustStatus: 'seller_confirmed' as const };
      await expect(bridgeToBase({ from_label: 'x', amount: 10 }, l3)).rejects.toThrow(TrustError);
    });

    it('stores bridge record with polygon_to_base direction', async () => {
      const result = await bridgeToBase({ from_label: 'poly-wallet', amount: 75 }, makeL4Claims());
      expect(result.bridge_id).toBeDefined();
      const row = _testDb!.prepare('SELECT * FROM bridge_log WHERE bridge_id = ?').get(
        result.bridge_id,
      ) as { direction: string } | undefined;
      expect(row!.direction).toBe('polygon_to_base');
    });
  });

  // -------------------------------------------------------------------------
  // get_bridge_status
  // -------------------------------------------------------------------------

  describe('getBridgeStatus', () => {
    it('requires L2 trust — rejects L1', async () => {
      await expect(
        getBridgeStatus({ bridge_id: 'any' }, makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' })),
      ).rejects.toThrow(TrustError);
    });

    it('returns stored status for a known bridge_id', async () => {
      const { bridge_id } = await bridgeToPolygon({ from_label: 'w', amount: 10 }, makeL4Claims());
      const status = await getBridgeStatus({ bridge_id }, makeL2Claims());
      expect(status.bridge_id).toBe(bridge_id);
      expect(status.status).toBe('pending');
      expect(status.direction).toBe('base_to_polygon');
      expect(status.amount_usdc).toBe(10);
    });

    it('throws when bridge_id is not found', async () => {
      await expect(
        getBridgeStatus({ bridge_id: 'does-not-exist' }, makeL2Claims()),
      ).rejects.toThrow('does-not-exist');
    });

    it('reflects status updates written directly to DB', async () => {
      const { bridge_id } = await bridgeToPolygon({ from_label: 'w', amount: 10 }, makeL4Claims());
      _testDb!.prepare("UPDATE bridge_log SET status = 'minted' WHERE bridge_id = ?").run(bridge_id);
      const status = await getBridgeStatus({ bridge_id }, makeL2Claims());
      expect(status.status).toBe('minted');
    });
  });
});
