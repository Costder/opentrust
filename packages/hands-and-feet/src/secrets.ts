import { readConfig } from './config.js';
import type { HandsAndFeetConfig } from './types.js';

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

/**
 * Loads capability config. In Plan A: reads from config.json.
 * Registry-backed secrets and encrypted local files are future plans.
 */
export function loadSecrets(): HandsAndFeetConfig['capabilities'] {
  const cfg = readConfig();
  return cfg.capabilities;
}

/**
 * Gets the ntfy.sh topic and server URL from config.
 * Throws SecretsError if notify is not configured.
 */
export function getNotifyTopic(): { topic: string; serverUrl: string } {
  const secrets = loadSecrets();
  if (!secrets.notify?.topic) {
    throw new SecretsError(
      'ntfy.sh topic not configured. Run "hands-and-feet init" to set it up.',
    );
  }
  return {
    topic: secrets.notify.topic,
    serverUrl: secrets.notify.serverUrl ?? 'https://ntfy.sh',
  };
}
