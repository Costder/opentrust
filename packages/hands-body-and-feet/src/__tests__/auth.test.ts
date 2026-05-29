import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { extractBearerToken, validatePassport, AuthError } from '../auth.js';
import type { PassportClaims } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(payload: PassportClaims, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const sampleClaims: PassportClaims = {
  passportId: 'passport-abc123',
  agentId: 'agent-xyz',
  trustLevel: 3,
  trustStatus: 'seller_confirmed',
  flags: [],
  isDisputed: false,
  version: '1',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// extractBearerToken
// ---------------------------------------------------------------------------

describe('extractBearerToken', () => {
  it('returns the token from a valid Bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('throws AuthError with statusCode 401 when header is missing', () => {
    try {
      extractBearerToken(undefined);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(401);
    }
  });

  it('throws AuthError for wrong prefix (Token instead of Bearer)', () => {
    expect(() => extractBearerToken('Token abc')).toThrow(AuthError);
  });

  it('throws AuthError when token is empty after "Bearer "', () => {
    expect(() => extractBearerToken('Bearer ')).toThrow(AuthError);
  });
});

// ---------------------------------------------------------------------------
// validatePassport — registry mode (no OPENTRUST_JWT_SECRET)
// ---------------------------------------------------------------------------

describe('validatePassport (registry mode)', () => {
  it('returns PassportClaims on 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleClaims,
    }));

    const result = await validatePassport('good-token', 'https://registry.example.com');
    expect(result).toEqual(sampleClaims);
  });

  it('throws AuthError with statusCode 401 on 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    }));

    await expect(validatePassport('bad-token', 'https://registry.example.com'))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws AuthError with statusCode 403 containing "revoked" on 403 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ reason: 'revoked' }),
    }));

    const err = await validatePassport('revoked-token', 'https://registry.example.com')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).statusCode).toBe(403);
    expect((err as AuthError).message).toContain('revoked');
  });

  it('throws AuthError containing "Registry unreachable" when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const err = await validatePassport('any-token', 'https://registry.example.com')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).message).toContain('Registry unreachable');
  });
});

// ---------------------------------------------------------------------------
// validatePassport — local JWT mode (OPENTRUST_JWT_SECRET is set)
// ---------------------------------------------------------------------------

describe('validatePassport (local JWT mode)', () => {
  const JWT_SECRET = 'test-secret-key';

  it('returns parsed PassportClaims for a valid JWT', async () => {
    vi.stubEnv('OPENTRUST_JWT_SECRET', JWT_SECRET);

    const token = makeJwt(sampleClaims, JWT_SECRET);
    const result = await validatePassport(token, 'https://registry.example.com');
    expect(result).toEqual(sampleClaims);
  });

  it('throws AuthError for a JWT with a tampered signature', async () => {
    vi.stubEnv('OPENTRUST_JWT_SECRET', JWT_SECRET);

    const validToken = makeJwt(sampleClaims, JWT_SECRET);
    // Replace the signature with a wrong one
    const [header, payload] = validToken.split('.');
    const tamperedToken = `${header}.${payload}.invalidsignature`;

    const err = await validatePassport(tamperedToken, 'https://registry.example.com')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as AuthError).statusCode).toBe(401);
    expect((err as AuthError).message).toContain('Invalid JWT signature');
  });
});
