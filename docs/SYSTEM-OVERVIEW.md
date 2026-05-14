# OpenTrust System Overview

> Version: pre-1.0 (founder-led stage)  
> Last updated: 2026-05-14

This document is the single entry point for understanding the complete OpenTrust system — what every piece is, how they connect, and what the data flow looks like end to end.

---

## What OpenTrust Is

OpenTrust is an **open standard and reference implementation** for AI agent tool trust. It answers three questions that no existing infrastructure answers today:

1. **"Can I trust this tool?"** — verified identity, declared permissions, community/cryptographic review
2. **"What does this tool cost, and can my agent pay for it automatically?"** — machine-readable payment contract
3. **"When my agent spawns sub-agents, how does trust and budget flow?"** — orchestration identity and spend policy inheritance

OpenTrust itself **collects no fees**. It defines the spec, runs the reference registry, and maintains the CLI. Revenue for the creator comes from consulting, advisory, and ecosystem influence — not from the protocol.

---

## System Map

```
┌─────────────────────────────────────────────────────────────┐
│                        TOOL AUTHORS                         │
│  Register a passport → claim ownership → earn trust status  │
└──────────────────────────┬──────────────────────────────────┘
                           │ submit passport
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       REGISTRY                              │
│  Stores passports · Signs them (Ed25519) · Serves search    │
│  Maintains revocation list · Hosts reviewer key set         │
│  Publishes /.well-known/ endpoints                          │
└──────┬─────────────────────────────────────────┬────────────┘
       │ fetch passport                           │ verify
       ▼                                         ▼
┌─────────────┐                        ┌────────────────────┐
│   AGENTS    │ ──── X-Agent-Identity ─▶   TOOLS (servers)  │
│  (callers)  │ ──── X-Spend-Policy ───▶                    │
│             │ ──── X-Payment-TxHash ─▶                    │
│  Enforce    │                        │  Verify payment    │
│  spend      │ ◀── access token ─────  │  Check revocation │
│  policy     │                        │  Serve response    │
└──────┬──────┘                        └────────────────────┘
       │ spawn
       ▼
┌─────────────┐
│  SUB-AGENTS │  (inherit/restrict/deny spend policy)
└─────────────┘
```

---

## Core Primitive: The Agent Tool Passport

The passport is the unit of trust. It is a JSON document tied to a **specific version** of a specific tool. Trust is not about the tool in the abstract — it is about `slug:version`.

### What a passport contains

| Block | Purpose |
|---|---|
| `tool_identity` | Name, slug, source URL, category (21-value enum), license, maintainers |
| `creator_identity` | Creator, org, GitHub handle, domain, verification state |
| `trust_status` | Current level on the 8-level ladder |
| `revocation` | Emergency kill switch — `revoked: true` overrides all trust levels |
| `version_hash` | Semantic version, git commit, artifact hash |
| `capabilities` | Free-text list of what the tool does |
| `permission_manifest` | Boolean flags: file, terminal, browser, network, memory, wallet, api, camera, microphone, private_data |
| `data_handling` | Retention, regions, training use, GDPR/HIPAA/CCPA flags |
| `dependencies` | Other tools this tool depends on (trust propagation) |
| `io_schema` | Canonical input/output JSON Schema for cross-framework composition |
| `caller_requirements` | Minimum agent trust, depth limits, org allowlist |
| `source_formats` | Which ecosystems it exists in (mcp, openai_function, langchain, openapi, npm_package, pypi_package, cargo_crate, cli, agent, custom) |
| `format_manifests` | Per-ecosystem metadata (MCP server command, LangChain class, etc.) |
| `commercial_status` | Full machine-readable payment contract |
| `security` | Registry signature, transport config, webhook HMAC config |
| `review_history` | Timestamped reviews with optional cryptographic attestations |
| `risk_summary` | AI-generated and human-reviewed findings |
| `permission_changelog` | Breaking permission changes across versions (re-consent triggers) |
| `cache_ttl_seconds` | How long agents may cache this passport |
| `agent_access` | API URL, MCP readable flag, CLI command, declared rate limits |

### Category taxonomy (enforced enum)

`search` · `file-management` · `code-execution` · `developer-tools` · `browser-automation` · `data-analysis` · `database` · `version-control` · `ai-models` · `communication` · `documentation` · `image-processing` · `audio-video` · `productivity` · `finance` · `security` · `monitoring` · `research` · `infrastructure` · `testing` · `custom`

