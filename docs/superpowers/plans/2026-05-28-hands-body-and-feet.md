# Hands, Body and Feet — Persistence Epic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, autonomous "body" to hands-and-feet — real tool execution, event-triggered wakeups, bounded delegations for unattended runs, durable memory, and stable identity — then rename the package to 2.0.0.

**Architecture:** Extract the `CallTool` if-chain into a standalone `dispatchTool(name,args,claims)` function, then layer delegations (stored, narrowed grants for unattended runs) and triggers (event-matched wakeups that always run under a delegation) on top of that seam. Memory and identity are simple KV/record tables on the existing SQLite DB. Phase 6 renames the package.

**Tech Stack:** TypeScript, better-sqlite3, node-cron, vitest, express, `@modelcontextprotocol/sdk`. All tests use in-memory SQLite — no network, no secrets.

**Spec:** `docs/superpowers/specs/2026-05-28-hands-body-and-feet-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `packages/hands-and-feet/src/dispatch.ts` | **Create** | `dispatchTool(name,args,claims)` — single execution seam for all tools |
| `packages/hands-and-feet/src/spend-tracker.ts` | **Modify** | Add `delegations`, `delegation_usage`, `triggers`, `agent_identity`, `memory` tables |
| `packages/hands-and-feet/src/server.ts` | **Modify** | Rewire CallTool → `dispatchTool`; add ListTools entries for new tools; call `loadActiveTriggers` on boot |
| `packages/hands-and-feet/src/capabilities/tasks/index.ts` | **Modify** | Replace `fireTask` stub with real `dispatchTool` call |
| `packages/hands-and-feet/src/capabilities/delegations/index.ts` | **Create** | Delegation CRUD + `executeUnderDelegation` enforcement wrapper |
| `packages/hands-and-feet/src/capabilities/triggers/index.ts` | **Create** | Trigger CRUD + `matchAndFire` + `renderTemplate` + `loadActiveTriggers` |
| `packages/hands-and-feet/src/capabilities/body/index.ts` | **Create** | Identity + memory tools (`get_identity`, `set_identity_binding`, `get_memory`, `set_memory`, `list_memory`, `delete_memory`) |
| `packages/hands-and-feet/src/capabilities/webhook/index.ts` | **Modify** | Call `matchAndFire` on inbound webhook event |
| `packages/hands-and-feet/src/capabilities/email/index.ts` | **Modify** | Call `matchAndFire` on inbound email |
| `packages/hands-and-feet/src/capabilities/phone-jmp/index.ts` | **Modify** | Call `matchAndFire` on inbound SMS |
| `packages/hands-and-feet/src/capabilities/rss/index.ts` | **Modify** | Call `matchAndFire` on new RSS item |
| `packages/hands-and-feet/src/__tests__/dispatch.test.ts` | **Create** | Parity tests: dispatchTool matches direct calls |
| `packages/hands-and-feet/src/__tests__/delegations.test.ts` | **Create** | Allowlist denial, budget exhaustion, narrower-wins, kill-switch, revoked passport |
| `packages/hands-and-feet/src/__tests__/triggers.test.ts` | **Create** | Template rendering, per-source matching, fire→execute→audit, paused trigger no-op |
| `packages/hands-and-feet/src/__tests__/body.test.ts` | **Create** | Round-trip identity + memory, list, delete |
| `packages/hands-and-feet/package.json` | **Modify** (Phase 6) | Rename to `@opentrust/hands-body-and-feet`, bump to `2.0.0` |

---

## Task 1: Create `dispatchTool` — the execution seam (Phase 1)

**Files:**
- Create: `packages/hands-and-feet/src/dispatch.ts`
- Create: `packages/hands-and-feet/src/__tests__/dispatch.test.ts`

- [ ] **Step 1.1: Write the failing test**

```typescript
// packages/hands-and-feet/src/__tests__/dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

// Mock all capabilities so we don't need real providers
vi.mock('../capabilities/notify/index.js', () => ({
  notifyHuman: vi.fn().mockResolvedValue({ sent: true }),
  NOTIFY_TOOL: { name: 'notify_human', description: '', inputSchema: { type: 'object', properties: {} } },
}));
vi.mock('../capabilities/wallet/index.js', () => ({
  createWallet: vi.fn().mockResolvedValue({ label: 'w1', address: '0x1' }),
  getAddress: vi.fn(), getBalance: vi.fn(), sendUsdc: vi.fn(), signMessage: vi.fn(), signTypedData: vi.fn(),
  WALLET_TOOLS: { create_wallet: { name: 'create_wallet', minTrustLevel: 2 }, get_address: { name: 'get_address', minTrustLevel: 2 }, get_balance: { name: 'get_balance', minTrustLevel: 2 }, send_usdc: { name: 'send_usdc', minTrustLevel: 4 }, sign_message: { name: 'sign_message', minTrustLevel: 3 }, sign_typed_data: { name: 'sign_typed_data', minTrustLevel: 4 } },
}));
// (other capability mocks omitted for brevity — add the same pattern for
//  bridge, payments, cards, phone, email, tunnel, webhook, tasks, docker,
//  phone-jmp, github, ipfs, rss, mail — each returning vi.fn().mockResolvedValue({}))

import { notifyHuman } from '../capabilities/notify/index.js';
import { createWallet } from '../capabilities/wallet/index.js';

