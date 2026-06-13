// packages/hands-body-and-feet/src/__tests__/config-default-registry.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('DEFAULT_REGISTRY_URL', () => {
  it('defaults to the hosted official registry', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const { DEFAULT_REGISTRY_URL } = await import('../config.js');
    expect(DEFAULT_REGISTRY_URL).toBe('https://opentrust.sh');
    expect(DEFAULT_REGISTRY_URL.startsWith('https://')).toBe(true);
  });

  it('is overridable via OPENTRUST_REGISTRY_URL', async () => {
    vi.resetModules();
    vi.stubEnv('OPENTRUST_REGISTRY_URL', 'https://registry.example.test');
    const { DEFAULT_REGISTRY_URL } = await import('../config.js');
    expect(DEFAULT_REGISTRY_URL).toBe('https://registry.example.test');
  });
});
