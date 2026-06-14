import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock node:fs so we can control existsSync without touching the real filesystem
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { existsSync } from 'node:fs';
import { getCapabilityStatuses } from '../control-panel/capabilities.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExistsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Email ────────────────────────────────────────────────────────────────────
describe('email capability', () => {
  it('is always ready (local-smtp fallback)', () => {
    const { email } = getCapabilityStatuses({});
    expect(email.ready).toBe(true);
    expect(email.availableProviders).toContain('local-smtp');
  });

  it('detects AgentMail via AGENTMAIL_API_KEY', () => {
    const { email } = getCapabilityStatuses({ AGENTMAIL_API_KEY: 'key-xxx' });
    expect(email.availableProviders).toContain('agentmail');
    expect(email.provider).toBe('agentmail');
  });

  it('detects Postmark via POSTMARK_SERVER_TOKEN', () => {
    const { email } = getCapabilityStatuses({ POSTMARK_SERVER_TOKEN: 'tok-xxx' });
    expect(email.availableProviders).toContain('postmark');
  });

  it('detects Postmark via POSTMARK_API_KEY', () => {
    const { email } = getCapabilityStatuses({ POSTMARK_API_KEY: 'key-xxx' });
    expect(email.availableProviders).toContain('postmark');
  });

  it('detects Resend via RESEND_API_KEY', () => {
    const { email } = getCapabilityStatuses({ RESEND_API_KEY: 're_xxx' });
    expect(email.availableProviders).toContain('resend');
  });

  it('never returns raw env values', () => {
    const secret = 'super-secret-key-12345';
    const { email } = getCapabilityStatuses({ RESEND_API_KEY: secret });
    const json = JSON.stringify(email);
    expect(json).not.toContain(secret);
  });
});

// ── Phone ────────────────────────────────────────────────────────────────────
describe('phone capability', () => {
  it('is not ready with empty env', () => {
    const { phone } = getCapabilityStatuses({});
    expect(phone.ready).toBe(false);
    expect(phone.availableProviders).toHaveLength(0);
  });

  it('detects Twilio when both SID and token are set', () => {
    const { phone } = getCapabilityStatuses({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: 'tok',
    });
    expect(phone.ready).toBe(true);
    expect(phone.availableProviders).toContain('twilio');
  });

  it('does not detect Twilio with only SID (missing token)', () => {
    const { phone } = getCapabilityStatuses({ TWILIO_ACCOUNT_SID: 'ACxxx' });
    expect(phone.availableProviders).not.toContain('twilio');
  });

  it('detects SignalWire when all three vars are set', () => {
    const { phone } = getCapabilityStatuses({
      SIGNALWIRE_SPACE_URL: 'https://example.signalwire.com',
      SIGNALWIRE_PROJECT_ID: 'proj',
      SIGNALWIRE_API_KEY: 'key',
    });
    expect(phone.availableProviders).toContain('signalwire');
  });

  it('detects JMP via JMP_PASSWORD', () => {
    const { phone } = getCapabilityStatuses({ JMP_PASSWORD: 'pw' });
    expect(phone.availableProviders).toContain('jmp');
  });

  it('detects JMP via XMPP credentials', () => {
    const { phone } = getCapabilityStatuses({
      XMPP_JID: 'bot@example.com',
      XMPP_PASSWORD: 'pw',
    });
    expect(phone.availableProviders).toContain('jmp');
  });

  it('never returns raw env values', () => {
    const secret = 'tok-secret-abc';
    const { phone } = getCapabilityStatuses({
      TWILIO_ACCOUNT_SID: 'ACxxx',
      TWILIO_AUTH_TOKEN: secret,
    });
    expect(JSON.stringify(phone)).not.toContain(secret);
  });
});

// ── GitHub ───────────────────────────────────────────────────────────────────
describe('github capability', () => {
  it('is not ready without GITHUB_TOKEN', () => {
    const { github } = getCapabilityStatuses({});
    expect(github.ready).toBe(false);
  });

  it('is ready when GITHUB_TOKEN is set', () => {
    const { github } = getCapabilityStatuses({ GITHUB_TOKEN: 'ghp_xxx' });
    expect(github.ready).toBe(true);
    expect(github.availableProviders).toContain('github-token');
  });

  it('never returns raw token value', () => {
    const token = 'ghp_supersecret';
    const { github } = getCapabilityStatuses({ GITHUB_TOKEN: token });
    expect(JSON.stringify(github)).not.toContain(token);
  });
});

