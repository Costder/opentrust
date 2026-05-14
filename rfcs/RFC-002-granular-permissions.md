# RFC-002: Granular Permission Scopes (v0.2)

**Status:** Draft  
**Author:** SoulForge / OpenTrust maintainers  
**Created:** 2026-05-14  
**Target spec version:** 0.2.0  

---

## Summary

Replace boolean-only permission flags in `permissions.schema.json` with structured scope objects that are machine-enforceable, not just declarative. Boolean values remain valid for all permissions (backward compatibility with v0.1 passports).

---

## Motivation

The current v0.1 permission manifest uses booleans:

```json
{ "file": true, "network": true, "terminal": false }
```

`network: true` tells an agent nothing useful. Does the tool contact one API or the entire internet? Does it make outbound requests only, or does it bind a listening socket? `file: true` — can it delete `/etc/passwd`?

This is worse than no information. It creates false confidence.

The v0.2 granular scopes make permissions machine-enforceable: a runtime or sandbox can read `network.allowed_domains` and enforce it at the syscall level. A validator can check `terminal.forbidden_commands` against known-dangerous patterns. An agent can read `wallet.max_per_call_usd` and enforce it against its spend policy before making the call.

---

## Specification

### Backward Compatibility

Every permission field accepts `boolean | ScopeObject`. This means:

- A v0.1 passport with `"network": true` validates against the v0.2 schema without modification.
- Validators SHOULD emit a warning when boolean `true` is used for `file`, `network`, `terminal`, `wallet`, or `private_data` — these are the surfaces where granular scopes provide real safety value.
- Agents MUST treat `boolean: true` as maximally permissive (same as v0.1 behavior).

### New Scope Objects

#### `file` → `FilePermission`

```json
{
  "file": {
    "read": ["./docs/**", "~/.config/opentrust/**"],
    "write": ["./output/**"],
    "delete": false,
    "watch": false
  }
}
```

- `read`, `write`, `delete`: `boolean | string[]` (glob patterns)
- `watch`: boolean — flag if combined with `network: true`
- Validators check: absolute paths outside `/tmp` or project root, delete scopes on sensitive paths

#### `network` → `NetworkPermission`

```json
{
  "network": {
    "allowed_domains": ["api.github.com"],
    "blocked_domains": [],
    "allowed_schemes": ["https"],
    "outbound_only": true,
    "max_request_size_kb": 512
  }
}
```

- Wildcards (`*.example.com`) are valid but flagged as elevated risk
- `http` and `ws` schemes are flagged as insecure
- `outbound_only: false` (binds a port) is flagged for review

#### `terminal` → `TerminalPermission`

```json
{
  "terminal": {
    "allowed_commands": ["git", "npm", "python3"],
    "forbidden_commands": ["rm -rf", "curl | sh", "sudo", "wget | bash"],
    "shell_access": false,
    "working_directory": "./",
    "timeout_seconds": 30
  }
}
```

- `shell_access: true` → critical risk flag, requires `reviewer_signed` minimum trust
- Validators maintain a known-dangerous command list checked against `forbidden_commands`
- Empty `allowed_commands` + populated `forbidden_commands` = "any command except forbidden list"

#### `memory` → `MemoryPermission`

```json
{
  "memory": {
    "read_context": false,
    "write_context": true,
    "persistence": "session",
    "scope": "local"
  }
}
```

- `write_context: true` is flagged for reviewer review (injection risk)
- `persistence: "persistent"` + `scope: "shared"` → highest risk combination

#### `wallet` → `WalletPermission`

```json
{
  "wallet": {
    "read_balance": true,
    "sign_transactions": true,
    "max_per_call_usd": 25.00,
    "allowed_chains": ["base"],
    "allowed_tokens": ["USDC"],
    "escrow_only": true
  }
}
```

- Any `wallet` permission → requires `reviewer_signed` minimum trust at validation
- `sign_transactions: true` without `max_per_call_usd` → validation error in strict mode

#### `api` → `ApiPermission`

```json
{
  "api": {
    "services": ["github", "openai"],
    "credential_handling": "caller_provided",
    "credentials_logged": false
  }
}
```

- `credentials_logged: true` → blocks `security_checked` trust level

#### `private_data` → `PrivateDataPermission`

```json
{
  "private_data": {
    "data_types": ["pii", "credentials"],
    "purpose": "Verify user identity before granting tool access",
    "data_minimization": true
  }
}
```

---

## Validator Behavior

Validators MUST:
- Accept `boolean | ScopeObject` for all permissions (backward compat)
- Warn on `boolean: true` for `file`, `network`, `terminal`, `wallet`, `private_data`
- Error on `wallet.sign_transactions: true` without `max_per_call_usd` (strict mode)
- Error on `terminal.shell_access: true` if trust level < `reviewer_signed`
- Check `terminal.forbidden_commands` against known-dangerous list (maintained in `docs/dangerous-commands.md`)
- Flag `network.allowed_schemes` containing `http` or `ws`

Validators SHOULD:
- Check `network.allowed_domains` against known-malicious domain lists
- Flag `file.delete` scopes containing system paths
- Warn on `memory.write_context: true` without reviewer attestation

---

## Migration

Tool authors with v0.1 passports do not need to migrate immediately. v0.1 boolean passports are valid against the v0.2 schema. Authors SHOULD migrate high-risk permissions (`network`, `terminal`, `wallet`, `file`) to structured scopes when updating to `spec_version: "0.2.0"`.

The `passport-generator` will auto-generate v0.2 granular scopes for new passports by analyzing the tool's source code and declared dependencies.

---

## Open Questions

1. **Glob standardization**: Should we specify which glob standard is used (minimatch, globby, POSIX)? Current proposal: minimatch patterns, since it's the most common in the npm ecosystem where many MCP tools live.

2. **Enforcement vs declaration**: This RFC defines the schema. Actual runtime enforcement depends on the sandbox/runtime calling the tool. Should the spec make any normative statements about runtime behavior, or remain purely declarative?

3. **network.allowed_domains wildcard policy**: Should `*` (all domains) be a validation error rather than just a warning? Proposal: error in strict mode, warning in default mode.

---

## Reference Implementation

- Updated schema: `passport-schema/permissions.schema.json`
- Example passport: `passport-schema/examples/github-search-mcp-v02.json`
- Validator changes: `manifest-validator/` (tracked separately in RFC-002-validator branch)

---

## How to Comment

Open a GitHub Discussion in this repo tagged `rfc-002`. Major changes go through PR against this file. See `rfcs/README.md` for the full governance process.
