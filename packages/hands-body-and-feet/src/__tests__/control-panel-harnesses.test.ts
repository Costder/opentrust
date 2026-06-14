import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock node:fs so existsSync never hits the real filesystem
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { existsSync } from 'node:fs';
import { getHarnessStatuses } from '../control-panel/harnesses.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExistsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Return shape ─────────────────────────────────────────────────────────────
describe('getHarnessStatuses shape', () => {
  it('returns all four harness keys', () => {
    const s = getHarnessStatuses({});
    expect(s).toHaveProperty('hermes');
    expect(s).toHaveProperty('openclaw');
    expect(s).toHaveProperty('codex');
    expect(s).toHaveProperty('claude');
  });

  it('each harness has required fields', () => {
    const s = getHarnessStatuses({});
    for (const h of Object.values(s)) {
      expect(typeof h.id).toBe('string');
      expect(typeof h.name).toBe('string');
      expect(typeof h.ready).toBe('boolean');
      expect(typeof h.dayOne).toBe('boolean');
      expect(typeof h.unattendedAllowed).toBe('boolean');
      expect(typeof h.socialAutomationAllowed).toBe('boolean');
    }
  });

  it('uses process.env as default', () => {
    expect(() => getHarnessStatuses()).not.toThrow();
  });
});

// ── dayOne and unattendedAllowed ─────────────────────────────────────────────
describe('dayOne and unattendedAllowed', () => {
  it('are true for all harnesses', () => {
    const s = getHarnessStatuses({});
    for (const h of Object.values(s)) {
      expect(h.dayOne).toBe(true);
      expect(h.unattendedAllowed).toBe(true);
    }
  });
});

// ── socialAutomationAllowed ───────────────────────────────────────────────────
describe('socialAutomationAllowed', () => {
  it('is false only for Claude', () => {
    const s = getHarnessStatuses({});
    expect(s.hermes.socialAutomationAllowed).toBe(true);
    expect(s.openclaw.socialAutomationAllowed).toBe(true);
    expect(s.codex.socialAutomationAllowed).toBe(true);
    expect(s.claude.socialAutomationAllowed).toBe(false);
  });
});

// ── IDs and names ─────────────────────────────────────────────────────────────
describe('harness identifiers', () => {
  it('hermes has correct id and name', () => {
    const { hermes } = getHarnessStatuses({});
    expect(hermes.id).toBe('hermes');
    expect(hermes.name).toMatch(/hermes/i);
  });

  it('openclaw has correct id and name', () => {
    const { openclaw } = getHarnessStatuses({});
    expect(openclaw.id).toBe('openclaw');
    expect(openclaw.name).toMatch(/openclaw/i);
  });

  it('codex has correct id and name', () => {
    const { codex } = getHarnessStatuses({});
    expect(codex.id).toBe('codex');
    expect(codex.name).toMatch(/codex/i);
  });

  it('claude has correct id and name', () => {
    const { claude } = getHarnessStatuses({});
    expect(claude.id).toBe('claude');
    expect(claude.name).toMatch(/claude/i);
  });
});

// ── Hermes detection ──────────────────────────────────────────────────────────
describe('hermes harness', () => {
  it('is not ready with empty env and no path hits', () => {
    mockExistsSync.mockReturnValue(false);
    const { hermes } = getHarnessStatuses({});
    expect(hermes.ready).toBe(false);
  });

  it('is ready when XMPP_JID and XMPP_PASSWORD are set', () => {
    const { hermes } = getHarnessStatuses({
      XMPP_JID: 'bot@jabber.org',
      XMPP_PASSWORD: 'pw',
    });
    expect(hermes.ready).toBe(true);
  });

  it('is ready when HERMES_URL is set', () => {
    const { hermes } = getHarnessStatuses({ HERMES_URL: 'https://hermes.example.com' });
    expect(hermes.ready).toBe(true);
  });

  it('is ready when HERMES_API_URL is set', () => {
    const { hermes } = getHarnessStatuses({ HERMES_API_URL: 'https://api.hermes.example.com' });
    expect(hermes.ready).toBe(true);
  });

  it('does not expose raw credential values', () => {
    const pw = 'super-secret-xmpp-password';
    const { hermes } = getHarnessStatuses({
      XMPP_JID: 'bot@jabber.org',
      XMPP_PASSWORD: pw,
    });
    expect(JSON.stringify(hermes)).not.toContain(pw);
  });

  it('only uses XMPP_JID (not ready without password)', () => {
    const { hermes } = getHarnessStatuses({ XMPP_JID: 'bot@jabber.org' });
    expect(hermes.ready).toBe(false);
  });
});

