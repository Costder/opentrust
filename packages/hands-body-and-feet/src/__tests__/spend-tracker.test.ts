import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Use in-memory SQLite for spend-tracker tests — avoids file-locking on Windows.
// vi.mock is hoisted, so we can't reference module-level vars in the factory.
// Instead we mock better-sqlite3 to open ':memory:' and keep a module-scoped
// reference via globalThis so we can reset between tests.
// ---------------------------------------------------------------------------

vi.mock('better-sqlite3', () => {
  // We use a lazy singleton so the same in-memory DB is returned each call
  // until the test suite explicitly calls Database.reset()
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(function (_path: string) {
    if (!db) {
      // Dynamic import of the real module inside the factory
      // We can't use await here — use synchronous require-style via createRequire
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (path: string) => import('better-sqlite3').Database;
      // If the mock factory is being called, "require" is the REAL module
      // (vitest resolves the real dep when require is used inside a mock factory)
      db = new RealDB(':memory:');
    }
    return db;
  });
  // Expose a reset helper on the constructor so tests can clear state
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

vi.mock('../config.js', () => ({
  CONFIG_DIR: '/tmp/test-haf',
  ensureConfigDir: vi.fn(),
}));

import Database from 'better-sqlite3';
import {
  openDb,
  logSpend,
  getDailySpend,
  checkSpendAllowed,
  _resetDb,
} from '../spend-tracker.js';
import { TrustError } from '../trust.js';
import type { WalletEntry } from '../keystore.js';

function makeEntry(overrides: Partial<WalletEntry> = {}): WalletEntry {
  return {
    label: 'test-wallet',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    chains: ['base'],
    gasReserveUsdc: 5,
    dailyCapUsdc: 100,
    maxPerCallUsdc: 50,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const MockDatabase = Database as unknown as { resetDb: () => void };

afterAll(() => {
  _resetDb();
  MockDatabase.resetDb();
});

describe('spend-tracker', () => {
  beforeEach(() => {
    // Reset both the spend-tracker singleton and the mock DB
    _resetDb();
    MockDatabase.resetDb();
  });

  // -------------------------------------------------------------------------
  // logSpend + getDailySpend round-trip
  // -------------------------------------------------------------------------

  it('logSpend + getDailySpend returns correct total', () => {
    logSpend('wallet-a', 'base', 10, 'send_usdc', '0xabc');
    logSpend('wallet-a', 'base', 20, 'send_usdc', '0xdef');
    expect(getDailySpend('wallet-a')).toBe(30);
  });

  it('getDailySpend returns 0 for wallet with no entries', () => {
    expect(getDailySpend('nobody')).toBe(0);
  });

  it('getDailySpend only counts the queried wallet', () => {
    logSpend('wallet-a', 'base', 50, 'send_usdc');
    logSpend('wallet-b', 'base', 99, 'send_usdc');
    expect(getDailySpend('wallet-a')).toBe(50);
    expect(getDailySpend('wallet-b')).toBe(99);
  });

  // -------------------------------------------------------------------------
  // Old spend (yesterday) doesn't count
  // -------------------------------------------------------------------------

  it('spend logged yesterday does not count toward today daily total', () => {
    const db = openDb();
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    db.prepare(
      `INSERT INTO spend_log (wallet_label, chain, amount_usdc, tool_name, tx_hash, logged_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('wallet-a', 'base', 100, 'send_usdc', null, yesterday.toISOString());

    // Today's spend is 0
    expect(getDailySpend('wallet-a')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // checkSpendAllowed — happy path
  // -------------------------------------------------------------------------

  it('checkSpendAllowed passes when amount is within caps', () => {
    const entry = makeEntry({ dailyCapUsdc: 100, gasReserveUsdc: 5, maxPerCallUsdc: 50 });
    expect(() => checkSpendAllowed('test-wallet', entry, 30)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // checkSpendAllowed — per-call cap exceeded
  // -------------------------------------------------------------------------

  it('checkSpendAllowed throws TrustError when amount exceeds per-call cap', () => {
    const entry = makeEntry({ dailyCapUsdc: 100, gasReserveUsdc: 5, maxPerCallUsdc: 50 });
    expect(() => checkSpendAllowed('test-wallet', entry, 51)).toThrow(TrustError);
    expect(() => checkSpendAllowed('test-wallet', entry, 51)).toThrow(/per-call cap/i);
  });

  // -------------------------------------------------------------------------
  // checkSpendAllowed — daily cap exceeded after gas reserve deduction
  // -------------------------------------------------------------------------

  it('checkSpendAllowed throws TrustError when spend would exceed effective daily cap', () => {
    // effectiveCap = 100 - 5 = 95
    const entry = makeEntry({ dailyCapUsdc: 100, gasReserveUsdc: 5, maxPerCallUsdc: 50 });
    // Already spent 80 today
    logSpend('test-wallet', 'base', 80, 'send_usdc');
    // 80 + 20 = 100 > 95 effectiveCap
    expect(() => checkSpendAllowed('test-wallet', entry, 20)).toThrow(TrustError);
    expect(() => checkSpendAllowed('test-wallet', entry, 20)).toThrow(/Daily cap exceeded/i);
  });

  it('checkSpendAllowed passes exactly at effective daily cap', () => {
    // effectiveCap = 100 - 5 = 95
    const entry = makeEntry({ dailyCapUsdc: 100, gasReserveUsdc: 5, maxPerCallUsdc: 50 });
    logSpend('test-wallet', 'base', 45, 'send_usdc');
    // 45 + 50 = 95 == effectiveCap (should pass — not strictly greater)
    expect(() => checkSpendAllowed('test-wallet', entry, 50)).not.toThrow();
  });

  it('checkSpendAllowed throws when daily total would exceed effective cap by even 1 cent', () => {
    const entry = makeEntry({ dailyCapUsdc: 100, gasReserveUsdc: 5, maxPerCallUsdc: 50 });
    logSpend('test-wallet', 'base', 45.01, 'send_usdc');
    // 45.01 + 50 = 95.01 > 95 effectiveCap
    expect(() => checkSpendAllowed('test-wallet', entry, 50)).toThrow(TrustError);
  });
});

describe('new tables exist after openDb()', () => {
  it('delegations table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT id, label, passport_id, passport_version, agent_id, trust_level, trust_status, tool_allowlist, spend_caps, action_budgets, status, created_at FROM delegations LIMIT 1').all()
    ).not.toThrow();
  });

  it('delegation_usage table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT id, delegation_id, tool, call_count, spent_usdc, window_start FROM delegation_usage LIMIT 1').all()
    ).not.toThrow();
  });

  it('triggers table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT id, label, source, match_json, action_json, delegation_id, status, last_fired_at, last_fire_status FROM triggers LIMIT 1').all()
    ).not.toThrow();
  });

  it('agent_identity table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT agent_id, primary_wallet, email, phone, updated_at FROM agent_identity LIMIT 1').all()
    ).not.toThrow();
  });

  it('memory table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT key, value_json, updated_at FROM memory LIMIT 1').all()
    ).not.toThrow();
  });
});
