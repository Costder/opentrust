// packages/hands-body-and-feet/src/__tests__/help.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';
import { TrustError } from '../trust.js';

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({})),
  CONFIG_DIR: '/tmp/test-haf-help',
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
import { hbfHelp } from '../capabilities/help/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL1Claims(): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'agent1',
    trustLevel: 1,
    trustStatus: 'auto_generated_draft',
    flags: [],
    isDisputed: false,
    version: '1',
  };
}

function makeL2Claims(): PassportClaims {
  return { ...makeL1Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
});

describe('hbf_help', () => {
  it('returns all domains when no domain arg is given', async () => {
    const result = await hbfHelp({}, makeL1Claims());
    expect(Array.isArray(result.domains)).toBe(true);
    expect(result.domains.length).toBeGreaterThan(5);
    const domainNames = result.domains.map((d) => d.domain);
    expect(domainNames).toContain('wallet');
    expect(domainNames).toContain('email');
    expect(domainNames).toContain('bus');
    expect(domainNames).toContain('help');
  });

  it('includes the new bus tools in the bus domain', async () => {
    const result = await hbfHelp({ domain: 'bus' }, makeL1Claims());
    expect(result.domains).toHaveLength(1);
    const busToolNames = result.domains[0].tools.map((t) => t.name);
    expect(busToolNames).toContain('bus_send');
    expect(busToolNames).toContain('bus_poll');
    expect(busToolNames).toContain('bus_wait');
  });

  it('shows alias_of metadata for domain-prefix aliases', async () => {
    const result = await hbfHelp({ domain: 'wallet' }, makeL1Claims());
    const alias = result.domains[0].tools.find((t) => t.name === 'wallet_address') as
      | { name: string; alias_of?: string }
      | undefined;
    expect(alias).toBeDefined();
    expect(alias?.alias_of).toBe('get_address');
  });

  it('filters to a single domain when domain arg is provided', async () => {
    const result = await hbfHelp({ domain: 'wallet' }, makeL2Claims());
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0].domain).toBe('wallet');
    const names = result.domains[0].tools.map((t) => t.name);
    expect(names).toContain('create_wallet');
    expect(names).toContain('send_usdc');
  });

  it('returns empty domains array for an unknown domain', async () => {
    const result = await hbfHelp({ domain: 'nonexistent-domain' }, makeL1Claims());
    expect(result.domains).toHaveLength(0);
  });

  it('includes recipes array with exactly 3 entries', async () => {
    const result = await hbfHelp({}, makeL1Claims());
    expect(Array.isArray(result.recipes)).toBe(true);
    expect(result.recipes).toHaveLength(3);
    // Check each recipe is a non-empty string
    for (const recipe of result.recipes) {
      expect(typeof recipe).toBe('string');
      expect(recipe.length).toBeGreaterThan(0);
    }
  });

  it('includes the payment recipe', async () => {
    const result = await hbfHelp({}, makeL1Claims());
    const hasPaymentRecipe = result.recipes.some((r) => r.includes('create_wallet'));
    expect(hasPaymentRecipe).toBe(true);
  });

  it('includes the bus_send recipe', async () => {
    const result = await hbfHelp({}, makeL1Claims());
    const hasBusRecipe = result.recipes.some((r) => r.includes('bus_send'));
    expect(hasBusRecipe).toBe(true);
  });

  it('includes the cron trigger recipe', async () => {
    const result = await hbfHelp({}, makeL1Claims());
    const hasTriggerRecipe = result.recipes.some((r) => r.includes('create_trigger'));
    expect(hasTriggerRecipe).toBe(true);
  });

  it('each tool entry has name, description, and minTrustLevel', async () => {
    const result = await hbfHelp({ domain: 'email' }, makeL1Claims());
    for (const tool of result.domains[0].tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.minTrustLevel).toBe('number');
    }
  });

  it('tools with spend policy expose spendPolicy field', async () => {
    const result = await hbfHelp({ domain: 'wallet' }, makeL1Claims());
    const sendUsdc = result.domains[0].tools.find((t) => t.name === 'send_usdc');
    expect(sendUsdc).toBeDefined();
    expect(sendUsdc?.spendPolicy).toBeDefined();
    expect(sendUsdc?.spendPolicy?.maxPerCallUsdc).toBeDefined();
  });

  it('is accessible at L1 trust (auto_generated_draft)', async () => {
    await expect(hbfHelp({}, makeL1Claims())).resolves.toBeDefined();
  });

  it('throws DisputedError for disputed passport', async () => {
    const disputedClaims: PassportClaims = {
      ...makeL1Claims(),
      isDisputed: true,
      trustStatus: 'disputed',
    };
    await expect(hbfHelp({}, disputedClaims)).rejects.toThrow();
  });
});
