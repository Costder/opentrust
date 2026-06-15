/**
 * Tests for the payment-request (receive-only) capability.
 * Uses an in-memory SQLite DB and mocked fetch for RPC calls.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Config / DB mocks (same pattern as webhook.test.ts)
// ────────────────────────────────────────────────────────────
vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({
    version: 1,
    instanceId: 'test',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
  })),
  CONFIG_DIR: '/tmp/test-haf-payment-requests',
  ensureConfigDir: vi.fn(),
}));

vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(function (_path: string) {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (path: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

// ────────────────────────────────────────────────────────────
// Keystore mock — returns a fixed wallet entry for label "primary"
// ────────────────────────────────────────────────────────────
vi.mock('../keystore.js', () => ({
  getWallet: vi.fn((_label: string) => ({
    label: 'primary',
    // well-known test private key (never used in production)
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    chains: ['base'],
    gasReserveUsdc: 0,
    dailyCapUsdc: 1000,
    maxPerCallUsdc: 100,
    createdAt: '2024-01-01T00:00:00.000Z',
  })),
  addWallet: vi.fn(),
  loadKeystore: vi.fn(() => []),
  saveKeystore: vi.fn(),
}));

// ethers mock — just needs Wallet to return a fixed address
vi.mock('ethers', () => ({
  ethers: {
    Wallet: vi.fn(function (_pk: string) {
      return {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      };
    }),
  },
}));

// ────────────────────────────────────────────────────────────
// fetch mock — controls RPC responses
// ────────────────────────────────────────────────────────────
const RECEIVER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Default RPC responses
let mockLogs: unknown[] = [];
let mockLatestBlock = { number: '0x' + (10000).toString(16), timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) };
let mockMidBlock = { number: '0x' + (5000).toString(16), timestamp: '0x' + Math.floor(Date.now() / 1000 - 86400).toString(16) };

vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
  const body = JSON.parse(init.body as string) as { method: string; params: unknown[] };

  let result: unknown;
  if (body.method === 'eth_getBlockByNumber') {
    const tag = body.params[0] as string;
    if (tag === 'latest') result = mockLatestBlock;
    else result = mockMidBlock;
  } else if (body.method === 'eth_getLogs') {
    result = mockLogs;
  } else {
    result = null;
  }

  return {
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 1, result }),
  };
}));

// ────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';
import { _resetDb } from '../spend-tracker.js';
import { paymentRequest, paymentStatus, paymentList } from '../capabilities/payments/payment-requests.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

// ────────────────────────────────────────────────────────────
// Claim helpers
// ────────────────────────────────────────────────────────────
function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}
function makeL2Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed', ...overrides };
}

// ────────────────────────────────────────────────────────────
// Build a matching Transfer log for a given amount
// ────────────────────────────────────────────────────────────
function makeTransferLog(toAddress: string, amountUsdc: number, txHash = '0xdeadbeef') {
  const units = BigInt(Math.round(amountUsdc * 1_000_000));
  const paddedTo = '0x000000000000000000000000' + toAddress.slice(2).toLowerCase();
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const data = '0x' + units.toString(16).padStart(64, '0');
  return {
    topics: [TRANSFER_TOPIC, '0x' + '0'.repeat(64), paddedTo],
    data,
    transactionHash: txHash,
    blockNumber: '0x' + (9999).toString(16),
  };
}

// ────────────────────────────────────────────────────────────
// Reset between tests
// ────────────────────────────────────────────────────────────
beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  mockLogs = [];
  vi.clearAllMocks();
  // Provide passphrase so resolveAddress doesn't fail
  process.env.HANDS_BODY_AND_FEET_PASSPHRASE = 'test-passphrase';
});

// ────────────────────────────────────────────────────────────
// payment_request tests
// ────────────────────────────────────────────────────────────
describe('payment_request', () => {
  it('rejects L2 caller (requires L3)', async () => {
    await expect(
      paymentRequest({ amount_usdc: 10, memo: 'test' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('rejects disputed passport', async () => {
    await expect(
      paymentRequest({ amount_usdc: 10, memo: 'test' }, makeL3Claims({ isDisputed: true })),
    ).rejects.toThrow();
  });

  it('creates request and returns all required fields', async () => {
    const result = await paymentRequest({ amount_usdc: 5, memo: 'pay for coffee' }, makeL3Claims());

    expect(result.request_id).toHaveLength(8);
    expect(result.address).toBe(RECEIVER);
    expect(result.memo).toBe('pay for coffee');
    expect(result.amount_usdc_expected).toBeGreaterThan(5);
    expect(result.amount_usdc_expected).toBeLessThan(5.01);
    expect(result.expires_at).toBeTruthy();
    expect(result.instructions).toMatch(/Send exactly/);
    expect(result.instructions).toContain(RECEIVER);
  });

  it('amount_usdc_expected differs from requested (uniquification adds 0.001–0.009)', async () => {
    const result = await paymentRequest({ amount_usdc: 10, memo: 'm' }, makeL3Claims());
    const delta = result.amount_usdc_expected - 10;
    expect(delta).toBeGreaterThanOrEqual(0.001);
    expect(delta).toBeLessThanOrEqual(0.009);
  });

  it('produces valid EIP-681 URI', async () => {
    const result = await paymentRequest({ amount_usdc: 7.5, memo: 'test' }, makeL3Claims());

    expect(result.eip681_uri).toMatch(
      new RegExp(`^ethereum:${USDC_BASE.replace(/\./g, '\\.')}@8453/transfer\\?address=${RECEIVER}&uint256=\\d+$`),
    );
    // Verify uint256 is amount * 1e6
    const uint256Part = result.eip681_uri.split('uint256=')[1];
    const uint256 = BigInt(uint256Part);
    expect(uint256).toBe(BigInt(Math.round(result.amount_usdc_expected * 1_000_000)));
  });

  it('two concurrent requests for same address get different expected amounts', async () => {
    const r1 = await paymentRequest({ amount_usdc: 20, memo: 'a' }, makeL3Claims());
    const r2 = await paymentRequest({ amount_usdc: 20, memo: 'b' }, makeL3Claims());
    expect(r1.amount_usdc_expected).not.toBe(r2.amount_usdc_expected);
  });

  it('respects custom expiry_hours', async () => {
    const before = new Date();
    const result = await paymentRequest({ amount_usdc: 1, memo: 'test', expiry_hours: 1 }, makeL3Claims());
    const after = new Date();

    const expiresAt = new Date(result.expires_at).getTime();
    // Should be ~1 hour from now (allow 5s tolerance)
    expect(expiresAt).toBeGreaterThanOrEqual(before.getTime() + 3595_000);
    expect(expiresAt).toBeLessThanOrEqual(after.getTime() + 3605_000);
  });
});

// ────────────────────────────────────────────────────────────
// payment_status tests
// ────────────────────────────────────────────────────────────
describe('payment_status', () => {
  it('rejects L1 caller (requires L2)', async () => {
    await expect(
      paymentStatus({ request_id: 'xxxxxxxx' }, makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' })),
    ).rejects.toThrow(TrustError);
  });

  it('throws for unknown request_id', async () => {
    await expect(
      paymentStatus({ request_id: 'notfound' }, makeL2Claims()),
    ).rejects.toThrow('not found');
  });

  it('happy path: matching Transfer log → status paid, newly_paid=true', async () => {
    const req = await paymentRequest({ amount_usdc: 3, memo: 'happy path' }, makeL3Claims());

    mockLogs = [makeTransferLog(RECEIVER, req.amount_usdc_expected)];

    const status = await paymentStatus({ request_id: req.request_id }, makeL2Claims());

    expect(status.status).toBe('paid');
    expect(status.newly_paid).toBe(true);
    expect(status.paid_tx_hash).toBe('0xdeadbeef');
    expect(status.paid_at).toBeTruthy();
  });

  it('amount mismatch does NOT mark paid', async () => {
    const req = await paymentRequest({ amount_usdc: 3, memo: 'mismatch' }, makeL3Claims());

    // Transfer for wrong amount
    mockLogs = [makeTransferLog(RECEIVER, req.amount_usdc_expected + 1)];

    const status = await paymentStatus({ request_id: req.request_id }, makeL2Claims());
    expect(status.status).toBe('pending');
    expect(status.newly_paid).toBeUndefined();
  });

  it('second call on already-paid request returns paid without newly_paid', async () => {
    const req = await paymentRequest({ amount_usdc: 3, memo: 'already paid' }, makeL3Claims());
    mockLogs = [makeTransferLog(RECEIVER, req.amount_usdc_expected)];

    await paymentStatus({ request_id: req.request_id }, makeL2Claims());

    // Second call — no more logs needed (already settled)
    mockLogs = [];
    const status2 = await paymentStatus({ request_id: req.request_id }, makeL2Claims());
    expect(status2.status).toBe('paid');
    expect(status2.newly_paid).toBeUndefined();
  });

  it('expiry path: past expires_at → status expired', async () => {
    const req = await paymentRequest(
      { amount_usdc: 1, memo: 'expire me', expiry_hours: 0.0001 }, // ~0.36 seconds
      makeL3Claims(),
    );

    // Wait a moment, then manually back-date the expires_at in the DB
    const { openDb } = await import('../spend-tracker.js');
    const db = openDb();
    const pastTime = new Date(Date.now() - 10_000).toISOString();
    db.prepare('UPDATE payment_requests SET expires_at = ? WHERE id = ?').run(pastTime, req.request_id);

    mockLogs = []; // no logs
    const status = await paymentStatus({ request_id: req.request_id }, makeL2Claims());
    expect(status.status).toBe('expired');
  });

  it('inserts webhook_events row on paid', async () => {
    const req = await paymentRequest({ amount_usdc: 5, memo: 'webhook test' }, makeL3Claims());
    mockLogs = [makeTransferLog(RECEIVER, req.amount_usdc_expected, '0xaaabbb')];

    await paymentStatus({ request_id: req.request_id }, makeL2Claims());

    const { openDb } = await import('../spend-tracker.js');
    const db = openDb();
    const events = db.prepare(
      "SELECT * FROM webhook_events WHERE webhook_label = 'payments' ORDER BY id DESC LIMIT 1",
    ).all() as Array<{ body: string }>;

    expect(events.length).toBe(1);
    const body = JSON.parse(events[0].body) as {
      type: string;
      request_id: string;
      tx_hash: string;
    };
    expect(body.type).toBe('payment_received');
    expect(body.request_id).toBe(req.request_id);
    expect(body.tx_hash).toBe('0xaaabbb');
  });
});

// ────────────────────────────────────────────────────────────
// payment_list tests
// ────────────────────────────────────────────────────────────
describe('payment_list', () => {
  it('rejects L1 caller (requires L2)', async () => {
    await expect(
      paymentList({}, makeL2Claims({ trustLevel: 1, trustStatus: 'auto_generated_draft' })),
    ).rejects.toThrow(TrustError);
  });

  it('returns all requests when no filter given', async () => {
    await paymentRequest({ amount_usdc: 1, memo: 'a' }, makeL3Claims());
    await paymentRequest({ amount_usdc: 2, memo: 'b' }, makeL3Claims());

    const list = await paymentList({}, makeL2Claims());
    expect(list.length).toBe(2);
  });

  it('filters by status=pending', async () => {
    const req = await paymentRequest({ amount_usdc: 3, memo: 'filter test' }, makeL3Claims());
    mockLogs = [makeTransferLog(RECEIVER, req.amount_usdc_expected)];
    await paymentStatus({ request_id: req.request_id }, makeL2Claims()); // mark paid

    await paymentRequest({ amount_usdc: 4, memo: 'still pending' }, makeL3Claims());

    const pending = await paymentList({ status: 'pending' }, makeL2Claims());
    expect(pending.every((r) => r.status === 'pending')).toBe(true);
    expect(pending.length).toBe(1);
  });

  it('filters by status=paid', async () => {
    const req = await paymentRequest({ amount_usdc: 3, memo: 'to pay' }, makeL3Claims());
    mockLogs = [makeTransferLog(RECEIVER, req.amount_usdc_expected)];
    await paymentStatus({ request_id: req.request_id }, makeL2Claims());

    const paid = await paymentList({ status: 'paid' }, makeL2Claims());
    expect(paid.length).toBe(1);
    expect(paid[0].status).toBe('paid');
  });

  it('returns newest first', async () => {
    const r1 = await paymentRequest({ amount_usdc: 1, memo: 'first' }, makeL3Claims());
    await new Promise<void>((res) => setTimeout(res, 5));
    const r2 = await paymentRequest({ amount_usdc: 2, memo: 'second' }, makeL3Claims());

    const list = await paymentList({}, makeL2Claims());
    expect(list[0].id).toBe(r2.request_id);
    expect(list[1].id).toBe(r1.request_id);
  });
});
