import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { HandsAndFeetConfig, KillSwitchState } from './types.js';

export const CONFIG_DIR = join(homedir(), '.hands-and-feet');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const STATE_PATH = join(CONFIG_DIR, 'state.json');

/**
 * Default OpenTrust registry the client talks to when nothing else is set.
 *
 * Points at the hosted official registry so `npx … stdio` and a fresh `serve`
 * work out of the box. Override with the `OPENTRUST_REGISTRY_URL` env var or a
 * `registryUrl` in config.json (e.g. `http://localhost:8000` for self-hosting).
 */
export const DEFAULT_REGISTRY_URL =
  process.env['OPENTRUST_REGISTRY_URL'] ?? 'https://opentrust.sh';

export function ensureConfigDir(configDir = CONFIG_DIR): void {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

export function configExists(configDir = CONFIG_DIR): boolean {
  return existsSync(join(configDir, 'config.json'));
}

export function readConfig(configDir = CONFIG_DIR): HandsAndFeetConfig {
  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`No config found at ${configPath}. Run 'hands-body-and-feet init' first.`);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8')) as HandsAndFeetConfig;
}

export function writeConfig(cfg: HandsAndFeetConfig, configDir = CONFIG_DIR): void {
  ensureConfigDir(configDir);
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function readState(configDir = CONFIG_DIR): KillSwitchState {
  const statePath = join(configDir, 'state.json');
  if (!existsSync(statePath)) {
    return { paused: false };
  }
  return JSON.parse(readFileSync(statePath, 'utf-8')) as KillSwitchState;
}

export function writeState(state: KillSwitchState, configDir = CONFIG_DIR): void {
  ensureConfigDir(configDir);
  const statePath = join(configDir, 'state.json');
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}
