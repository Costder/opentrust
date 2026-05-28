# MCP Bridge — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Package:** `@opentrust/hands-and-feet` (`packages/hands-and-feet`)
**Scope:** v1 — local stdio mounting only

---

## 1. Purpose

Turn Hands and Feet (HF) into a **trust-enforcing MCP gateway**. Instead of HF
re-implementing every real-world capability itself, it can **mount external MCP
servers** (starting with `@playwright/mcp` for browsing), re-expose an
**allowlisted** subset of their tools through HF's own `ListTools`/`CallTool`,
and run every forwarded call through HF's trust layer (`enforceTrust`) and an
audit log **before** it reaches the foreign server.

This is the highest-leverage "don't reinvent the wheel" move: HF writes zero
browser code, borrows whatever a mounted server provides, and adds its real
value — passport trust gating, the kill switch, and an audit trail — on top.

### Non-goals (v1)

- No remote HTTP/SSE MCP servers (local stdio child processes only).
- No sandboxing of mounted children beyond OS-user + env isolation.
- No application of USDC `spendCaps` to bridged tools (trust-level gating only).
- No package rename in this work item (see §10).

---

## 2. Design decisions (resolved)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Trust gating of foreign tools | **Default-deny allowlist + per-server trust floor**, with optional per-tool overrides. Nothing foreign is callable unless explicitly listed. |
| 2 | Transport scope | **Local stdio child processes only** for v1. |
| 3 | Process lifecycle | **Lazy spawn + idle shutdown.** Schemas introspected once at boot, child closed; real spawn on first call; warm while active; auto-shutdown after idle timeout. |
| 4 | Integration shape | **A1 — `BridgeManager` singleton** that augments the existing switch via two small edits in `server.ts`. The 60 native tools are untouched. |
| 5 | Namespacing | `<alias>__<originalTool>`. Native HF tools are bare → zero collision. Config validation rejects an alias containing `__`. |
| 6 | Env isolation | Child receives only config-declared `env` merged onto a minimal base — never `process.env`, so HF secrets/keystore never leak to a mounted server. |
| 7 | Audit | New `bridge_calls` SQLite table; every bridged call logged. |

---

## 3. Architecture

### 3.1 New module: `src/bridge-manager.ts` (process-level singleton)

The MCP server object is recreated per HTTP request (stateless mode), so all
long-lived bridge state lives at module scope — the same pattern as the existing
`activeTunnels` map.

**State**

```ts
interface MountedServer {
  config: MountedServerConfig;
  toolCatalog: Map<string, {           // keyed by ORIGINAL tool name
    inputSchema: object;
    description: string;
    minTrustLevel: TrustLevel;          // resolved: per-tool override else floor
  }>;
  conn?: {
    client: Client;                     // @modelcontextprotocol/sdk client
    transport: StdioClientTransport;
    child: ChildProcess;
    lastUsed: number;
    idleTimer: NodeJS.Timeout;
  };
  available: boolean;                   // false if introspection failed
}

const servers = new Map<string, MountedServer>();   // keyed by alias
```

**Methods**

- `init(config: HandsAndFeetConfig): Promise<void>`
  For each `config.mcpServers[alias]`: call `introspect(alias)`. On failure,
  log, set `available=false`, continue (HF boot never crashes over a bad mount).

- `introspect(alias)`: spawn the child via `StdioClientTransport`, `Client.connect`,
  `client.listTools()`, keep only allowlisted tools, store `inputSchema` +
  `description` + resolved `minTrustLevel` in `toolCatalog`, then **disconnect
  and kill the child**.

- `listBridgedTools(): McpToolDef[]`
  For every available server's cataloged tools, return defs with name
  `<alias>__<tool>`, description prefixed `[via <alias>] …`, and cached
  `inputSchema`.

- `handles(name: string): boolean`
  True iff `name` parses to `<alias>__<tool>` present in an available catalog.

