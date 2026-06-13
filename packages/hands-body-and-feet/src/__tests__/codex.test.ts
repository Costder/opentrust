import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

function makeClaims(trustLevel: 2 | 3 | 4 = 3): PassportClaims {
  return {
    passportId: 'p1',
    agentId: 'a1',
    trustLevel,
    trustStatus: 'seller_confirmed',
    flags: [],
    isDisputed: false,
    version: '1',
  };
}

function fakeProcess(options: { stdout?: string; stderr?: string; code?: number } = {}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    unref: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.unref = vi.fn();
  proc.pid = 1234;
  setTimeout(() => {
    if (options.stdout) proc.stdout.emit('data', Buffer.from(options.stdout));
    if (options.stderr) proc.stderr.emit('data', Buffer.from(options.stderr));
    proc.emit('close', options.code ?? 0);
  }, 0);
  return proc;
}

describe('codex capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CODEX_CLI_PATH;
  });

  it('runs headless codex exec and captures output', async () => {
    spawnMock.mockImplementationOnce(() => fakeProcess({ stdout: 'done\n' }));
    const { codexExec } = await import('../capabilities/codex/index.js');

    const result = await codexExec({ prompt: 'poll the bus', cwd: 'C:/work' }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['exec', '--cd', 'C:/work', '--ask-for-approval', 'never', 'poll the bus'],
      expect.objectContaining({ cwd: 'C:/work' }),
    );
    expect(result).toMatchObject({ mode: 'headless', exit_code: 0, stdout: 'done\n' });
  });

  it('launches desktop Codex detached so approval-gated work can be handled interactively', async () => {
    const proc = fakeProcess();
    spawnMock.mockReturnValueOnce(proc);
    const { codexOpenDesktop } = await import('../capabilities/codex/index.js');

    const result = await codexOpenDesktop({ prompt: 'reply to scout-01', cwd: 'C:/work' }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['app', 'C:/work'],
      expect.objectContaining({
        cwd: 'C:/work',
        detached: true,
        stdio: 'ignore',
      }),
    );
    expect(proc.unref).toHaveBeenCalled();
    expect(result).toMatchObject({
      launched: true,
      mode: 'desktop',
      pid: 1234,
      follow_up_prompt: 'reply to scout-01',
    });
  });

  it('uses CODEX_CLI_PATH when configured', async () => {
    process.env.CODEX_CLI_PATH = 'C:/Codex/codex.exe';
    spawnMock.mockImplementationOnce(() => fakeProcess());
    const { codexOpenDesktop } = await import('../capabilities/codex/index.js');

    await codexOpenDesktop({ cwd: 'C:/work' }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'C:/Codex/codex.exe',
      ['app', 'C:/work'],
      expect.any(Object),
    );
  });

  it('requires L3 trust', async () => {
    const { codexExec } = await import('../capabilities/codex/index.js');

    await expect(codexExec({ prompt: 'hi' }, makeClaims(2))).rejects.toThrow(/trust/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