---

## Trust Ladder

Trust advances forward only. `disputed` can apply at any level and blocks agents.

| Level | Status | Color | Agent-usable |
|---|---|---|---|
| 1 | `auto_generated_draft` | gray | No |
| 2 | `creator_claimed` | blue | No |
| 3 | `owner_confirmed` | teal | Yes |
| 4 | `community_reviewed` | green | Yes |
| 5 | `reviewer_signed` | purple | Yes |
| 6 | `security_checked` | orange | Yes |
| 7 | `continuously_monitored` | indigo | Yes |
| — | `disputed` | red | No |

The minimum recommended level for any agent that makes payments or has file/network access: **`community_reviewed` (4)** or higher. Tools at levels 1–2 should never be used by production agents.

---

## Permission Model

Permissions are boolean flags in `permission_manifest`. The 10 declared permissions:

| Flag | What it covers |
|---|---|
| `file` | Read or write local files |
| `terminal` | Execute shell commands |
| `browser` | Control or scrape a browser |
| `network` | Make outbound network requests |
| `memory` | Access persistent agent memory stores |
| `wallet` | Interact with crypto wallets or payment systems |
| `api` | Call third-party APIs (implies credential access) |
| `camera` | Access camera hardware or video feeds |
| `microphone` | Access microphone or audio feeds |
| `private_data` | Handle PII, health records, or confidential documents |

The `permission_changelog` field tracks when permissions are added between versions so agents know whether to re-consent before upgrading.

---

## Payment Contract

Payment flows in one direction: from the calling agent to the tool author. OpenTrust defines the contract; it doesn't sit in the payment path.

### Three-step agent flow

```
1. READ   passport.commercial_status.pricing
          → Is this within my spend policy? Is there a free tier remaining?

2. PAY    passport.commercial_status.payment_config
          → Send USDC to wallet_address (crypto_direct)
            or call checkout_url (coinbase_commerce)
            or POST to gateway_url (payment_gateway)

3. PROVE  passport.commercial_status.access_config
          → Include X-Payment-TxHash header (transaction_proof)
            or exchange txHash for JWT at verification_endpoint (webhook_token)
            or use issued API key (api_key_issued)
```

### Pricing models

`per_call` · `per_token` · `per_byte` · `flat_fee` · `subscription_monthly` · `subscription_annual` · `tiered`

### Payment networks

Default: **Base** (Coinbase L2 — sub-cent fees, ~2s finality). Also: `ethereum`, `solana`, `polygon`, `arbitrum`.

### Default currency

**USDC**. Also: USDT, ETH, SOL.

---

## Escrow

Escrow is opt-in per tool. Rule: **no proof of delivery standard defined = no escrow-protected listing**.

### Escrow types

- `smart_contract` — funds held on-chain, released by contract logic (audit URL required)
- `optimistic` — funds auto-release after timeout unless disputed
- `trusted_third_party` — named third party holds and releases

### Proof of delivery types

`hash_match` · `access_granted` · `sandbox_completed` · `api_responds` · `output_delivered` · `timeout_auto_release`

### Three-tier dispute resolution

| Tier | Outcome | Triggers | SLA |
|---|---|---|---|
| 1 | `auto_seller_win` | hash matches, access granted, sandbox completed, buyer missed window | 5 min |
| 2 | `auto_buyer_refund` | deadline missed, hash mismatch, malware found, permissions differ from manifest | 10 min |
| 3 | `human_arbitration` | research quality dispute, scope creep, expectation mismatch | 48 hr |

### Dispute bonds (anti-frivolous)

| Transaction size | Bond |
|---|---|
| Under $25 | $2 |
| $25–$100 | $5 |
| $100–$500 | $15 |
| $500–$2,500 | $35 |
| Over $2,500 | custom / percentage |

Bond is refunded if the dispute is upheld; forfeited if not.

---

## Agent Identity

Agents present a signed JWT in `X-OpenTrust-Agent-Identity`. Tools with `caller_requirements.require_agent_identity = true` reject calls without it.

### Identity token fields

