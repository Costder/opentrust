# Changelog — @infinitestudios/hands-body-and-feet

## 2.3.0 — 2026-06-03

**AgentMail email transport — real hosted inboxes (send + receive).**

- New `agentmail` email transport: each agent gets a hosted inbox via
  agentmail.to (set `AGENTMAIL_API_KEY`). Unlike postmark/resend (send-only) or
  self-hosted local SMTP, it does send AND receive with no SMTP server.
- `create_mailbox` provisions a real inbox; `read_inbox` / `wait_for_email` poll
  AgentMail; `ingestAgentMailWebhook` handles real-time `message.received` events.
- `hands-body-and-feet init` offers AgentMail as the easiest email setup.
- Defaults switched to the branded OpenTrust domain
  (`api.opentrust.infiniterealms.io`).

## 2.2.0 — 2026-05-29

**Works out of the box against the hosted registry.**

The client always called `POST /api/v1/passports/validate` (HTTP auth) and
`GET /api/v1/passports/{id}` (task/delegation re-validation), but the registry
never implemented those routes — so every registry-backed trust check 404'd and
fail-closed. The persistence epic's tasks/delegations could therefore never fire
against a real registry.

- **Registry now implements the validation contract** (`api/src/routes/passport_auth.py`):
  - `POST /api/v1/passports/validate` — verifies the agent passport JWT (HS256,
    registry `JWT_SECRET`), checks revocation + disputed state, returns claims.
  - `GET /api/v1/passports/{id}` — stateless revocation oracle (valid unless
    explicitly revoked) in the exact shape the client's re-validation expects.
- **Default registry URL is now the hosted official registry**, centralized in
  one place (`DEFAULT_REGISTRY_URL` in `config.ts`) and overridable via the
  `OPENTRUST_REGISTRY_URL` env var or a `registryUrl` in config.json. Previously
  the default was `http://localhost:8000`, which silently required every user to
  run their own registry. (The hardcoded default is currently the Vercel project
  URL; swap it for a stable custom domain when one exists.)

Net effect: a fresh install talks to the official registry with no setup, and
scheduled-task / delegation re-validation actually works against it.

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