// ── OpenClaw detection ────────────────────────────────────────────────────────
describe('openclaw harness', () => {
  it('is not ready with empty env and no path hits', () => {
    mockExistsSync.mockReturnValue(false);
    const { openclaw } = getHarnessStatuses({});
    expect(openclaw.ready).toBe(false);
  });

  it('is ready when OPENCLAW_URL is set', () => {
    const { openclaw } = getHarnessStatuses({ OPENCLAW_URL: 'http://localhost:9000' });
    expect(openclaw.ready).toBe(true);
  });

  it('is ready when OPENCLAW_API_URL is set', () => {
    const { openclaw } = getHarnessStatuses({ OPENCLAW_API_URL: 'http://localhost:9001' });
    expect(openclaw.ready).toBe(true);
  });

  it('is ready when OPENCLAW_API_KEY is set', () => {
    const { openclaw } = getHarnessStatuses({ OPENCLAW_API_KEY: 'key-abc' });
    expect(openclaw.ready).toBe(true);
  });

  it('is ready when OPENCLAW_CLI_PATH is set', () => {
    const { openclaw } = getHarnessStatuses({ OPENCLAW_CLI_PATH: '/usr/local/bin/openclaw' });
    expect(openclaw.ready).toBe(true);
  });

  it('is ready when openclaw binary is found on PATH', () => {
    mockExistsSync.mockImplementation((p: string) => typeof p === 'string' && p.includes('openclaw'));
    const { openclaw } = getHarnessStatuses({ PATH: '/usr/local/bin:/usr/bin' });
    expect(openclaw.ready).toBe(true);
  });
});

// ── Codex detection ───────────────────────────────────────────────────────────
describe('codex harness', () => {
  it('is not ready with empty env and no path hits', () => {
    mockExistsSync.mockReturnValue(false);
    const { codex } = getHarnessStatuses({});
    expect(codex.ready).toBe(false);
  });

  it('is ready when OPENAI_API_KEY is set', () => {
    const { codex } = getHarnessStatuses({ OPENAI_API_KEY: 'sk-xxx' });
    expect(codex.ready).toBe(true);
  });

  it('is ready when CODEX_CLI_PATH is set', () => {
    const { codex } = getHarnessStatuses({ CODEX_CLI_PATH: '/usr/local/bin/codex' });
    expect(codex.ready).toBe(true);
  });

  it('is ready when codex binary is found on PATH', () => {
    mockExistsSync.mockImplementation((p: string) => typeof p === 'string' && p.includes('codex'));
    const { codex } = getHarnessStatuses({ PATH: '/usr/local/bin:/usr/bin' });
    expect(codex.ready).toBe(true);
  });

  it('never exposes OPENAI_API_KEY value', () => {
    const key = 'sk-super-secret-openai-key';
    const { codex } = getHarnessStatuses({ OPENAI_API_KEY: key });
    expect(JSON.stringify(codex)).not.toContain(key);
  });
});

// ── Claude detection ──────────────────────────────────────────────────────────
describe('claude harness', () => {
  it('is not ready with empty env and no path hits', () => {
    mockExistsSync.mockReturnValue(false);
    const { claude } = getHarnessStatuses({});
    expect(claude.ready).toBe(false);
  });

  it('is ready when ANTHROPIC_API_KEY is set', () => {
    const { claude } = getHarnessStatuses({ ANTHROPIC_API_KEY: 'sk-ant-xxx' });
    expect(claude.ready).toBe(true);
  });

  it('is ready when CLAUDE_CLI_PATH is set', () => {
    const { claude } = getHarnessStatuses({ CLAUDE_CLI_PATH: '/usr/local/bin/claude' });
    expect(claude.ready).toBe(true);
  });

  it('is ready when claude binary is found on PATH', () => {
    mockExistsSync.mockImplementation((p: string) => typeof p === 'string' && p.includes('claude'));
    const { claude } = getHarnessStatuses({ PATH: '/usr/local/bin:/usr/bin' });
    expect(claude.ready).toBe(true);
  });

  it('never exposes ANTHROPIC_API_KEY value', () => {
    const key = 'sk-ant-super-secret-key';
    const { claude } = getHarnessStatuses({ ANTHROPIC_API_KEY: key });
    expect(JSON.stringify(claude)).not.toContain(key);
  });

  it('has socialAutomationAllowed=false regardless of env', () => {
    const envs = [
      {},
      { ANTHROPIC_API_KEY: 'key' },
      { CLAUDE_CLI_PATH: '/bin/claude' },
    ];
    for (const env of envs) {
      expect(getHarnessStatuses(env).claude.socialAutomationAllowed).toBe(false);
    }
  });
});