function makeL3Claims(): PassportClaims {
  return { passportId: 'p1', agentId: 'a1', trustLevel: 3, trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1' };
}

describe('dispatchTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes notify_human', async () => {
    // This import will fail until dispatch.ts exists
    const { dispatchTool } = await import('../dispatch.js');
    await dispatchTool('notify_human', { message: 'hi' }, makeL3Claims());
    expect(notifyHuman).toHaveBeenCalledWith({ message: 'hi' }, makeL3Claims());
  });

  it('routes create_wallet', async () => {
    const { dispatchTool } = await import('../dispatch.js');
    const result = await dispatchTool('create_wallet', { label: 'w1' }, makeL3Claims());
    expect(createWallet).toHaveBeenCalled();
    expect(result.content[0].text).toContain('w1');
  });

  it('returns isError for unknown tool', async () => {
    const { dispatchTool } = await import('../dispatch.js');
    const result = await dispatchTool('nonexistent_tool', {}, makeL3Claims());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('returns isError when capability throws', async () => {
    vi.mocked(notifyHuman).mockRejectedValueOnce(new Error('boom'));
    const { dispatchTool } = await import('../dispatch.js');
    const result = await dispatchTool('notify_human', { message: 'hi' }, makeL3Claims());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('boom');
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/dispatch.test.ts
```
Expected: FAIL — `Cannot find module '../dispatch.js'`

- [ ] **Step 1.3: Create `dispatch.ts` — copy the if-chain from server.ts**

```typescript
// packages/hands-and-feet/src/dispatch.ts
// Single execution seam for all tool calls.
// Called by the /mcp handler, fireTask, and executeUnderDelegation.
import { notifyHuman } from './capabilities/notify/index.js';
import { createWallet, getAddress, getBalance, sendUsdc, signMessage, signTypedData } from './capabilities/wallet/index.js';
import { bridgeToPolygon, bridgeToBase, getBridgeStatus } from './capabilities/bridge/index.js';
import { payWithUsdc, getPaymentStatus, preparePayment } from './capabilities/payments/index.js';
import type { PreparePaymentParams, PreparePaymentReceipt } from './capabilities/payments/index.js';
import { createVirtualCard, getCardDetails, addFundsToCard, topUpMoonCredit, freezeCard, deleteCard, getCardTransactions } from './capabilities/cards/index.js';
import { provisionPhoneNumber, sendSms, readSms, releasePhoneNumber } from './capabilities/phone/index.js';
import { createMailbox, sendEmail, readInbox, waitForEmail, deleteMailbox } from './capabilities/email/index.js';
import { createTunnel, getTunnelUrl, closeTunnel } from './capabilities/tunnel/index.js';
import { createWebhook, getWebhookUrl, readWebhookEvents, waitForWebhook, deleteWebhook } from './capabilities/webhook/index.js';
import { createTask, listTasks, deleteTask, pauseTask } from './capabilities/tasks/index.js';
import type { PermissionSnapshot } from './capabilities/tasks/revocation.js';
import { runContainer, stopContainer, removeContainer, listContainers, containerLogs, execInContainer } from './capabilities/docker/index.js';
import { provisionPhoneNumberJmp, sendSmsJmp, readSmsJmp, releasePhoneNumberJmp } from './capabilities/phone-jmp/index.js';
import { createRepo, createFile, createPullRequest, listRepos } from './capabilities/github/index.js';
import { publishContent, getIpfsContent, pinContent } from './capabilities/ipfs/index.js';
import { createFeed, addFeedItem, serveFeed } from './capabilities/rss/index.js';
import { listMail, forwardMail, shredMail, scanMail } from './capabilities/mail/index.js';
import type { PassportClaims } from './types.js';

export type DispatchResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(result: unknown): DispatchResult {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function err(message: string): DispatchResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export async function dispatchTool(
  name: string,
  args: unknown,
  claims: PassportClaims,
): Promise<DispatchResult> {
  try {
    if (name === 'notify_human') return ok(await notifyHuman(args as Parameters<typeof notifyHuman>[0], claims));
    if (name === 'create_wallet') return ok(await createWallet(args as { label?: string; chain?: 'base' | 'polygon' }, claims));
    if (name === 'get_address') return ok(await getAddress(args as { label: string }, claims));
    if (name === 'get_balance') return ok(await getBalance(args as { label: string; token?: 'ETH' | 'MATIC' | 'USDC'; chain?: 'base' | 'polygon' }, claims));
    if (name === 'send_usdc') return ok(await sendUsdc(args as { from_label: string; to_address: string; amount: number; chain?: 'base' | 'polygon' }, claims));
    if (name === 'sign_message') return ok(await signMessage(args as { label: string; text: string }, claims));
    if (name === 'sign_typed_data') return ok(await signTypedData(args as { label: string; domain: Record<string, unknown>; types: Record<string, unknown>; value: Record<string, unknown> }, claims));
    if (name === 'bridge_to_polygon') return ok(await bridgeToPolygon(args as { from_label: string; amount: number }, claims));
    if (name === 'bridge_to_base') return ok(await bridgeToBase(args as { from_label: string; amount: number }, claims));
    if (name === 'get_bridge_status') return ok(await getBridgeStatus(args as { bridge_id: string }, claims));
    if (name === 'pay_with_usdc') return ok(await payWithUsdc(args as { from_label: string; to_address: string; amount: number; memo?: string }, claims));
    if (name === 'get_payment_status') return ok(await getPaymentStatus(args as { tx_hash: string }, claims));
    if (name === 'prepare_payment') return ok(await preparePayment(args as unknown as PreparePaymentParams, claims) as PreparePaymentReceipt);
    if (name === 'create_virtual_card') return ok(await createVirtualCard(args as { label?: string; product?: 'moon_x' | 'moon_1x'; amount?: number }, claims));
    if (name === 'get_card_details') return ok(await getCardDetails(args as { label: string }, claims));
    if (name === 'add_funds_to_card') return ok(await addFundsToCard(args as { label: string; amount: number }, claims));
    if (name === 'top_up_moon_credit') return ok(await topUpMoonCredit(args as { amount: number }, claims));
    if (name === 'freeze_card') return ok(await freezeCard(args as { label: string }, claims));
    if (name === 'delete_card') return ok(await deleteCard(args as { label: string }, claims));
    if (name === 'get_card_transactions') return ok(await getCardTransactions(args as { label: string; limit?: number }, claims));
    if (name === 'provision_phone_number') return ok(await provisionPhoneNumber(args as { area_code?: string }, claims));
    if (name === 'send_sms') return ok(await sendSms(args as { from_number: string; to: string; message: string }, claims));
    if (name === 'read_sms') return ok(await readSms(args as { number: string; limit?: number }, claims));
    if (name === 'release_phone_number') return ok(await releasePhoneNumber(args as { number: string }, claims));
    if (name === 'create_mailbox') return ok(await createMailbox(args as { address: string }, claims));
    if (name === 'send_email') return ok(await sendEmail(args as { from: string; to: string; subject: string; body: string; html?: string }, claims));
    if (name === 'read_inbox') return ok(await readInbox(args as { address: string; limit?: number }, claims));
    if (name === 'wait_for_email') return ok(await waitForEmail(args as { address: string; filter?: { subject_contains?: string; from_contains?: string; body_contains?: string }; timeout_ms: number }, claims));
    if (name === 'delete_mailbox') return ok(await deleteMailbox(args as { address: string }, claims));
    if (name === 'create_tunnel') return ok(await createTunnel(args as { port: number; label?: string; provider?: 'cloudflared' | 'ngrok' }, claims));
    if (name === 'get_tunnel_url') return ok(await getTunnelUrl(args as { label: string }, claims));
    if (name === 'close_tunnel') return ok(await closeTunnel(args as { label: string }, claims));
    if (name === 'create_webhook') return ok(await createWebhook(args as { label: string; max_payload_bytes?: number; retention_days?: number }, claims));
    if (name === 'get_webhook_url') return ok(await getWebhookUrl(args as { label: string }, claims));
    if (name === 'read_webhook_events') return ok(await readWebhookEvents(args as { label: string; since?: string; limit?: number }, claims));
    if (name === 'wait_for_webhook') return ok(await waitForWebhook(args as { label: string; filter?: { body_contains?: string }; timeout_ms?: number }, claims));
    if (name === 'delete_webhook') return ok(await deleteWebhook(args as { label: string }, claims));
    if (name === 'create_task') return ok(await createTask(args as { label?: string; cron_expression: string; tool_name: string; tool_args?: Record<string, unknown>; passport_id: string; passport_version: string; permission_snapshot: PermissionSnapshot }, claims));
    if (name === 'list_tasks') return ok(await listTasks({} as Record<string, never>, claims));
    if (name === 'delete_task') return ok(await deleteTask(args as { label: string }, claims));
    if (name === 'pause_task') return ok(await pauseTask(args as { label: string }, claims));
    if (name === 'run_container') return ok(await runContainer(args as { image: string; name?: string; env?: string[]; ports?: Record<string, string> }, claims));
    if (name === 'stop_container') return ok(await stopContainer(args as { id: string }, claims));
    if (name === 'remove_container') return ok(await removeContainer(args as { id: string; force?: boolean }, claims));
    if (name === 'list_containers') return ok(await listContainers(args as { all?: boolean }, claims));
    if (name === 'container_logs') return ok(await containerLogs(args as { id: string; tail?: number }, claims));
    if (name === 'exec_in_container') return ok(await execInContainer(args as { id: string; command: string[] }, claims));
    if (name === 'provision_phone_number_jmp') return ok(await provisionPhoneNumberJmp(args as { area_code?: string }, claims));
    if (name === 'send_sms_jmp') return ok(await sendSmsJmp(args as { to: string; message: string; from_number?: string }, claims));
    if (name === 'read_sms_jmp') return ok(await readSmsJmp(args as { number?: string; limit?: number }, claims));
    if (name === 'release_phone_number_jmp') return ok(await releasePhoneNumberJmp(args as { number: string }, claims));
    if (name === 'create_repo') return ok(await createRepo(args as { name: string; private?: boolean; description?: string }, claims));
    if (name === 'create_file') return ok(await createFile(args as { owner?: string; repo: string; path: string; content: string; message: string; branch?: string }, claims));
    if (name === 'create_pull_request') return ok(await createPullRequest(args as { owner?: string; repo: string; title: string; body?: string; head: string; base: string }, claims));
    if (name === 'list_repos') return ok(await listRepos(args as { type?: 'all' | 'owner' | 'public' | 'private'; per_page?: number }, claims));
    if (name === 'publish_content') return ok(await publishContent(args as { content: string; filename?: string }, claims));
    if (name === 'get_ipfs_content') return ok(await getIpfsContent(args as { cid: string }, claims));
    if (name === 'pin_content') return ok(await pinContent(args as { cid: string }, claims));
    if (name === 'create_feed') return ok(await createFeed(args as { label: string; title: string; description: string; link: string }, claims));
    if (name === 'add_feed_item') return ok(await addFeedItem(args as { feed_label: string; title: string; description: string; url?: string; guid?: string }, claims));
    if (name === 'serve_feed') return ok(await serveFeed(args as { label: string }, claims));
    if (name === 'list_mail') return ok(await listMail(args as { limit?: number; status?: string }, claims));
    if (name === 'forward_mail') return ok(await forwardMail(args as { mail_id: string; address: string }, claims));
    if (name === 'shred_mail') return ok(await shredMail(args as { mail_id: string }, claims));
    if (name === 'scan_mail') return ok(await scanMail(args as { mail_id: string }, claims));

    return err(`Unknown tool: ${name}`);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/dispatch.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 1.5: Commit**

```bash
git add packages/hands-and-feet/src/dispatch.ts packages/hands-and-feet/src/__tests__/dispatch.test.ts
git commit -m "feat(haf): extract dispatchTool seam (Phase 1)"
```

---

## Task 2: Rewire server.ts CallTool handler to use `dispatchTool` (Phase 1)

**Files:**
- Modify: `packages/hands-and-feet/src/server.ts` (the `CallToolRequestSchema` handler, lines ~955-1286)

- [ ] **Step 2.1: Write the regression test**

In `packages/hands-and-feet/src/__tests__/server.test.ts`, verify the existing server tests still pass after the rewire. No new test needed — this is a pure refactor confirmed by the existing suite.

Run existing tests first to establish baseline:

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/server.test.ts
```
Expected: all pass (note the count, confirm same count after rewire)

- [ ] **Step 2.2: Replace the CallTool handler body in server.ts**

In `packages/hands-and-feet/src/server.ts`, add at the top of the file (after existing imports):

```typescript
import { dispatchTool } from './dispatch.js';
```

Then replace the entire `server.setRequestHandler(CallToolRequestSchema, ...)` block (lines ~955-1286) with:

```typescript
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await dispatchTool(name, args ?? {}, claims);
  });
```

- [ ] **Step 2.3: Run full test suite to confirm no regression**

```bash
cd packages/hands-and-feet && npm test
```
Expected: same number of tests pass as before

- [ ] **Step 2.4: Commit**

```bash
git add packages/hands-and-feet/src/server.ts
git commit -m "refactor(haf): rewire CallTool handler through dispatchTool (Phase 1)"
```

---

## Task 3: Fix the `fireTask` stub — real execution (Phase 2)

**Files:**
- Modify: `packages/hands-and-feet/src/capabilities/tasks/index.ts`
- Modify: `packages/hands-and-feet/src/__tests__/tasks.test.ts`

- [ ] **Step 3.1: Write the failing test**

Add to the end of `packages/hands-and-feet/src/__tests__/tasks.test.ts`:

```typescript
// Add to hoisted mocks at the top of tasks.test.ts:
// const { mockDispatchTool } = vi.hoisted(() => ({
//   mockDispatchTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] }),
// }));
// vi.mock('../dispatch.js', () => ({ dispatchTool: mockDispatchTool }));

describe('fireTask (real execution)', () => {
  it('calls dispatchTool with the task tool and args when passport is allowed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'p1', version: '1', status: 'active' }),
    });

    // Create a task — this schedules a cron job
    let cronCallback: (() => void) | undefined;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return makeFakeJob();
    });

    await createTask(
      {
        label: 'fire-test',
        cron_expression: '* * * * *',
        tool_name: 'notify_human',
        tool_args: { message: 'ping' },
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );

    // Trigger the cron callback
    await cronCallback!();

    expect(mockDispatchTool).toHaveBeenCalledWith(
      'notify_human',
      { message: 'ping' },
      expect.objectContaining({ passportId: 'p1' }),
    );
  });

  it('skips dispatchTool when passport is revoked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'p1', version: '1', status: 'revoked' }),
    });

    let cronCallback: (() => void) | undefined;
    mockCronSchedule.mockImplementation((_expr: string, cb: () => void) => {
      cronCallback = cb;
      return makeFakeJob();
    });

    await createTask(
      {
        label: 'revoked-test',
        cron_expression: '* * * * *',
        tool_name: 'notify_human',
        tool_args: {},
        passport_id: 'p1',
        passport_version: '1',
        permission_snapshot: FAKE_SNAPSHOT,
      },
      makeL3Claims(),
    );

    mockDispatchTool.mockClear();
    await cronCallback!();
    expect(mockDispatchTool).not.toHaveBeenCalled();
  });
});
```

Also add these two lines to the top of the hoisted block in tasks.test.ts:
```typescript
const { mockCronSchedule, mockCronValidate, mockDispatchTool } = vi.hoisted(() => ({
  mockCronSchedule: vi.fn(),
  mockCronValidate: vi.fn().mockReturnValue(true),
  mockDispatchTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] }),
}));
// ...
vi.mock('../dispatch.js', () => ({ dispatchTool: mockDispatchTool }));
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/tasks.test.ts -t "fireTask"
```
Expected: FAIL — `mockDispatchTool` not called (fireTask is still a stub)

- [ ] **Step 3.3: Replace the fireTask stub in `capabilities/tasks/index.ts`**

Add import at top of `capabilities/tasks/index.ts`:
```typescript
import { dispatchTool } from '../../dispatch.js';
import type { TrustLevel, TrustStatus } from '../../types.js';
```

Replace the fire block in `fireTask` (lines 84-88 — the stub comment + status update):

```typescript
  // Reconstruct claims from stored passport snapshot
  const effectiveCaps = validation.effectiveSnapshot.spendCaps;
  // We need trust level/status for enforceTrust — use the snapshot tool's minTrustLevel as proxy.
  // For a scheduled task we store enough to reconstruct minimal claims: use level 3 as safe default.
  // (Delegations in Phase 3 will store trust_level/trust_status explicitly.)
  const reconstructedClaims = {
    passportId: row.passport_id,
    agentId: row.passport_id, // placeholder — tasks predate agentId storage
    trustLevel: 3 as TrustLevel,
    trustStatus: 'seller_confirmed' as TrustStatus,
    flags: [] as string[],
    spendCaps: effectiveCaps
      ? { maxPerCallUsdc: effectiveCaps.maxPerCallUsdc ?? Infinity, dailyCapUsdc: effectiveCaps.dailyCapUsdc ?? Infinity }
      : undefined,
    isDisputed: false,
    version: row.passport_version,
  };

  const toolArgs = JSON.parse(row.tool_args) as Record<string, unknown>;
  await dispatchTool(row.tool_name, toolArgs, reconstructedClaims);

  db.prepare(
    'UPDATE scheduled_tasks SET last_fired_at = ?, last_fire_status = ? WHERE label = ?',
  ).run(new Date().toISOString(), 'success', label);
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/tasks.test.ts
```
Expected: all tasks tests PASS including the two new fireTask tests

- [ ] **Step 3.5: Commit**

```bash
git add packages/hands-and-feet/src/capabilities/tasks/index.ts packages/hands-and-feet/src/__tests__/tasks.test.ts
git commit -m "feat(haf): replace fireTask stub with real dispatchTool execution (Phase 2)"
```

---

## Task 4: Add new DB tables for delegations, triggers, identity, memory (Phase 3 + 4 + 5 prep)

**Files:**
- Modify: `packages/hands-and-feet/src/spend-tracker.ts`

- [ ] **Step 4.1: Write the failing test**

Add to `packages/hands-and-feet/src/__tests__/spend-tracker.test.ts` (open to check count, then add):

```typescript
describe('new tables exist after openDb()', () => {
  it('delegations table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT id, label, passport_id, passport_version, agent_id, trust_level, trust_status, tool_allowlist, spend_caps, action_budgets, status, created_at FROM delegations LIMIT 1').all()
    ).not.toThrow();
  });

  it('delegation_usage table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT id, delegation_id, tool, call_count, spent_usdc, window_start FROM delegation_usage LIMIT 1').all()
    ).not.toThrow();
  });

  it('triggers table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT id, label, source, match_json, action_json, delegation_id, status, last_fired_at, last_fire_status FROM triggers LIMIT 1').all()
    ).not.toThrow();
  });

  it('agent_identity table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT agent_id, primary_wallet, email, phone, updated_at FROM agent_identity LIMIT 1').all()
    ).not.toThrow();
  });

  it('memory table exists', () => {
    const db = openDb();
    expect(() =>
      db.prepare('SELECT key, value_json, updated_at FROM memory LIMIT 1').all()
    ).not.toThrow();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/spend-tracker.test.ts -t "new tables"
```
Expected: FAIL — tables do not exist yet

- [ ] **Step 4.3: Add tables to `openDb()` in `spend-tracker.ts`**

Append to the `_db.exec(...)` string in `openDb()`, after the `rss_items` table:

```typescript
    CREATE TABLE IF NOT EXISTS delegations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL,
      passport_id TEXT NOT NULL,
      passport_version TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      trust_level INTEGER NOT NULL,
      trust_status TEXT NOT NULL,
      tool_allowlist TEXT NOT NULL DEFAULT '[]',
      spend_caps TEXT NOT NULL DEFAULT '{}',
      action_budgets TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delegation_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delegation_id INTEGER NOT NULL REFERENCES delegations(id) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      spent_usdc REAL NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL,
      UNIQUE(delegation_id, tool)
    );
    CREATE TABLE IF NOT EXISTS triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT UNIQUE NOT NULL,
      source TEXT NOT NULL,
      match_json TEXT NOT NULL DEFAULT '{}',
      action_json TEXT NOT NULL,
      delegation_id INTEGER REFERENCES delegations(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_fired_at TEXT,
      last_fire_status TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_identity (
      agent_id TEXT PRIMARY KEY,
      primary_wallet TEXT,
      email TEXT,
      phone TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/spend-tracker.test.ts
```
Expected: all spend-tracker tests pass including the 5 new table-existence tests

- [ ] **Step 4.5: Commit**

```bash
git add packages/hands-and-feet/src/spend-tracker.ts packages/hands-and-feet/src/__tests__/spend-tracker.test.ts
git commit -m "feat(haf): add delegations, triggers, identity, memory tables (Phase 3-5 prep)"
```

---

## Task 5: Create `delegations` capability — `executeUnderDelegation` + CRUD tools (Phase 3)

**Files:**
- Create: `packages/hands-and-feet/src/capabilities/delegations/index.ts`
- Create: `packages/hands-and-feet/src/__tests__/delegations.test.ts`
- Modify: `packages/hands-and-feet/src/dispatch.ts` (add 3 delegation tool cases)

- [ ] **Step 5.1: Write failing tests**

```typescript
// packages/hands-and-feet/src/__tests__/delegations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

const { mockIsPaused, mockDispatchTool, mockValidate } = vi.hoisted(() => ({
  mockIsPaused: vi.fn().mockReturnValue(false),
  mockDispatchTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"ok":true}' }] }),
  mockValidate: vi.fn(),
}));

vi.mock('../state.js', () => ({ isPaused: mockIsPaused }));
vi.mock('../dispatch.js', () => ({ dispatchTool: mockDispatchTool }));
vi.mock('../capabilities/tasks/revocation.js', () => ({
  validateTaskPassport: mockValidate,
}));
vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({ registryUrl: 'http://localhost:8000' })),
  CONFIG_DIR: '/tmp/test-haf-del',
  ensureConfigDir: vi.fn(),
}));
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(() => {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (path: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

import Database from 'better-sqlite3';
import { _resetDb } from '../spend-tracker.js';
import {
  createDelegation,
  listDelegations,
  revokeDelegation,
  executeUnderDelegation,
} from '../capabilities/delegations/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL3Claims(overrides: Partial<PassportClaims> = {}): PassportClaims {
  return {
    passportId: 'p1', agentId: 'agent1', trustLevel: 3,
    trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1',
    spendCaps: { maxPerCallUsdc: 100, dailyCapUsdc: 500 },
    ...overrides,
  };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
  mockIsPaused.mockReturnValue(false);
  mockDispatchTool.mockResolvedValue({ content: [{ type: 'text', text: '{"ok":true}' }] });
  mockValidate.mockResolvedValue({ decision: 'allow', effectiveSnapshot: { tool: 'notify_human', spendCaps: { maxPerCallUsdc: 100, dailyCapUsdc: 500 } } });
});

describe('createDelegation', () => {
  it('stores delegation and returns label', async () => {
    const result = await createDelegation({
      label: 'del-1',
      tool_allowlist: ['notify_human', 'send_email'],
      spend_caps: { maxPerCallUsdc: 10, dailyCapUsdc: 50 },
      action_budgets: { notify_human: 5 },
    }, makeL3Claims());
    expect(result.label).toBe('del-1');
    expect(result.status).toBe('active');
  });

  it('throws TrustError for L2 caller', async () => {
    const { TrustError } = await import('../trust.js');
    await expect(
      createDelegation({ label: 'x', tool_allowlist: [], spend_caps: {}, action_budgets: {} },
        makeL3Claims({ trustLevel: 2, trustStatus: 'creator_claimed' }))
    ).rejects.toThrow(TrustError);
  });
});

describe('executeUnderDelegation', () => {
  async function makeDelegation(allowlist = ['notify_human'], budgets: Record<string, number> = {}) {
    return createDelegation({
      label: `del-${Date.now()}`,
      tool_allowlist: allowlist,
      spend_caps: { maxPerCallUsdc: 100, dailyCapUsdc: 500 },
      action_budgets: budgets,
    }, makeL3Claims());
  }

  it('calls dispatchTool on success', async () => {
    const { label } = await makeDelegation(['notify_human']);
    await executeUnderDelegation(label, 'notify_human', { message: 'hi' });
    expect(mockDispatchTool).toHaveBeenCalledWith('notify_human', { message: 'hi' }, expect.objectContaining({ passportId: 'p1' }));
  });

  it('denies tool not in allowlist', async () => {
    const { label } = await makeDelegation(['send_email']);
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not in allowlist');
  });

  it('halts when kill switch is engaged', async () => {
    mockIsPaused.mockReturnValue(true);
    const { label } = await makeDelegation(['notify_human']);
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('PAUSED');
    expect(mockDispatchTool).not.toHaveBeenCalled();
  });

  it('denies when passport is revoked', async () => {
    mockValidate.mockResolvedValue({ decision: 'deny', reason: 'passport_revoked', effectiveSnapshot: { tool: 'notify_human' } });
    const { label } = await makeDelegation(['notify_human']);
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('passport_revoked');
  });

  it('enforces action budget and marks exhausted', async () => {
    const { label } = await makeDelegation(['notify_human'], { notify_human: 1 });
    // First call succeeds
    await executeUnderDelegation(label, 'notify_human', {});
    // Second call is denied
    const result = await executeUnderDelegation(label, 'notify_human', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('budget exhausted');
  });

  it('narrower-wins: lower cap from registry overrides delegation cap', async () => {
    mockValidate.mockResolvedValue({
      decision: 'allow',
      effectiveSnapshot: { tool: 'notify_human', spendCaps: { maxPerCallUsdc: 5, dailyCapUsdc: 20 } },
    });
    const { label } = await makeDelegation(['notify_human']);
    await executeUnderDelegation(label, 'notify_human', {});
    // The claims passed to dispatchTool should have the narrower cap (5, not 100)
    const calledClaims = mockDispatchTool.mock.calls[0][2] as PassportClaims;
    expect(calledClaims.spendCaps?.maxPerCallUsdc).toBe(5);
  });
});

describe('revokeDelegation', () => {
  it('sets status to revoked', async () => {
    await createDelegation({ label: 'del-r', tool_allowlist: [], spend_caps: {}, action_budgets: {} }, makeL3Claims());
    const result = await revokeDelegation({ label: 'del-r' }, makeL3Claims());
    expect(result.revoked).toBe(true);

    const list = await listDelegations({}, makeL3Claims());
    expect(list.delegations[0].status).toBe('revoked');
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/delegations.test.ts
```
Expected: FAIL — `Cannot find module '../capabilities/delegations/index.js'`

- [ ] **Step 5.3: Create `capabilities/delegations/index.ts`**

```typescript
// packages/hands-and-feet/src/capabilities/delegations/index.ts
import { randomUUID } from 'crypto';
import { openDb } from '../../spend-tracker.js';
import { readConfig } from '../../config.js';
import { isPaused } from '../../state.js';
import { enforceTrust } from '../../trust.js';
import { dispatchTool } from '../../dispatch.js';
import { validateTaskPassport } from '../tasks/revocation.js';
import type { PassportClaims, TrustLevel, TrustStatus, ToolDefinition } from '../../types.js';
import type { DispatchResult } from '../../dispatch.js';

// ── Tool definitions ────────────────────────────────────────────
const CREATE_DELEGATION_TOOL: ToolDefinition = { name: 'create_delegation', minTrustLevel: 3 };
const LIST_DELEGATIONS_TOOL: ToolDefinition  = { name: 'list_delegations',  minTrustLevel: 2 };
const REVOKE_DELEGATION_TOOL: ToolDefinition = { name: 'revoke_delegation', minTrustLevel: 3 };

export const DELEGATION_TOOLS = {
  create_delegation: CREATE_DELEGATION_TOOL,
  list_delegations:  LIST_DELEGATIONS_TOOL,
  revoke_delegation: REVOKE_DELEGATION_TOOL,
};

// ── Row types ───────────────────────────────────────────────────
interface DelegationRow {
  id: number;
  label: string;
  passport_id: string;
  passport_version: string;
  agent_id: string;
  trust_level: number;
  trust_status: string;
  tool_allowlist: string; // JSON string[]
  spend_caps: string;     // JSON {maxPerCallUsdc?: number, dailyCapUsdc?: number}
  action_budgets: string; // JSON Record<string, number>
  status: string;
  created_at: string;
}

interface UsageRow {
  id: number;
  delegation_id: number;
  tool: string;
  call_count: number;
  spent_usdc: number;
  window_start: string;
}

// ── CRUD tools ──────────────────────────────────────────────────
export async function createDelegation(
  params: {
    label?: string;
    tool_allowlist: string[];
    spend_caps: { maxPerCallUsdc?: number; dailyCapUsdc?: number };
    action_budgets: Record<string, number>;
  },
  claims: PassportClaims,
): Promise<{ label: string; status: string }> {
  enforceTrust(claims, CREATE_DELEGATION_TOOL);

  const label = params.label ?? `del-${randomUUID().slice(0, 8)}`;
  const db = openDb();

  db.prepare(`
    INSERT INTO delegations
      (label, passport_id, passport_version, agent_id, trust_level, trust_status,
       tool_allowlist, spend_caps, action_budgets, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    label,
    claims.passportId,
    claims.version,
    claims.agentId,
    claims.trustLevel,
    claims.trustStatus,
    JSON.stringify(params.tool_allowlist),
    JSON.stringify(params.spend_caps),
    JSON.stringify(params.action_budgets),
    new Date().toISOString(),
  );

  return { label, status: 'active' };
}

export async function listDelegations(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ delegations: Array<Omit<DelegationRow, 'id'>> }> {
  enforceTrust(claims, LIST_DELEGATIONS_TOOL);
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM delegations WHERE status != 'deleted' ORDER BY created_at ASC")
    .all() as DelegationRow[];
  return { delegations: rows.map(({ id: _id, ...rest }) => rest) };
}

export async function revokeDelegation(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; revoked: boolean }> {
  enforceTrust(claims, REVOKE_DELEGATION_TOOL);
  const db = openDb();
  const result = db
    .prepare("UPDATE delegations SET status = 'revoked' WHERE label = ? AND status = 'active'")
    .run(params.label);
  return { label: params.label, revoked: result.changes > 0 };
}

// ── Execution wrapper ───────────────────────────────────────────
export async function executeUnderDelegation(
  delegationLabel: string,
  tool: string,
  args: unknown,
): Promise<DispatchResult> {
  const db = openDb();

  // Load delegation
  const delegation = db
    .prepare('SELECT * FROM delegations WHERE label = ?')
    .get(delegationLabel) as DelegationRow | undefined;

  if (!delegation) return { content: [{ type: 'text', text: `Delegation not found: ${delegationLabel}` }], isError: true };
  if (delegation.status !== 'active') return { content: [{ type: 'text', text: `Delegation is ${delegation.status}` }], isError: true };

  // 1. Kill switch
  if (isPaused()) return { content: [{ type: 'text', text: 'PAUSED: Hands and Feet is paused' }], isError: true };

  // 2. Re-validate passport against live registry
  let config: { registryUrl?: string };
  try { config = readConfig() as { registryUrl?: string }; } catch { config = {}; }
  const registryUrl = config.registryUrl ?? 'http://localhost:8000';

  const validation = await validateTaskPassport(
    delegation.passport_id,
    delegation.passport_version,
    { tool, spendCaps: JSON.parse(delegation.spend_caps) as { maxPerCallUsdc?: number; dailyCapUsdc?: number } },
    registryUrl,
  );

  if (validation.decision === 'deny') {
    return { content: [{ type: 'text', text: `Passport denied: ${validation.reason}` }], isError: true };
  }

  // 3. Check tool allowlist
  const allowlist = JSON.parse(delegation.tool_allowlist) as string[];
  if (!allowlist.includes(tool)) {
    return { content: [{ type: 'text', text: `Tool '${tool}' not in allowlist for delegation '${delegationLabel}'` }], isError: true };
  }

  // 4. Check & increment action budget
  const budgets = JSON.parse(delegation.action_budgets) as Record<string, number>;
  const toolBudget = budgets[tool];
  if (toolBudget !== undefined) {
    const usage = db
      .prepare('SELECT call_count FROM delegation_usage WHERE delegation_id = ? AND tool = ?')
      .get(delegation.id, tool) as UsageRow | undefined;
    const currentCount = usage?.call_count ?? 0;
    if (currentCount >= toolBudget) {
      db.prepare("UPDATE delegations SET status = 'exhausted' WHERE id = ?").run(delegation.id);
      return { content: [{ type: 'text', text: `Action budget exhausted for tool '${tool}' in delegation '${delegationLabel}'` }], isError: true };
    }
    // Atomically increment
    db.prepare(`
      INSERT INTO delegation_usage (delegation_id, tool, call_count, spent_usdc, window_start)
      VALUES (?, ?, 1, 0, ?)
      ON CONFLICT(delegation_id, tool) DO UPDATE SET call_count = call_count + 1
    `).run(delegation.id, tool, new Date().toISOString());
  }

  // 5. Narrower-wins on spend caps: min(delegation.spend_caps, effectiveSnapshot.spendCaps)
  const delCaps = JSON.parse(delegation.spend_caps) as { maxPerCallUsdc?: number; dailyCapUsdc?: number };
  const regCaps = validation.effectiveSnapshot.spendCaps;
  const effectiveCaps = {
    maxPerCallUsdc: Math.min(delCaps.maxPerCallUsdc ?? Infinity, regCaps?.maxPerCallUsdc ?? Infinity),
    dailyCapUsdc:   Math.min(delCaps.dailyCapUsdc   ?? Infinity, regCaps?.dailyCapUsdc   ?? Infinity),
  };

  // 6. Reconstruct claims and dispatch
  const reconstructedClaims: PassportClaims = {
    passportId:  delegation.passport_id,
    agentId:     delegation.agent_id,
    trustLevel:  delegation.trust_level as TrustLevel,
    trustStatus: delegation.trust_status as TrustStatus,
    flags:       [],
    spendCaps: {
      maxPerCallUsdc: isFinite(effectiveCaps.maxPerCallUsdc) ? effectiveCaps.maxPerCallUsdc : 9999,
      dailyCapUsdc:   isFinite(effectiveCaps.dailyCapUsdc)   ? effectiveCaps.dailyCapUsdc   : 9999,
    },
    isDisputed: false,
    version:    delegation.passport_version,
  };

  return dispatchTool(tool, args, reconstructedClaims);
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/delegations.test.ts
```
Expected: all 9 delegations tests PASS

- [ ] **Step 5.5: Add delegation tool cases to `dispatch.ts`**

Add at the top of `dispatch.ts` (import block):
```typescript
import { createDelegation, listDelegations, revokeDelegation, DELEGATION_TOOLS } from './capabilities/delegations/index.js';
```

Add before the final `return err(...)` line in `dispatchTool`:
```typescript
    if (name === 'create_delegation') return ok(await createDelegation(args as { label?: string; tool_allowlist: string[]; spend_caps: { maxPerCallUsdc?: number; dailyCapUsdc?: number }; action_budgets: Record<string, number> }, claims));
    if (name === 'list_delegations')  return ok(await listDelegations({}, claims));
    if (name === 'revoke_delegation') return ok(await revokeDelegation(args as { label: string }, claims));
```

Re-export `DELEGATION_TOOLS` is not needed in dispatch.ts — tools are registered in server.ts directly.

- [ ] **Step 5.6: Add delegation tools to `server.ts` ListTools handler**

In `server.ts`, in the `ListToolsRequestSchema` handler, add after the mail tools block:

```typescript
      // Delegation tools
      {
        name: 'create_delegation',
        description: 'Creates a bounded delegation grant for unattended execution. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            label: { type: 'string', description: 'Delegation label (auto-generated if omitted)' },
            tool_allowlist: { type: 'array', items: { type: 'string' }, description: 'Tools this delegation may call' },
            spend_caps: { type: 'object', properties: { maxPerCallUsdc: { type: 'number' }, dailyCapUsdc: { type: 'number' } }, description: 'USDC spend caps' },
            action_budgets: { type: 'object', description: 'Per-tool call budgets e.g. {"notify_human": 10}' },
          },
          required: ['tool_allowlist', 'spend_caps', 'action_budgets'],
        },
      },
      {
        name: 'list_delegations',
        description: 'Lists all delegations. Requires L2 trust.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'revoke_delegation',
        description: 'Revokes an active delegation. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          properties: { label: { type: 'string' } },
          required: ['label'],
        },
      },
```

- [ ] **Step 5.7: Run full suite**

```bash
cd packages/hands-and-feet && npm test
```
Expected: all existing + new delegations tests pass

- [ ] **Step 5.8: Commit**

```bash
git add packages/hands-and-feet/src/capabilities/delegations/index.ts packages/hands-and-feet/src/__tests__/delegations.test.ts packages/hands-and-feet/src/dispatch.ts packages/hands-and-feet/src/server.ts
git commit -m "feat(haf): add delegations model and executeUnderDelegation (Phase 3)"
```

---

## Task 6: Create triggers — unified event-driven wakeups (Phase 4)

**Files:**
- Create: `packages/hands-and-feet/src/capabilities/triggers/index.ts`
- Create: `packages/hands-and-feet/src/__tests__/triggers.test.ts`
- Modify: `packages/hands-and-feet/src/dispatch.ts` (add 4 trigger tool cases)
- Modify: `packages/hands-and-feet/src/server.ts` (ListTools + `loadActiveTriggers` on boot)

- [ ] **Step 6.1: Write failing tests**

```typescript
// packages/hands-and-feet/src/__tests__/triggers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

const { mockExecuteUnder, mockCronSchedule, mockCronValidate } = vi.hoisted(() => ({
  mockExecuteUnder: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] }),
  mockCronSchedule: vi.fn(),
  mockCronValidate: vi.fn().mockReturnValue(true),
}));

vi.mock('../capabilities/delegations/index.js', () => ({
  executeUnderDelegation: mockExecuteUnder,
}));
vi.mock('node-cron', () => ({
  schedule: mockCronSchedule,
  validate: mockCronValidate,
  getTasks: vi.fn().mockReturnValue(new Map()),
}));
vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({ registryUrl: 'http://localhost:8000' })),
  CONFIG_DIR: '/tmp/test-haf-trig',
  ensureConfigDir: vi.fn(),
}));
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(() => {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (p: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

import Database from 'better-sqlite3';
import { _resetDb } from '../spend-tracker.js';
import {
  createTrigger,
  listTriggers,
  deleteTrigger,
  renderTemplate,
  matchAndFire,
} from '../capabilities/triggers/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeL3Claims(): PassportClaims {
  return { passportId: 'p1', agentId: 'a1', trustLevel: 3, trustStatus: 'seller_confirmed', flags: [], isDisputed: false, version: '1' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
  vi.clearAllMocks();
  mockCronValidate.mockReturnValue(true);
  mockCronSchedule.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  mockExecuteUnder.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
});

describe('renderTemplate', () => {
  it('substitutes {{event.field}} with event data', () => {
    const template = { message: '{{event.subject}}', to: '{{event.from}}' };
    const event = { subject: 'Hello', from: 'alice@example.com' };
    const result = renderTemplate(template, event);
    expect(result).toEqual({ message: 'Hello', to: 'alice@example.com' });
  });

  it('leaves unmatched placeholders as-is', () => {
    const template = { msg: '{{event.missing}}' };
    const result = renderTemplate(template, {});
    expect(result).toEqual({ msg: '{{event.missing}}' });
  });

  it('does not evaluate expressions — only string substitution', () => {
    const template = { msg: '{{event.x + 1}}' };
    const result = renderTemplate(template, { x: '5' });
    // No match because key is 'x + 1', not 'x'
    expect(result).toEqual({ msg: '{{event.x + 1}}' });
  });
});

describe('createTrigger', () => {
  it('creates a cron trigger and schedules it', async () => {
    const result = await createTrigger({
      label: 'ping-hourly',
      source: 'cron',
      match: { cron_expression: '0 * * * *' },
      action: { tool_name: 'notify_human', tool_args_template: { message: 'hourly ping' } },
      delegation_label: null,
    }, makeL3Claims());
    expect(result.status).toBe('active');
    expect(mockCronSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  });

  it('throws TrustError for L2 caller', async () => {
    const { TrustError } = await import('../trust.js');
    await expect(
      createTrigger({ label: 'x', source: 'webhook', match: {}, action: { tool_name: 'notify_human', tool_args_template: {} }, delegation_label: null },
        { ...makeL3Claims(), trustLevel: 2, trustStatus: 'creator_claimed' })
    ).rejects.toThrow(TrustError);
  });
});

describe('matchAndFire (webhook source)', () => {
  it('fires matching trigger and calls executeUnderDelegation', async () => {
    // Create a delegation first (using direct DB insert to bypass full delegation module)
    const db = (await import('../spend-tracker.js')).openDb();
    db.prepare(`INSERT INTO delegations (label, passport_id, passport_version, agent_id, trust_level, trust_status, tool_allowlist, spend_caps, action_budgets, status, created_at)
      VALUES ('del-1', 'p1', '1', 'a1', 3, 'seller_confirmed', '["notify_human"]', '{}', '{}', 'active', '2026-01-01')`).run();

    await createTrigger({
      label: 'wh-trigger',
      source: 'webhook',
      match: { webhook_label: 'my-hook' },
      action: { tool_name: 'notify_human', tool_args_template: { message: 'webhook fired: {{event.body}}' } },
      delegation_label: 'del-1',
    }, makeL3Claims());

    await matchAndFire('webhook', { webhook_label: 'my-hook', body: 'payload' });

    expect(mockExecuteUnder).toHaveBeenCalledWith(
      'del-1',
      'notify_human',
      { message: 'webhook fired: payload' },
    );
  });

  it('does not fire a paused trigger', async () => {
    const db = (await import('../spend-tracker.js')).openDb();
    db.prepare(`INSERT INTO delegations (label, passport_id, passport_version, agent_id, trust_level, trust_status, tool_allowlist, spend_caps, action_budgets, status, created_at) VALUES ('del-2', 'p1', '1', 'a1', 3, 'seller_confirmed', '["notify_human"]', '{}', '{}', 'active', '2026-01-01')`).run();

    const { label } = await createTrigger({
      label: 'wh-paused',
      source: 'webhook',
      match: { webhook_label: 'my-hook' },
      action: { tool_name: 'notify_human', tool_args_template: {} },
      delegation_label: 'del-2',
    }, makeL3Claims());

    await deleteTrigger({ label }, makeL3Claims());
    mockExecuteUnder.mockClear();
    await matchAndFire('webhook', { webhook_label: 'my-hook' });
    expect(mockExecuteUnder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/triggers.test.ts
```
Expected: FAIL — `Cannot find module '../capabilities/triggers/index.js'`

- [ ] **Step 6.3: Create `capabilities/triggers/index.ts`**

```typescript
// packages/hands-and-feet/src/capabilities/triggers/index.ts
import * as cron from 'node-cron';
import { randomUUID } from 'crypto';
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import { executeUnderDelegation } from '../delegations/index.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ── Tool definitions ────────────────────────────────────────────
const CREATE_TRIGGER_TOOL: ToolDefinition = { name: 'create_trigger', minTrustLevel: 3 };
const LIST_TRIGGERS_TOOL: ToolDefinition  = { name: 'list_triggers',  minTrustLevel: 2 };
const DELETE_TRIGGER_TOOL: ToolDefinition = { name: 'delete_trigger', minTrustLevel: 3 };
const PAUSE_TRIGGER_TOOL: ToolDefinition  = { name: 'pause_trigger',  minTrustLevel: 3 };

export const TRIGGER_TOOLS = {
  create_trigger: CREATE_TRIGGER_TOOL,
  list_triggers:  LIST_TRIGGERS_TOOL,
  delete_trigger: DELETE_TRIGGER_TOOL,
  pause_trigger:  PAUSE_TRIGGER_TOOL,
};

// ── Row type ────────────────────────────────────────────────────
interface TriggerRow {
  id: number;
  label: string;
  source: string;
  match_json: string;
  action_json: string;
  delegation_id: number | null;
  status: string;
  last_fired_at: string | null;
  last_fire_status: string | null;
}

const activeJobs = new Map<string, ReturnType<typeof cron.schedule>>();

// ── Template renderer (string substitution only) ─────────────────
export function renderTemplate(
  template: Record<string, unknown>,
  event: Record<string, unknown>,
): Record<string, unknown> {
  const rendered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v === 'string') {
      rendered[k] = v.replace(/\{\{event\.([^}]+)\}\}/g, (_match, field: string) => {
        const val = event[field];
        return val !== undefined ? String(val) : `{{event.${field}}}`;
      });
    } else {
      rendered[k] = v;
    }
  }
  return rendered;
}

// ── CRUD ─────────────────────────────────────────────────────────
export async function createTrigger(
  params: {
    label?: string;
    source: 'cron' | 'webhook' | 'email' | 'sms' | 'rss';
    match: Record<string, unknown>;
    action: { tool_name: string; tool_args_template: Record<string, unknown> };
    delegation_label: string | null;
  },
  claims: PassportClaims,
): Promise<{ label: string; status: string }> {
  enforceTrust(claims, CREATE_TRIGGER_TOOL);

  const label = params.label ?? `trigger-${randomUUID().slice(0, 8)}`;
  const db = openDb();

  // Resolve delegation_id
  let delegationId: number | null = null;
  if (params.delegation_label) {
    const row = db.prepare('SELECT id FROM delegations WHERE label = ?').get(params.delegation_label) as { id: number } | undefined;
    delegationId = row?.id ?? null;
  }

  db.prepare(`
    INSERT INTO triggers (label, source, match_json, action_json, delegation_id, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(
    label,
    params.source,
    JSON.stringify(params.match),
    JSON.stringify(params.action),
    delegationId,
  );

  // For cron triggers, schedule immediately
  if (params.source === 'cron') {
    const expr = (params.match as { cron_expression?: string }).cron_expression;
    if (expr && cron.validate(expr)) {
      const job = cron.schedule(expr, () => {
        matchAndFire('cron', { trigger_label: label }).catch((e: unknown) => {
          console.error(`[triggers] cron fire error for '${label}':`, e instanceof Error ? e.message : String(e));
        });
      });
      activeJobs.set(label, job);
    }
  }

  return { label, status: 'active' };
}

export async function listTriggers(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ triggers: Array<Omit<TriggerRow, 'id'>> }> {
  enforceTrust(claims, LIST_TRIGGERS_TOOL);
  const db = openDb();
  const rows = db.prepare("SELECT * FROM triggers WHERE status != 'deleted' ORDER BY rowid ASC").all() as TriggerRow[];
  return { triggers: rows.map(({ id: _id, ...rest }) => rest) };
}

export async function deleteTrigger(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; deleted: boolean }> {
  enforceTrust(claims, DELETE_TRIGGER_TOOL);
  const job = activeJobs.get(params.label);
  if (job) { job.stop(); activeJobs.delete(params.label); }
  const db = openDb();
  const result = db.prepare("UPDATE triggers SET status = 'deleted' WHERE label = ?").run(params.label);
  return { label: params.label, deleted: result.changes > 0 };
}

export async function pauseTrigger(
  params: { label: string },
  claims: PassportClaims,
): Promise<{ label: string; paused: boolean }> {
  enforceTrust(claims, PAUSE_TRIGGER_TOOL);
  const job = activeJobs.get(params.label);
  if (job) job.stop();
  const db = openDb();
  const result = db.prepare("UPDATE triggers SET status = 'paused' WHERE label = ? AND status = 'active'").run(params.label);
  return { label: params.label, paused: result.changes > 0 };
}

// ── Fire engine ──────────────────────────────────────────────────
/**
 * Called by receiver hooks and cron jobs.
 * source: 'cron'|'webhook'|'email'|'sms'|'rss'
 * event: source-specific payload used for matching + template rendering
 */
export async function matchAndFire(
  source: string,
  event: Record<string, unknown>,
): Promise<void> {
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM triggers WHERE source = ? AND status = 'active'")
    .all(source) as TriggerRow[];

  for (const row of rows) {
    const match = JSON.parse(row.match_json) as Record<string, unknown>;
    if (!matchesPredicate(match, event)) continue;

    const action = JSON.parse(row.action_json) as { tool_name: string; tool_args_template: Record<string, unknown> };
    const renderedArgs = renderTemplate(action.tool_args_template, event);

    let fireStatus = 'success';
    try {
      if (row.delegation_id !== null) {
        const del = db.prepare('SELECT label FROM delegations WHERE id = ?').get(row.delegation_id) as { label: string } | undefined;
        if (del) {
          const result = await executeUnderDelegation(del.label, action.tool_name, renderedArgs);
          if (result.isError) fireStatus = `error:${result.content[0]?.text ?? 'unknown'}`;
        } else {
          fireStatus = 'error:delegation_not_found';
        }
      } else {
        // No delegation — only allow notify_human (HITL)
        if (action.tool_name !== 'notify_human') {
          fireStatus = 'error:no_delegation_required';
        }
        // notify_human without delegation is allowed (it's a human-side alert, not an agent action)
      }
    } catch (e) {
      fireStatus = `error:${e instanceof Error ? e.message : String(e)}`;
    }

    db.prepare("UPDATE triggers SET last_fired_at = ?, last_fire_status = ? WHERE id = ?")
      .run(new Date().toISOString(), fireStatus, row.id);
  }
}

function matchesPredicate(match: Record<string, unknown>, event: Record<string, unknown>): boolean {
  // For cron: trigger_label match
  if ('trigger_label' in match) return match['trigger_label'] === event['trigger_label'];
  // For webhook: webhook_label
  if ('webhook_label' in match) return match['webhook_label'] === event['webhook_label'];
  // For email: from_contains
  if ('from_contains' in match) {
    const from = String(event['from'] ?? '');
    return from.includes(String(match['from_contains']));
  }
  // For sms: from_number match
  if ('from_number' in match) return match['from_number'] === event['from_number'];
  // For rss: feed_label + optional keyword
  if ('feed_label' in match) {
    if (match['feed_label'] !== event['feed_label']) return false;
    if ('keyword' in match) return String(event['title'] ?? '').includes(String(match['keyword']));
    return true;
  }
  return false;
}

// ── Boot loader ──────────────────────────────────────────────────
export function loadActiveTriggers(): void {
  const db = openDb();
  const rows = db
    .prepare("SELECT * FROM triggers WHERE source = 'cron' AND status = 'active'")
    .all() as TriggerRow[];

  for (const row of rows) {
    const match = JSON.parse(row.match_json) as { cron_expression?: string };
    const expr = match.cron_expression;
    if (!expr || !cron.validate(expr)) {
      console.warn(`[triggers] invalid cron expression for trigger '${row.label}'`);
      continue;
    }
    const job = cron.schedule(expr, () => {
      matchAndFire('cron', { trigger_label: row.label }).catch((e: unknown) => {
        console.error(`[triggers] cron fire error for '${row.label}':`, e instanceof Error ? e.message : String(e));
      });
    });
    activeJobs.set(row.label, job);
  }
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/triggers.test.ts
```
Expected: all triggers tests PASS

- [ ] **Step 6.5: Add trigger cases to `dispatch.ts`**

Add import:
```typescript
import { createTrigger, listTriggers, deleteTrigger, pauseTrigger } from './capabilities/triggers/index.js';
```

Add before the final `return err(...)`:
```typescript
    if (name === 'create_trigger') return ok(await createTrigger(args as { label?: string; source: 'cron'|'webhook'|'email'|'sms'|'rss'; match: Record<string, unknown>; action: { tool_name: string; tool_args_template: Record<string, unknown> }; delegation_label: string|null }, claims));
    if (name === 'list_triggers')  return ok(await listTriggers({}, claims));
    if (name === 'delete_trigger') return ok(await deleteTrigger(args as { label: string }, claims));
    if (name === 'pause_trigger')  return ok(await pauseTrigger(args as { label: string }, claims));
```

- [ ] **Step 6.6: Add trigger ListTools entries and update `startServer` boot in `server.ts`**

In the `ListToolsRequestSchema` handler, add after delegation tools:
```typescript
      // Trigger tools
      {
        name: 'create_trigger',
        description: 'Creates an event trigger (cron/webhook/email/sms/rss) that fires a tool under a delegation. Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          required: ['source', 'match', 'action', 'delegation_label'],
          properties: {
            label: { type: 'string' },
            source: { type: 'string', enum: ['cron', 'webhook', 'email', 'sms', 'rss'] },
            match: { type: 'object', description: 'Source-specific predicate: {cron_expression} | {webhook_label} | {from_contains} | {from_number} | {feed_label, keyword?}' },
            action: { type: 'object', required: ['tool_name', 'tool_args_template'], properties: { tool_name: { type: 'string' }, tool_args_template: { type: 'object' } } },
            delegation_label: { type: ['string', 'null'], description: 'Delegation label to execute under (required for any tool other than notify_human)' },
          },
        },
      },
      {
        name: 'list_triggers',
        description: 'Lists all triggers. Requires L2 trust.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'delete_trigger',
        description: 'Deletes a trigger. Requires L3 trust.',
        inputSchema: { type: 'object' as const, properties: { label: { type: 'string' } }, required: ['label'] },
      },
      {
        name: 'pause_trigger',
        description: 'Pauses a trigger without deleting it. Requires L3 trust.',
        inputSchema: { type: 'object' as const, properties: { label: { type: 'string' } }, required: ['label'] },
      },
```

In `server.ts`, add import:
```typescript
import { loadActiveTriggers } from './capabilities/triggers/index.js';
```

In `startServer`, replace `loadActiveTasks()` call:
```typescript
      try {
        loadActiveTasks();
        loadActiveTriggers();
      } catch (err: unknown) {
        console.error('Failed to load active tasks/triggers:', err instanceof Error ? err.message : String(err));
      }
```

- [ ] **Step 6.7: Run full suite**

```bash
cd packages/hands-and-feet && npm test
```
Expected: all pass

- [ ] **Step 6.8: Commit**

```bash
git add packages/hands-and-feet/src/capabilities/triggers/index.ts packages/hands-and-feet/src/__tests__/triggers.test.ts packages/hands-and-feet/src/dispatch.ts packages/hands-and-feet/src/server.ts
git commit -m "feat(haf): add triggers system — cron/webhook/email/sms/rss wakeups (Phase 4)"
```

---

## Task 7: Wire trigger matcher hooks to receivers (Phase 4)

**Files:**
- Modify: `packages/hands-and-feet/src/capabilities/webhook/index.ts`
- Modify: `packages/hands-and-feet/src/capabilities/email/index.ts`
- Modify: `packages/hands-and-feet/src/capabilities/phone-jmp/index.ts`
- Modify: `packages/hands-and-feet/src/capabilities/rss/index.ts`

- [ ] **Step 7.1: Webhook receiver hook**

In `packages/hands-and-feet/src/capabilities/webhook/index.ts`, find `webhookReceiver` and add after storing the event:

```typescript
// Near top of file, add:
import { matchAndFire } from '../triggers/index.js';

// In webhookReceiver, after the db.prepare INSERT for webhook_events (the event was stored),
// add:
  matchAndFire('webhook', {
    webhook_label: label,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: JSON.stringify(req.headers),
  }).catch((e: unknown) => console.error('[triggers] webhook matchAndFire error:', e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 7.2: Email receiver hook**

In `packages/hands-and-feet/src/capabilities/email/index.ts`, find where inbound email is stored in the `emails` table (in the SMTP server `onData` handler). After the INSERT, add:

```typescript
// Near top of file, add:
import { matchAndFire } from '../triggers/index.js';

// After email is inserted into the emails table:
  matchAndFire('email', {
    mailbox_address: to,
    from: from,
    subject: parsed.subject ?? '',
    body: parsed.text ?? '',
  }).catch((e: unknown) => console.error('[triggers] email matchAndFire error:', e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 7.3: SMS (JMP) receiver hook**

In `packages/hands-and-feet/src/capabilities/phone-jmp/index.ts`, find where inbound XMPP messages are handled (the `stanza` event handler). After processing an inbound SMS, add:

```typescript
// Near top of file, add:
import { matchAndFire } from '../triggers/index.js';

// After recording the inbound SMS:
  matchAndFire('sms', {
    from_number: fromNumber,
    body: messageBody,
  }).catch((e: unknown) => console.error('[triggers] sms matchAndFire error:', e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 7.4: RSS new-item hook**

In `packages/hands-and-feet/src/capabilities/rss/index.ts`, find `addFeedItem`. After inserting the new item, add:

```typescript
// Near top of file, add:
import { matchAndFire } from '../triggers/index.js';

// After the INSERT into rss_items:
  matchAndFire('rss', {
    feed_label: params.feed_label,
    title: params.title,
    description: params.description,
    url: params.url ?? '',
  }).catch((e: unknown) => console.error('[triggers] rss matchAndFire error:', e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 7.5: Run full suite**

```bash
cd packages/hands-and-feet && npm test
```
Expected: all pass (the hooks are fire-and-forget, existing tests unaffected)

- [ ] **Step 7.6: Commit**

```bash
git add packages/hands-and-feet/src/capabilities/webhook/index.ts packages/hands-and-feet/src/capabilities/email/index.ts packages/hands-and-feet/src/capabilities/phone-jmp/index.ts packages/hands-and-feet/src/capabilities/rss/index.ts
git commit -m "feat(haf): wire trigger matcher hooks to webhook/email/sms/rss receivers (Phase 4)"
```

---

## Task 8: Body — identity + memory tools (Phase 5)

**Files:**
- Create: `packages/hands-and-feet/src/capabilities/body/index.ts`
- Create: `packages/hands-and-feet/src/__tests__/body.test.ts`
- Modify: `packages/hands-and-feet/src/dispatch.ts`
- Modify: `packages/hands-and-feet/src/server.ts`

- [ ] **Step 8.1: Write failing tests**

```typescript
// packages/hands-and-feet/src/__tests__/body.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PassportClaims } from '../types.js';

vi.mock('../config.js', () => ({
  readConfig: vi.fn(() => ({})),
  CONFIG_DIR: '/tmp/test-haf-body',
  ensureConfigDir: vi.fn(),
}));
vi.mock('better-sqlite3', () => {
  let db: import('better-sqlite3').Database | null = null;
  const Ctor = vi.fn(() => {
    if (!db) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
      const RealDB = (require('better-sqlite3') as any) as new (p: string) => import('better-sqlite3').Database;
      db = new RealDB(':memory:');
    }
    return db;
  });
  (Ctor as unknown as { resetDb: () => void }).resetDb = () => { db = null; };
  return { default: Ctor };
});

import Database from 'better-sqlite3';
import { _resetDb } from '../spend-tracker.js';
import {
  getIdentity,
  setIdentityBinding,
  getMemory,
  setMemory,
  listMemory,
  deleteMemory,
} from '../capabilities/body/index.js';

const MockDatabase = Database as unknown as { resetDb: () => void };

function makeClaims(): PassportClaims {
  return { passportId: 'p1', agentId: 'agent1', trustLevel: 2, trustStatus: 'creator_claimed', flags: [], isDisputed: false, version: '1' };
}

beforeEach(() => {
  MockDatabase.resetDb();
  _resetDb();
});

describe('identity', () => {
  it('returns null fields before any binding is set', async () => {
    const result = await getIdentity({}, makeClaims());
    expect(result.identity).toBeNull();
  });

  it('round-trips set and get', async () => {
    await setIdentityBinding({ field: 'email', value: 'bot@example.com' }, makeClaims());
    const result = await getIdentity({}, makeClaims());
    expect(result.identity?.email).toBe('bot@example.com');
  });

  it('updates an existing field without wiping others', async () => {
    await setIdentityBinding({ field: 'email', value: 'a@b.com' }, makeClaims());
    await setIdentityBinding({ field: 'phone', value: '+15555555555' }, makeClaims());
    const result = await getIdentity({}, makeClaims());
    expect(result.identity?.email).toBe('a@b.com');
    expect(result.identity?.phone).toBe('+15555555555');
  });
});

describe('memory', () => {
  it('returns null for missing key', async () => {
    const result = await getMemory({ key: 'nope' }, makeClaims());
    expect(result.value).toBeNull();
  });

  it('round-trips set and get', async () => {
    await setMemory({ key: 'ctx', value: { step: 3 } }, makeClaims());
    const result = await getMemory({ key: 'ctx' }, makeClaims());
    expect(result.value).toEqual({ step: 3 });
  });

  it('overwrites on re-set', async () => {
    await setMemory({ key: 'k', value: 'old' }, makeClaims());
    await setMemory({ key: 'k', value: 'new' }, makeClaims());
    const result = await getMemory({ key: 'k' }, makeClaims());
    expect(result.value).toBe('new');
  });

  it('listMemory returns all keys', async () => {
    await setMemory({ key: 'a', value: 1 }, makeClaims());
    await setMemory({ key: 'b', value: 2 }, makeClaims());
    const result = await listMemory({}, makeClaims());
    expect(result.keys).toContain('a');
    expect(result.keys).toContain('b');
  });

  it('deleteMemory removes the key', async () => {
    await setMemory({ key: 'gone', value: 'bye' }, makeClaims());
    await deleteMemory({ key: 'gone' }, makeClaims());
    const result = await getMemory({ key: 'gone' }, makeClaims());
    expect(result.value).toBeNull();
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/body.test.ts
```
Expected: FAIL — `Cannot find module '../capabilities/body/index.js'`

- [ ] **Step 8.3: Create `capabilities/body/index.ts`**

```typescript
// packages/hands-and-feet/src/capabilities/body/index.ts
import { openDb } from '../../spend-tracker.js';
import { enforceTrust } from '../../trust.js';
import type { PassportClaims, ToolDefinition } from '../../types.js';

// ── Tool definitions ────────────────────────────────────────────
const GET_IDENTITY_TOOL: ToolDefinition     = { name: 'get_identity',        minTrustLevel: 2 };
const SET_IDENTITY_TOOL: ToolDefinition     = { name: 'set_identity_binding', minTrustLevel: 3 };
const GET_MEMORY_TOOL: ToolDefinition       = { name: 'get_memory',          minTrustLevel: 2 };
const SET_MEMORY_TOOL: ToolDefinition       = { name: 'set_memory',          minTrustLevel: 2 };
const LIST_MEMORY_TOOL: ToolDefinition      = { name: 'list_memory',         minTrustLevel: 2 };
const DELETE_MEMORY_TOOL: ToolDefinition    = { name: 'delete_memory',       minTrustLevel: 3 };

export const BODY_TOOLS = {
  get_identity: GET_IDENTITY_TOOL,
  set_identity_binding: SET_IDENTITY_TOOL,
  get_memory: GET_MEMORY_TOOL,
  set_memory: SET_MEMORY_TOOL,
  list_memory: LIST_MEMORY_TOOL,
  delete_memory: DELETE_MEMORY_TOOL,
};

// ── Row types ───────────────────────────────────────────────────
interface IdentityRow {
  agent_id: string;
  primary_wallet: string | null;
  email: string | null;
  phone: string | null;
  updated_at: string;
}

// ── Identity tools ───────────────────────────────────────────────
export async function getIdentity(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ identity: Omit<IdentityRow, 'agent_id'> | null }> {
  enforceTrust(claims, GET_IDENTITY_TOOL);
  const db = openDb();
  const row = db.prepare('SELECT * FROM agent_identity WHERE agent_id = ?').get(claims.agentId) as IdentityRow | undefined;
  if (!row) return { identity: null };
  const { agent_id: _id, ...rest } = row;
  return { identity: rest };
}

export async function setIdentityBinding(
  params: { field: 'primary_wallet' | 'email' | 'phone'; value: string },
  claims: PassportClaims,
): Promise<{ updated: boolean }> {
  enforceTrust(claims, SET_IDENTITY_TOOL);
  const db = openDb();
  const existing = db.prepare('SELECT * FROM agent_identity WHERE agent_id = ?').get(claims.agentId) as IdentityRow | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE agent_identity SET ${params.field} = ?, updated_at = ? WHERE agent_id = ?`)
      .run(params.value, now, claims.agentId);
  } else {
    const init: Record<string, string | null> = { primary_wallet: null, email: null, phone: null };
    init[params.field] = params.value;
    db.prepare('INSERT INTO agent_identity (agent_id, primary_wallet, email, phone, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(claims.agentId, init.primary_wallet, init.email, init.phone, now);
  }
  return { updated: true };
}

// ── Memory tools ─────────────────────────────────────────────────
export async function getMemory(
  params: { key: string },
  claims: PassportClaims,
): Promise<{ key: string; value: unknown }> {
  enforceTrust(claims, GET_MEMORY_TOOL);
  const db = openDb();
  const row = db.prepare('SELECT value_json FROM memory WHERE key = ?').get(params.key) as { value_json: string } | undefined;
  return { key: params.key, value: row ? (JSON.parse(row.value_json) as unknown) : null };
}

export async function setMemory(
  params: { key: string; value: unknown },
  claims: PassportClaims,
): Promise<{ key: string; saved: boolean }> {
  enforceTrust(claims, SET_MEMORY_TOOL);
  const db = openDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO memory (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(params.key, JSON.stringify(params.value), now);
  return { key: params.key, saved: true };
}

export async function listMemory(
  _params: Record<string, unknown>,
  claims: PassportClaims,
): Promise<{ keys: string[] }> {
  enforceTrust(claims, LIST_MEMORY_TOOL);
  const db = openDb();
  const rows = db.prepare('SELECT key FROM memory ORDER BY updated_at DESC').all() as { key: string }[];
  return { keys: rows.map((r) => r.key) };
}

export async function deleteMemory(
  params: { key: string },
  claims: PassportClaims,
): Promise<{ key: string; deleted: boolean }> {
  enforceTrust(claims, DELETE_MEMORY_TOOL);
  const db = openDb();
  const result = db.prepare('DELETE FROM memory WHERE key = ?').run(params.key);
  return { key: params.key, deleted: result.changes > 0 };
}
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
cd packages/hands-and-feet && npx vitest run src/__tests__/body.test.ts
```
Expected: all 8 body tests PASS

- [ ] **Step 8.5: Add body cases to `dispatch.ts`**

Add import:
```typescript
import { getIdentity, setIdentityBinding, getMemory, setMemory, listMemory, deleteMemory } from './capabilities/body/index.js';
```

Add before `return err(...)`:
```typescript
    if (name === 'get_identity')        return ok(await getIdentity({}, claims));
    if (name === 'set_identity_binding') return ok(await setIdentityBinding(args as { field: 'primary_wallet'|'email'|'phone'; value: string }, claims));
    if (name === 'get_memory')          return ok(await getMemory(args as { key: string }, claims));
    if (name === 'set_memory')          return ok(await setMemory(args as { key: string; value: unknown }, claims));
    if (name === 'list_memory')         return ok(await listMemory({}, claims));
    if (name === 'delete_memory')       return ok(await deleteMemory(args as { key: string }, claims));
```

- [ ] **Step 8.6: Add body ListTools entries to `server.ts`**

```typescript
      // Body tools
      {
        name: 'get_identity',
        description: 'Returns the agent\'s stored identity bindings (wallet, email, phone). Requires L2 trust.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'set_identity_binding',
        description: 'Sets one field of the agent\'s identity (primary_wallet, email, or phone). Requires L3 trust.',
        inputSchema: {
          type: 'object' as const,
          required: ['field', 'value'],
          properties: {
            field: { type: 'string', enum: ['primary_wallet', 'email', 'phone'] },
            value: { type: 'string' },
          },
        },
      },
      {
        name: 'get_memory',
        description: 'Reads a durable memory value by key. Requires L2 trust.',
        inputSchema: { type: 'object' as const, required: ['key'], properties: { key: { type: 'string' } } },
      },
      {
        name: 'set_memory',
        description: 'Writes a durable memory value. Survives restarts. Requires L2 trust.',
        inputSchema: {
          type: 'object' as const,
          required: ['key', 'value'],
          properties: { key: { type: 'string' }, value: { description: 'Any JSON-serializable value' } },
        },
      },
      {
        name: 'list_memory',
        description: 'Lists all memory keys, newest first. Requires L2 trust.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'delete_memory',
        description: 'Deletes a memory key. Requires L3 trust.',
        inputSchema: { type: 'object' as const, required: ['key'], properties: { key: { type: 'string' } } },
      },
```

- [ ] **Step 8.7: Run full suite**

```bash
cd packages/hands-and-feet && npm test
```
Expected: all pass

- [ ] **Step 8.8: Commit**

```bash
git add packages/hands-and-feet/src/capabilities/body/index.ts packages/hands-and-feet/src/__tests__/body.test.ts packages/hands-and-feet/src/dispatch.ts packages/hands-and-feet/src/server.ts
git commit -m "feat(haf): add identity + memory tools (Phase 5)"
```

---

## Task 9: Rename to `@opentrust/hands-body-and-feet` 2.0.0 (Phase 6)

**Files:**
- Modify: `packages/hands-and-feet/package.json`
- Modify: `packages/hands-and-feet/src/server.ts` (MCP server name string)
- Rename dir: `packages/hands-and-feet/` → `packages/hands-body-and-feet/`
- Modify: `CLAUDE.md`
- Create migration note in `packages/hands-body-and-feet/CHANGELOG.md`

- [ ] **Step 9.1: Verify full suite passes before rename**

```bash
cd packages/hands-and-feet && npm test
```
Expected: all pass — clean baseline before the rename

- [ ] **Step 9.2: Update `package.json`**

In `packages/hands-and-feet/package.json`:
- Change `"name": "@opentrust/hands-and-feet"` → `"name": "@opentrust/hands-body-and-feet"`
- Change `"version": "1.0.0"` → `"version": "2.0.0"`
- Change `"hands-and-feet": "./bin/hands-and-feet.js"` under `"bin"` → `"hands-body-and-feet": "./bin/hands-and-feet.js"`

- [ ] **Step 9.3: Update MCP server name string in `server.ts`**

Change:
```typescript
  const server = new Server(
    { name: 'hands-and-feet', version: '0.1.0' },
```
to:
```typescript
  const server = new Server(
    { name: 'hands-body-and-feet', version: '2.0.0' },
```

- [ ] **Step 9.4: git mv the directory**

```bash
cd /path/to/opentrust && git mv packages/hands-and-feet packages/hands-body-and-feet
```

- [ ] **Step 9.5: Update `CLAUDE.md`**

Change the table row:
```
| `packages/hands-and-feet` typecheck + tests (333 tests)
```
references and the packages table entry for `hands-and-feet` → `hands-body-and-feet`.

Specifically in the CI section:
```
6. `packages/hands-body-and-feet` typecheck + tests
```

And in the Repository layout table if it references the package:
Add or update: `| `packages/hands-body-and-feet/` | TypeScript MCP server — gives agents real-world capabilities; the persistent body |`

- [ ] **Step 9.6: Update `.github/workflows/ci.yml`**

Change:
```yaml
      - run: cd packages/hands-and-feet && npm ci && npm run typecheck && npm test
```
to:
```yaml
      - run: cd packages/hands-body-and-feet && npm ci && npm run typecheck && npm test
```

- [ ] **Step 9.7: Write CHANGELOG migration note**

Create `packages/hands-body-and-feet/CHANGELOG.md`:

```markdown
# Changelog — @opentrust/hands-body-and-feet

## 2.0.0 — 2026-05-28

**Breaking changes:**
- Package renamed from `@opentrust/hands-and-feet` to `@opentrust/hands-body-and-feet`
- Binary renamed from `hands-and-feet` to `hands-body-and-feet`
- MCP server name string changed from `hands-and-feet` to `hands-body-and-feet`

**Migration:** Update your `package.json` dependency and MCP client config:
```json
// Before
"@opentrust/hands-and-feet": "^1.0.0"
// After
"@opentrust/hands-body-and-feet": "^2.0.0"
```

**New capabilities:**
- `dispatchTool` — unified internal execution seam (all tools now route through one function)
- **Delegations** — `create_delegation`, `list_delegations`, `revoke_delegation`: store bounded grants for unattended execution with allowlist + spend caps + action budgets
- **Triggers** — `create_trigger`, `list_triggers`, `delete_trigger`, `pause_trigger`: wake the agent on cron/webhook/email/sms/rss events
- **Identity** — `get_identity`, `set_identity_binding`: stable agent-owned wallet/email/phone bindings
- **Memory** — `get_memory`, `set_memory`, `list_memory`, `delete_memory`: durable KV survives restarts

**Safety:**
- All triggered execution runs under a delegation (no unguarded path from event → tool)
- Kill switch (`isPaused`) now also halts delegated execution
- Live passport re-validation on every delegation fire (narrower-wins caps)

## 1.0.0

Initial stable release.
```

- [ ] **Step 9.8: Run suite from new directory**

```bash
cd packages/hands-body-and-feet && npm test
```
Expected: all pass (same count as before rename)

- [ ] **Step 9.9: Commit**

```bash
git add packages/hands-body-and-feet/ CLAUDE.md .github/workflows/ci.yml
git commit -m "feat(haf): rename to @opentrust/hands-body-and-feet v2.0.0 (Phase 6)"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Phase 1 (Mechanism A dispatcher): Tasks 1 + 2
- ✅ Phase 2 (real execution + cron): Task 3
- ✅ Phase 3 (delegations model): Tasks 4 + 5
- ✅ Phase 4 (event triggers): Tasks 6 + 7
- ✅ Phase 5 (identity + memory): Task 8
- ✅ Phase 6 (rename): Task 9
- ✅ Kill switch halts delegated execution: covered in `executeUnderDelegation` (Task 5), tested in delegations test
- ✅ Narrower-wins caps: covered in `executeUnderDelegation` (Task 5), tested
- ✅ All triggered execution under delegation: enforced in `matchAndFire` (Task 6), no delegation → only notify_human allowed
- ✅ `loadActiveTriggers` on boot: Task 6 Step 6.6
- ✅ Template rendering (string substitution only): `renderTemplate` (Task 6), tested

**Type consistency:**
- `dispatchTool` returns `DispatchResult` (exported type) — used consistently in delegations and triggers
- `executeUnderDelegation` takes `(delegationLabel: string, tool: string, args: unknown)` — matches calls in `matchAndFire`
- `renderTemplate` takes and returns `Record<string, unknown>` — consistent with `action.tool_args_template`
- `loadActiveTriggers` (triggers module) called in `startServer` alongside `loadActiveTasks`
