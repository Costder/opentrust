import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandsAndFeetConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Mock config module before importing secrets
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
  readConfig: vi.fn(),
}));

import { readConfig } from '../config.js';
import { loadSecrets, getNotifyTopic, SecretsError } from '../secrets.js';

const mockReadConfig = vi.mocked(readConfig);

function makeConfig(capabilities: HandsAndFeetConfig['capabilities']): HandsAndFeetConfig {
  return {
    version: 1,
    instanceId: 'test-instance',
    registryUrl: 'https://registry.example.com',
    passphraseHash: 'pbkdf2:sha256:abc:def',
    capabilities,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// loadSecrets
// ---------------------------------------------------------------------------

describe('loadSecrets', () => {
  it('returns the capabilities object from config', () => {
    const capabilities: HandsAndFeetConfig['capabilities'] = {
      notify: {
        topic: 'my-topic',
        serverUrl: 'https://ntfy.sh',
      },
    };
    mockReadConfig.mockReturnValue(makeConfig(capabilities));

    const result = loadSecrets();
    expect(result).toEqual(capabilities);
  });
});

// ---------------------------------------------------------------------------
// getNotifyTopic
// ---------------------------------------------------------------------------

describe('getNotifyTopic', () => {
  it('returns { topic, serverUrl } when notify is fully configured', () => {
    mockReadConfig.mockReturnValue(makeConfig({
      notify: {
        topic: 'agent-alerts',
        serverUrl: 'https://ntfy.example.com',
      },
    }));

    const result = getNotifyTopic();
    expect(result).toEqual({
      topic: 'agent-alerts',
      serverUrl: 'https://ntfy.example.com',
    });
  });

  it('defaults serverUrl to "https://ntfy.sh" when not specified in config', () => {
    mockReadConfig.mockReturnValue(makeConfig({
      notify: {
        topic: 'my-topic',
        serverUrl: undefined as unknown as string,
      },
    }));

    const result = getNotifyTopic();
    expect(result.serverUrl).toBe('https://ntfy.sh');
    expect(result.topic).toBe('my-topic');
  });

  it('throws SecretsError when capabilities.notify is undefined', () => {
    mockReadConfig.mockReturnValue(makeConfig({}));

    expect(() => getNotifyTopic()).toThrow(SecretsError);
    expect(() => getNotifyTopic()).toThrow('ntfy.sh topic not configured');
  });

  it('throws SecretsError when capabilities.notify.topic is an empty string', () => {
    mockReadConfig.mockReturnValue(makeConfig({
      notify: {
        topic: '',
        serverUrl: 'https://ntfy.sh',
      },
    }));

    expect(() => getNotifyTopic()).toThrow(SecretsError);
    expect(() => getNotifyTopic()).toThrow('ntfy.sh topic not configured');
  });
});