| Field | Purpose |
|---|---|
| `agent_id` | `{registry}/{org}/{agent-slug}` — globally unique |
| `agent_type` | `autonomous` · `supervised` · `human_in_the_loop` |
| `operator` | Who runs this agent (GitHub user/org, domain, platform account) |
| `trust_status` | `none` · `identity_declared` · `github_verified` · `org_verified` · `platform_verified` |
| `spend_policy` | Embedded spend policy (see below) |
| `call_chain` | Ordered list of ancestor agent IDs (cycle detection, max 10) |
| `depth` | 0 = root agent |
| `spawned_by` | Parent's `agent_id` |
| `session_id` | Correlates calls within one task |
| `issued_at` / `expires_at` | Token validity window |
| `signature` | Ed25519 over the canonical token payload |

### Sub-agent call chain

Tools check their own `agent_id` or `slug` against the incoming `call_chain`. If it appears, the call is rejected (cycle detection). The root operator — `call_chain[0]`'s operator — is financially responsible for all costs in the chain.

```
Agent A (depth=0)  →  Sub-Agent B (depth=1, chain=["A"])  →  Tool C (chain=["A","B"])
                                                           →  Sub-Agent D (chain=["A","B"])
                                                                → Sub-Agent A: REJECTED (A in chain)
```

---

## Spend Policy

Operators configure spend policies at deployment. Agents enforce them at runtime. Tools that set `caller_requirements.require_spend_policy = true` check the `X-OpenTrust-Spend-Policy` header.

### Core policy fields

| Field | Purpose |
|---|---|
| `max_cost_per_call_usdc` | Hard cap per tool call |
| `max_cost_per_session_usdc` | Cap across one agent task |
| `max_cost_per_day_usdc` | Daily cap |
| `min_trust_status` | Minimum trust level before agent will pay |
| `blocked_permissions` | Permissions agent won't pay for |
| `allowed_networks` | Which chains are authorized |
| `allowed_currencies` | Which tokens are authorized (default: USDC) |
| `require_escrow_above_usdc` | Payments above this must use escrow |
| `human_approval_above_usdc` | Payments above this need human sign-off |
| `blocked_categories` | Tool categories agent won't pay for |
| `allowed_registries` | Only tools from these registries may be paid |

### Orchestration fields

| Field | Default | Purpose |
|---|---|---|
| `max_orchestration_depth` | 3 | Maximum sub-agent chain depth |
| `sub_agent_policy` | `restrict` | How budget propagates downward |
| `allow_spawning_agents` | true | Whether this agent can call agent-type tools |

### Sub-agent policy inheritance

- **`inherit`** — sub-agent gets identical policy
- **`restrict`** (default) — `max_cost_per_call_usdc` and `max_cost_per_session_usdc` divided by `(depth + 1)` at each level
- **`deny`** — sub-agents may not spend anything

### Dynamic budget allocation (experimental, disabled by default)

Enable with `dynamic_budget_allocation.enabled = true`.

- **Per-sub-agent absolute cap** (`max_usdc`): hard ceiling regardless of parent budget
- **Per-sub-agent percentage cap** (`budget_percent`): N% of parent's remaining budget at spawn time
- When both are set, the lower value wins
- **Runtime adjustment** via `budget_adjustment_endpoint` PATCH — authorized by `allocation_controller` (human, AI agent, or both)
- **Audit log** at `audit_log_endpoint` for every spend event and allocation change
- Unmatched sub-agents fall back to `unallocated_fallback` (default: `restrict`)

---

## Security Model (5 Layers)

### Layer 1 — Transport

TLS 1.2 minimum on all protocol communications. TLS 1.3 recommended. HSTS required for registry endpoints. Certificate pinning recommended for tools with `wallet` or `private_data` permissions.

### Layer 2 — Passport integrity (registry signature)

Every passport is signed by the registry using Ed25519. The signature covers a SHA-256 hash of the canonical passport JSON (keys sorted, whitespace stripped, `security.registry_signature` excluded). Agents verify offline without trusting the network path.

Registry public keys: `https://opentrust.dev/.well-known/opentrust-keys.json`

### Layer 3 — Reviewer attestations

Reviewers sign `{slug}:{version}:{trust_status}:{signed_at}` with their registered Ed25519 key. Attestations are embedded in `review_history[].attestation`. Verifiable independently by any client.

### Layer 4 — Payment webhook signatures

All payment callbacks carry `X-OpenTrust-Signature: hmac-sha256={sig}` and `X-OpenTrust-Timestamp: {unix_ts}`. Webhooks older than 300 seconds are rejected (replay window). Signature covers the raw request body.

### Layer 5 — On-chain payment verification

