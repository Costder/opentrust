import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hashPassphrase, verifyPassphrase, isPaused, pause, resume } from '../state.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hands-body-and-feet-state-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// hashPassphrase
// ---------------------------------------------------------------------------

describe('hashPassphrase', () => {
  it('returns a string starting with "pbkdf2:sha256:"', () => {
    const hash = hashPassphrase('my-passphrase');
    expect(hash).toMatch(/^pbkdf2:sha256:/);
  });

  it('two calls with the same passphrase produce different hashes (different salts)', () => {
    const hash1 = hashPassphrase('same-passphrase');
    const hash2 = hashPassphrase('same-passphrase');
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// verifyPassphrase
// ---------------------------------------------------------------------------

describe('verifyPassphrase', () => {
  it('returns true for the correct passphrase', () => {
    const passphrase = 'correct-horse-battery-staple';
    const stored = hashPassphrase(passphrase);
    expect(verifyPassphrase(passphrase, stored)).toBe(true);
  });

  it('returns false for a wrong passphrase', () => {
    const stored = hashPassphrase('correct-passphrase');
    expect(verifyPassphrase('wrong-passphrase', stored)).toBe(false);
  });

  it('returns false for a malformed stored hash', () => {
    expect(verifyPassphrase('any-passphrase', 'not-a-valid-hash')).toBe(false);
  });

  it('returns false for a stored hash with wrong prefix', () => {
    expect(verifyPassphrase('any-passphrase', 'md5:sha256:somesalt:somehash')).toBe(false);
  });

  it('returns false for a stored hash that is empty', () => {
    expect(verifyPassphrase('any-passphrase', '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPaused / pause / resume
// ---------------------------------------------------------------------------

describe('isPaused', () => {
  it('returns false when no state file exists', () => {
    expect(isPaused(tempDir)).toBe(false);
  });
});

describe('pause', () => {
  it('makes isPaused() return true', () => {
    pause('test-instance', tempDir);
    expect(isPaused(tempDir)).toBe(true);
  });

  it('returns a state object with paused: true, pausedAt set, pausedBy set', () => {
    const before = Date.now();
    const state = pause('instance-abc', tempDir);
    const after = Date.now();

    expect(state.paused).toBe(true);
    expect(typeof state.pausedAt).toBe('string');
    expect(state.pausedBy).toBe('instance-abc');

    // Verify pausedAt is a valid ISO timestamp within the test window
    const ts = new Date(state.pausedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('resume', () => {
  it('makes isPaused() return false after pausing', () => {
    pause('test-instance', tempDir);
    resume('test-instance', tempDir);
    expect(isPaused(tempDir)).toBe(false);
  });

  it('returns a state object with paused: false and resumedAt set', () => {
    pause('test-instance', tempDir);
    const before = Date.now();
    const state = resume('test-instance', tempDir);
    const after = Date.now();

    expect(state.paused).toBe(false);
    expect(typeof state.resumedAt).toBe('string');

    const ts = new Date(state.resumedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
