// packages/hands-and-feet/src/__tests__/triggers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

const { mockExecuteUnder, mockCronSchedule, mockCronValidate } = vi.hoisted(() => ({
  mockExecuteUnder: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] }),
  mockCronSchedule: vi.fn(),
  mockCronValidate: vi.fn().mockReturnValue(true),
}));

vi.mock('../capabilities/delegations/index.js', () => ({
  executeUnderDelegation: mockExecuteUnder,
}));
vi.mock('node-cron', () => ({
  schedule: mockCronSchedule,
  validate: mockCronValidate,
  getTasks: vi.fn().mockReturnValue(new Map()),
}));
vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({ registryUrl: 'http://localhost:8000' })),
  CONFIG_DIR: '/tmp/test-haf-trig',
  ensureConfigDir: vi.fn(),
}));
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(() => {
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
  createTrigger,
  listTriggers,
  deleteTrigger,
  renderTemplate,
  matchAndFire,
} from '../capabilities/triggers/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL3Claims(): PassportClaims {
  return { passportId: 'p1', agentId: 'a1', trustLevel: 3, trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
  mockCronValidate.mockReturnValue(true);
  mockCronSchedule.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockExecuteUnder.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
});

describe('renderTemplate', () => {
  it('substitutes {{event.field}} with event data', () => {
    const template = { message: '{{event.subject}}', to: '{{event.from}}' };
    const event = { subject: 'Hello', from: 'alice@example.com' };
    const result = renderTemplate(template, event);
    expect(result).toEqual({ message: 'Hello', to: 'alice@example.com' });
  });

  it('leaves unmatched placeholders as-is', () => {
    const template = { msg: '{{event.missing}}' };
    const result = renderTemplate(template, {});
    expect(result).toEqual({ msg: '{{event.missing}}' });
  });

  it('does not evaluate expressions — only string substitution', () => {
    const template = { msg: '{{event.x + 1}}' };
    const result = renderTemplate(template, { x: '5' });
    // No match because key is 'x + 1', not 'x'
    expect(result).toEqual({ msg: '{{event.x + 1}}' });
  });
});

describe('createTrigger', () => {
  it('creates a cron trigger and schedules it', async () => {
    const result = await createTrigger({
      label: 'ping-hourly',
      source: 'cron',
      match: { cron_expression: '0 * * * *' },
      action: { tool_name: 'notify_human', tool_args_template: { message: 'hourly ping' } },
      delegation_label: null,
    }, makeL3Claims());
    expect(result.status).toBe('active');
    expect(mockCronSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  });

  it('throws TrustError for L2 caller', async () => {
    const { TrustError } = await import('../trust.js');
    await expect(
      createTrigger({ label: 'x', source: 'webhook', match: {}, action: { tool_name: 'notify_human', tool_args_template: {} }, delegation_label: null },
        { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' })
    ).rejects.toThrow(TrustError);
  });
});

describe('matchAndFire (webhook source)', () => {
  it('fires matching trigger and calls executeUnderDelegation', async () => {
    // Create a delegation first (using direct DB insert to bypass full delegation module)
    const db = (await import('../spend-tracker.js')).openDb();
    db.prepare(`INSERT INTO delegations (label, passport_id, passport_version, agent_id, trust_level, trust_status, tool_allowlist, spend_caps, action_budgets, status, created_at)
      VALUES ('del-1', 'p1', '1', 'a1', 3, 'seller_confirmed', '["notify_human"]', '{}', '{}', 'active', '2026-01-01')`).run();

    await createTrigger({
      label: 'wh-trigger',
      source: 'webhook',
      match: { webhook_label: 'my-hook' },
      action: { tool_name: 'notify_human', tool_args_template: { message: 'webhook fired: {{event.body}}' } },
      delegation_label: 'del-1',
    }, makeL3Claims());

    await matchAndFire('webhook', { webhook_label: 'my-hook', body: 'payload' });

    expect(mockExecuteUnder).toHaveBeenCalledWith(
      'del-1',
      'notify_human',
      { message: 'webhook fired: payload' },
    );
  });

  it('does not fire a deleted trigger', async () => {
    const db = (await import('../spend-tracker.js')).openDb();
    db.prepare(`INSERT INTO delegations (label, passport_id, passport_version, agent_id, trust_level, trust_status, tool_allowlist, spend_caps, action_budgets, status, created_at) VALUES ('del-2', 'p1', '1', 'a1', 3, 'seller_confirmed', '["notify_human"]', '{}', '{}', 'active', '2026-01-01')`).run();

    const { label } = await createTrigger({
      label: 'wh-paused',
      source: 'webhook',
      match: { webhook_label: 'my-hook' },
      action: { tool_name: 'notify_human', tool_args_template: {} },
      delegation_label: 'del-2',
    }, makeL3Claims());

    await deleteTrigger({ label }, makeL3Claims());
    mockExecuteUnder.mockClear();
    await matchAndFire('webhook', { webhook_label: 'my-hook' });
    expect(mockExecuteUnder).not.toHaveBeenCalled();
  });
});
