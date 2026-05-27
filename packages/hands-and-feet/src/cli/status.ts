import type { CommandModule } from 'yargs';
import { readConfig, readState } from '../config.js';

const status: CommandModule = {
  command: 'status',
  describe: 'Print current system status',
  handler: async () => {
    const cfg = readConfig();
    const state = readState();

    console.log('\n── Hands and Feet Status ─────────────────────────────');
    console.log(`  Kill switch:  ${state.paused ? '🔴 PAUSED' : '🟢 active'}`);
    if (state.paused) {
      console.log(`  Paused at:    ${state.pausedAt ?? 'unknown'}`);
      console.log(`  Paused by:    ${state.pausedBy ?? 'unknown'}`);
    }
    if (state.resumedAt && !state.paused) {
      console.log(`  Last resume:  ${state.resumedAt}`);
    }
    console.log(`  Instance ID:  ${cfg.instanceId}`);
    console.log(`  Registry:     ${cfg.registryUrl}`);
    console.log('\n  Capabilities:');
    if (cfg.capabilities.notify) {
      const n = cfg.capabilities.notify;
      console.log(`    ✅ notify_human  topic="${n.topic}"  server="${n.serverUrl}"`);
    } else {
      console.log('    ❌ notify_human  (not configured)');
    }
    console.log('\n  Outsourced deps:');
    console.log('    ntfy.sh     github.com/binwiederhier/ntfy  L2 (low risk)');
    console.log('──────────────────────────────────────────────────────\n');
  },
};

export default status;
