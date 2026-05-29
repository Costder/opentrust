import type { CommandModule } from 'yargs';
import { password } from '@inquirer/prompts';
import { readConfig } from '../config.js';
import { verifyPassphrase, pause } from '../state.js';

const pauseCmd: CommandModule = {
  command: 'pause',
  describe: 'Pause the MCP server (kill switch). Requires passphrase.',
  handler: async () => {
    const cfg = readConfig();
    const passphrase = await password({ message: 'Kill switch passphrase:' });

    if (!verifyPassphrase(passphrase, cfg.passphraseHash)) {
      console.error('Incorrect passphrase.');
      process.exit(1);
    }

    const state = pause(cfg.instanceId);
    console.log(`\n🔴 Hands and Feet PAUSED at ${state.pausedAt}`);
    console.log('   All MCP tool calls will return 503 until you run "hands-body-and-feet resume".');
  },
};

export default pauseCmd;
