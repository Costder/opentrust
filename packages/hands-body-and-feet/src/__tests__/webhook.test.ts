import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────
vi.mock('../capabilities/triggers/index.js', () => ({
  matchAndFire: vi.fn().mockResolvedValue(undefined),
  loadActiveTriggers: vi.fn(),
}));

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({
    version: 1,
    instanceId: 'test',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
  })),
  CONFIG_DIR: '/tmp/test-haf-webhook',
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

import Database from 'better-sqlite3';
import {
  createWebhook,
  getWebhookUrl,
  readWebhookEvents,
  waitForWebhook,
  deleteWebhook,
  webhookReceiver,
} from '../capabilities/webhook/index.js';
import { matchAndFire } from '../capabilities/triggers/index.js';
import { _resetDb } from '../spend-tracker.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

// ────────────────────────────────────────────────────────────
// Helpers
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

function makeL2Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

function makeMockResponse() {
  const res = {
    status: vi.fn().mockReturnThis() as unknown,
    json: vi.fn().mockReturnThis() as unknown,
  } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────
describe('create_webhook', () => {
  it('throws TrustError for L2 caller', async () => {
    await expect(createWebhook({ label: 'test-wh' }, makeL2Claims())).rejects.toThrow(TrustError);
  });

  it('stores webhook record in DB and returns path', async () => {
    const result = await createWebhook({ label: 'my-webhook' }, makeL3Claims());
    expect(result.label).toBe('my-webhook');
    expect(result.path).toMatch(/^\/webhooks\/my-webhook\//);
    expect(result.secret_token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('stores custom retention and payload settings', async () => {
    const result = await createWebhook(
      { label: 'custom-wh', max_payload_bytes: 512, retention_days: 7 },
      makeL3Claims(),
    );
    expect(result.label).toBe('custom-wh');
  });
});

describe('get_webhook_url', () => {
  it('returns local_path when no tunnel is active', async () => {
    await createWebhook({ label: 'url-test-wh' }, makeL3Claims());
    const result = await getWebhookUrl({ label: 'url-test-wh' }, makeL2Claims());
    expect(result.local_path).toMatch(/^\/webhooks\/url-test-wh\//);
    expect(result.url).toBeNull(); // no tunnel
  });

  it('returns null for unknown webhook', async () => {
    const result = await getWebhookUrl({ label: 'unknown' }, makeL2Claims());
    expect(result.url).toBeNull();
    expect(result.local_path).toBeNull();
  });
});

describe('webhookReceiver', () => {
  it('stores event when token is valid', async () => {
    const wh = await createWebhook({ label: 'recv-wh' }, makeL3Claims());
    const token = wh.secret_token;

    const req = {
      params: { label: 'recv-wh', token },
      body: { event: 'payment' },
      headers: { 'content-type': 'application/json' },
    } as unknown as Request;
    const res = makeMockResponse();

    await webhookReceiver(req, res);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(200);

    // Verify matchAndFire was called with correct source and payload
    expect(matchAndFire).toHaveBeenCalledWith('webhook', expect.objectContaining({
      webhook_label: 'recv-wh',
      body: JSON.stringify({ event: 'payment' }),
      headers: JSON.stringify({ 'content-type': 'application/json' }),
    }));

    // Verify event was stored
    const events = await readWebhookEvents({ label: 'recv-wh' }, makeL2Claims());
    expect(events.count).toBe(1);
    expect((events.events[0].body as { event: string }).event).toBe('payment');
  });

  it('returns 401 for invalid token', async () => {
    await createWebhook({ label: 'auth-wh' }, makeL3Claims());

    const req = {
      params: { label: 'auth-wh', token: 'wrong-token' },
      body: {},
      headers: {},
    } as unknown as Request;
    const res = makeMockResponse();

    await webhookReceiver(req, res);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
  });

  it('returns 401 for unknown label', async () => {
    const req = {
      params: { label: 'no-such-wh', token: 'any-token' },
      body: {},
      headers: {},
    } as unknown as Request;
    const res = makeMockResponse();

    await webhookReceiver(req, res);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
  });

  it('returns 413 when body exceeds max_payload_bytes', async () => {
    const wh = await createWebhook(
      { label: 'size-wh', max_payload_bytes: 10 },
      makeL3Claims(),
    );
    const token = wh.secret_token;

    const req = {
      params: { label: 'size-wh', token },
      body: { data: 'this is longer than 10 bytes for sure' },
      headers: {},
    } as unknown as Request;
    const res = makeMockResponse();

    await webhookReceiver(req, res);
    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(413);
  });
});

describe('read_webhook_events', () => {
  it('returns stored events', async () => {
    const wh = await createWebhook({ label: 'read-events-wh' }, makeL3Claims());
    const token = wh.secret_token;

    // Store two events
    for (const body of [{ x: 1 }, { x: 2 }]) {
      const req = {
        params: { label: 'read-events-wh', token },
        body,
        headers: {},
      } as unknown as Request;
      await webhookReceiver(req, makeMockResponse());
    }

    const result = await readWebhookEvents({ label: 'read-events-wh' }, makeL2Claims());
    expect(result.count).toBe(2);
  });

  it('filters by since timestamp', async () => {
    const wh = await createWebhook({ label: 'since-wh' }, makeL3Claims());
    const token = wh.secret_token;

    const req1 = {
      params: { label: 'since-wh', token },
      body: { n: 1 },
      headers: {},
    } as unknown as Request;
    await webhookReceiver(req1, makeMockResponse());

    const since = new Date().toISOString();
    await new Promise<void>((r) => setTimeout(r, 5)); // ensure different timestamp

    const req2 = {
      params: { label: 'since-wh', token },
      body: { n: 2 },
      headers: {},
    } as unknown as Request;
    await webhookReceiver(req2, makeMockResponse());

    const result = await readWebhookEvents({ label: 'since-wh', since }, makeL2Claims());
    expect(result.count).toBe(1);
    expect((result.events[0].body as { n: number }).n).toBe(2);
  });
});

describe('wait_for_webhook', () => {
  it('resolves when matching event arrives', async () => {
    const wh = await createWebhook({ label: 'wait-wh' }, makeL3Claims());
    const token = wh.secret_token;

    // Schedule event delivery after 200ms
    setTimeout(async () => {
      const req = {
        params: { label: 'wait-wh', token },
        body: { status: 'paid' },
        headers: {},
      } as unknown as Request;
      await webhookReceiver(req, makeMockResponse());
    }, 200);

    const result = await waitForWebhook(
      { label: 'wait-wh', filter: { body_contains: 'paid' }, timeout_ms: 3000 },
      makeL2Claims(),
    );
    expect(result.timed_out).toBe(false);
    expect((result.event?.body as { status: string }).status).toBe('paid');
  });

  it('times out when no matching event arrives', async () => {
    await createWebhook({ label: 'timeout-wh' }, makeL3Claims());
    const result = await waitForWebhook(
      { label: 'timeout-wh', timeout_ms: 500 },
      makeL2Claims(),
    );
    expect(result.timed_out).toBe(true);
    expect(result.event).toBeNull();
  });
});

describe('delete_webhook', () => {
  it('removes webhook and cascades event deletion', async () => {
    const wh = await createWebhook({ label: 'del-wh' }, makeL3Claims());
    const token = wh.secret_token;

    // Store an event
    const req = {
      params: { label: 'del-wh', token },
      body: { x: 1 },
      headers: {},
    } as unknown as Request;
    await webhookReceiver(req, makeMockResponse());

    const result = await deleteWebhook({ label: 'del-wh' }, makeL3Claims());
    expect(result.deleted).toBe(true);

    // Webhook events should be gone (FK cascade)
    const events = await readWebhookEvents({ label: 'del-wh' }, makeL2Claims());
    expect(events.count).toBe(0);
  });

  it('throws TrustError for L2 caller on delete_webhook', async () => {
    await expect(deleteWebhook({ label: 'any' }, makeL2Claims())).rejects.toThrow(TrustError);
  });
});
