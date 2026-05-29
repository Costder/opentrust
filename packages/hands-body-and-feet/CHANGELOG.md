# Changelog — @opentrust/hands-body-and-feet

## 2.1.0 — 2026-05-29

**New: stdio transport — one-line, harness-agnostic setup.**

Previously the server only spoke HTTP on a fixed port (3847) and required an
`Authorization: Bearer <passport>` header on every request — meaning a running
daemon, a token, and (for Claude Desktop) an `mcp-remote` shim. That's far more
friction than a normal MCP server.

The new `stdio` command makes adding the server identical to any other MCP
server — a single line in any client (Claude Code, Claude Desktop, Cursor, …):

```jsonc
{ "mcpServers": { "hands-body-and-feet": {
  "command": "npx", "args": ["-y", "@opentrust/hands-body-and-feet", "stdio"]
}}}
```

- **Zero-config:** no `init` required. The data dir auto-creates; identity
  resolves to a local L3 agent by default.
- **Identity resolution** (`stdio` mode):
  1. `OPENTRUST_PASSPORT_TOKEN` — a real passport, validated against the registry
     (or locally if `OPENTRUST_JWT_SECRET` is set).
  2. Local fallback — `OPENTRUST_AGENT_ID` (default `local-agent`) +
     `OPENTRUST_TRUST_STATUS` (default `seller_confirmed` / L3).
- **Trust still enforced:** tools check trust levels and spend caps; the kill
  switch still halts execution. The per-request bearer model stays where it
  belongs — multi-tenant HTTP deployments (`serve`).
- stdout carries only JSON-RPC; all logging is routed to stderr.

The HTTP transport (`serve`) is unchanged and remains available.

## 2.0.0 — 2026-05-28

**Breaking changes:**
- Package renamed from `@opentrust/hands-and-feet` to `@opentrust/hands-body-and-feet`
- Binary renamed from `hands-and-feet` to `hands-body-and-feet`
- MCP server name string changed from `hands-and-feet` to `hands-body-and-feet`

**Data directory:** The on-disk config directory (`~/.hands-and-feet`) is intentionally preserved
for backwards compatibility. Existing v1.0.0 users will find their data intact after upgrading.
New installations will use the same path. Docker users: the compose file now uses
`~/.hands-body-and-feet` for new deployments.
Docker users upgrading from v1.0.0: migrate your existing data with:
`mv ~/.hands-and-feet ~/.hands-body-and-feet`

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
