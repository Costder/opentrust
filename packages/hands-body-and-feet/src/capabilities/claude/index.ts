import { spawn } from 'node:child_process';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

const CLAUDE_EXEC_TOOL: ToolDefinition = { name: 'claude_exec', minTrustLevel: 3 };
const CLAUDE_OPEN_DESKTOP_TOOL: ToolDefinition = { name: 'claude_open_desktop', minTrustLevel: 3 };

export const CLAUDE_TOOLS = {
  claude_exec: CLAUDE_EXEC_TOOL,
  claude_open_desktop: CLAUDE_OPEN_DESKTOP_TOOL,
} as const;

export interface ClaudeExecParams {
  prompt: string;
  cwd?: string;
  timeout_ms?: number;
  model?: string;
  allowed_tools?: string[];
}

export interface ClaudeOpenDesktopParams {
  cwd?: string;
  prompt?: string;
}

function claudeCommand(): string {
  return process.env.CLAUDE_CLI_PATH || 'claude';
}

function defaultCwd(cwd?: string): string {
  return cwd || process.cwd();
}

/**
 * Headless Claude Code via `claude -p`. For headless-safe work (analysis, drafting,
 * read-only/allow-listed tools). Anything needing interactive permission approval should
 * use claude_open_desktop instead — the approval layer lives in the interactive session.
 */
export async function claudeExec(
  params: ClaudeExecParams,
  claims: PassportClaims,
): Promise<{ mode: 'headless'; command: string; args: string[]; exit_code: number | null; stdout: string; stderr: string }> {
  enforceTrust(claims, CLAUDE_EXEC_TOOL);
  if (!params.prompt?.trim()) {
    throw new Error('claude_exec requires a non-empty prompt');
  }

  const command = claudeCommand();
  const cwd = defaultCwd(params.cwd);
  const args = ['-p', params.prompt, '--output-format', 'text'];
  if (params.model) args.push('--model', params.model);
  if (params.allowed_tools?.length) args.push('--allowedTools', params.allowed_tools.join(','));

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`claude_exec timed out after ${params.timeout_ms ?? 300000}ms`));
    }, params.timeout_ms ?? 300_000);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ mode: 'headless', command, args, exit_code: code, stdout, stderr });
    });
  });
}

/**
 * Opens the Claude desktop app (interactive) for approval-gated work. Uses the registered
 * `claude://` protocol by default; set CLAUDE_DESKTOP_PATH to launch a specific executable.
 * Returns immediately with an optional follow-up prompt for the human/session.
 */
export async function claudeOpenDesktop(
  params: ClaudeOpenDesktopParams,
  claims: PassportClaims,
): Promise<{ launched: true; mode: 'desktop'; command: string; args: string[]; pid: number | undefined; follow_up_prompt?: string }> {
  enforceTrust(claims, CLAUDE_OPEN_DESKTOP_TOOL);
  const cwd = defaultCwd(params.cwd);

  const desktopPath = process.env.CLAUDE_DESKTOP_PATH;
  const command = desktopPath || 'cmd';
  const args = desktopPath ? [] : ['/c', 'start', '', 'claude://'];

  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return {
    launched: true,
    mode: 'desktop',
    command,
    args,
    pid: child.pid,
    follow_up_prompt: params.prompt,
  };
}
