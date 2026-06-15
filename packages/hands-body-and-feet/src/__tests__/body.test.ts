// packages/hands-body-and-feet/src/__tests__/body.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({})),
  CONFIG_DIR: '/tmp/test-haf-body',
  ensureConfigDir: vi.fn(),
}));
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(function () {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (p: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

import Database from 'better-sqlite3';
import { _resetDb } from '../spend-tracker.js';
import {
  getIdentity,
  setIdentityBinding,
  getMemory,
  setMemory,
  listMemory,
  deleteMemory,
} from '../capabilities/body/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeClaims(): PassportClaims {
  return { passportId: 'p1', agentId: 'agent1', trustLevel: 2, trustStatus: 'creator_claimed', flags: [], isDisputed: false, version: '1' };
}

function makeL3Claims(): PassportClaims {
  return { passportId: 'p1', agentId: 'agent1', trustLevel: 3, trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
});

describe('identity', () => {
  it('returns null fields before any binding is set', async () => {
    const result = await getIdentity({}, makeClaims());
    expect(result.identity).toBeNull();
  });

  it('round-trips set and get', async () => {
    await setIdentityBinding({ field: 'email', value: 'bot@example.com' }, makeL3Claims());
    const result = await getIdentity({}, makeClaims());
    expect(result.identity?.email).toBe('bot@example.com');
  });

  it('updates an existing field without wiping others', async () => {
    await setIdentityBinding({ field: 'email', value: 'a@b.com' }, makeL3Claims());
    await setIdentityBinding({ field: 'phone', value: '+15555555555' }, makeL3Claims());
    const result = await getIdentity({}, makeClaims());
    expect(result.identity?.email).toBe('a@b.com');
    expect(result.identity?.phone).toBe('+15555555555');
  });
});

describe('memory', () => {
  it('returns null for missing key', async () => {
    const result = await getMemory({ key: 'nope' }, makeClaims());
    expect(result.value).toBeNull();
  });

  it('round-trips set and get', async () => {
    await setMemory({ key: 'ctx', value: { step: 3 } }, makeClaims());
    const result = await getMemory({ key: 'ctx' }, makeClaims());
    expect(result.value).toEqual({ step: 3 });
  });

  it('overwrites on re-set', async () => {
    await setMemory({ key: 'k', value: 'old' }, makeClaims());
    await setMemory({ key: 'k', value: 'new' }, makeClaims());
    const result = await getMemory({ key: 'k' }, makeClaims());
    expect(result.value).toBe('new');
  });

  it('listMemory returns all keys', async () => {
    await setMemory({ key: 'a', value: 1 }, makeClaims());
    await setMemory({ key: 'b', value: 2 }, makeClaims());
    const result = await listMemory({}, makeClaims());
    expect(result.keys).toContain('a');
    expect(result.keys).toContain('b');
  });

  it('deleteMemory removes the key', async () => {
    await setMemory({ key: 'gone', value: 'bye' }, makeClaims());
    await deleteMemory({ key: 'gone' }, makeL3Claims());
    const result = await getMemory({ key: 'gone' }, makeClaims());
    expect(result.value).toBeNull();
  });
});
