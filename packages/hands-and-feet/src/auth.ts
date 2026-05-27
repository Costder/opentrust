import { createHmac } from 'crypto';
import type { PassportClaims } from './types.js';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new AuthError('Empty bearer token');
  return token;
}

/**
 * Verifies a JWT signed with HMAC-SHA256 using the given secret.
 * Returns parsed PassportClaims on success; throws AuthError on failure.
 */
function verifyLocalJwt(token: string, secret: string): PassportClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthError('Invalid JWT format', 401);
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  // Recompute the expected signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  if (expectedSig !== signatureB64) {
    throw new AuthError('Invalid JWT signature', 401);
  }

  // Decode payload
  const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf-8');
  return JSON.parse(payloadJson) as PassportClaims;
}

export async function validatePassport(
  token: string,
  registryUrl: string,
): Promise<PassportClaims> {
  // Dev/test local fallback: if OPENTRUST_JWT_SECRET is set, validate locally
  const jwtSecret = process.env['OPENTRUST_JWT_SECRET'];
  if (jwtSecret) {
    return verifyLocalJwt(token, jwtSecret);
  }

  let response: Response;
  try {
    response = await fetch(`${registryUrl}/api/v1/passports/validate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (e) {
    throw new AuthError(`Registry unreachable: ${String(e)}`);
  }

  if (response.status === 401) {
    throw new AuthError('Invalid passport token', 401);
  }
  if (response.status === 403) {
    const body = (await response.json()) as { reason?: string };
    throw new AuthError(`Passport revoked (${body.reason ?? 'unknown'})`, 403);
  }
  if (!response.ok) {
    throw new AuthError(`Registry error: ${response.status}`);
  }

  return response.json() as Promise<PassportClaims>;
}
