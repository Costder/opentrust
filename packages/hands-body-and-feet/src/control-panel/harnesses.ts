import { existsSync } from 'node:fs';

export interface HarnessStatus {
  id: string;
  name: string;
  ready: boolean;
  dayOne: boolean;
  unattendedAllowed: boolean;
  socialAutomationAllowed: boolean;
  note?: string;
}

export interface HarnessStatuses {
  hermes: HarnessStatus;
  openclaw: HarnessStatus;
  codex: HarnessStatus;
  claude: HarnessStatus;
}

function hasKey(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === 'string' && (env[key] as string).length > 0;
}

function resolveCommand(envKey: string, defaultCmd: string, env: NodeJS.ProcessEnv): string {
  return env[envKey] ?? defaultCmd;
}

function commandLikelyAvailable(cmd: string, env: NodeJS.ProcessEnv): boolean {
  const envPathKey = 'PATH';
  const pathVal = env[envPathKey] ?? '';
  const separator = process.platform === 'win32' ? ';' : ':';
  const dirs = pathVal.split(separator);
  const ext = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

  for (const dir of dirs) {
    for (const e of ext) {
      if (existsSync(`${dir}/${cmd}${e}`)) return true;
    }
  }
  return false;
}

function detectHermes(env: NodeJS.ProcessEnv): HarnessStatus {
  const hasXmpp = hasKey(env, 'XMPP_JID') && hasKey(env, 'XMPP_PASSWORD');
  const hasHermesUrl = hasKey(env, 'HERMES_URL') || hasKey(env, 'HERMES_API_URL');
  const ready = hasXmpp || hasHermesUrl;

  return {
    id: 'hermes',
    name: 'Hermes Agent',
    ready,
    dayOne: true,
    unattendedAllowed: true,
    socialAutomationAllowed: true,
    note: ready
      ? 'Hermes messaging bridge configured'
      : 'Set XMPP_JID + XMPP_PASSWORD or HERMES_URL to activate',
  };
}

function detectOpenClaw(env: NodeJS.ProcessEnv): HarnessStatus {
  const hasUrl = hasKey(env, 'OPENCLAW_URL') || hasKey(env, 'OPENCLAW_API_URL');
  const hasKey2 = hasKey(env, 'OPENCLAW_API_KEY');
  const hasPath = hasKey(env, 'OPENCLAW_CLI_PATH');
  const cmdAvailable = commandLikelyAvailable(
    resolveCommand('OPENCLAW_CLI_PATH', 'openclaw', env),
    env,
  );
  const ready = hasUrl || hasKey2 || hasPath || cmdAvailable;

  return {
    id: 'openclaw',
    name: 'OpenClaw',
    ready,
    dayOne: true,
    unattendedAllowed: true,
    socialAutomationAllowed: true,
    note: ready
      ? 'OpenClaw harness available'
      : 'Set OPENCLAW_URL or install openclaw CLI to activate',
  };
}

function detectCodex(env: NodeJS.ProcessEnv): HarnessStatus {
  const hasApiKey = hasKey(env, 'OPENAI_API_KEY');
  const hasPath = hasKey(env, 'CODEX_CLI_PATH');
  const cmdAvailable = commandLikelyAvailable(
    resolveCommand('CODEX_CLI_PATH', 'codex', env),
    env,
  );
  const ready = hasApiKey || hasPath || cmdAvailable;

  return {
    id: 'codex',
    name: 'Codex',
    ready,
    dayOne: true,
    unattendedAllowed: true,
    socialAutomationAllowed: true,
    note: ready
      ? 'Codex harness available'
      : 'Set OPENAI_API_KEY or install codex CLI to activate',
  };
}

function detectClaude(env: NodeJS.ProcessEnv): HarnessStatus {
  const hasApiKey = hasKey(env, 'ANTHROPIC_API_KEY');
  const hasPath = hasKey(env, 'CLAUDE_CLI_PATH');
  const cmdAvailable = commandLikelyAvailable(
    resolveCommand('CLAUDE_CLI_PATH', 'claude', env),
    env,
  );
  const ready = hasApiKey || hasPath || cmdAvailable;

  return {
    id: 'claude',
    name: 'Claude',
    ready,
    dayOne: true,
    unattendedAllowed: true,
    socialAutomationAllowed: false,
    note: ready
      ? 'Claude harness available'
      : 'Set ANTHROPIC_API_KEY or install claude CLI to activate',
  };
}

export function getHarnessStatuses(env: NodeJS.ProcessEnv = process.env): HarnessStatuses {
  return {
    hermes: detectHermes(env),
    openclaw: detectOpenClaw(env),
    codex: detectCodex(env),
    claude: detectClaude(env),
  };
}
