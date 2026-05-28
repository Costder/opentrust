import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TrustError } from '../trust.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────
const { mockCronSchedule, mockCronValidate } = vi.hoisted(() => ({
  mockCronSchedule: vi.fn(),
  mockCronValidate: vi.fn().mockReturnValue(true),
}));

vi.mock('node-cron', () => ({
  schedule: mockCronSchedule,
  validate: mockCronValidate,
  getTasks: vi.fn().mockReturnValue(new Map()),
}));

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({
    version: 1,
    instanceId: 'test',
    registryUrl: 'http://localhost:8000',
    passphraseHash: 'hash',
    capabilities: {},
  })),
  CONFIG_DIR: '/tmp/test-haf-tasks',
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

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import Database from 'better-sqlite3';
import { createTask, listTasks, deleteTask, pauseTask } from '../capabilities/tasks/index.js';
import { validateTaskPassport } from '../capabilities/tasks/revocation.js';
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

const FAKE_SNAPSHOT = { tool: 'send_email', spendCaps: { maxPerCallUsdc: 10, dailyCapUsdc: 100 } };

function makeFakeJob() {
  return { start: vi.fn(), stop: vi.fn() };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
  mockCronValidate.mockReturnValue(true);
  mockCronSchedule.mockReturnValue(makeFakeJob());
});

