import { describe, it, expect } from 'vitest';
import { enforceTrust, enforceSpend, TrustError, DisputedError } from '../trust.js';
import type { PassportClaims, ToolDefinition } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'passport-test-001',
    agentId: 'agent-test',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test-tool',
    minTrustLevel: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enforceTrust
// ---------------------------------------------------------------------------

describe('enforceTrust', () => {
  it('throws DisputedError when isDisputed is true', () => {
    const claims = makeClaims({ isDisputed: true });
    expect(() => enforceTrust(claims, makeTool())).toThrow(DisputedError);
  });

  it('throws DisputedError when trustStatus is "disputed"', () => {
    const claims = makeClaims({ trustStatus: 'disputed', trustLevel: 1 });
    expect(() => enforceTrust(claims, makeTool())).toThrow(DisputedError);
  });

  it('throws TrustError when passport trust level (1) is below tool minimum (2)', () => {
    const claims = makeClaims({ trustLevel: 1, trustStatus: 'auto_generated_draft' });
    const tool = makeTool({ minTrustLevel: 2 });
    expect(() => enforceTrust(claims, tool)).toThrow(TrustError);
  });

  it('does not throw when passport trust level equals tool minimum', () => {
    const claims = makeClaims({ trustLevel: 2, trustStatus: 'creator_claimed' });
    const tool = makeTool({ minTrustLevel: 2 });
    expect(() => enforceTrust(claims, tool)).not.toThrow();
  });

  it('does not throw when passport trust level exceeds tool minimum', () => {
    const claims = makeClaims({ trustLevel: 4, trustStatus: 'community_reviewed' });
    const tool = makeTool({ minTrustLevel: 2 });
    expect(() => enforceTrust(claims, tool)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// enforceSpend
// ---------------------------------------------------------------------------

describe('enforceSpend', () => {
  it('passes when amount is below passport cap', () => {
    const claims = makeClaims({ spendCaps: { maxPerCallUsdc: 10, dailyCapUsdc: 100 } });
    const tool = makeTool();
    expect(() => enforceSpend(claims, tool, 5)).not.toThrow();
  });

  it('throws TrustError when amount exceeds passport cap', () => {
    const claims = makeClaims({ spendCaps: { maxPerCallUsdc: 10, dailyCapUsdc: 100 } });
    const tool = makeTool();
    expect(() => enforceSpend(claims, tool, 15)).toThrow(TrustError);
  });

  it('throws TrustError when amount exceeds tool cap', () => {
    const claims = makeClaims(); // no spend caps
    const tool = makeTool({ spendPolicy: { maxPerCallUsdc: 10 } });
    expect(() => enforceSpend(claims, tool, 15)).toThrow(TrustError);
  });

  it('uses the lower of passport cap and tool cap (tool cap wins)', () => {
    const claims = makeClaims({ spendCaps: { maxPerCallUsdc: 20, dailyCapUsdc: 200 } });
    const tool = makeTool({ spendPolicy: { maxPerCallUsdc: 10 } });
    // 12 exceeds the effective cap of 10 (tool wins)
    expect(() => enforceSpend(claims, tool, 12)).toThrow(TrustError);
    // 9 is within both caps
    expect(() => enforceSpend(claims, tool, 9)).not.toThrow();
  });

  it('passes for any amount when no caps are defined', () => {
    const claims = makeClaims(); // spendCaps undefined
    const tool = makeTool();    // spendPolicy undefined
    expect(() => enforceSpend(claims, tool, 999999)).not.toThrow();
  });
});
