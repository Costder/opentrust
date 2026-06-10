// packages/hands-body-and-feet/src/__tests__/bus.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';
import { TrustError } from '../trust.js';

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({})),
  CONFIG_DIR: '/tmp/test-haf-bus',
  ensureConfigDir: vi.fn(),
}));

vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn((_path: string) => {
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
import { busSend, busPoll, busWait } from '../capabilities/bus/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeClaims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'agent1',
    trustLevel: 2,
    trustStatus: 'creator_claimed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL1Claims(): PassportClaims {
  return { ...makeClaims(), trustLevel: 1, trustStatus: 'auto_generated_draft' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
});

// ── bus_send ──────────────────────────────────────────────────

describe('bus_send', () => {
  it('queues a message and returns message_id + queued:true', async () => {
    const result = await busSend({ to_agent: 'bot-b', payload: { hello: 'world' } }, makeClaims());
    expect(result.queued).toBe(true);
    expect(typeof result.message_id).toBe('number');
    expect(result.message_id).toBeGreaterThan(0);
  });

  it('stores from_agent when provided', async () => {
    await busSend({ to_agent: 'bot-b', payload: 'ping', from_agent: 'bot-a' }, makeClaims());
    // poll it back to verify from_agent round-trips
    const poll = await busPoll({ agent_id: 'bot-b' }, makeClaims());
    expect(poll.messages[0].from_agent).toBe('bot-a');
  });

  it('throws TrustError for L1 caller', async () => {
    await expect(
      busSend({ to_agent: 'bot-b', payload: {} }, makeL1Claims()),
    ).rejects.toThrow(TrustError);
  });
});

// ── bus_poll ──────────────────────────────────────────────────

describe('bus_poll', () => {
  it('returns empty when no messages', async () => {
    const result = await busPoll({ agent_id: 'nobody' }, makeClaims());
    expect(result.messages).toHaveLength(0);
    expect(result.remaining).toBe(0);
  });

  it('send → poll round-trip returns message with parsed payload', async () => {
    await busSend({ to_agent: 'bot-b', payload: { step: 1 } }, makeClaims());
    const result = await busPoll({ agent_id: 'bot-b' }, makeClaims());
    expect(result.messages).toHaveLength(1);
    expect((result.messages[0].payload as { step: number }).step).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('second poll returns empty — claim semantics', async () => {
    await busSend({ to_agent: 'bot-b', payload: 'first' }, makeClaims());
    await busPoll({ agent_id: 'bot-b' }, makeClaims()); // claims the message
    const second = await busPoll({ agent_id: 'bot-b' }, makeClaims());
    expect(second.messages).toHaveLength(0);
    expect(second.remaining).toBe(0);
  });

  it('does not return messages addressed to a different agent', async () => {
    await busSend({ to_agent: 'bot-a', payload: 'for a' }, makeClaims());
    const result = await busPoll({ agent_id: 'bot-b' }, makeClaims());
    expect(result.messages).toHaveLength(0);
  });

  it('respects limit parameter and reports remaining', async () => {
    for (let i = 0; i < 5; i++) {
      await busSend({ to_agent: 'bulk-bot', payload: i }, makeClaims());
    }
    const result = await busPoll({ agent_id: 'bulk-bot', limit: 3 }, makeClaims());
    expect(result.messages).toHaveLength(3);
    expect(result.remaining).toBe(2);
  });

  it('messages are returned oldest-first', async () => {
    await busSend({ to_agent: 'ord-bot', payload: 'first' }, makeClaims());
    await busSend({ to_agent: 'ord-bot', payload: 'second' }, makeClaims());
    const result = await busPoll({ agent_id: 'ord-bot' }, makeClaims());
    expect(result.messages[0].payload).toBe('first');
    expect(result.messages[1].payload).toBe('second');
  });

  it('throws TrustError for L1 caller', async () => {
    await expect(busPoll({ agent_id: 'bot-b' }, makeL1Claims())).rejects.toThrow(TrustError);
  });
});

// ── bus_wait ──────────────────────────────────────────────────

describe('bus_wait', () => {
  it('times out when no messages arrive', async () => {
    const result = await busWait(
      { agent_id: 'wait-bot', timeout_ms: 100, poll_interval_ms: 20 },
      makeClaims(),
    );
    expect(result.messages).toHaveLength(0);
    expect(result.timed_out).toBe(true);
  });

  it('returns messages when a message is sent during wait', async () => {
    // Send a message after a short delay so bus_wait picks it up
    setTimeout(async () => {
      await busSend({ to_agent: 'async-bot', payload: { wake: true } }, makeClaims());
    }, 50);

    const result = await busWait(
      { agent_id: 'async-bot', timeout_ms: 2000, poll_interval_ms: 30 },
      makeClaims(),
    );
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.timed_out).toBeUndefined();
    expect((result.messages[0].payload as { wake: boolean }).wake).toBe(true);
  });

  it('returns messages already queued without timeout', async () => {
    await busSend({ to_agent: 'pre-bot', payload: 'already here' }, makeClaims());
    const result = await busWait(
      { agent_id: 'pre-bot', timeout_ms: 5000, poll_interval_ms: 100 },
      makeClaims(),
    );
    expect(result.messages).toHaveLength(1);
    expect(result.timed_out).toBeUndefined();
  });

  it('throws TrustError for L1 caller', async () => {
    await expect(
      busWait({ agent_id: 'bot-b', timeout_ms: 50 }, makeL1Claims()),
    ).rejects.toThrow(TrustError);
  });
});