// ── Wallet / payments ────────────────────────────────────────────────────────
describe('wallet capability', () => {
  it('is not ready without credentials', () => {
    const { wallet } = getCapabilityStatuses({});
    expect(wallet.ready).toBe(false);
  });

  it('detects ethereum wallet via WALLET_PRIVATE_KEY', () => {
    const { wallet } = getCapabilityStatuses({ WALLET_PRIVATE_KEY: '0xdeadbeef' });
    expect(wallet.ready).toBe(true);
    expect(wallet.availableProviders).toContain('ethereum-wallet');
  });

  it('detects ethereum wallet via ETH_PRIVATE_KEY', () => {
    const { wallet } = getCapabilityStatuses({ ETH_PRIVATE_KEY: '0xdeadbeef' });
    expect(wallet.availableProviders).toContain('ethereum-wallet');
  });

  it('detects coinbase-commerce via key id + secret', () => {
    const { wallet } = getCapabilityStatuses({
      COINBASE_BUSINESS_API_KEY_ID: 'id-123',
      COINBASE_BUSINESS_API_KEY_SECRET: 'sec-456',
    });
    expect(wallet.availableProviders).toContain('coinbase-commerce');
  });

  it('detects coinbase-commerce via COINBASE_COMMERCE_API_KEY', () => {
    const { wallet } = getCapabilityStatuses({ COINBASE_COMMERCE_API_KEY: 'cbkey' });
    expect(wallet.availableProviders).toContain('coinbase-commerce');
  });

  it('never returns raw key values', () => {
    const key = '0xprivatekeyvalue';
    const { wallet } = getCapabilityStatuses({ WALLET_PRIVATE_KEY: key });
    expect(JSON.stringify(wallet)).not.toContain(key);
  });
});

// ── Virtual cards (Moon) ─────────────────────────────────────────────────────
describe('virtualCards capability', () => {
  it('is not ready without credentials', () => {
    const { virtualCards } = getCapabilityStatuses({});
    expect(virtualCards.ready).toBe(false);
  });

  it('detects Moon via MOON_API_KEY', () => {
    const { virtualCards } = getCapabilityStatuses({ MOON_API_KEY: 'moon-key' });
    expect(virtualCards.ready).toBe(true);
    expect(virtualCards.availableProviders).toContain('moon');
  });

  it('detects Moon via MOON_SECRET_KEY', () => {
    const { virtualCards } = getCapabilityStatuses({ MOON_SECRET_KEY: 'moon-secret' });
    expect(virtualCards.ready).toBe(true);
  });

  it('never returns raw key values', () => {
    const key = 'moon-secret-abc123';
    const { virtualCards } = getCapabilityStatuses({ MOON_API_KEY: key });
    expect(JSON.stringify(virtualCards)).not.toContain(key);
  });
});

// ── Docker ───────────────────────────────────────────────────────────────────
describe('docker capability', () => {
  it('is not ready when no socket and no DOCKER_HOST', () => {
    mockExistsSync.mockReturnValue(false);
    const { docker } = getCapabilityStatuses({});
    expect(docker.ready).toBe(false);
  });

  it('is ready when /var/run/docker.sock exists', () => {
    mockExistsSync.mockReturnValue(true);
    const { docker } = getCapabilityStatuses({});
    expect(docker.ready).toBe(true);
  });

  it('is ready when DOCKER_HOST is set', () => {
    mockExistsSync.mockReturnValue(false);
    const { docker } = getCapabilityStatuses({ DOCKER_HOST: 'tcp://localhost:2376' });
    expect(docker.ready).toBe(true);
    expect(docker.availableProviders).toContain('docker');
  });

  it('never exposes DOCKER_HOST value', () => {
    const host = 'tcp://my-secret-host:2376';
    const { docker } = getCapabilityStatuses({ DOCKER_HOST: host });
    expect(JSON.stringify(docker)).not.toContain(host);
  });
});

// ── Tunnel ───────────────────────────────────────────────────────────────────
describe('tunnel capability', () => {
  it('is always ready (cloudflared fallback)', () => {
    const { tunnel } = getCapabilityStatuses({});
    expect(tunnel.ready).toBe(true);
    expect(tunnel.availableProviders).toContain('cloudflared');
  });

  it('adds ngrok when NGROK_AUTHTOKEN is set', () => {
    const { tunnel } = getCapabilityStatuses({ NGROK_AUTHTOKEN: 'tok' });
    expect(tunnel.availableProviders).toContain('ngrok');
    expect(tunnel.provider).toBe('ngrok');
  });

  it('never exposes ngrok token', () => {
    const token = 'ngrok-token-secret-abc';
    const { tunnel } = getCapabilityStatuses({ NGROK_AUTHTOKEN: token });
    expect(JSON.stringify(tunnel)).not.toContain(token);
  });
});

