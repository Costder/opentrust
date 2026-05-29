// packages/hands-body-and-feet/src/stdio.ts
//
// Stdio transport for the Hands, Body and Feet MCP server.
//
// This is the universal, harness-agnostic on-ramp. Unlike the HTTP transport
// (which requires a running daemon on a fixed port plus a per-request bearer
// token), stdio mode is spawned on demand by the harness and resolves the
// agent's passport identity ONCE from local config or env. That makes adding
// the server a single line in any MCP client (Claude Code, Claude Desktop,
// Cursor, etc.):
//
//   { "command": "npx", "args": ["-y", "@opentrust/hands-body-and-feet", "stdio"] }
//
// Trust is still enforced per tool call (claims carry trustLevel + spend caps);
// the difference is the identity is established at startup, not re-injected on
// every request.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { validatePassport } from './auth.js';
import { startLocalTransportIfConfigured } from './capabilities/email/index.js';
import { loadActiveTasks } from './capabilities/tasks/index.js';
import { loadActiveTriggers } from './capabilities/triggers/index.js';
import { startPurgeJob } from './capabilities/webhook/index.js';
import { startXmppIfConfigured } from './capabilities/phone-jmp/index.js';
import {
  TRUST_STATUS_TO_LEVEL,
  type PassportClaims,
  type TrustLevel,
  type TrustStatus,
} from './types.js';

/**
 * Resolve the passport claims used for every tool call in stdio mode.
 *
 * Resolution order:
 *   1. `OPENTRUST_PASSPORT_TOKEN` — validate it (against the registry, or
 *      locally if `OPENTRUST_JWT_SECRET` is set). Use this for a real passport.
 *   2. Local identity fallback — a zero-config local agent. Trust level comes
 *      from `OPENTRUST_TRUST_STATUS` (default `seller_confirmed` / L3), agent id
 *      from `OPENTRUST_AGENT_ID` (default `local-agent`).
 *
 * The local fallback matches the trust boundary of every other local stdio MCP
 * server: the process is spawned by the user's own harness on their own machine.
 * It is still more restrictive than typical servers — tools enforce trust levels
 * and spend caps, and the kill switch still halts execution.
 */
export async function resolveStdioClaims(registryUrl: string): Promise<PassportClaims> {
  const token = process.env['OPENTRUST_PASSPORT_TOKEN'];
  if (token) {
    return validatePassport(token, registryUrl);
  }

  const requestedStatus = process.env['OPENTRUST_TRUST_STATUS'] as TrustStatus | undefined;
  const trustStatus: TrustStatus = requestedStatus ?? 'seller_confirmed';
  const mappedLevel = TRUST_STATUS_TO_LEVEL[trustStatus];
  // `disputed` maps to 0 (always denied); fall back to L3 for a usable local agent.
  const trustLevel: TrustLevel = mappedLevel && mappedLevel > 0 ? (mappedLevel as TrustLevel) : 3;
  const agentId = process.env['OPENTRUST_AGENT_ID'] ?? 'local-agent';

  return {
    passportId: agentId,
    agentId,
    trustLevel,
    trustStatus: trustLevel === 3 ? 'seller_confirmed' : trustStatus,
    flags: [],
    isDisputed: false,
    version: '1',
  };
}

/**
 * Start the MCP server over stdio. Resolves claims, wires the server to a
 * StdioServerTransport, and starts the same background services as the HTTP
 * transport (scheduled tasks, triggers, inbound listeners) so persistence and
 * event-driven wakeups work identically.
 *
 * This function does not return until the transport closes — the harness keeps
 * the process alive via the stdin pipe.
 */
export async function startStdioServer(registryUrl: string): Promise<void> {
  // CRITICAL: in stdio mode, stdout IS the JSON-RPC channel. Any stray
  // `console.log` would corrupt the protocol stream, so route it to stderr.
  // (console.error / warn already go to stderr and are safe.)
  console.log = (...args: unknown[]): void => {
    console.error(...args);
  };

  const claims = await resolveStdioClaims(registryUrl);
  const server = createMcpServer(claims);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Feature parity with the HTTP transport: persistence + inbound listeners.
  startLocalTransportIfConfigured().catch((err: unknown) => {
    console.error('Failed to start local SMTP transport:', err instanceof Error ? err.message : String(err));
  });
  try {
    loadActiveTasks();
    loadActiveTriggers();
  } catch (err: unknown) {
    console.error('Failed to load active tasks/triggers:', err instanceof Error ? err.message : String(err));
  }
  startPurgeJob();
  startXmppIfConfigured().catch((err: unknown) => {
    console.error('Failed to start XMPP client:', err instanceof Error ? err.message : String(err));
  });
}
