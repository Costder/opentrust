import { describe, expect, it } from 'vitest';
import type { Mission } from '../control-panel/types.js';
import { classifyObjective, createStrategyRecord } from '../control-panel/strategy.js';
import { defaultSpendCaps } from '../control-panel/permissions.js';

function mission(objective: string): Mission {
  return {
    missionId: 'mission-1',
    title: 'Test mission',
    objective,
    mode: 'founder',
    status: 'draft',
    strategyGoalId: null,
    budget: defaultSpendCaps({ missionTotal: 100 }),
    forbiddenActions: [],
    activeAgentIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('Agent OS Strategy Skill helper', () => {
  it('classifies business and growth outcomes as big goals', () => {
    expect(classifyObjective('Build a payment company and grow it to 10M ARR')).toBe('big_goal');
    expect(classifyObjective('Launch my marketplace business')).toBe('big_goal');
  });

  it('classifies short concrete work as simple', () => {
    expect(classifyObjective('Run tests and summarize failures')).toBe('simple');
  });

  it('creates strategy records with assumptions, milestones, exit rules, and tasks', () => {
    const record = createStrategyRecord(mission('Grow my AI automation agency to $100k revenue'));
    expect(record).not.toBeNull();
    expect(record?.assumptions.length).toBeGreaterThan(0);
    expect(record?.milestones.length).toBeGreaterThan(0);
    expect(record?.exitRules.join(' ')).toMatch(/hard caps/i);
    expect(record?.tasks.join(' ')).toMatch(/capability readiness/i);
  });
});
