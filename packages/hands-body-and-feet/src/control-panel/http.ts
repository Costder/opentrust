import express from 'express';
import type { Server } from 'node:http';
import { registerControlPanelRoutes } from './routes.js';
import { seedControlPanelDemoIfEmpty } from './seed.js';

/**
 * Shared, on-demand control panel HTTP server.
 *
 * The control panel is normally part of the full `serve` app, but MCP clients
 * launch the server over stdio (no HTTP). This lets stdio mode, the `open`
 * command, and the `open_control_panel` tool all bring the panel up at a
 * stable URL without each reinventing it. It is a process-wide singleton and
 * binds loopback only.
 */

function defaultPort(): number {
  const raw = process.env['HBF_CONTROL_PANEL_PORT'] ?? process.env['HBF_PORT'] ?? '3847';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3847;
}

let panelServer: Server | null = null;
let panelPort: number | null = null;

export function controlPanelUrl(port?: number): string {
  return `http://localhost:${port ?? panelPort ?? defaultPort()}/control`;
}

export interface EnsureControlPanelResult {
  url: string;
  port: number;
  started: boolean; // we started it in this process
  alreadyRunning: boolean; // another HBF process already owns the port
}

/**
 * Ensure a control panel HTTP server is reachable. Idempotent: if this process
 * already started one, returns it; if the port is already taken (another HBF
 * `serve`/`stdio` instance), reports it as already running.
 */
export async function ensureControlPanelServer(opts?: {
  registryUrl?: string;
  port?: number;
}): Promise<EnsureControlPanelResult> {
  const port = opts?.port ?? defaultPort();

  if (panelServer && panelPort === port) {
    return { url: controlPanelUrl(port), port, started: false, alreadyRunning: true };
  }

  const registryUrl = opts?.registryUrl ?? process.env['OPENTRUST_REGISTRY_URL'] ?? 'https://opentrust.sh';
  const app = express();
  app.use(express.json());
  registerControlPanelRoutes(app, { registryUrl });
  try {
    seedControlPanelDemoIfEmpty();
  } catch {
    /* seeding is best-effort */
  }

  return await new Promise<EnsureControlPanelResult>((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      panelServer = server;
      panelPort = port;
      resolve({ url: controlPanelUrl(port), port, started: true, alreadyRunning: false });
    });
    server.on('error', (e: NodeJS.ErrnoException) => {
      resolve({
        url: controlPanelUrl(port),
        port,
        started: false,
        alreadyRunning: e.code === 'EADDRINUSE',
      });
    });
  });
}
