# Hands, Body and Feet — Persistence Epic Design

**Date:** 2026-05-28
**Status:** Approved (design)
**Package:** `packages/hands-and-feet` (`@opentrust/hands-and-feet` → renamed `@opentrust/hands-body-and-feet` 2.0.0 at the end)
**Execution model:** One phased spec, implemented incrementally over time (via `/loop` against `/goal`). Phases are ordered and dependency-gated; each can ship and be tested independently.

---

## Motivation

Hands and Feet (HF) gives an agent *reach* — 16 capabilities (email, phone, wallet, github, docker, ipfs, payments, tunnel, etc.) exposed as MCP tools, each gated by the caller's OpenTrust passport trust level. What it lacks is *continuity*: the agent only acts while a human is actively driving it. It cannot be woken by an external event, it forgets everything between requests, it has no stable identity of its own, and it cannot safely hand a slice of its authority to a future unattended run.

This epic adds the missing "body" — the persistent, autonomous middle between hands (tools) and feet (transport). Four capabilities, all building on primitives HF already has ~70% built:

| # | Capability | What it adds | Existing primitive it builds on |
|---|---|---|---|
| 1 | **Being woken** | External events (cron, webhook, email, SMS, RSS) trigger tool execution | `scheduled_tasks` + cron + the webhook/RSS/mail receivers |
| 2 | **Persistence** | A durable memory KV the agent can read/write across runs | SQLite via `openDb()` |
| 3 | **Identity** | A stable self — the agent's own wallet/email/phone bindings | wallet, mail, phone capabilities |
| 4 | **Bounded delegation** | Hand a narrow, capped, time-bounded slice of authority to an unattended run | `validateTaskPassport` + `narrowerCaps` (already implemented for cron tasks) |

### The keystone problem

`fireTask()` in `capabilities/tasks/index.ts` (lines ~84-88) **does not execute anything**. On an allowed fire it logs intent and sets `last_fire_status='success'` — a stub. So today HF can *schedule* and *trigger* but the trigger fires into a void. Everything in this epic hangs off fixing that: giving triggers a real, trust-checked execution path. Most of the work is *connecting* primitives, not inventing them. Real execution is the missing link.

---

## Architecture

Four mechanisms (A-D), introduced across six phases.

### Mechanism A — Internal dispatcher

Today `CallTool` is a ~300-line `if`-chain switch inside the per-request MCP server in `server.ts`. Extract it into a standalone function:

```ts
dispatchTool(name: string, args: unknown, claims: PassportClaims): Promise<CallToolResult>
```

Phase 1 makes `dispatchTool` simply *wrap* the existing switch — same logic, same `enforceTrust(claims, tool)` per-capability gating, new seam. This is the foundation everything else calls; introducing it as a pure wrapper keeps risk near zero. The live `/mcp` route is rewired to call `dispatchTool` so there is exactly one execution path.

### Mechanism B — Delegations (item #4: bounded delegation)

A delegation is a stored, narrowed grant the agent issues *to itself* for unattended use. New tables:

```
delegations(
  id, label,
  passport_id, passport_version,        -- snapshot at creation
  tool_allowlist   JSON string[],        -- which tools this grant may call
  spend_caps       JSON {maxPerCallUsdc?, dailyCapUsdc?},
  action_budgets   JSON {<tool>: <maxCalls>} | total budget,
  status           'active'|'revoked'|'exhausted',
  created_at
)
delegation_usage(
  delegation_id, tool, count, spent_usdc, window_start  -- running tallies
)
```

The enforcement wrapper:

```ts
executeUnderDelegation(delegation, tool, args): Promise<CallToolResult>
```

1. **Re-validate passport** against the live registry via `validateTaskPassport(passport_id, passport_version, snapshot, registryUrl)` → deny on revoked / disputed / unreachable; **narrower-wins** if the passport's current caps shrank since creation.
2. **Check the kill switch** — if `isPaused()`, refuse. (Today `isPaused()` only gates `/mcp`; this extends it to all triggered execution.)
3. **Check the tool allowlist** — `tool ∈ delegation.tool_allowlist` or deny.
4. **Check & increment action budget** — atomically; mark `status='exhausted'` when a budget hits zero.
5. **Enforce USDC spend caps** — per-call and daily, narrower of {delegation, live passport}.
6. **Reconstruct `PassportClaims`** from the (re-validated, narrowed) snapshot and call `dispatchTool(tool, args, claims)`.

Tools exposed: `create_delegation`, `list_delegations`, `revoke_delegation`. The **live `/mcp` path bypasses** `executeUnderDelegation` — interactive callers are gated by their own passport in real time; delegations exist only for *unattended* execution.

### Mechanism C — Triggers (item #1: being woken)

