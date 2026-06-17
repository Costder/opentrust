import type { CommandModule } from 'yargs';
import { configExists, readConfig, ensureConfigDir, DEFAULT_REGISTRY_URL } from '../config.js';
import { ensureControlPanelServer } from '../control-panel/http.js';
import { openUrl } from '../control-panel/open-browser.js';

const open: CommandModule = {
  command: 'open',
  describe: 'Open the Agent OS control panel in your browser (starts the local server if needed)',
  builder: (y) =>
    y.option('port', {
      type: 'number',
      default: 3847,
      describe: 'Port the control panel runs on',
    }),
  handler: async (argv) => {
    ensureConfigDir();

    let registryUrl = DEFAULT_REGISTRY_URL;
    if (configExists()) {
      try {
        registryUrl = readConfig().registryUrl || DEFAULT_REGISTRY_URL;
      } catch {
        // Malformed config — fall back to default.
      }
    }

    const result = await ensureControlPanelServer({ registryUrl, port: argv['port'] as number });
    console.log(`Agent OS control panel: ${result.url}`);
    openUrl(result.url);

    if (result.started) {
      // We own the server in this process — keep it alive until interrupted.
      console.log('Serving the control panel. Press Ctrl+C to stop.');
      const shutdown = (): void => process.exit(0);
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      await new Promise<void>(() => {});
    } else if (result.alreadyRunning) {
      console.log('Control panel already running — opened in your browser.');
    }
  },
};

export default open;
