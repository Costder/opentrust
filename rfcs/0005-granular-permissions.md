# RFC 0005: Granular Permission Scopes

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-18
- **PR:** TBD

## Summary

The v0.2 permission schema introduces granular, machine-enforceable permission scopes to replace boolean permission fields. Boolean fields (e.g., `"network": true`) are advisory-only and cannot be enforced at runtime — a tool claiming `"network": false` can still make arbitrary outbound requests. Granular scopes define exact boundaries: allowed domains, allowed commands, file path patterns, and spending limits. This enables agent runtimes to enforce declared permissions and makes tool security reviewable and composable across platforms.

## Motivation

Early 2026 has seen 30+ Model Context Protocol CVEs, with supply chain attacks targeting MCP registries and public tool registries. The fundamental issue is that boolean permission declarations are not enforceable — they serve as documentation only. A tool may claim `"terminal": false` but still execute arbitrary shell commands if the runtime does not restrict it.

Current scenarios:
- A tool declares `"network": false` to signal it avoids external calls, but there is no technical barrier preventing outbound requests.
- A tool declares `"file": true` claiming to need file access, but reviewers cannot determine if it needs to read configuration, write outputs, or delete files — all three carry very different risk profiles.
- A tool declares `"wallet": true` with no granularity on spending limits or blockchain restrictions, forcing agents to choose between complete trust and complete denial.
- Supply chain attacks target tools in registries by modifying their published passports to remove declared restrictions.

Granular scopes solve this by:
1. Enabling runtimes to enforce permission boundaries at the system call level.
2. Allowing reviewers to audit exact capability claims against tool behavior.
3. Making it possible to detect when a tool's declared behavior changes (by hashing the permission scope).
4. Enabling agent orchestrators to compose tools based on precise capability boundaries.

## Proposed Change

### Schema overview

The v0.2 permission manifest maintains backward compatibility with boolean fields while introducing structured scope objects for each permission type. A permission can be declared as:

```json
{
  "file": true,           // Old style: boolean, advisory-only
  "network": {            // New style: granular scopes
    "allowed_domains": ["api.github.com"],
    "allowed_schemes": ["https"],
    "outbound_only": true
  },
  "terminal": false       // Boolean false means no permission
}
```

### Permission types and granular scopes

#### File permission

```json
{
  "file": {
    "read": ["./docs/**", "./config/**"],
    "write": ["./output/**"],
    "delete": [],
    "watch": false,
    "notes": "Reads docs and config, writes outputs only. No deletion or file watching."
  }
}
```

**Fields:**
- `read`: array of glob patterns the tool may read, or `true` for unrestricted read access.
- `write`: array of glob patterns the tool may write or create, or `true` for unrestricted write.
- `delete`: array of glob patterns the tool may delete, or `true` for unrestricted deletion. Any non-empty delete scope is flagged as high-risk by reviewers.
- `watch`: boolean whether the tool may watch paths for filesystem changes (inotify, FSEvents, etc.). Flagged if combined with network access.
- `notes`: human-readable explanation of file access needs.

#### Network permission

```json
{
  "network": {
    "allowed_domains": ["api.github.com", "*.openai.com"],
    "blocked_domains": ["malicious-domain.xyz"],
    "allowed_schemes": ["https"],
    "outbound_only": true,
    "max_request_size_kb": 5000,
    "notes": "Calls GitHub and OpenAI APIs over HTTPS only. No server mode."
  }
}
```

**Fields:**
- `allowed_domains`: exact hostnames or single-level wildcards (`*.example.com`) the tool may contact. No URL scheme — declared separately in `allowed_schemes`.
- `blocked_domains`: domains the tool explicitly will not contact (useful for tools handling sensitive data that want to declare they never phone home).
- `allowed_schemes`: array of URL schemes (`https`, `http`, `wss`, `ws`, `ftp`). Defaults to `["https"]`. Using `http` or `ws` is flagged as insecure unless justified.
- `outbound_only`: boolean whether the tool only makes outbound requests. `false` means the tool binds a listening port — flagged for human review.
- `max_request_size_kb`: maximum payload size per request in KB, helping agents reason about data exfiltration risk.
- `notes`: explanation of network use case.