For `access_config.type = "transaction_proof"`, tools verify the txHash against the chain directly:
1. Minimum confirmations (2 on Base/ETH, 32 on Solana)
2. Recipient matches `payment_config.wallet_address`
3. Amount ≥ declared price
4. Token contract is canonical USDC/USDT for the network
5. txHash not previously used (registry nonce-check endpoint)

Canonical token contract addresses: `https://opentrust.dev/.well-known/token-contracts.json`

### Revocation

`revocation.revoked = true` is the emergency path — immediate, no review required. Canonical list at `https://opentrust.dev/.well-known/revoked-passports.json` (5-minute TTL).

Agents **must** check revocation:
- Before using any cached passport past its `cache_ttl_seconds`
- Before any payment transaction
- Before calling any tool at `security_checked` or higher

`disputed` (trust_status) is the normal path for quality/trust concerns. `revoked` is for active threats.

---

## Multi-Registry

Anyone can run an OpenTrust registry. Three trust levels:

| Level | Meaning |
|---|---|
| `root` | Fully trusted. Keys hardcoded in reference agents. |
| `delegated` | Trusted via delegation signature from a root registry. |
| `private` | Trusted within one org; not trusted by external agents by default. |
| `untrusted` | Known but not trusted. |

Registry discovery: `https://opentrust.dev/.well-known/opentrust-registries.json`

When a slug is ambiguous across registries, agents use the `resolution_order` array to pick.

---

## Well-Known Endpoints

| Endpoint | Contents |
|---|---|
| `/.well-known/opentrust-keys.json` | Registry Ed25519 signing key set with expiry dates |
| `/.well-known/revoked-passports.json` | Revocation list (5-min TTL) |
| `/.well-known/opentrust-registries.json` | Trusted registry list with delegation signatures |
| `/.well-known/token-contracts.json` | Canonical USDC/USDT contract addresses per chain |

---

## Governance

