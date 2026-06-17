// src/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var CONFIG_DIR = join(homedir(), ".hands-and-feet");
var CONFIG_PATH = join(CONFIG_DIR, "config.json");
var STATE_PATH = join(CONFIG_DIR, "state.json");
function ensureConfigDir(configDir = CONFIG_DIR) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 448 });
  }
}
function configExists(configDir = CONFIG_DIR) {
  return existsSync(join(configDir, "config.json"));
}
function readConfig(configDir = CONFIG_DIR) {
  const configPath = join(configDir, "config.json");
  if (!existsSync(configPath)) {
    throw new Error(`No config found at ${configPath}. Run 'hands-and-feet init' first.`);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}
function writeConfig(cfg, configDir = CONFIG_DIR) {
  ensureConfigDir(configDir);
  const configPath = join(configDir, "config.json");
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 384 });
}
function readState(configDir = CONFIG_DIR) {
  const statePath = join(configDir, "state.json");
  if (!existsSync(statePath)) {
    return { paused: false };
  }
  return JSON.parse(readFileSync(statePath, "utf-8"));
}
function writeState(state, configDir = CONFIG_DIR) {
  ensureConfigDir(configDir);
  const statePath = join(configDir, "state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 384 });
}

export {
  CONFIG_DIR,
  ensureConfigDir,
  configExists,
  readConfig,
  writeConfig,
  readState,
  writeState
};
