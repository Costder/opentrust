import {
  pause,
  verifyPassphrase
} from "./chunk-AWZFPYEH.js";
import {
  readConfig
} from "./chunk-4KSGGIH6.js";

// src/cli/pause.ts
import { password } from "@inquirer/prompts";
var pauseCmd = {
  command: "pause",
  describe: "Pause the MCP server (kill switch). Requires passphrase.",
  handler: async () => {
    const cfg = readConfig();
    const passphrase = await password({ message: "Kill switch passphrase:" });
    if (!verifyPassphrase(passphrase, cfg.passphraseHash)) {
      console.error("Incorrect passphrase.");
      process.exit(1);
    }
    const state = pause(cfg.instanceId);
    console.log(`
\u{1F534} Hands and Feet PAUSED at ${state.pausedAt}`);
    console.log('   All MCP tool calls will return 503 until you run "hands-and-feet resume".');
  }
};
var pause_default = pauseCmd;
export {
  pause_default as default
};
