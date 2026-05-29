import { createHmac, pbkdf2Sync, randomBytes } from 'crypto';
import { readState, writeState } from './config.js';
import type { KillSwitchState } from './types.js';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

/** Creates a passphrase hash string stored in config for kill-switch verification */
export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2:sha256:${salt}:${hash.toString('hex')}`;
}

/** Verifies a passphrase against the stored hash. Constant-time comparison. */
export function verifyPassphrase(passphrase: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const salt = parts[2];
  const expected = parts[3];
  if (!salt || !expected) return false;
  const hash = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  // Constant-time comparison via HMAC with ephemeral key
  const hashHex = hash.toString('hex');
  const keyBuf = randomBytes(32);
  const a = createHmac('sha256', keyBuf).update(hashHex).digest();
  const b = createHmac('sha256', keyBuf).update(expected).digest();
  return a.equals(b);
}

export function isPaused(configDir?: string): boolean {
  return readState(configDir).paused;
}

export function pause(instanceId: string, configDir?: string): KillSwitchState {
  const state: KillSwitchState = {
    paused: true,
    pausedAt: new Date().toISOString(),
    pausedBy: instanceId,
  };
  writeState(state, configDir);
  return state;
}

export function resume(instanceId: string, configDir?: string): KillSwitchState {
  const state: KillSwitchState = {
    paused: false,
    resumedAt: new Date().toISOString(),
  };
  writeState(state, configDir);
  return state;
}
