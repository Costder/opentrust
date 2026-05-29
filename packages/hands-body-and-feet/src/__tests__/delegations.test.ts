// packages/hands-body-and-feet/src/__tests__/delegations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

const { mockIsPaused, mockDispatchTool, mockValidate } = vi.hoisted(() => ({
  mockIsPaused: vi.fn().mockReturnValue(false),
  mockDispatchTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"ok":true}' }] }),
  mockValidate: vi.fn(),
}));

vi.mock('../state.js', () => ({ isPaused: mockIsPaused }));
vi.mock('../dispatch.js', () => ({ dispatchTool: mockDispatchTool }));
vi.mock('../capabilities/tasks/revocation.js', () => ({
  validateTaskPassport: mockValidate,
}));
vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({ registryUrl: 'http://localhost:8000' })),
  CONFIG_DIR: '/tmp/test-haf-del',
  ensureConfigDir: vi.fn(),
}));
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(() => {
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
import { _resetDb } from '../spend-tracker.js';
import {
  createDelegation,
  listDelegations,
  revokeDelegation,
  executeUnderDelegation,
} from '../capabilities/delegations/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1', agentId: 'agent1', trustLevel: 3,
    trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1',
    spendCaps: { maxPerCallUsdc: 100, dailyCapUsdc: 500 },
    ...overrides,
  };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
  mockIsPaused.mockReturnValue(false);
  mockDispatchTool.mockResolvedValue({ content: [{ type: 'text', text: '{"ok":true}' }] });
  mockValidate.mockResolvedValue({ decision: 'allow', effectiveSnapshot: { tool: 'notify_human', spendCaps: { maxPerCallUsdc: 100, dailyCapUsdc: 500 } } });
});

describe('createDelegation', () => {
  it('stores delegation and returns label', async () => {
    const result = await createDelegation({
      label: 'del-1',
      tool_allowlist: ['notify_human', 'send_email'],
      spend_caps: { maxPerCallUsdc: 10, dailyCapUsdc: 50 },
      action_budgets: { notify_human: 5 },
    }, makeL3Claims());
    expect(result.label).toBe('del-1');
    expect(result.status).toBe('active');
  });

  it('throws TrustError for L2 caller', async () => {
    const { TrustError } = await import('../trust.js');
    await expect(
      createDelegation({ label: 'x', tool_allowlist: [], spend_caps: {}, action_budgets: {} },
        makeL3Claims({ trustLevel: 2, trustStatus: 'creator_claimed' }))
    ).rejects.toThrow(TrustError);
  });
});

describe('executeUnderDelegation', () => {
  async function makeDelegation(allowlist = ['notify_human'], budgets: Record<string, number> = {}) {
    return createDelegation({
      label: `del-${Date.now()}`,
      tool_allowlist: allowlist,
      spend_caps: { maxPerCallUsdc: 100, dailyCapUsdc: 500 },
      action_budgets: budgets,
    }, makeL3Claims());
  }

  it('calls dispatchTool on success', async () => {
    const { label } = await makeDelegation(['notify_human']);
    await executeUnderDelegation(label, 'notify_human', { message: 'hi' });
    expect(mockDispatchTool).toHaveBeenCalledWith('notify_human', { message: 'hi' }, expect.objectContaining({ passportId: 'p1' }));
  });

  it('denies tool not in allowlist', async () => {
    const { label } = await makeDelegation(['send_email']);
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not in allowlist');
  });

  it('halts when kill switch is engaged', async () => {
    mockIsPaused.mockReturnValue(true);
    const { label } = await makeDelegation(['notify_human']);
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('PAUSED');
    expect(mockDispatchTool).not.toHaveBeenCalled();
  });

  it('denies when passport is revoked', async () => {
    mockValidate.mockResolvedValue({ decision: 'deny', reason: 'passport_revoked', effectiveSnapshot: { tool: 'notify_human' } });
    const { label } = await makeDelegation(['notify_human']);
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('passport_revoked');
  });

  it('enforces action budget and marks exhausted', async () => {
    const { label } = await makeDelegation(['notify_human'], { notify_human: 1 });
    // First call succeeds
    await executeUnderDelegation(label, 'notify_human', {});
    // Second call is denied
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('budget exhausted');
  });

  it('narrower-wins: lower cap from registry overrides delegation cap', async () => {
    mockValidate.mockResolvedValue({
      decision: 'allow',
      effectiveSnapshot: { tool: 'notify_human', spendCaps: { maxPerCallUsdc: 5, dailyCapUsdc: 20 } },
    });
    const { label } = await makeDelegation(['notify_human']);
    await executeUnderDelegation(label, 'notify_human', {});
    // The claims passed to dispatchTool should have the narrower cap (5, not 100)
    const calledClaims = mockDispatchTool.mock.calls[0][2] as PassportClaims;
    expect(calledClaims.spendCaps?.maxPerCallUsdc).toBe(5);
  });
});

describe('revokeDelegation', () => {
  it('sets status to revoked', async () => {
    await createDelegation({ label: 'del-r', tool_allowlist: [], spend_caps: {}, action_budgets: {} }, makeL3Claims());
    const result = await revokeDelegation({ label: 'del-r' }, makeL3Claims());
    expect(result.revoked).toBe(true);

    const list = await listDelegations({}, makeL3Claims());
    expect(list.delegations[0].status).toBe('revoked');
  });
});
