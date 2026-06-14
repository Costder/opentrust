import { describe, expect, it } from 'vitest';
import { AUTONOMY_MODES, decideSpendWithinCaps, defaultSpendCaps, getModeMetadata } from '../control-panel/permissions.js';

describe('Agent OS permission profiles', () => {
  it('ships all four public autonomy modes from day one', () => {
    expect(AUTONOMY_MODES.map((mode) => mode.mode)).toEqual([
      'manager',
      'operator',
      'shopkeeper',
      'founder',
    ]);
    expect(getModeMetadata('founder').label).toBe('Founder Mode');
    expect(getModeMetadata('shopkeeper').alwaysOn).toBe(true);
  });

  it('allows money actions inside hard budget caps without approval', () => {
    const decision = decideSpendWithinCaps(
      25,
      defaultSpendCaps({ perCall: 50, daily: 100, missionTotal: 300 }),
      20,
      100,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toMatch(/no per-action approval/i);
  });

  it('blocks money actions when no hard budget is configured', () => {
    const decision = decideSpendWithinCaps(1, defaultSpendCaps());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/no hard spend budget/i);
  });

  it('blocks money actions above per-call, daily, or mission caps', () => {
    const caps = defaultSpendCaps({ perCall: 50, daily: 100, missionTotal: 200 });
    expect(decideSpendWithinCaps(51, caps).allowed).toBe(false);
    expect(decideSpendWithinCaps(25, caps, 90).allowed).toBe(false);
    expect(decideSpendWithinCaps(25, caps, 0, 190).allowed).toBe(false);
  });
});
