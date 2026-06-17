import { ensureControlPanelServer } from '../../control-panel/http.js';
import { openUrl } from '../../control-panel/open-browser.js';

export const CONTROL_PANEL_TOOLS = {
  open_control_panel: { name: 'open_control_panel' as const },
};

export interface OpenControlPanelArgs {
  open_browser?: boolean;
  registry_url?: string;
  port?: number;
}

export interface OpenControlPanelResult {
  url: string;
  server_started: boolean;
  already_running: boolean;
  browser_opened: boolean;
  message: string;
}

/**
 * Bring the Agent OS control panel up (starting the local HTTP server if it is
 * not already running) and open it in the user's browser. Safe local action —
 * only ever opens the fixed loopback control panel URL.
 */
export async function openControlPanel(args: OpenControlPanelArgs = {}): Promise<OpenControlPanelResult> {
  const ensured = await ensureControlPanelServer({ registryUrl: args.registry_url, port: args.port });
  const shouldOpen = args.open_browser !== false;
  const browserOpened = shouldOpen ? openUrl(ensured.url) : false;
  return {
    url: ensured.url,
    server_started: ensured.started,
    already_running: ensured.alreadyRunning,
    browser_opened: browserOpened,
    message:
      `Agent OS control panel is available at ${ensured.url}` +
      (browserOpened ? ' and is opening in your browser.' : '.'),
  };
}
