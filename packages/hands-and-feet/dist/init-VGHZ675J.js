import {
  hashPassphrase
} from "./chunk-AWZFPYEH.js";
import {
  configExists,
  writeConfig
} from "./chunk-4KSGGIH6.js";

// src/cli/init.ts
import { input, password, confirm, select } from "@inquirer/prompts";
import { randomUUID } from "crypto";
var init = {
  command: "init",
  describe: "Initialize Hands and Feet (idempotent)",
  builder: (y) => y.option("re-bind", {
    type: "boolean",
    describe: "Re-bind to existing registry configuration on a new machine"
  }).option("i-understand-form-1583", {
    type: "boolean",
    describe: "Acknowledge Form 1583 notarization requirement for PostScan Mail"
  }),
  handler: async (argv) => {
    if (configExists() && !argv.rebind) {
      const proceed = await confirm({
        message: "Already initialized. Re-initialize? (existing config will be overwritten)",
        default: false
      });
      if (!proceed) {
        console.log("Init cancelled.");
        process.exit(0);
      }
    }
    console.log("\n\u{1F91D} Hands and Feet \u2014 Initial Setup\n");
    const registryUrl = await input({
      message: "OpenTrust registry URL:",
      default: "http://localhost:8000"
    });
    const notifyTopic = await input({
      message: "ntfy.sh topic (your private notification topic):",
      validate: (v) => v.trim().length > 0 || "Topic is required"
    });
    const notifyServerUrl = await input({
      message: "ntfy.sh server URL:",
      default: "https://ntfy.sh"
    });
    console.log("\n\u{1F511} Set a passphrase for the kill switch (pause/resume commands).");
    const passphrase = await password({
      message: "Kill switch passphrase:",
      validate: (v) => v.length >= 8 || "Passphrase must be at least 8 characters"
    });
    const passphrase2 = await password({ message: "Confirm passphrase:" });
    if (passphrase !== passphrase2) {
      console.error("Passphrases do not match. Init aborted.");
      process.exit(1);
    }
    const cfg = {
      version: 1,
      instanceId: randomUUID(),
      registryUrl,
      passphraseHash: hashPassphrase(passphrase),
      capabilities: {
        notify: {
          topic: notifyTopic,
          serverUrl: notifyServerUrl
        }
      }
    };
    const setupCards = await confirm({ message: "Set up Moon (Pay with Moon) virtual cards?", default: false });
    if (setupCards) {
      console.log("\n\u26A0\uFE0F  Moon requires KYC \u2014 you are the legally responsible party for all card activity.");
      const moonSandbox = await confirm({ message: "Use Moon sandbox mode?", default: true });
      cfg.capabilities.cards = { sandbox: moonSandbox };
      console.log("   Set MOON_CONSUMER_KEY and MOON_CONSUMER_SECRET env vars before running serve.");
    }
    const setupPhone = await confirm({ message: "Set up phone (SMS)?", default: false });
    if (setupPhone) {
      const provider = await select({
        message: "Phone provider:",
        choices: [
          { value: "twilio", name: "Twilio (set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)" },
          { value: "signalwire", name: "SignalWire (set SIGNALWIRE_PROJECT_ID + SIGNALWIRE_AUTH_TOKEN + SIGNALWIRE_SPACE_URL)" }
        ]
      });
      cfg.capabilities.phone = { provider };
      if (provider === "twilio") {
        console.log("   Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars before running serve.");
      } else {
        console.log("   Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_AUTH_TOKEN, and SIGNALWIRE_SPACE_URL env vars before running serve.");
      }
    }
    const setupEmail = await confirm({ message: "Set up email?", default: false });
    if (setupEmail) {
      const transport = await select({
        message: "Email transport:",
        choices: [
          { value: "local", name: "local \u2014 self-hosted SMTP, no external account needed" },
          { value: "postmark", name: "postmark \u2014 set POSTMARK_SERVER_TOKEN env var" },
          { value: "resend", name: "resend \u2014 set RESEND_API_KEY env var" }
        ]
      });
      cfg.capabilities.email = { transport };
      if (transport === "postmark") {
        console.log("   Set POSTMARK_SERVER_TOKEN env var before running serve.");
      } else if (transport === "resend") {
        console.log("   Set RESEND_API_KEY env var before running serve.");
      }
    }
    const setupGithub = await confirm({ message: "Set up GitHub?", default: false });
    if (setupGithub) {
      const defaultOwner = await input({ message: "Default GitHub owner/org (leave blank to require per-call):" });
      cfg.capabilities.github = { defaultOwner: defaultOwner || void 0 };
      console.log("   Set GITHUB_TOKEN env var (personal access token with repo scope).");
    }
    const setupIPFS = await confirm({ message: "Set up IPFS (requires Kubo daemon)?", default: false });
    if (setupIPFS) {
      console.log("   Set IPFS_API_URL env var (default: http://localhost:5001).");
      console.log("   Or set IPFS_API_URL=web3storage and WEB3_STORAGE_TOKEN for web3.storage fallback.");
    }
    const iUnderstandForm1583 = argv["i-understand-form-1583"];
    const setupMail = await confirm({ message: "Set up PostScan Mail (physical mailbox)?", default: false });
    if (setupMail) {
      if (!iUnderstandForm1583) {
        console.error("\n\x1B[31m");
        console.error("\u26A0\uFE0F  IMPORTANT LEGAL NOTICE \u26A0\uFE0F");
        console.error("PostScan Mail requires USPS Form 1583 notarization.");
        console.error("This physically ties your LEGAL IDENTITY to this mailbox.");
        console.error("Any mail your AI agent forwards, scans, or shreds is YOUR legal responsibility.");
        console.error("Proceed only if you have completed Form 1583 notarization.");
        console.error("\x1B[0m");
        console.error("Re-run with --i-understand-form-1583 flag to enable PostScan Mail setup.");
      } else {
        console.log("   Set POSTSCAN_API_KEY and POSTSCAN_ACCOUNT_ID env vars before running serve.");
        console.log("   Alternatively set EARTH_CLASS_MAIL_API_KEY for Earth Class Mail fallback.");
      }
    }
    writeConfig(cfg);
    console.log("\n\u2705 Hands and Feet initialized successfully.");
    console.log('   Run "hands-and-feet serve" to start the MCP server.');
  }
};
var init_default = init;
export {
  init_default as default
};