- `callBridgedTool(name, args, claims): Promise<McpResult>`
  1. Parse `alias` + `originalName`; look up catalog entry (else throw).
  2. `enforceTrust(claims, { name, minTrustLevel })` — **HF gate, before anything.**
  3. Insert `pending` row into `bridge_calls`.
  4. `ensureConn(alias)` — lazy spawn if cold; reset idle timer.
  5. `client.callTool({ name: originalName, arguments: args })` under
     `callTimeoutMs`.
  6. Cap serialized result at `maxResultBytes` (truncate + note if exceeded).
  7. Update `bridge_calls` row to `ok`/`err`; return MCP content.
  Trust/dispute errors are allowed to throw — the existing `try/catch` around
  `CallTool` dispatch in `server.ts` converts them to `isError` content.

- `ensureConn(alias)`: if a live conn exists, return; else spawn child with
  isolated env, `Client.connect`, set `lastUsed`, arm idle timer.

- idle timer: when it fires, if `now - lastUsed >= idleTimeoutMs`, close client
  + kill child + clear `conn`.

- `shutdownAll()`: close all clients + kill all children. Wired to process exit.

### 3.2 Integration into `server.ts` (A1 — two edits + one boot call)

- `startServer`: `await bridgeManager.init(config)` **before** `app.listen`.
- `ListTools` handler: `tools: [ ...nativeTools, ...bridgeManager.listBridgedTools() ]`.
- `CallTool` handler: immediately before the `Unknown tool` fallback:
  ```ts
  if (bridgeManager.handles(name)) {
    return await bridgeManager.callBridgedTool(name, args, claims);
  }
  ```
- Pause/kill-switch (`isPaused` on `/mcp`) and the disputed overlay (in `claims`)
  are inherited automatically.

---

## 4. Config schema

Extends `HandsAndFeetConfig`:

```ts
mcpServers?: Record<string, MountedServerConfig>;

interface MountedServerConfig {
  command: string;                  // e.g. "npx"
  args?: string[];                  // e.g. ["-y","@playwright/mcp@latest","--headless","--isolated"]
  env?: Record<string, string>;     // explicit env ONLY (see §5)
  minTrustLevel: TrustLevel;        // per-server floor (1–7)
  allow: Record<string, { minTrustLevel?: TrustLevel } | true>;  // DEFAULT-DENY allowlist
  idleTimeoutMs?: number;           // default 300_000
  callTimeoutMs?: number;           // default 60_000
  maxResultBytes?: number;          // default 262_144
}
```

- **Default-deny:** only keys present in `allow` are ever exposed or callable.
- Per-tool `minTrustLevel` overrides the server floor; `true` (or omitted
  override) uses the floor.
- Config validation: reject an `alias` containing `__` or equal to any native
  HF tool name; reject empty `allow`.

---

## 5. Security — confused-deputy mitigations

HF holds the passport and forwards to code it does not control. Mitigations:

- **Default-deny allowlist** (decision 1). A server adding new tools later does
  **not** silently expose them.
- **Trust enforced before forwarding.** The child never receives the passport
  or any HF claim.
- **Env isolation.** The child's environment is the config-declared `env` only,
  merged onto a minimal base (e.g. `PATH`, `HOME`). `process.env` — which holds
  HF's keystore passphrase and provider secrets — is **never** passed through.
- **Resource limits.** Per-call timeout, result size cap, crashed-child
  isolation (one bad child errors its own tool only; HF stays up).
- **Inherited controls.** Kill switch and disputed-passport denial apply with no
  extra code.

### Documented v1 limitations

- **`spendCaps` do not apply to bridged tools.** HF's USDC per-call/daily caps
  gate native wallet/payment tools only. A bridged tool that itself spends money
  is governed by **trust level only**. Future: a per-tool "cost class" tag.
- **No process sandbox.** Children run as the same OS user as HF. Future option:
  wrap mounts in HF's existing `docker` capability.

---

## 6. Audit — `bridge_calls` table

New SQLite table via the existing `openDb()` (spend-tracker):

```
bridge_calls(
  id TEXT PRIMARY KEY,
  alias TEXT,
  tool TEXT,
  namespaced_name TEXT,
  trust_level INTEGER,
  passport_id TEXT,
  status TEXT,            -- pending | ok | err
  error TEXT,
  started_at TEXT,
  finished_at TEXT
)
```