// ────────────────────────────────────────────────────────────
// create_task
// ────────────────────────────────────────────────────────────
describe('create_task', () => {
  it('throws TrustError for L2 caller', async () => {
    await expect(
      createTask(
        {
          cron_expression: '* * * * *',
          tool_name: 'send_email',
          passport_id: 'p1',
          passport_version: '1',
          permission_snapshot: FAKE_SNAPSHOT,
        },
        makeL2Claims(),
      ),
    ).rejects.toThrow(TrustError);
  });

  it('stores task in DB and schedules cron job', async () => {
    const result = await createTask(
      {
        label: 'my-task',
        cron_expression: '0 * * * *',
        tool_name: 'send_email',
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );

    expect(result.label).toBe('my-task');
    expect(result.status).toBe('active');
    expect(mockCronSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  });

  it('throws for invalid cron expression', async () => {
    mockCronValidate.mockReturnValue(false);
    await expect(
      createTask(
        {
          cron_expression: 'not-a-cron',
          tool_name: 'send_email',
          passport_id: 'p1',
          passport_version: '1',
          permission_snapshot: FAKE_SNAPSHOT,
        },
        makeL3Claims(),
      ),
    ).rejects.toThrow(/Invalid cron expression/);
  });

  it('auto-generates label if omitted', async () => {
    const result = await createTask(
      {
        cron_expression: '* * * * *',
        tool_name: 'send_email',
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );
    expect(result.label).toMatch(/^task-/);
  });
});

// ────────────────────────────────────────────────────────────
// list_tasks
// ────────────────────────────────────────────────────────────
describe('list_tasks', () => {
  it('L2 can list tasks', async () => {
    await createTask(
      {
        label: 'list-me',
        cron_expression: '* * * * *',
        tool_name: 'notify_human',
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );

    const result = await listTasks({} as Record<string, never>, makeL2Claims());
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].label).toBe('list-me');
    expect(result.tasks[0].status).toBe('active');
  });
});

// ────────────────────────────────────────────────────────────
// pause_task
// ────────────────────────────────────────────────────────────
describe('pause_task', () => {
  it('pauses an active task and stops the cron job', async () => {
    const fakeJob = makeFakeJob();
    mockCronSchedule.mockReturnValue(fakeJob);

    await createTask(
      {
        label: 'pause-me',
        cron_expression: '* * * * *',
        tool_name: 'notify_human',
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );

    const result = await pauseTask({ label: 'pause-me' }, makeL3Claims());
    expect(result.paused).toBe(true);
    expect(fakeJob.stop).toHaveBeenCalled();

    // Verify status in DB
    const tasks = await listTasks({} as Record<string, never>, makeL2Claims());
    expect(tasks.tasks[0].status).toBe('paused');
  });

  it('throws TrustError for L2 caller on pause_task', async () => {
    await expect(pauseTask({ label: 'any' }, makeL2Claims())).rejects.toThrow(TrustError);
  });
});

// ────────────────────────────────────────────────────────────
// delete_task
// ────────────────────────────────────────────────────────────
describe('delete_task', () => {
  it('deletes a task and stops the cron job', async () => {
    const fakeJob = makeFakeJob();
    mockCronSchedule.mockReturnValue(fakeJob);

    await createTask(
      {
        label: 'delete-me',
        cron_expression: '* * * * *',
        tool_name: 'notify_human',
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );

    const result = await deleteTask({ label: 'delete-me' }, makeL3Claims());
    expect(result.deleted).toBe(true);
    expect(fakeJob.stop).toHaveBeenCalled();

    // Deleted tasks should not appear in list
    const tasks = await listTasks({} as Record<string, never>, makeL2Claims());
    expect(tasks.tasks).toHaveLength(0);
  });

  it('throws TrustError for L2 caller on delete_task', async () => {
    await expect(deleteTask({ label: 'any' }, makeL2Claims())).rejects.toThrow(TrustError);
  });
});

// ────────────────────────────────────────────────────────────
// validateTaskPassport (revocation.ts)
// ────────────────────────────────────────────────────────────
describe('validateTaskPassport', () => {
  it('denies when passport is revoked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'p1', version: '1', status: 'revoked' }),
    });

    const result = await validateTaskPassport('p1', '1', FAKE_SNAPSHOT, 'http://localhost:8000');
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('revoked');
  });

  it('denies when passport is disputed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'p1', version: '1', status: 'disputed' }),
    });

    const result = await validateTaskPassport('p1', '1', FAKE_SNAPSHOT, 'http://localhost:8000');
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('disputed');
  });

  it('denies when registry is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await validateTaskPassport('p1', '1', FAKE_SNAPSHOT, 'http://localhost:8000');
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('registry_unreachable');
  });

  it('allows active passport with matching version', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'p1',
        version: '1',
        status: 'active',
        spendCaps: { maxPerCallUsdc: 10, dailyCapUsdc: 100 },
      }),
    });

    const result = await validateTaskPassport('p1', '1', FAKE_SNAPSHOT, 'http://localhost:8000');
    expect(result.decision).toBe('allow');
  });

  it('narrower-wins: stored higher cap, current lower cap → uses lower', async () => {
    // Stored: maxPerCallUsdc=50, current: maxPerCallUsdc=5 → effective=5
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'p1',
        version: '2', // version mismatch
        status: 'active',
        spendCaps: { maxPerCallUsdc: 5, dailyCapUsdc: 50 },
      }),
    });

    const storedSnapshot = {
      tool: 'send_usdc',
      spendCaps: { maxPerCallUsdc: 50, dailyCapUsdc: 500 },
    };
    const result = await validateTaskPassport('p1', '1', storedSnapshot, 'http://localhost:8000');
    expect(result.decision).toBe('allow');
    expect(result.effectiveSnapshot.spendCaps?.maxPerCallUsdc).toBe(5);
    expect(result.effectiveSnapshot.spendCaps?.dailyCapUsdc).toBe(50);
  });

  it('narrower-wins: stored lower cap, current higher cap → uses stored', async () => {
    // Stored: maxPerCallUsdc=5, current: maxPerCallUsdc=100 → effective=5 (stored is narrower)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'p1',
        version: '2',
        status: 'active',
        spendCaps: { maxPerCallUsdc: 100, dailyCapUsdc: 1000 },
      }),
    });

    const storedSnapshot = {
      tool: 'send_usdc',
      spendCaps: { maxPerCallUsdc: 5, dailyCapUsdc: 50 },
    };
    const result = await validateTaskPassport('p1', '1', storedSnapshot, 'http://localhost:8000');
    expect(result.decision).toBe('allow');
    expect(result.effectiveSnapshot.spendCaps?.maxPerCallUsdc).toBe(5);
    expect(result.effectiveSnapshot.spendCaps?.dailyCapUsdc).toBe(50);
  });
});
