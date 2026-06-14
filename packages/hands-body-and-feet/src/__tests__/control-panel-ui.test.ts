import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(__dirname, '../control-panel/ui/index.html');
const html = readFileSync(htmlPath, 'utf-8');

// ── Kill switch ───────────────────────────────────────────────────────────────
describe('kill switch', () => {
  it('has a kill switch element', () => {
    expect(html).toMatch(/kill.switch|kill switch/i);
  });

  it('has data-testid="kill-switch"', () => {
    expect(html).toContain('data-testid="kill-switch"');
  });

  it('kill switch is styled as a danger/stop button', () => {
    expect(html).toMatch(/btn-danger|emergency|stop|halt/i);
  });
});

// ── Mission prompt ────────────────────────────────────────────────────────────
describe('mission prompt', () => {
  it('has a mission prompt section', () => {
    expect(html).toMatch(/mission.prompt|mission prompt/i);
  });

  it('has data-testid="mission-prompt"', () => {
    expect(html).toContain('data-testid="mission-prompt"');
  });

  it('includes a textarea for the mission', () => {
    expect(html).toContain('<textarea');
  });
});

// ── Operator roles ────────────────────────────────────────────────────────────
describe('operator roles', () => {
  it('includes Manager role', () => {
    expect(html).toMatch(/manager/i);
    expect(html).toContain('data-testid="role-manager"');
  });

  it('includes Operator role', () => {
    expect(html).toMatch(/\boperator\b/i);
    expect(html).toContain('data-testid="role-operator"');
  });

  it('includes Shopkeeper role', () => {
    expect(html).toMatch(/shopkeeper/i);
    expect(html).toContain('data-testid="role-shopkeeper"');
  });

  it('includes Founder role', () => {
    expect(html).toMatch(/founder/i);
    expect(html).toContain('data-testid="role-founder"');
  });
});

// ── Spend caps ────────────────────────────────────────────────────────────────
describe('spend caps', () => {
  it('has a spend caps section', () => {
    expect(html).toMatch(/spend.caps|spend cap/i);
    expect(html).toContain('data-testid="spend-caps-section"');
  });

  it('has per-call cap input', () => {
    expect(html).toContain('data-testid="spend-per-call"');
  });

  it('has daily cap input', () => {
    expect(html).toContain('data-testid="spend-daily"');
  });
});

// ── Strategy skill ────────────────────────────────────────────────────────────
describe('strategy skill', () => {
  it('has a strategy skill section', () => {
    expect(html).toMatch(/strategy.skill|strategy skill/i);
    expect(html).toContain('data-testid="strategy-section"');
  });

  it('has a strategy toggle', () => {
    expect(html).toContain('data-testid="strategy-toggle"');
  });
});

// ── Harnesses ─────────────────────────────────────────────────────────────────
describe('agent harnesses section', () => {
  it('has a harnesses section', () => {
    expect(html).toContain('data-testid="harnesses-section"');
  });
});

describe('hermes harness', () => {
  it('is present in the UI', () => {
    expect(html).toMatch(/hermes/i);
    expect(html).toContain('data-testid="harness-hermes"');
  });

  it('has a toggle', () => {
    expect(html).toContain('data-testid="harness-hermes-toggle"');
  });
});

describe('openclaw harness', () => {
  it('is present in the UI', () => {
    expect(html).toMatch(/openclaw/i);
    expect(html).toContain('data-testid="harness-openclaw"');
  });

  it('has a toggle', () => {
    expect(html).toContain('data-testid="harness-openclaw-toggle"');
  });
});

describe('codex harness', () => {
  it('is present in the UI', () => {
    expect(html).toMatch(/codex/i);
    expect(html).toContain('data-testid="harness-codex"');
  });

  it('has a toggle', () => {
    expect(html).toContain('data-testid="harness-codex-toggle"');
  });
});

describe('claude harness', () => {
  it('is present in the UI', () => {
    expect(html).toMatch(/claude/i);
    expect(html).toContain('data-testid="harness-claude"');
  });

  it('has a toggle', () => {
    expect(html).toContain('data-testid="harness-claude-toggle"');
  });

  it('shows social automation is off for Claude', () => {
    expect(html).toMatch(/social automation[:\s-]*(off|disabled|false)/i);
  });
});

// ── Local mode / no login ─────────────────────────────────────────────────────
describe('local mode', () => {
  it('has a local mode section', () => {
    expect(html).toMatch(/local.mode|no.login/i);
    expect(html).toContain('data-testid="local-mode-section"');
  });

  it('has a local mode toggle', () => {
    expect(html).toContain('data-testid="local-mode-toggle"');
  });

  it('mentions no login or offline operation', () => {
    expect(html).toMatch(/no.?cloud.login|no.login|offline|air.?gap/i);
  });
});

// ── OpenTrust integration ─────────────────────────────────────────────────────
describe('opentrust section', () => {
  it('has an opentrust section', () => {
    expect(html).toContain('data-testid="opentrust-section"');
  });

  it('includes marketplace', () => {
    expect(html).toMatch(/marketplace/i);
    expect(html).toContain('data-testid="ot-marketplace"');
  });

  it('includes passport workflow', () => {
    expect(html).toMatch(/passport/i);
    expect(html).toContain('data-testid="ot-passport"');
  });

  it('includes job posting', () => {
    expect(html).toMatch(/jobs?/i);
    expect(html).toContain('data-testid="ot-jobs"');
  });

  it('includes reviews', () => {
    expect(html).toMatch(/review/i);
    expect(html).toContain('data-testid="ot-reviews"');
  });

  it('has agent prompts for each workflow', () => {
    expect(html).toContain('data-testid="passport-prompt"');
    expect(html).toContain('data-testid="jobs-prompt"');
    expect(html).toContain('data-testid="reviews-prompt"');
  });

  it('has a registry URL input', () => {
    expect(html).toContain('data-testid="ot-registry-url"');
  });

  it('passport prompt mentions OpenTrust or passport', () => {
    const match = html.match(/data-testid="passport-prompt"[^>]*>([\s\S]*?)<\/blockquote>/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/passport|opentrust/i);
  });

  it('jobs prompt mentions budget or USDC', () => {
    const match = html.match(/data-testid="jobs-prompt"[^>]*>([\s\S]*?)<\/blockquote>/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/budget|usdc|job/i);
  });

  it('reviews prompt mentions audit or sandbox or review', () => {
    const match = html.match(/data-testid="reviews-prompt"[^>]*>([\s\S]*?)<\/blockquote>/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/audit|sandbox|review/i);
  });
});

// ── Status bar ────────────────────────────────────────────────────────────────
describe('status bar', () => {
  it('has a status bar', () => {
    expect(html).toContain('data-testid="status-bar"');
  });
});

// ── Script and style links ────────────────────────────────────────────────────
describe('resource links', () => {
  it('links styles.css from the served control panel asset path', () => {
    expect(html).toContain('href="/control-panel/styles.css"');
  });

  it('links app.js from the served control panel asset path', () => {
    expect(html).toContain('src="/control-panel/app.js"');
  });
});