Every bridged call writes a row. Directly closes the previously-identified
"money-only audit" gap. (A read tool over this table is a possible follow-up,
out of v1 scope.)

---

## 7. Playwright proof (first mount)

```ts
mcpServers: {
  playwright: {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--headless", "--isolated"],
    minTrustLevel: 3,
    allow: {
      browser_navigate:        { minTrustLevel: 2 },  // read-mostly
      browser_snapshot:        { minTrustLevel: 2 },
      browser_take_screenshot: { minTrustLevel: 2 },
      browser_click:           { minTrustLevel: 3 },  // interaction
      browser_type:            { minTrustLevel: 3 },
      browser_select_option:   { minTrustLevel: 3 },
      browser_press_key:       { minTrustLevel: 3 }
    },
    idleTimeoutMs: 300_000
  }
}
```

- Read tools (navigate / snapshot / screenshot) at **L2**; interactions at **L3**.
- File-download and JS-eval tools are **deliberately not allowlisted**.
- Exposed to agents as `playwright__browser_navigate`, etc.

---

## 8. Error handling

| Condition | Behavior |
|-----------|----------|
| Introspection failure at boot | Log; mark server `available=false`; omit its tools from `ListTools`; HF boots normally. |
| Tool not in allowlist | Not listed; `handles()` false; call rejected. |
| Trust / disputed failure | `enforceTrust` throws → caught by existing `CallTool` try/catch → `isError` content. |
| Child spawn failure (ENOENT, etc.) | Actionable error content (resolve `command` via npx/PATH; surface install hint). |
| Call timeout | Abort in-flight request; return timeout error; recycle the child. |
| Result exceeds `maxResultBytes` | Truncate + append a truncation note. |

---

## 9. Testing (vitest, self-contained → CI-safe)

CI runs `packages/hands-and-feet` tests with no network/secrets. Tests use a
**tiny in-repo stub MCP server fixture** (a node script exposing two fake tools,
`echo` and `secret_action`) — no real Playwright/Chromium required.

Cases:
- introspection populates the catalog;
- default-deny: an unlisted tool is absent from `ListTools` and its call is rejected;
- per-server floor enforced; per-tool override applied;
- namespacing (`alias__tool`) round-trips;
- **lazy** spawn: no child at boot, child spawned on first call;
- idle shutdown kills the child;
- `bridge_calls` row written on success and failure;
- child crash → graceful error, HF stays up;
- env isolation: child cannot read an undeclared env var;
- result size cap; call timeout.

A **separate, env-gated** integration test mounts the real `@playwright/mcp` and
navigates to a page (mirrors the prior tunnel demo). It is **excluded from CI**
and documented for local runs.

---

## 10. Package rename (scheduled, not in this work item)

The project is being renamed to **"hands, body and feet."** "Body" maps to the
persistence/identity epic (the next work item), not to the bridge (which is
"hands/feet reach"). Therefore:

- The rename is **scheduled with the persistence/identity epic**, not the bridge.
- During bridge work the package stays `@opentrust/hands-and-feet`.
- When executed, the rename is a coordinated change across: npm package name,
  `bin` name, the MCP server `name` string in `createMcpServer`, the
  `packages/` directory, and all docs — and is a natural **2.0.0** major.

---

## 11. File-level change summary

| File | Change |
|------|--------|
| `src/bridge-manager.ts` | **New.** The singleton described in §3.1. |
| `src/types.ts` | Add `MountedServerConfig`; add `mcpServers?` to `HandsAndFeetConfig`. |
| `src/server.ts` | Boot `bridgeManager.init`; spread bridged tools into `ListTools`; forward in `CallTool`. |
| `src/spend-tracker.ts` (or a new `src/bridge-db.ts`) | `bridge_calls` table DDL. |
| `src/config.ts` | Validate `mcpServers` (alias rules, non-empty allow). |
| `src/__tests__/bridge-manager.test.ts` | **New.** Cases in §9 + stub fixture. |
| `src/__tests__/fixtures/stub-mcp-server.mjs` | **New.** Self-contained stub server. |
| docs / `README` | Document the bridge, config, Playwright example, and limitations. |
