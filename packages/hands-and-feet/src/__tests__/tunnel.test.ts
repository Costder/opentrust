import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────
const { mockSpawn, mockNgrokForward } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockNgrokForward: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('@ngrok/ngrok', () => ({
  forward: mockNgrokForward,
}));

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({
    version: 1,
    instanceId: 'test',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
  })),
  CONFIG_DIR: '/tmp/test-haf-tunnel',
  ensureConfigDir: vi.fn(),
}));

vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn((_path: string) => {
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
import { createTunnel, getTunnelUrl, closeTunnel } from '../capabilities/tunnel/index.js';
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

// ────────────────────────────────────────────────────────────
// Fake child process helper
// ────────────────────────────────────────────────────────────
function makeChildProcess(urlToEmit: string) {
  let stderrListener: ((chunk: Buffer | string) => void) | null = null;
  const proc = {
    stdout: { on: vi.fn() },
    stderr: {
      on: vi.fn((_event: string, cb: (chunk: Buffer | string) => void) => {
        stderrListener = cb;
      }),
    },
    on: vi.fn(),
    kill: vi.fn(),
    emitUrl: () => stderrListener?.(urlToEmit),
  };
  return proc;
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────
describe('create_tunnel', () => {
  it('throws TrustError for L2 caller', async () => {
    await expect(
      createTunnel({ port: 3000 }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('creates tunnel with cloudflared, stores in DB, returns URL', async () => {
    const proc = makeChildProcess('https://abc123.trycloudflare.com');
    mockSpawn.mockReturnValue(proc);

    // We need to emit the URL after spawn is called
    const promise = createTunnel({ port: 3000, label: 'my-tunnel', provider: 'cloudflared' }, makeL3Claims());
    // Give a tick for event listeners to register, then emit
    await new Promise<void>((r) => setTimeout(r, 10));
    proc.emitUrl();

    const result = await promise;
    expect(result.url).toBe('https://abc123.trycloudflare.com');
    expect(result.label).toBe('my-tunnel');
    expect(result.provider).toBe('cloudflared');
    expect(mockSpawn).toHaveBeenCalledWith(
      'cloudflared',
      ['tunnel', '--url', 'http://localhost:3000'],
      expect.any(Object),
    );
  });

  it('creates tunnel with ngrok, stores in DB, returns URL', async () => {
    const fakeListener = { url: vi.fn().mockReturnValue('https://ngrok-test.ngrok.io') };
    mockNgrokForward.mockResolvedValue(fakeListener);

    const result = await createTunnel({ port: 4000, label: 'ngrok-tunnel', provider: 'ngrok' }, makeL3Claims());
    expect(result.url).toBe('https://ngrok-test.ngrok.io');
    expect(result.provider).toBe('ngrok');
    expect(mockNgrokForward).toHaveBeenCalledWith({ addr: 4000 });
  });

  it('returns existing open tunnel if label already exists', async () => {
    const fakeListener = { url: vi.fn().mockReturnValue('https://ngrok-existing.ngrok.io') };
    mockNgrokForward.mockResolvedValue(fakeListener);

    // Create first time
    await createTunnel({ port: 5000, label: 'existing', provider: 'ngrok' }, makeL3Claims());
    // Second call — should return same
    const result = await createTunnel({ port: 5000, label: 'existing', provider: 'ngrok' }, makeL3Claims());
    expect(result.url).toBe('https://ngrok-existing.ngrok.io');
    // ngrokForward only called once
    expect(mockNgrokForward).toHaveBeenCalledTimes(1);
  });
});

describe('get_tunnel_url', () => {
  it('returns URL from DB for active tunnel', async () => {
    const fakeListener = { url: vi.fn().mockReturnValue('https://get-url-test.ngrok.io') };
    mockNgrokForward.mockResolvedValue(fakeListener);

    await createTunnel({ port: 6000, label: 'get-url-tunnel', provider: 'ngrok' }, makeL3Claims());
    const result = await getTunnelUrl({ label: 'get-url-tunnel' }, makeL2Claims());

    expect(result.url).toBe('https://get-url-test.ngrok.io');
    expect(result.label).toBe('get-url-tunnel');
  });

  it('returns null for unknown label', async () => {
    const result = await getTunnelUrl({ label: 'nonexistent' }, makeL2Claims());
    expect(result.url).toBeNull();
  });
});

describe('close_tunnel', () => {
  it('marks tunnel closed in DB and kills process', async () => {
    const proc = makeChildProcess('https://close-test.trycloudflare.com');
    mockSpawn.mockReturnValue(proc);

    const promise = createTunnel({ port: 7000, label: 'close-me', provider: 'cloudflared' }, makeL3Claims());
    await new Promise<void>((r) => setTimeout(r, 10));
    proc.emitUrl();
    await promise;

    const result = await closeTunnel({ label: 'close-me' }, makeL3Claims());
    expect(result.closed).toBe(true);
    expect(proc.kill).toHaveBeenCalled();

    // URL should now return null
    const urlResult = await getTunnelUrl({ label: 'close-me' }, makeL2Claims());
    expect(urlResult.url).toBeNull();
  });

  it('throws TrustError for L2 caller on close_tunnel', async () => {
    await expect(closeTunnel({ label: 'any' }, makeL2Claims())).rejects.toThrow(TrustError);
  });
});
