import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { enforceTrust } from '../../trust.js';
import { openDb } from '../../spend-tracker.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ────────────────────────────────────────────────────────────
// Tool definitions
// ────────────────────────────────────────────────────────────
const CREATE_TUNNEL_TOOL: ToolDefinition = { name: 'create_tunnel', minTrustLevel: 3 };
const GET_TUNNEL_URL_TOOL: ToolDefinition = { name: 'get_tunnel_url', minTrustLevel: 2 };
const CLOSE_TUNNEL_TOOL: ToolDefinition = { name: 'close_tunnel', minTrustLevel: 3 };

export const TUNNEL_TOOLS = {
  create_tunnel: CREATE_TUNNEL_TOOL,
  get_tunnel_url: GET_TUNNEL_URL_TOOL,
  close_tunnel: CLOSE_TUNNEL_TOOL,
};

// ────────────────────────────────────────────────────────────
// In-memory registry
// ────────────────────────────────────────────────────────────
interface TunnelEntry {
  label: string;
  tunnelId: string;
  provider: 'cloudflared' | 'ngrok';
  url: string;
  port: number;
  process?: ChildProcess;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session?: any;
}

const activeTunnels = new Map<string, TunnelEntry>();

// ────────────────────────────────────────────────────────────
// Cloudflared provider
// ────────────────────────────────────────────────────────────
async function cloudflaredCreate(
  port: number,
  label: string,
): Promise<{ url: string; tunnelId: string; process: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error('cloudflared: timed out waiting for tunnel URL (30s)'));
      }
    }, 30_000);

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ url: match[0], tunnelId: `cf-${label}-${randomUUID().slice(0, 8)}`, process: proc });
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    proc.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error(`cloudflared exited with code ${code} before providing URL`));
      }
    });
  });
}

// ────────────────────────────────────────────────────────────
// Ngrok provider
// ────────────────────────────────────────────────────────────
async function ngrokCreate(
  port: number,
  label: string,
): Promise<{ url: string; tunnelId: string; session: unknown }> {
  // Dynamic import to avoid import-time side-effects
  const ngrok = await import('@ngrok/ngrok');
  const listener = await ngrok.forward({ addr: port });
  const url = listener.url();
  if (!url) throw new Error('ngrok: no URL returned from forward()');
  return {
    url,
    tunnelId: `ng-${label}-${randomUUID().slice(0, 8)}`,
    session: listener,
  };
}

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────
export async function createTunnel(
  params: { port: number; label?: string; provider?: 'cloudflared' | 'ngrok' },
  claims: PassportClaims,
): Promise<{ label: string; url: string; tunnelId: string; provider: string }> {
  enforceTrust(claims, CREATE_TUNNEL_TOOL);

  const label = params.label ?? `tunnel-${randomUUID().slice(0, 8)}`;
  const provider = params.provider ?? 'cloudflared';

  const db = openDb();
  // Check for existing open tunnel with same label
  const existing = db
    .prepare('SELECT * FROM tunnels WHERE label = ? AND closed_at IS NULL')
    .get(label) as { url: string; tunnel_id: string; provider: string } | undefined;
  if (existing) {
    return { label, url: existing.url, tunnelId: existing.tunnel_id, provider: existing.provider };
  }

  let entry: TunnelEntry;

  if (provider === 'cloudflared') {
    const result = await cloudflaredCreate(params.port, label);
    entry = {
      label,
      tunnelId: result.tunnelId,
      provider,
      url: result.url,
      port: params.port,
      process: result.process,
    };
  } else {
    const result = await ngrokCreate(params.port, label);
    entry = {
      label,
      tunnelId: result.tunnelId,
      provider,
      url: result.url,
      port: params.port,
      session: result.session,
    };
  }

  activeTunnels.set(label, entry);

  db.prepare(`
    INSERT OR REPLACE INTO tunnels (label, tunnel_id, provider, url, port, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(label, entry.tunnelId, provider, entry.url, params.port, new Date().toISOString());

  return { label, url: entry.url, tunnelId: entry.tunnelId, provider };
}

export async function getTunnelUrl(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; url: string | null }> {
  enforceTrust(claims, GET_TUNNEL_URL_TOOL);

  const db = openDb();
  const row = db
    .prepare('SELECT url FROM tunnels WHERE label = ? AND closed_at IS NULL')
    .get(params.label) as { url: string } | undefined;

  return { label: params.label, url: row?.url ?? null };
}

export async function closeTunnel(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; closed: boolean }> {
  enforceTrust(claims, CLOSE_TUNNEL_TOOL);

  const entry = activeTunnels.get(params.label);
  if (entry) {
    if (entry.process) {
      entry.process.kill();
    }
    if (entry.session && typeof (entry.session as { close?: () => void }).close === 'function') {
      await (entry.session as { close: () => Promise<void> }).close();
    }
    activeTunnels.delete(params.label);
  }

  const db = openDb();
  db.prepare('UPDATE tunnels SET closed_at = ? WHERE label = ? AND closed_at IS NULL')
    .run(new Date().toISOString(), params.label);

  return { label: params.label, closed: true };
}
