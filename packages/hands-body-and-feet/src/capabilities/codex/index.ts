import { spawn } from 'node:child_process';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

const CODEX_EXEC_TOOL: ToolDefinition = { name: 'codex_exec', minTrustLevel: 3 };
const CODEX_OPEN_DESKTOP_TOOL: ToolDefinition = { name: 'codex_open_desktop', minTrustLevel: 3 };

export const CODEX_TOOLS = {
  codex_exec: CODEX_EXEC_TOOL,
  codex_open_desktop: CODEX_OPEN_DESKTOP_TOOL,
} as const;

export interface CodexExecParams {
  prompt: string;
  cwd?: string;
  timeout_ms?: number;
  approval_policy?: 'never' | 'on-request' | 'untrusted';
}

export interface CodexOpenDesktopParams {
  cwd?: string;
  prompt?: string;
}

function codexCommand(): string {
  return process.env.CODEX_CLI_PATH || 'codex';
}

function defaultCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export async function codexExec(
  params: CodexExecParams,
  claims: PassportClaims,
): Promise<{ mode: 'headless'; command: string; args: string[]; exit_code: number | null; stdout: string; stderr: string }> {
  enforceTrust(claims, CODEX_EXEC_TOOL);
  if (!params.prompt?.trim()) {
    throw new Error('codex_exec requires a non-empty prompt');
  }

  const command = codexCommand();
  const cwd = defaultCwd(params.cwd);
  const approvalPolicy = params.approval_policy ?? 'never';
  const args = ['exec', '--cd', cwd, '--ask-for-approval', approvalPolicy, params.prompt];

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`codex_exec timed out after ${params.timeout_ms ?? 300000}ms`));
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

export async function codexOpenDesktop(
  params: CodexOpenDesktopParams,
  claims: PassportClaims,
): Promise<{ launched: true; mode: 'desktop'; command: string; args: string[]; pid: number | undefined; follow_up_prompt?: string }> {
  enforceTrust(claims, CODEX_OPEN_DESKTOP_TOOL);
  const command = codexCommand();
  const cwd = defaultCwd(params.cwd);
  const args = ['app', cwd];
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