#### Terminal permission

```json
{
  "terminal": {
    "allowed_commands": ["git", "npm", "python3"],
    "forbidden_commands": ["rm -rf", "curl | sh", "sudo", "su"],
    "shell_access": false,
    "working_directory": "./project",
    "timeout_seconds": 30,
    "notes": "Runs git, npm, and Python. No shell escapes, no privilege escalation, 30s timeout per command."
  }
}
```

**Fields:**
- `allowed_commands`: exact command names the tool may execute. If empty and `forbidden_commands` is set, the tool may run any command except those on the forbidden list.
- `forbidden_commands`: commands the tool will never execute. Validators check this list against known-dangerous patterns (`rm -rf`, `curl | sh`, `sudo`, `su`, etc.).
- `shell_access`: boolean whether the tool may spawn an interactive shell. `true` is a critical risk flag — agents require `reviewer_signed` minimum trust.
- `working_directory`: directory the tool operates in. Absolute paths outside `/tmp` or the project root are flagged by validators.
- `timeout_seconds`: maximum execution time per command, preventing infinite loops or resource exhaustion.
- `notes`: explanation of shell requirements.

#### Memory permission

```json
{
  "memory": {
    "read_context": true,
    "write_context": true,
    "persistence": "session",
    "scope": "local",
    "notes": "Reads and writes call-specific context. Data does not persist across sessions."
  }
}
```

**Fields:**
- `read_context`: boolean whether the tool may read the calling agent's conversation context or memory store.
- `write_context`: boolean whether the tool may write or inject into the agent's memory. High-risk if true.
- `persistence`: enum (`none`, `session`, `persistent`). Declares whether memory writes persist beyond a single call. `persistent` means cross-session storage.
- `scope`: enum (`local`, `shared`). `shared` means the tool may read/write memory visible to other agents or sessions — flagged as high-risk.
- `notes`: explanation of memory use.

#### Wallet permission

```json
{
  "wallet": {
    "read_balance": true,
    "sign_transactions": true,
    "max_per_call_usd": 100.00,
    "allowed_chains": ["base", "polygon"],
    "allowed_tokens": ["USDC", "ETH"],
    "escrow_only": false,
    "notes": "Reads balance, signs transactions on Base and Polygon. Max $100 per call."
  }
}
```

**Fields:**
- `read_balance`: boolean whether the tool may read wallet balance.
- `sign_transactions`: boolean whether the tool may sign and submit transactions. Critical-risk — requires caller to enforce spend policy.
- `max_per_call_usd`: maximum USD value the tool may transact in a single call. Agents must enforce this limit.
- `allowed_chains`: array of blockchain networks the tool may transact on (e.g., `["base", "ethereum"]`).
- `allowed_tokens`: array of token contract addresses or well-known symbols the tool may transact (e.g., `["USDC", "ETH"]`).
- `escrow_only`: boolean whether the tool only transacts through escrow contracts (no direct wallet sends). Lowers risk profile if true.
- `notes`: explanation of wallet use.

### High-risk pattern flags

Validators must identify and flag these patterns during review:

| Pattern | Risk Level | Reason |
|---------|-----------|--------|
| `file.write` with empty `forbidden_paths` | HIGH | Unlimited write access can corrupt or exfiltrate files. |
| `file.delete` with any non-empty value | HIGH | Deletion is rarely recoverable. Must be human-reviewed. |
| `network` unrestricted (boolean `true` or no `allowed_domains`) | MEDIUM | Tool may contact arbitrary domains. Difficult to audit for supply chain attacks. |
| `network.allowed_schemes` includes `http` or `ws` | MEDIUM | Unencrypted traffic can be intercepted. |
| `terminal.shell_access: true` | CRITICAL | Interactive shell enables arbitrary code execution. Requires `reviewer_signed` minimum. |
| `terminal.allowed_commands` empty with `shell_access: true` | CRITICAL | Combination of shell access and no command allowlist is unrestricted execution. |
| `wallet.sign_transactions: true` without spending limits | CRITICAL | Unlimited fund access. Requires strict spend policy enforcement. |
| `wallet.sign_transactions: true` with `max_per_call_usd` unset | CRITICAL | No transaction amount ceiling. Agent must enforce via spend policy. |
| `memory.write_context: true` with `scope: "shared"` | HIGH | Tool can inject data into shared agent memory, affecting other tools. |

