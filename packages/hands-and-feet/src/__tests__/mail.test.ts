import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrustError } from '../trust.js';
import { SecretsError } from '../secrets.js';
import type { PassportClaims } from '../types.js';

// ────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────
vi.mock('../config.js', () => ({
  readConfig: vi.fn(),
  CONFIG_DIR: '/tmp/test-haf-mail',
  ensureConfigDir: vi.fn(),
}));

import { listMail, forwardMail, shredMail, scanMail } from '../capabilities/mail/index.js';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────
function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel: 3,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
    ...overrides,
  };
}

function makeL2Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' };
}

function makeL1Claims(): PassportClaims {
  return { ...makeL3Claims(), trustLevel: 1, trustStatus: 'auto_generated_draft' };
}

function setPostScanCreds() {
  process.env['POSTSCAN_API_KEY'] = 'test-api-key';
  process.env['POSTSCAN_ACCOUNT_ID'] = 'acct_123';
}

function clearMailCreds() {
  delete process.env['POSTSCAN_API_KEY'];
  delete process.env['POSTSCAN_ACCOUNT_ID'];
  delete process.env['EARTH_CLASS_MAIL_API_KEY'];
  delete process.env['EARTH_CLASS_MAIL_ACCOUNT_ID'];
}

beforeEach(() => {
  vi.clearAllMocks();
  setPostScanCreds();
});

afterEach(() => {
  clearMailCreds();
});

// ────────────────────────────────────────────────────────────
// list_mail
// ────────────────────────────────────────────────────────────
describe('list_mail', () => {
  it('throws TrustError for L1 caller (needs L2)', async () => {
    await expect(listMail({}, makeL1Claims())).rejects.toThrow(TrustError);
  });

  it('lists mail for L2 caller', async () => {
    const fakeMail = [{ id: 'm1', subject: 'Test Letter', status: 'new' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeMail),
    }));

    const result = await listMail({ limit: 5 }, makeL2Claims());
    expect(result.mail).toEqual(fakeMail);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/accounts/acct_123/mail'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }) }),
    );
    vi.unstubAllGlobals();
  });

  it('throws on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    }));

    await expect(listMail({}, makeL2Claims())).rejects.toThrow(/PostScan Mail API error/);
    vi.unstubAllGlobals();
  });
});

// ────────────────────────────────────────────────────────────
// forward_mail
// ────────────────────────────────────────────────────────────
describe('forward_mail', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(
      forwardMail({ mail_id: 'm1', address: '123 Main St' }, makeL2Claims()),
    ).rejects.toThrow(TrustError);
  });

  it('forwards mail for L3 caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }));

    const result = await forwardMail({ mail_id: 'm1', address: '123 Main St, Springfield, IL' }, makeL3Claims());
    expect(result.mail_id).toBe('m1');
    expect(result.forwarded).toBe(true);
    expect(result.address).toBe('123 Main St, Springfield, IL');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/mail/m1/forward'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to_address: '123 Main St, Springfield, IL' }),
      }),
    );
    vi.unstubAllGlobals();
  });
});

// ────────────────────────────────────────────────────────────
// shred_mail
// ────────────────────────────────────────────────────────────
describe('shred_mail', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(shredMail({ mail_id: 'm1' }, makeL2Claims())).rejects.toThrow(TrustError);
  });

  it('shreds mail for L3 caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }));

    const result = await shredMail({ mail_id: 'm2' }, makeL3Claims());
    expect(result.mail_id).toBe('m2');
    expect(result.shredded).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/mail/m2/shred'),
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });
});

// ────────────────────────────────────────────────────────────
// scan_mail
// ────────────────────────────────────────────────────────────
describe('scan_mail', () => {
  it('throws TrustError for L2 caller (needs L3)', async () => {
    await expect(scanMail({ mail_id: 'm1' }, makeL2Claims())).rejects.toThrow(TrustError);
  });

  it('requests scan for L3 caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }));

    const result = await scanMail({ mail_id: 'm3' }, makeL3Claims());
    expect(result.mail_id).toBe('m3');
    expect(result.scan_requested).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/mail/m3/scan'),
      expect.objectContaining({ method: 'POST' }),
    );
    vi.unstubAllGlobals();
  });
});

// ────────────────────────────────────────────────────────────
// Missing credentials
// ────────────────────────────────────────────────────────────
describe('missing credentials', () => {
  it('throws SecretsError when no credentials are set', async () => {
    clearMailCreds();
    await expect(listMail({}, makeL2Claims())).rejects.toThrow(SecretsError);
  });

  it('uses Earth Class Mail fallback when EARTH_CLASS_MAIL_API_KEY is set', async () => {
    clearMailCreds();
    process.env['EARTH_CLASS_MAIL_API_KEY'] = 'ec-key-123';
    process.env['EARTH_CLASS_MAIL_ACCOUNT_ID'] = 'ec-acct-456';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    const result = await listMail({}, makeL2Claims());
    expect(result.mail).toEqual([]);
    // Should call Earth Class Mail URL
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('earthclassmail.com'),
      expect.anything(),
    );
    vi.unstubAllGlobals();
  });
});
