import type { CommandModule } from 'yargs';
import { configExists, readConfig, ensureConfigDir, DEFAULT_REGISTRY_URL } from '../config.js';
import { startStdioServer } from '../stdio.js';

const stdio: CommandModule = {
  command: 'stdio',
  describe:
    'Run the MCP server over stdio (one-line setup for Claude Code, Claude Desktop, Cursor, etc.)',
  handler: async () => {
    // Zero-config: ensure the data dir exists (DB tables auto-create on first
    // open) and use the configured registry if init has been run, otherwise a
    // sensible default. No interactive init required for local stdio use.
    ensureConfigDir();

    let registryUrl = DEFAULT_REGISTRY_URL;
    if (configExists()) {
      try {
        registryUrl = readConfig().registryUrl || DEFAULT_REGISTRY_URL;
      } catch {
        // Malformed config — fall back to default rather than refusing to start.
      }
    }

    await startStdioServer(registryUrl);
  },
};

export default stdio;
