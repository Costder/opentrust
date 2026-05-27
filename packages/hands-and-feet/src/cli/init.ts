import type { CommandModule } from 'yargs';
import { input, password, confirm, select } from '@inquirer/prompts';
import { randomUUID } from 'crypto';
import { configExists, writeConfig } from '../config.js';
import { hashPassphrase } from '../state.js';
import type { HandsAndFeetConfig } from '../types.js';

const init: CommandModule = {
  command: 'init',
  describe: 'Initialize Hands and Feet (idempotent)',
  builder: (y) =>
    y.option('re-bind', {
      type: 'boolean',
      describe: 'Re-bind to existing registry configuration on a new machine',
    }),
  handler: async (argv) => {
    if (configExists() && !(argv as { rebind?: boolean }).rebind) {
      const proceed = await confirm({
        message: 'Already initialized. Re-initialize? (existing config will be overwritten)',
        default: false,
      });
      if (!proceed) {
        console.log('Init cancelled.');
        process.exit(0);
      }
    }

    console.log('\n🤝 Hands and Feet — Initial Setup\n');

    const registryUrl = await input({
      message: 'OpenTrust registry URL:',
      default: 'http://localhost:8000',
    });

    const notifyTopic = await input({
      message: 'ntfy.sh topic (your private notification topic):',
      validate: (v: string) => v.trim().length > 0 || 'Topic is required',
    });

    const notifyServerUrl = await input({
      message: 'ntfy.sh server URL:',
      default: 'https://ntfy.sh',
    });

    console.log('\n🔑 Set a passphrase for the kill switch (pause/resume commands).');
    const passphrase = await password({
      message: 'Kill switch passphrase:',
      validate: (v: string) => v.length >= 8 || 'Passphrase must be at least 8 characters',
    });
    const passphrase2 = await password({ message: 'Confirm passphrase:' });
    if (passphrase !== passphrase2) {
      console.error('Passphrases do not match. Init aborted.');
      process.exit(1);
    }

    const cfg: HandsAndFeetConfig = {
      version: 1,
      instanceId: randomUUID(),
      registryUrl,
      passphraseHash: hashPassphrase(passphrase),
      capabilities: {
        notify: {
          topic: notifyTopic,
          serverUrl: notifyServerUrl,
        },
      },
    };

    // Moon card setup
    const setupCards = await confirm({ message: 'Set up Moon (Pay with Moon) virtual cards?', default: false });
    if (setupCards) {
      console.log('\n⚠️  Moon requires KYC — you are the legally responsible party for all card activity.');
      const moonSandbox = await confirm({ message: 'Use Moon sandbox mode?', default: true });
      cfg.capabilities.cards = { sandbox: moonSandbox };
      console.log('   Set MOON_CONSUMER_KEY and MOON_CONSUMER_SECRET env vars before running serve.');
    }

    // Phone setup
    const setupPhone = await confirm({ message: 'Set up phone (SMS)?', default: false });
    if (setupPhone) {
      const provider = await select({
        message: 'Phone provider:',
        choices: [
          { value: 'twilio', name: 'Twilio (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)' },
          { value: 'signalwire', name: 'SignalWire (set SIGNALWIRE_PROJECT_ID + SIGNALWIRE_AUTH_TOKEN + SIGNALWIRE_SPACE_URL)' },
        ],
      });
      cfg.capabilities.phone = { provider: provider as 'twilio' | 'signalwire' };
      if (provider === 'twilio') {
        console.log('   Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars before running serve.');
      } else {
        console.log('   Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_AUTH_TOKEN, and SIGNALWIRE_SPACE_URL env vars before running serve.');
      }
    }

    writeConfig(cfg);

    console.log('\n✅ Hands and Feet initialized successfully.');
    console.log('   Run "hands-and-feet serve" to start the MCP server.');
  },
};

export default init;