Current stage: **founder-led** ([@Costder](https://github.com/Costder)).

- Schema/spec changes require an RFC (14-day comment period; 28 days for breaking changes)
- Bug fixes and docs do not require an RFC
- All decisions are public with written rationale
- Target: CNCF submission when v1.0 stable + 3 independent implementations + 2 major framework adoptions

---

## CLI Quick Reference

```bash
opentrust inspect github/file-search-mcp    # fetch and display a passport
opentrust validate my-tool-manifest.json    # validate against schema
opentrust status my-tool --format json      # check trust status
opentrust badge my-tool                     # generate SVG badge
```

---
---

# Gap Analysis: Status

> All 30 gaps below have been resolved. This section is kept as a record of what was found and where the fix lives.

| # | Issue | Fix location |
|---|---|---|
| 1 | Revocation list unsigned | `signed-revocation-list.schema.json`, `docs/security.md` Layer 6 |
| 2 | Spend policy header forgeable | `spend-policy.schema.json` description, `docs/security.md` Layer 7 |
| 3 | txHash nonce-check undefined | `docs/api-spec.md` Nonce section |
| 4 | Dynamic budget adjustment auth unspecified | `spend-policy.schema.json` budget_adjustment_endpoint description |
| 5 | Agent identity tokens have no revocation | `signed-revocation-list.schema.json` operator_keys, `agent-identity.schema.json` signature.key_id description |
| 6 | Delegation signatures have no expiry | `registry-trust.schema.json` delegation_expires_at |
| 7 | Passport squatting / no ownership dispute | `docs/api-spec.md` Ownership Dispute section |
| 8 | Smart contract audit self-declared | `escrow.schema.json` audit_verified + audit_firm |
| 9 | No spec version in schema $id paths | `passport.schema.json` spec_version required field |
| 10 | No protocol version header | `docs/api-spec.md` Protocol Version section |
| 11 | Tool discovery not standardized | `docs/api-spec.md` GET /api/v1/passports |
| 12 | No batch passport lookup | `docs/api-spec.md` POST /api/v1/passports/batch |
| 13 | No standard error response format | `passport-schema/error-response.schema.json` |
| 14 | No tool sunset mechanism | `passport.schema.json` sunset object |
| 15 | Multi-tool pricing unsupported | `passport.schema.json` format_manifests.mcp.tools[].commercial_status |
| 16 | Tiered pricing ambiguous | `commercial-status.schema.json` tiers_model enum |
| 17 | Webhook secret bootstrap unspecified | `docs/api-spec.md` Webhook Registration, `docs/security.md` Webhook Bootstrap |
| 18 | No outcome/feedback reporting | `docs/api-spec.md` POST /api/v1/outcomes |
| 19 | Dependency trust propagation undefined | `docs/security.md` Dependency Trust Propagation |
| 20 | No offline operation fallback | `docs/security.md` Offline Operation |
| 21 | No agent key management docs | `docs/agent-key-management.md` |
| 22 | No test vectors | `tests/vectors/` (registry-signature, reviewer-attestation, agent-identity) |
| 23 | JWT header size risk | `spend-policy.schema.json` dynamic_budget_allocation description, `agent-identity.schema.json` policy_url |
| 24 | Free tier identity ambiguous | `commercial-status.schema.json` free_tier.identity_required + description |
| 25 | autonomous + human_approval contradiction | `spend-policy.schema.json` human_approval_above_usdc description, `docs/sub-agents.md` |
| 26 | Sub-agent passport trust interaction undefined | `docs/sub-agents.md` Sub-Agent Passport Trust Interaction |
| 27 | budget_percent race condition | `spend-policy.schema.json` budget_percent description (atomic reserve), `docs/sub-agents.md` |
| 28 | continuously_monitored → demotion path undefined | `docs/api-spec.md` outcomes trust demotion rule, `docs/governance.md` |
| 29 | Registry bootstrapping problem | `docs/governance.md` Registry Self-Verification |
| 30 | GDPR for registry itself | `docs/registry-privacy.md` |

---

# Gap Analysis: Original Detail (for reference)

---

## Critical Security Gaps

### 1. Revocation list is unsigned
The revocation list at `/.well-known/revoked-passports.json` is plain JSON with no signature. An attacker who can MITM this endpoint (DNS hijack, BGP hijack, compromised CDN edge) can serve an empty list and make every revoked tool appear valid. **Fix:** The registry must sign the revocation list with its Ed25519 key, and agents must verify the signature before trusting it.

### 2. Spend policy header is unverified
`X-OpenTrust-Spend-Policy` is presented by the calling agent. A malicious agent can forge any policy it wants. The spec has `spend_policy` embedded in the signed agent identity token, but `require_spend_policy = true` on tools does not require the spend policy to come from the signed token — it just requires the header to exist. **Fix:** Specify that spend policy must be extracted from the verified `X-OpenTrust-Agent-Identity` JWT, not from a standalone header that can be forged.

### 3. Payment txHash reuse across tools
The spec says the registry provides a "nonce-check endpoint" to prevent reusing a single transaction hash across multiple tool calls, but this endpoint is never defined. Two cooperating or independent tools could both accept the same transaction. **Fix:** Define the nonce-check API: `POST /api/v1/nonces/check` with `{txHash, slug, caller_agent_id}`, returning `{used: bool}`. The registry must store seen txHashes with TTL matching the chain's finality window.

### 4. Dynamic budget allocation endpoint has no authentication spec
`budget_adjustment_endpoint` says "the endpoint must authenticate the controller" but leaves the mechanism entirely to implementers. This is the most powerful runtime operation in the spec (it changes how much money sub-agents can spend mid-session) and it has no defined security contract. **Fix:** Require HMAC-SHA256 with a shared secret (same model as webhook verification) or a signed JWT from the declared `allocation_controller.agent_id`.

### 5. Agent identity token has no revocation mechanism
If an agent identity token is stolen or its signing key is compromised, there is no way to invalidate existing tokens before they expire. The key set has key rotation (old keys kept 90 days) but there is no per-token or per-operator revocation list. **Fix:** Define an operator key revocation endpoint and require agents to check it alongside the passport revocation list.

### 6. Delegation signatures have no expiry
A delegated registry's `delegation_signature` is a static base64url string with no expiry date. If the root registry's private key is compromised and rotated, old delegation signatures signed by the compromised key remain valid forever. **Fix:** Add `delegation_expires_at` to `RegistryRecord` and require re-signing on key rotation.

### 7. Passport squatting
At level 1 (`auto_generated_draft`), any tool can be imported. The claim process at level 2 (`creator_claimed`) requires GitHub OAuth, but there is no rule preventing someone from claiming a popular tool before the real creator does. The spec does not define a dispute path specifically for ownership disputes (only for trust/quality disputes). **Fix:** Define an ownership dispute mechanism separate from the quality dispute tier. Add: if a GitHub repository owner proves ownership of the source URL, they override any earlier claim.

### 8. Smart contract audit is self-declared
`escrow.contract.audit_url` is a URL the tool author provides. Nothing verifies the URL points to a real audit by a real firm. A malicious tool can link to a fake or reused audit PDF. **Fix:** Require audits for smart_contract escrow to be submitted to the registry for review before the tool can list `type: smart_contract`. Add an `audit_verified` boolean set by the registry.

---

## Missing Protocol Definitions

### 9. No spec version in schema $id paths
All `$id` URIs are `https://opentrust.dev/schemas/passport.schema.json` with no version number. When the spec needs a breaking change there is no migration path built in — agents will have no way to know which version of the schema a passport conforms to. **Fix:** Add `/v1/` to all schema `$id`s now (while zero tools exist in production) and add a top-level `spec_version` field to passports.

### 10. No protocol version header
When an agent fetches a passport from a registry, there is no response header indicating which version of the OpenTrust protocol the registry speaks. A future v2 registry serving a v1 agent will fail silently. **Fix:** Require `X-OpenTrust-Protocol-Version` on all registry API responses.

### 11. No tool discovery/search spec
The reference registry has a search API, but it is not part of the open standard. Any independently-deployed registry can use any search interface. Agents written against the reference registry's search API will not work against other registries. **Fix:** Define a minimum discovery API in a new RFC: `GET /api/v1/passports?category=&trust_status=&q=` with a standard response envelope. This is the DNS of the tool ecosystem — it must be standard.

### 12. No batch passport lookup
Agents building orchestration pipelines need to evaluate many tools at once. Fetching them one at a time is slow and hammers the registry. **Fix:** Define `POST /api/v1/passports/batch` accepting `{slugs: []}` and returning an array of signed passports.

### 13. No standardized error response format
The spec defines data models for passports, identities, and policies but says nothing about what error responses from a registry look like. Each implementation will invent its own format, breaking agent error handling. **Fix:** Define a standard error envelope: `{error_code, message, details, request_id}` with a registry of error codes (PASSPORT_NOT_FOUND, TRUST_TOO_LOW, REVOKED, etc.).

### 14. No tool sunset/deprecation mechanism
There is no way for a tool author to say "this tool is end-of-life, please migrate to X by date Y." The only exit path is abandonment (trust decays from lack of monitoring) or revocation (implies malice). **Fix:** Add a `sunset` object to the passport: `{deprecated_at, end_of_life_at, successor_slug, migration_guide_url}`.

### 15. No multi-tool pricing per passport
`commercial_status` is top-level on the passport. An MCP server that exposes 5 tools — each with different pricing — can only declare one price. `format_manifests.mcp.tools` lists the tools but has no pricing. **Fix:** Allow `commercial_status` overrides per tool in `format_manifests.mcp.tools[].commercial_status`, making the top-level one the default.

### 16. Tiered pricing is ambiguous
The `tiered` pricing model has `tiers[].up_to` and `tiers[].amount` but does not specify whether it is volume-based (price per unit decreases as total volume grows) or range-based (flat price within a band). Agents cannot predict costs without this. **Fix:** Add a `tiers_model` enum to pricing: `graduated` (each unit gets cheaper as volume grows) or `flat_per_tier` (flat price for all units within the band).

### 17. No webhook secret bootstrap spec
`security.webhook_config` requires a shared HMAC secret but the spec doesn't define how this secret is established when a tool registers with the registry. **Fix:** Define the tool registration handshake — presumably the registry generates and returns the secret on first registration, with a rotation endpoint defined.

---

## Missing Features

### 18. No tool feedback or rating mechanism
Trust can increase (through reviews) but there is no user feedback loop. An agent that called a tool and found it unreliable has no standardized way to report that experience. The sybil resistance section mentions "prior successful deliveries" and "low dispute rate" as signals, but there is no spec for how agents report delivery outcomes. **Fix:** Define a lightweight outcome reporting API — `POST /api/v1/outcomes` with `{slug, version, session_id, outcome: success|partial|failure, latency_ms}`. Used to feed the `continuously_monitored` trust level.

### 19. No dependency trust propagation
The passport has a `dependencies` array, and the spec says "if a dependency gets a CVE or is disputed, the dependent tool's trust status may be affected" — but "may be" is not a protocol rule. There is no automated mechanism. **Fix:** Define the rule: if any direct dependency has `trust_status = disputed` or `revocation.revoked = true`, the dependent tool's `trust_status` must floor at `community_reviewed` until the dependency is resolved.

### 20. No offline operation spec
The spec says agents should check revocation and verify signatures, but says nothing about what an agent must do when the registry is unreachable. A registry outage today means all agents either fail closed (reject all tools) or fail open (trust cached passports) — both are bad. **Fix:** Define the fallback: agents may operate with cached passports up to `cache_ttl_seconds` without contacting the registry, but must fail closed on payment operations and tools at `security_checked` or higher.

### 21. No agent key management spec
The agent identity schema has an Ed25519 signature, but the spec says nothing about how operators generate, store, or rotate their signing keys. A developer implementing an agent has no guidance. **Fix:** Add a `docs/agent-key-management.md` section: key generation with `openssl` or similar, storage in environment variables or KMS, rotation procedure, and how to deregister a compromised key.

### 22. No test vectors
The security docs have Python verification examples but no published test vectors. An implementation can pass casual tests while failing on edge cases (empty canonical JSON, Unicode in slugs, base64url padding). **Fix:** Publish `tests/vectors/` with known-good inputs and expected outputs for signature verification, payload hash construction, and reviewer attestation validation.

### 23. Header size risk from embedded spend policy
The `spend_policy` is embedded inside the agent identity JWT. With `dynamic_budget_allocation` entries (one per named sub-agent), this JWT can become large. Typical HTTP header size limits are 8KB. An orchestrator with 20+ named sub-agents could hit this. **Fix:** Add a note in the spend policy spec that implementations should strip `dynamic_budget_allocation` from the embedded JWT and reference it by `policy_version` + a `policy_url` instead when the allocation list is long.

### 24. Free tier verification gap
The passport declares a free tier (e.g., 100 calls/day) but there is no mechanism for the tool to verify that the calling agent has not already exhausted its free allocation. The tool has to track this per-agent, per-day — but there is no standard identifier for "this is the same agent as yesterday." **Fix:** Clarify that free tier tracking is the tool author's responsibility and `session_id` is not sufficient (it resets per task). Define that `agent_id` is the stable cross-session identifier tools should use for free tier enforcement.

---

## Unresolved Design Decisions

### 25. Should `human_approval_above_usdc` be forbidden for `autonomous` agents?
The spec defines `autonomous` agents as acting without per-action human approval. But `human_approval_above_usdc` in the spend policy implies there will be a human to ask. If an autonomous agent hits this threshold mid-task, it has no human to ask — it must either refuse the call or ignore the policy. The spec is silent on which is correct.

### 26. How does a sub-agent with its own passport interact with the calling agent's trust model?
When Agent A calls Tool B (which has `source_formats: ["agent"]`), Agent A reads Tool B's passport to decide whether to trust it. But Tool B, once running, spawns its own sub-calls. Those sub-calls inherit A's spend policy but not A's trust decisions. There is no spec for whether the sub-agent's own passport trust status affects the parent's policy decisions (e.g., "don't spawn agents below `reviewer_signed`").

### 27. `budget_percent` evaluation timing is ambiguous for concurrent sub-agents
The dynamic allocation spec says `budget_percent` is evaluated "at spawn time." If Agent A spawns Sub-Agent B (gets 40% of $10 = $4) and then simultaneously spawns Sub-Agent C (also 40% of $10 = $4), the total allocated is $8 which is fine. But if B spends $3 before C is spawned, C's 40% of A's *remaining* $7 = $2.80. Concurrent spawning of the same allocation creates a race condition. The spec doesn't define whether "remaining budget" is a snapshot at spawn time or a live deduction.

### 28. No path defined for `continuously_monitored` → demotion
`continuously_monitored` (level 7) is the highest positive trust level. But what happens when monitoring detects a problem? The spec says `disputed` "can apply at any level," but the automated path from monitoring to action is undefined. Who triggers the status change? What evidence threshold? Is it immediate or after a review period?

### 29. Registry itself has no passport
The OpenTrust CLI and the reference registry are themselves AI-adjacent tools. They should have passports. But who reviews them? The spec maintainer cannot self-review. This bootstrapping problem is unaddressed.

### 30. GDPR compliance for the registry itself
The passport `data_handling` block lets tool authors declare their compliance posture. But the registry stores creator names, GitHub handles, domains, and reviewer identities. There is no documented data handling policy for the registry as a data processor. This matters for EU-based tool authors who must complete due diligence before submitting data.
