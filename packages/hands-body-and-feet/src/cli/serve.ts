import type { CommandModule } from 'yargs';
import { readConfig } from '../config.js';
import { startServer } from '../server.js';
import { openUrl } from '../control-panel/open-browser.js';

const serve: CommandModule = {
  command: 'serve',
  describe: 'Start the Hands and Feet MCP server on port 3847',
  builder: (y) =>
    y
      .option('port', {
        type: 'number',
        default: 3847,
        describe: 'HTTP port to listen on',
      })
      .option('allow-local-fallback', {
        type: 'boolean',
        default: false,
        describe: 'Allow starting even if registry is unreachable',
      })
      .option('open', {
        type: 'boolean',
        default: true,
        describe: 'Open the Agent OS control panel in your browser on start (use --no-open to disable)',
      }),
  handler: async (argv) => {
    const cfg = readConfig();

    if (argv['allow-local-fallback']) {
      console.warn(
        '\n⚠️  WARNING: --allow-local-fallback enabled. ' +
        'Secrets will be used from local files if registry is unreachable.\n',
      );
    }

    const port = argv['port'] as number;
    const httpServer = await startServer({
      registryUrl: cfg.registryUrl,
      port,
    });

    const controlPanelUrl = `http://localhost:${port}/control`;
    console.log(`Agent OS control panel: ${controlPanelUrl}`);
    if (argv['open'] !== false) {
      openUrl(controlPanelUrl);
    }

    // Graceful shutdown
    const shutdown = () => {
      console.log('\nShutting down...');
      httpServer.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },
};

export default serve;
