import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ensureConfigDir,
  configExists,
  readConfig,
  writeConfig,
  readState,
  writeState,
} from '../config.js';
import type { HandsAndFeetConfig, KillSwitchState } from '../types.js';

let tempDir: string;

beforeEach(() => {
  // Create a fresh temp directory for each test
  tempDir = mkdtempSync(join(tmpdir(), 'hands-body-and-feet-test-'));
});

afterEach(() => {
  // Remove the temp directory and all contents after each test
  rmSync(tempDir, { recursive: true, force: true });
});

const sampleConfig: HandsAndFeetConfig = {
  version: 1,
  instanceId: 'test-instance-abc123',
  registryUrl: 'https://registry.example.com',
  passphraseHash: 'sha256:deadbeef1234567890',
  capabilities: {
    notify: {
      topic: 'agent-events',
      serverUrl: 'https://notify.example.com',
    },
  },
  allowLocalFallback: true,
};

describe('readConfig', () => {
  it('throws when config file does not exist', () => {
    expect(() => readConfig(tempDir)).toThrowError(
      /No config found at/
    );
  });

  it('error message includes the config path', () => {
    expect(() => readConfig(tempDir)).toThrowError(
      join(tempDir, 'config.json')
    );
  });
});

describe('writeConfig + readConfig round-trip', () => {
  it('written data matches read data exactly', () => {
    writeConfig(sampleConfig, tempDir);
    const result = readConfig(tempDir);
    expect(result).toEqual(sampleConfig);
  });

  it('preserves version field', () => {
    writeConfig(sampleConfig, tempDir);
    expect(readConfig(tempDir).version).toBe(1);
  });

  it('preserves instanceId field', () => {
    writeConfig(sampleConfig, tempDir);
    expect(readConfig(tempDir).instanceId).toBe('test-instance-abc123');
  });

  it('preserves registryUrl field', () => {
    writeConfig(sampleConfig, tempDir);
    expect(readConfig(tempDir).registryUrl).toBe('https://registry.example.com');
  });

  it('preserves passphraseHash field', () => {
    writeConfig(sampleConfig, tempDir);
    expect(readConfig(tempDir).passphraseHash).toBe('sha256:deadbeef1234567890');
  });

  it('preserves capabilities field', () => {
    writeConfig(sampleConfig, tempDir);
    expect(readConfig(tempDir).capabilities).toEqual({
      notify: {
        topic: 'agent-events',
        serverUrl: 'https://notify.example.com',
      },
    });
  });

  it('preserves allowLocalFallback field', () => {
    writeConfig(sampleConfig, tempDir);
    expect(readConfig(tempDir).allowLocalFallback).toBe(true);
  });

  it('handles config without optional fields', () => {
    const minimal: HandsAndFeetConfig = {
      version: 1,
      instanceId: 'minimal-id',
      registryUrl: 'https://registry.example.com',
      passphraseHash: 'sha256:abc',
      capabilities: {},
    };
    writeConfig(minimal, tempDir);
    const result = readConfig(tempDir);
    expect(result).toEqual(minimal);
    expect(result.allowLocalFallback).toBeUndefined();
  });
});

describe('readState', () => {
  it('returns { paused: false } when state file is absent', () => {
    const state = readState(tempDir);
    expect(state).toEqual({ paused: false });
  });

  it('returns default state without throwing when directory exists but state file missing', () => {
    ensureConfigDir(tempDir);
    expect(() => readState(tempDir)).not.toThrow();
    expect(readState(tempDir)).toEqual({ paused: false });
  });
});

describe('writeState + readState round-trip', () => {
  it('round-trips a simple paused=false state', () => {
    const state: KillSwitchState = { paused: false };
    writeState(state, tempDir);
    expect(readState(tempDir)).toEqual({ paused: false });
  });

  it('round-trips a paused=true state with all fields', () => {
    const state: KillSwitchState = {
      paused: true,
      pausedAt: '2024-01-15T10:30:00Z',
      pausedBy: 'admin-user',
    };
    writeState(state, tempDir);
    const result = readState(tempDir);
    expect(result).toEqual(state);
    expect(result.paused).toBe(true);
    expect(result.pausedAt).toBe('2024-01-15T10:30:00Z');
    expect(result.pausedBy).toBe('admin-user');
  });

  it('round-trips a resumed state with resumedAt field', () => {
    const state: KillSwitchState = {
      paused: false,
      pausedAt: '2024-01-15T10:30:00Z',
      pausedBy: 'admin-user',
      resumedAt: '2024-01-15T11:00:00Z',
    };
    writeState(state, tempDir);
    expect(readState(tempDir)).toEqual(state);
  });

  it('overwrites previous state on second write', () => {
    writeState({ paused: true, pausedAt: '2024-01-15T10:00:00Z', pausedBy: 'user1' }, tempDir);
    writeState({ paused: false, resumedAt: '2024-01-15T11:00:00Z' }, tempDir);
    expect(readState(tempDir).paused).toBe(false);
    expect(readState(tempDir).resumedAt).toBe('2024-01-15T11:00:00Z');
  });
});

describe('file permissions', () => {
  it('config file is created with mode 0o600 (owner read/write only)', () => {
    writeConfig(sampleConfig, tempDir);
    const configPath = join(tempDir, 'config.json');
    const stats = statSync(configPath);
    // On Windows the mode check is less meaningful, but we verify the file exists
    // and on POSIX systems we verify the exact permission bits
    if (process.platform !== 'win32') {
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    } else {
      // On Windows just verify the file was created
      expect(stats.isFile()).toBe(true);
    }
  });

  it('state file is created with mode 0o600 (owner read/write only)', () => {
    writeState({ paused: false }, tempDir);
    const statePath = join(tempDir, 'state.json');
    const stats = statSync(statePath);
    if (process.platform !== 'win32') {
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    } else {
      expect(stats.isFile()).toBe(true);
    }
  });
});

describe('ensureConfigDir', () => {
  it('creates the directory if it does not exist', () => {
    const newDir = join(tempDir, 'new-subdir');
    // Verify it doesn't exist yet (it's a subdirectory we haven't created)
    expect(() => statSync(newDir)).toThrow();
    ensureConfigDir(newDir);
    const stats = statSync(newDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('does not throw if the directory already exists', () => {
    ensureConfigDir(tempDir);
    expect(() => ensureConfigDir(tempDir)).not.toThrow();
  });

  it('creates nested directories recursively', () => {
    const deepDir = join(tempDir, 'a', 'b', 'c');
    ensureConfigDir(deepDir);
    expect(statSync(deepDir).isDirectory()).toBe(true);
  });
});

describe('configExists', () => {
  it('returns false when config file does not exist', () => {
    expect(configExists(tempDir)).toBe(false);
  });

  it('returns true after writing config', () => {
    writeConfig(sampleConfig, tempDir);
    expect(configExists(tempDir)).toBe(true);
  });
});
