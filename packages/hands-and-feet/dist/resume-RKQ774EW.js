import {
  resume,
  verifyPassphrase
} from "./chunk-AWZFPYEH.js";
import {
  readConfig
} from "./chunk-4KSGGIH6.js";

// src/cli/resume.ts
import { password } from "@inquirer/prompts";
var resumeCmd = {
  command: "resume",
  describe: "Resume the MCP server after a pause. Re-validates passports.",
  handler: async () => {
    const cfg = readConfig();
    const passphrase = await password({ message: "Kill switch passphrase:" });
    if (!verifyPassphrase(passphrase, cfg.passphraseHash)) {
      console.error("Incorrect passphrase.");
      process.exit(1);
    }
    const state = resume(cfg.instanceId);
    console.log(`
\u{1F7E2} Hands and Feet RESUMED at ${state.resumedAt}`);
    console.log("   MCP server is accepting tool calls again.");
  }
};
var resume_default = resumeCmd;
export {
  resume_default as default
};
