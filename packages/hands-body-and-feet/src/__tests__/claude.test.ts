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
  proc.pid = 4321;
  setTimeout(() => {
    if (options.stdout) proc.stdout.emit('data', Buffer.from(options.stdout));
    if (options.stderr) proc.stderr.emit('data', Buffer.from(options.stderr));
    proc.emit('close', options.code ?? 0);
  }, 0);
  return proc;
}

describe('claude capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    delete process.env.CLAUDE_DESKTOP_PATH;
  });

  it('runs headless claude -p and captures output', async () => {
    spawnMock.mockImplementationOnce(() => fakeProcess({ stdout: 'hi there\n' }));
    const { claudeExec } = await import('../capabilities/claude/index.js');

    const result = await claudeExec({ prompt: 'summarize the bus', cwd: 'C:/work' }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'claude',
      ['-p', 'summarize the bus', '--output-format', 'text'],
      expect.objectContaining({ cwd: 'C:/work' }),
    );
    expect(result).toMatchObject({ mode: 'headless', exit_code: 0, stdout: 'hi there\n' });
  });

  it('passes model and allowed_tools when provided', async () => {
    spawnMock.mockImplementationOnce(() => fakeProcess());
    const { claudeExec } = await import('../capabilities/claude/index.js');

    await claudeExec({ prompt: 'analyze', model: 'claude-x', allowed_tools: ['Read', 'Grep'] }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'claude',
      ['-p', 'analyze', '--output-format', 'text', '--model', 'claude-x', '--allowedTools', 'Read,Grep'],
      expect.any(Object),
    );
  });

  it('opens the desktop app detached via the claude:// protocol', async () => {
    const proc = fakeProcess();
    spawnMock.mockReturnValueOnce(proc);
    const { claudeOpenDesktop } = await import('../capabilities/claude/index.js');

    const result = await claudeOpenDesktop({ prompt: 'review the diff', cwd: 'C:/work' }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '', 'claude://'],
      expect.objectContaining({ cwd: 'C:/work', detached: true, stdio: 'ignore' }),
    );
    expect(proc.unref).toHaveBeenCalled();
    expect(result).toMatchObject({ launched: true, mode: 'desktop', pid: 4321, follow_up_prompt: 'review the diff' });
  });

  it('uses CLAUDE_CLI_PATH for headless when configured', async () => {
    process.env.CLAUDE_CLI_PATH = 'C:/Anthropic/claude.exe';
    spawnMock.mockImplementationOnce(() => fakeProcess());
    const { claudeExec } = await import('../capabilities/claude/index.js');

    await claudeExec({ prompt: 'hi' }, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'C:/Anthropic/claude.exe',
      expect.arrayContaining(['-p', 'hi']),
      expect.any(Object),
    );
  });

  it('uses CLAUDE_DESKTOP_PATH for desktop when configured', async () => {
    process.env.CLAUDE_DESKTOP_PATH = 'C:/Apps/Claude.exe';
    spawnMock.mockReturnValueOnce(fakeProcess());
    const { claudeOpenDesktop } = await import('../capabilities/claude/index.js');

    await claudeOpenDesktop({}, makeClaims());

    expect(spawnMock).toHaveBeenCalledWith(
      'C:/Apps/Claude.exe',
      [],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
  });

  it('requires L3 trust', async () => {
    const { claudeExec } = await import('../capabilities/claude/index.js');

    await expect(claudeExec({ prompt: 'hi' }, makeClaims(2))).rejects.toThrow(/trust/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
