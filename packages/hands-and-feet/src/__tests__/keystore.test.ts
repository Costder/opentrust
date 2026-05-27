import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// tempDir must be initialized before the mock factory runs, because keystore.ts
// computes getKeystorePath() lazily (function call), but config.ts CONFIG_DIR
// is read at import time. We set a placeholder and update in beforeEach.
// ---------------------------------------------------------------------------

// Use a stable temp root that we can direct CONFIG_DIR to before any import
const TEST_TMP_ROOT = mkdtempSync(join(tmpdir(), 'haf-keystore-root-'));
let tempDir = TEST_TMP_ROOT;

vi.mock('../config.js', () => ({
  get CONFIG_DIR() { return tempDir; },
  ensureConfigDir: vi.fn(() => {
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  }),
}));

// Import after mock
import {
  encryptData,
  decryptData,
  loadKeystore,
  saveKeystore,
  addWallet,
  getWallet,
  type WalletEntry,
} from '../keystore.js';

function makeEntry(label: string): WalletEntry {
  return {
    label,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    chains: ['base'],
    gasReserveUsdc: 5,
    dailyCapUsdc: 100,
    maxPerCallUsdc: 50,
    createdAt: new Date().toISOString(),
  };
}

describe('keystore', () => {
  beforeEach(() => {
    // Create a fresh temp dir for each test and point CONFIG_DIR at it
    tempDir = mkdtempSync(join(tmpdir(), 'haf-keystore-test-'));
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // encrypt / decrypt round-trip
  // -------------------------------------------------------------------------

  it('encryptData + decryptData round-trip preserves data', () => {
    const data = JSON.stringify({ foo: 'bar', num: 42 });
    const encrypted = encryptData(data, 'my-passphrase');
    const decrypted = decryptData(encrypted, 'my-passphrase');
    expect(decrypted).toBe(data);
  });

  it('decryptData throws with wrong passphrase (GCM auth tag failure)', () => {
    const data = 'secret wallet data';
    const encrypted = encryptData(data, 'correct-passphrase');
    expect(() => decryptData(encrypted, 'wrong-passphrase')).toThrow();
  });

  it('encryptData produces different ciphertext each call (random IV)', () => {
    const data = 'same data';
    const enc1 = encryptData(data, 'pass');
    const enc2 = encryptData(data, 'pass');
    expect(enc1).not.toBe(enc2);
  });

  // -------------------------------------------------------------------------
  // loadKeystore
  // -------------------------------------------------------------------------

  it('loadKeystore returns [] when keystore file is absent', () => {
    const entries = loadKeystore('any-passphrase');
    expect(entries).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // addWallet + loadKeystore round-trip
  // -------------------------------------------------------------------------

  it('addWallet stores entry and loadKeystore retrieves it', () => {
    const entry = makeEntry('my-wallet');
    addWallet(entry, 'pass123');
    const loaded = loadKeystore('pass123');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      label: 'my-wallet',
      chains: ['base'],
      gasReserveUsdc: 5,
    });
    expect(loaded[0].privateKey).toBe(entry.privateKey);
  });

  it('addWallet can store multiple wallets', () => {
    addWallet(makeEntry('wallet-a'), 'pass');
    addWallet(makeEntry('wallet-b'), 'pass');
    const loaded = loadKeystore('pass');
    expect(loaded).toHaveLength(2);
    expect(loaded.map(e => e.label)).toEqual(['wallet-a', 'wallet-b']);
  });

  // -------------------------------------------------------------------------
  // addWallet duplicate label throws
  // -------------------------------------------------------------------------

  it('addWallet throws when a wallet with the same label already exists', () => {
    addWallet(makeEntry('dup'), 'pass');
    expect(() => addWallet(makeEntry('dup'), 'pass')).toThrow(
      'Wallet with label "dup" already exists',
    );
  });

  // -------------------------------------------------------------------------
  // getWallet
  // -------------------------------------------------------------------------

  it('getWallet returns the matching entry by label', () => {
    addWallet(makeEntry('find-me'), 'pass');
    addWallet(makeEntry('other'), 'pass');
    const found = getWallet('find-me', 'pass');
    expect(found).toBeDefined();
    expect(found!.label).toBe('find-me');
  });

  it('getWallet returns undefined for unknown label', () => {
    addWallet(makeEntry('exists'), 'pass');
    expect(getWallet('missing', 'pass')).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // saveKeystore / loadKeystore encrypt-then-decrypt
  // -------------------------------------------------------------------------

  it('saveKeystore encrypted file cannot be loaded with wrong passphrase', () => {
    const entries: WalletEntry[] = [makeEntry('test')];
    saveKeystore(entries, 'correct');
    expect(() => loadKeystore('wrong')).toThrow();
  });
});
