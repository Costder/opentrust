// packages/hands-body-and-feet/src/__tests__/stdio.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({ registryUrl: 'http://localhost:8000' })),
  configExists: vi.fn(() => false),
  ensureConfigDir: vi.fn(),
  CONFIG_DIR: '/tmp/test-haf-stdio',
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

import { resolveStdioClaims } from '../stdio.js';

const ENV_KEYS = [
  'OPENTRUST_PASSPORT_TOKEN',
  'OPENTRUST_JWT_SECRET',
  'OPENTRUST_AGENT_ID',
  'OPENTRUST_TRUST_STATUS',
];

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

/** Mint a local HMAC-SHA256 JWT whose payload is the given claims object. */
function mintToken(claims: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe('resolveStdioClaims', () => {
  it('defaults to a local L3 (seller_confirmed) agent with no env set', async () => {
    const claims = await resolveStdioClaims('http://localhost:8000');
    expect(claims.agentId).toBe('local-agent');
    expect(claims.passportId).toBe('local-agent');
    expect(claims.trustLevel).toBe(3);
    expect(claims.trustStatus).toBe('seller_confirmed');
    expect(claims.isDisputed).toBe(false);
  });

  it('respects OPENTRUST_AGENT_ID', async () => {
    process.env['OPENTRUST_AGENT_ID'] = 'my-bot';
    const claims = await resolveStdioClaims('http://localhost:8000');
    expect(claims.agentId).toBe('my-bot');
    expect(claims.passportId).toBe('my-bot');
  });

  it('respects OPENTRUST_TRUST_STATUS for a lower trust level', async () => {
    process.env['OPENTRUST_TRUST_STATUS'] = 'creator_claimed';
    const claims = await resolveStdioClaims('http://localhost:8000');
    expect(claims.trustLevel).toBe(2);
    expect(claims.trustStatus).toBe('creator_claimed');
  });

  it('falls back to L3 if a disputed status (level 0) is requested', async () => {
    process.env['OPENTRUST_TRUST_STATUS'] = 'disputed';
    const claims = await resolveStdioClaims('http://localhost:8000');
    expect(claims.trustLevel).toBe(3);
  });

  it('validates a real passport token locally when OPENTRUST_JWT_SECRET is set', async () => {
    const secret = 'dev-secret';
    const realClaims = {
      passportId: 'p-real',
      agentId: 'agent-real',
      trustLevel: 4,
      trustStatus: 'community_reviewed',
      flags: [],
      isDisputed: false,
      version: '7',
    };
    process.env['OPENTRUST_JWT_SECRET'] = secret;
    process.env['OPENTRUST_PASSPORT_TOKEN'] = mintToken(realClaims, secret);

    const claims = await resolveStdioClaims('http://localhost:8000');
    expect(claims.passportId).toBe('p-real');
    expect(claims.agentId).toBe('agent-real');
    expect(claims.trustLevel).toBe(4);
    expect(claims.version).toBe('7');
  });
});
