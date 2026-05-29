# Changelog — @opentrust/hands-body-and-feet

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
