import { mkdirSync } from 'fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  CONFIG_DIR: '/tmp/test-hbf-agent-os',
  ensureConfigDir: vi.fn(() => mkdirSync('/tmp/test-hbf-agent-os', { recursive: true })),
}));

import { _resetDb, openDb } from '../spend-tracker.js';
import {
  appendEvent,
  createMission,
  ensureControlPanelSchema,
  getMission,
  listEvents,
  listMissions,
  listStrategyRecords,
  saveStrategyRecord,
} from '../control-panel/store.js';
import { createStrategyRecord } from '../control-panel/strategy.js';

afterAll(() => {
  _resetDb();
});

describe('Agent OS local store', () => {
  beforeEach(() => {
    _resetDb();
    ensureControlPanelSchema();
    const db = openDb();
    db.exec(`
      DELETE FROM agent_os_strategy_records;
      DELETE FROM agent_os_events;
      DELETE FROM agent_os_missions;
    `);
  });

  it('creates and reads a mission with default hard budget caps', () => {
    const mission = createMission({
      objective: 'Find leads and email the best five prospects.',
      mode: 'operator',
      budget: { perCall: 10, daily: 50, missionTotal: 100 },
    });

    expect(mission.missionId).toBeTruthy();
    expect(mission.budget.perCall).toBe(10);
    expect(getMission(mission.missionId)?.objective).toBe(mission.objective);
    expect(listMissions()).toHaveLength(1);
  });

  it('appends timeline events without mutating earlier events', () => {
    const mission = createMission({ objective: 'Run local tests.', mode: 'manager' });
    appendEvent({ missionId: mission.missionId, type: 'task', summary: 'Task dispatched.' });
    appendEvent({ missionId: mission.missionId, type: 'tool_call', summary: 'Tool called.', data: { tool: 'notify_human' } });

    const events = listEvents(mission.missionId);
    expect(events.map((event) => event.summary)).toEqual([
      'Mission created in manager mode.',
      'Task dispatched.',
      'Tool called.',
    ]);
    expect(events[2]?.data).toEqual({ tool: 'notify_human' });
  });

  it('stores Strategy Skill records for big missions', () => {
    const mission = createMission({
      objective: 'Launch a marketplace business and grow it to meaningful revenue.',
      mode: 'founder',
    });
    const record = createStrategyRecord(mission);
    expect(record).not.toBeNull();
    saveStrategyRecord(record!);

    const records = listStrategyRecords(mission.missionId);
    expect(records).toHaveLength(1);
    expect(records[0]?.classification).toBe('big_goal');
    expect(records[0]?.assumptions.join(' ')).toMatch(/hard budget caps/i);
  });
});