// ── IPFS ─────────────────────────────────────────────────────────────────────
describe('ipfs capability', () => {
  it('includes local-kubo by default', () => {
    const { ipfs } = getCapabilityStatuses({});
    expect(ipfs.availableProviders).toContain('local-kubo');
  });

  it('detects web3.storage via WEB3_STORAGE_TOKEN', () => {
    const { ipfs } = getCapabilityStatuses({ WEB3_STORAGE_TOKEN: 'w3s-tok' });
    expect(ipfs.availableProviders).toContain('web3.storage');
  });

  it('detects web3.storage via W3_PRINCIPAL', () => {
    const { ipfs } = getCapabilityStatuses({ W3_PRINCIPAL: 'did:key:xxx' });
    expect(ipfs.availableProviders).toContain('web3.storage');
  });

  it('never exposes token values', () => {
    const tok = 'w3s-supersecret-12345';
    const { ipfs } = getCapabilityStatuses({ WEB3_STORAGE_TOKEN: tok });
    expect(JSON.stringify(ipfs)).not.toContain(tok);
  });
});

// ── Physical mail ─────────────────────────────────────────────────────────────
describe('physicalMail capability', () => {
  it('is not ready without credentials', () => {
    const { physicalMail } = getCapabilityStatuses({});
    expect(physicalMail.ready).toBe(false);
  });

  it('detects PostScan via POSTSCAN_API_KEY', () => {
    const { physicalMail } = getCapabilityStatuses({ POSTSCAN_API_KEY: 'ps-key' });
    expect(physicalMail.ready).toBe(true);
    expect(physicalMail.availableProviders).toContain('postscan');
  });

  it('detects PostScan via POSTSCANMAIL_API_KEY', () => {
    const { physicalMail } = getCapabilityStatuses({ POSTSCANMAIL_API_KEY: 'ps-key' });
    expect(physicalMail.availableProviders).toContain('postscan');
  });

  it('detects Earth Class Mail via EARTH_CLASS_MAIL_API_KEY', () => {
    const { physicalMail } = getCapabilityStatuses({ EARTH_CLASS_MAIL_API_KEY: 'ecm-key' });
    expect(physicalMail.availableProviders).toContain('earth-class-mail');
  });

  it('detects Earth Class Mail via ECM_API_KEY', () => {
    const { physicalMail } = getCapabilityStatuses({ ECM_API_KEY: 'ecm-key' });
    expect(physicalMail.availableProviders).toContain('earth-class-mail');
  });

  it('never returns raw key values', () => {
    const key = 'postscan-secret-key-xyz';
    const { physicalMail } = getCapabilityStatuses({ POSTSCAN_API_KEY: key });
    expect(JSON.stringify(physicalMail)).not.toContain(key);
  });
});

// ── Distribution ──────────────────────────────────────────────────────────────
describe('distribution capability', () => {
  it('is always ready (rss-feed fallback)', () => {
    const { distribution } = getCapabilityStatuses({});
    expect(distribution.ready).toBe(true);
    expect(distribution.availableProviders).toContain('rss-feed');
  });

  it('adds github-releases when GITHUB_TOKEN is set', () => {
    const { distribution } = getCapabilityStatuses({ GITHUB_TOKEN: 'tok' });
    expect(distribution.availableProviders).toContain('github-releases');
  });

  it('adds email-broadcast when email provider is set', () => {
    const { distribution } = getCapabilityStatuses({ RESEND_API_KEY: 'tok' });
    expect(distribution.availableProviders).toContain('email-broadcast');
  });

  it('adds ipfs-publish when IPFS is configured', () => {
    const { distribution } = getCapabilityStatuses({ WEB3_STORAGE_TOKEN: 'tok' });
    expect(distribution.availableProviders).toContain('ipfs-publish');
  });
});

// ── Return shape ─────────────────────────────────────────────────────────────
describe('getCapabilityStatuses shape', () => {
  it('returns all expected capability keys', () => {
    const statuses = getCapabilityStatuses({});
    expect(statuses).toHaveProperty('email');
    expect(statuses).toHaveProperty('phone');
    expect(statuses).toHaveProperty('github');
    expect(statuses).toHaveProperty('wallet');
    expect(statuses).toHaveProperty('virtualCards');
    expect(statuses).toHaveProperty('docker');
    expect(statuses).toHaveProperty('tunnel');
    expect(statuses).toHaveProperty('ipfs');
    expect(statuses).toHaveProperty('physicalMail');
    expect(statuses).toHaveProperty('distribution');
  });

  it('each capability has ready and availableProviders', () => {
    const statuses = getCapabilityStatuses({});
    for (const cap of Object.values(statuses)) {
      expect(typeof cap.ready).toBe('boolean');
      expect(Array.isArray(cap.availableProviders)).toBe(true);
    }
  });

  it('uses process.env as default', () => {
    // should not throw
    expect(() => getCapabilityStatuses()).not.toThrow();
  });
});