Generalize `scheduled_tasks` into a unified `triggers` table:

```
triggers(
  id, label,
  source           'cron'|'webhook'|'email'|'sms'|'rss',
  match            JSON,                 -- source-specific predicate (cron expr, webhook path, from-addr, sender, feed+keyword)
  action           JSON {tool_name, tool_args_template},
  delegation_id    -> delegations.id,    -- REQUIRED: all triggered execution runs under a delegation
  status           'active'|'paused',
  last_fired_at, last_fire_status
)
```

A **trigger-matcher hook** is added to each receiver (cron scheduler, webhook receiver, mail/XMPP inbound, RSS poller). On a match it:
1. Renders `tool_args_template` against the event via `{{event.field}}` string-substitution only (no expressions, no code).
2. Calls `executeUnderDelegation(delegation, action.tool_name, renderedArgs)`.
3. Records `last_fired_at` / `last_fire_status` and an audit entry.

This **replaces the `fireTask` stub** with real execution. `loadActiveTasks()` becomes `loadActiveTriggers()` and re-arms cron triggers on boot.

### Mechanism D — Body: identity + memory (items #3 identity, #2 persistence)

**Identity** — a single durable record of the agent's own bindings:

```
agent_identity(agentId, primary_wallet, email, phone, updated_at)
```

Tools: `get_identity`, `set_identity_binding`. This is the agent's stable self — *its* wallet to be paid into, *its* address to be reached at — distinct from the per-request caller passport.

**Memory** — a durable key/value store:

```
memory(key, value JSON, updated_at)
```

Tools: `get_memory`, `set_memory`, `list_memory`, `delete_memory`. Survives across runs; this is what lets a woken agent remember what it was doing.

---

## Safety model

- **All triggered (unattended) execution runs under a delegation.** There is no path from an external event to a tool call that skips `executeUnderDelegation`.
- **Kill switch halts everything.** `isPaused()` is checked inside `executeUnderDelegation`, not just on `/mcp`. Pausing the instance freezes triggers too.
- **Bounded by construction.** A delegation can only ever *narrow* the issuing passport's authority: allowlist ⊆ available tools, caps = min(delegation, live passport), budgets decrement to zero.
- **Live revocation.** Every fire re-validates the passport against the registry; a revoked/disputed passport kills all its delegations' execution immediately.
- **Everything audited.** Every fire writes who/what/when/result.
- **Human-in-the-loop is expressible.** A trigger can target `notify_human`, so "wake me, then ask a human before doing X" is a first-class pattern.

---

## Phases

Each phase is independently shippable and testable.

| Phase | Title | Scope | Depends on |
|---|---|---|---|
| **1** | Dispatcher foundation | Extract `CallTool` switch → `dispatchTool(name,args,claims)` as a pure wrapper; rewire `/mcp` to use it. No behavior change. | — |
| **2** | Real execution + cron | Replace the `fireTask` stub with real execution through `dispatchTool`; cron triggers actually run their tool. | 1 |
| **3** | Delegations model | `delegations` + `delegation_usage` tables; `executeUnderDelegation` wrapper; create/list/revoke tools; kill-switch + narrower-wins enforcement. | 2 |
| **4** | Event triggers | Generalize `scheduled_tasks`→`triggers`; matcher hooks on webhook/email/sms/rss receivers; `{{event.field}}` templating; all fires run under a delegation. | 2 (uses 3) |
| **5** | Identity + memory | `agent_identity` + get/set tools; `memory` KV + get/set/list/delete tools. | 1 |
| **6** | Rename → 2.0.0 | "hands, body and feet": npm package name, `bin` name, MCP server name string, `packages/` dir, docs, CLAUDE.md, migration note. | all |

**Dependency graph:** 1 → 2 → {3, 4}; 4 uses 3; 5 after 1; 6 last.

---

## Testing

All tests use **vitest** and remain fully self-contained (no network, no secrets) so CI stays green:
- Dispatcher: parity tests proving `dispatchTool` behaves identically to the old switch for each tool.
- Delegations: allowlist denial, budget exhaustion, narrower-wins caps, kill-switch halt, revoked-passport halt.
- Triggers: template rendering, matcher predicates per source, fire → execute → audit, paused trigger no-op.
- Identity/memory: round-trip get/set, list, delete, persistence across a simulated restart.

Passport re-validation against the registry is mocked (as `validateTaskPassport` tests already are).

---

## Out of scope (YAGNI)

- The MCP-bridge / trust-gateway layer (designed then dropped — MCP clients already aggregate servers).
- Expression languages or code in `tool_args_template` (string substitution only).
- A browser capability (separate effort).
- The "reshape-don't-refuse" problem-solving skill (belongs in a separate repo/thread).
