import type { CommandModule } from 'yargs';
import { readConfig } from '../config.js';
import { startServer } from '../server.js';

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
      }),
  handler: async (argv) => {
    const cfg = readConfig();

    if (argv['allow-local-fallback']) {
      console.warn(
        '\n⚠️  WARNING: --allow-local-fallback enabled. ' +
        'Secrets will be used from local files if registry is unreachable.\n',
      );
    }

    const httpServer = await startServer({
      registryUrl: cfg.registryUrl,
      port: argv['port'] as number,
    });

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