### Machine-readable risk score

Passports should include a computed risk score reflecting the permission set. Agents may use this to decide whether to call a tool.

**Levels:**
- **low** — Permissions are strictly bounded with no critical flags. Examples: read-only file access to specific docs, HTTPS-only network access to one domain, no terminal access.
- **medium** — Some broad permissions but with mitigations. Examples: write access to output folder only, network access to multiple domains with HTTP flagged but noted, read-only memory access, wallet read-only access.
- **high** — Significant privileges requiring careful review. Examples: unrestricted file write access, unrestricted network with no domain allowlist, terminal access to specific commands, wallet transactions with strict spending limits.
- **critical** — Permissions that demand human review and minimum trust level of `reviewer_signed`. Examples: shell access, unlimited fund transactions, write access to shared memory, deletion permissions.

**Triggering factors:**
- Any critical pattern flag → **critical**
- Two or more high pattern flags → **high**
- One high pattern flag → **medium** (unless mitigated by clear notes)
- No flagged patterns and bounded access → **low**

## Alternatives Considered

### WASI (WebAssembly System Interface) capabilities

WASI defines a capability-based security model for WebAssembly sandboxing. Rejected because:
1. OpenTrust tools are not restricted to WASM — many are native CLI tools, Docker containers, or API services.
2. WASI's interface granularity (e.g., `fd_read`, `fd_write`) is too low-level for human review.
3. WASI capability tokens are not human-readable or portable across ecosystems.

### OPA/Rego policy language

Open Policy Agent (OPA) allows declarative permission policies in Rego. Rejected because:
1. Rego is a powerful query language but steeper learning curve for tool authors writing passports.
2. OPA requires runtime policy evaluation, adding runtime overhead and complexity.
3. OpenTrust prioritizes human-readable documentation that does not require executing code to review.

### Bare JSON with no schema

Allowing arbitrary JSON permission objects with no schema definition. Rejected because:
1. Tooling cannot validate or lint permissions without a schema.
2. Inconsistent field names across tools make aggregation and reporting difficult.
3. Supply chain audits cannot be automated if every tool uses different field structures.

## Backwards Compatibility

**v0.1 boolean fields remain fully valid.** A passport containing `"network": true` or `"terminal": false` will validate against the v0.2 schema.

**Validator behavior:** Validators supporting v0.2 SHOULD emit a deprecation warning when encountering boolean permissions on `file`, `network`, `terminal`, `wallet`, or `private_data`. They should recommend adding granular scopes to improve auditability. No validation failure.

**Migration:** Existing passports do not require updating. As tools undergo review or version updates, maintainers are encouraged to adopt granular scopes. There is no deadline or forced migration.

**Runtime interpretation:** Agents supporting v0.2 MUST treat boolean `true` as "maximally permissive" — equivalent to an empty scope object with all fields set to permissive defaults. For example, `"network": true` is equivalent to:
```json
{
  "network": {
    "allowed_domains": ["*"],
    "allowed_schemes": ["https", "http", "wss", "ws", "ftp"],
    "outbound_only": false,
    "notes": "Unrestricted network access declared via boolean. Consider requesting granular scopes."
  }
}
```

## Open Questions

1. **Glob pattern standard:** Should we specify a standard glob syntax (bash, gitignore, or another), or allow tooling to support multiple syntaxes? Currently the schema examples use bash-style globs, but implementations may differ.

2. **Computed vs. declared risk scores:** Should the risk score be declared by the tool author in the passport, computed by a validator, or both? A declared score could be fast for agents to consume, but a computed score cannot be gamed by tool authors. Recommendation: validators compute it, passports may include cached values with a timestamp.

3. **Scope version evolution:** If future permission types (e.g., for GPU/ML accelerators or blockchain oracle access) are added to v0.3 or later, how should validators handle passports with unknown scopes? Should they fail closed (reject unknown permissions as a security stance) or fail open (warn but allow)?

