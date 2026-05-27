import type { CommandModule } from 'yargs';
import { password } from '@inquirer/prompts';
import { readConfig } from '../config.js';
import { verifyPassphrase, resume } from '../state.js';

const resumeCmd: CommandModule = {
  command: 'resume',
  describe: 'Resume the MCP server after a pause. Re-validates passports.',
  handler: async () => {
    const cfg = readConfig();
    const passphrase = await password({ message: 'Kill switch passphrase:' });

    if (!verifyPassphrase(passphrase, cfg.passphraseHash)) {
      console.error('Incorrect passphrase.');
      process.exit(1);
    }

    // TODO: Re-validate stored passports against OT revocation list (Plan B+)
    const state = resume(cfg.instanceId);
    console.log(`\n🟢 Hands and Feet RESUMED at ${state.resumedAt}`);
    console.log('   MCP server is accepting tool calls again.');
  },
};

export default resumeCmd;
