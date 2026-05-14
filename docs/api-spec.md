# OpenTrust Registry API Specification

This document defines the **standard API** all conforming OpenTrust registries must implement. Agents written against this spec work against any conforming registry, not just the reference implementation.

Every response from a conforming registry must include:

```
X-OpenTrust-Protocol-Version: 0.1.0
Content-Type: application/json
```

Every non-2xx response must use the [error-response.schema.json](../passport-schema/error-response.schema.json) envelope.

---

## Authentication

API calls that modify state (register, claim, revoke) require a Bearer token from GitHub OAuth. Read-only endpoints are unauthenticated unless noted.

---

## Passport Endpoints

### GET /api/v1/passports/{slug}

Fetch a single passport by slug.

**Path params:** `slug` — e.g. `github-file-search`

**Query params:**
- `version` (optional) — specific semver. Defaults to latest.
- `registry` (optional) — registry base URL to resolve from. Defaults to this registry.

**Response 200:**
```json
{
  "passport": { /* passport.schema.json */ },
  "resolved_from": "https://registry.opentrust.dev"
}
```

**Error codes:** `PASSPORT_NOT_FOUND`, `PASSPORT_REVOKED` (410 with `successor_slug` in details if available), `SLUG_AMBIGUOUS` (409 with `alternatives` array).

---

### POST /api/v1/passports/batch

Fetch multiple passports in one request. Use this when building orchestration pipelines that need to evaluate many tools simultaneously.

**Request body:**
```json
{
  "slugs": ["github-file-search", "brave-search", "code-sandbox"],
  "version_map": {
    "github-file-search": "1.2.0"
  }
}
```

**Limits:** Maximum 50 slugs per batch request. Exceed this and the registry returns `BATCH_TOO_LARGE`.

**Response 200:**
```json
{
  "passports": {
    "github-file-search": { /* passport.schema.json */ },
    "brave-search": { /* passport.schema.json */ },
    "code-sandbox": null
  },
  "errors": {
    "code-sandbox": { "error_code": "PASSPORT_NOT_FOUND", "message": "...", "request_id": "..." }
  }
}
```

Passports that were found appear in `passports`. Slugs that failed appear in `errors` with standard error envelopes. Partial success returns HTTP 200 — check `errors` for individual failures.

---

### GET /api/v1/passports

Tool discovery endpoint. All conforming registries must implement this endpoint with these query parameters.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `q` | string | Full-text search over name, slug, description, capabilities |
| `category` | string | Filter by category enum value |
| `trust_status` | string | Minimum trust status (returns this level and above) |
| `source_format` | string | Filter by source_formats value (e.g. `mcp`, `langchain`) |
| `permission` | string (repeatable) | Filter by declared permission (e.g. `?permission=file&permission=network`) |
| `free_only` | boolean | Only return tools with `commercial_status.status: "free"` |
| `has_escrow` | boolean | Only return tools with `escrow_config.supported: true` |
| `limit` | integer | Results per page (default: 20, max: 100) |
| `cursor` | string | Pagination cursor from previous response |

**Response 200:**
```json
{
  "passports": [ /* array of passport.schema.json */ ],
  "total": 482,
  "cursor": "eyJvZmZzZXQiOjIwfQ",
  "has_more": true
}
```

When `has_more` is true, include `cursor` in the next request to get the next page.

---

### POST /api/v1/passports

Register or update a passport. Requires authentication.

**Request body:** passport conforming to `passport.schema.json`

**Response 201:** Created passport with `security.registry_signature` populated by the registry.

**Error codes:** `VALIDATION_ERROR`, `SCHEMA_VERSION_UNSUPPORTED`, `SLUG_SQUATTED` (if the slug is already claimed by a different creator).

---

## Nonce / Payment Verification

### POST /api/v1/nonces/check

Prevent a single on-chain transaction from being reused across multiple tool calls. Tools with `access_config.type: "transaction_proof"` must call this before serving a response.

**Request body:**
```json
{
  "tx_hash": "0xabc123...",
  "network": "base",
  "slug": "github-file-search",
  "caller_agent_id": "opentrust.dev/acme/research-agent"
}
```

**Response 200 (first use):**
```json
{
  "used": false,
  "recorded_at": "2026-05-14T10:00:00Z"
}
```

**Response 200 (already used):**
```json
{
  "used": true,
  "first_used_at": "2026-05-14T09:58:00Z",
  "first_used_by_slug": "github-file-search"
}
```

The registry records the txHash atomically — if two tools call this endpoint simultaneously with the same txHash, exactly one gets `used: false` and the other gets `used: true`. Tools must refuse service if `used: true`.

**TTL:** The registry retains nonce records for 30 days. Transactions older than 30 days are not accepted as payment proof regardless of their used status.

---

## Outcome Reporting

### POST /api/v1/outcomes

Agents report tool call outcomes to feed trust signals for `continuously_monitored` status. This is voluntary but strongly recommended — it enables automated demotion when error rates spike.

**Request body:**
```json
{
  "slug": "github-file-search",
  "version": "1.2.0",
  "session_id": "sess-abc123",
  "caller_agent_id": "opentrust.dev/acme/research-agent",
  "outcome": "success",
  "latency_ms": 340,
  "error_code": null,
  "timestamp": "2026-05-14T10:00:01Z"
}
```

**`outcome` values:**

| Value | Meaning |
|---|---|
| `success` | Tool responded correctly within time limit |
| `partial` | Tool responded but output was incomplete or malformed |
| `failure` | Tool returned an error or did not respond |
| `timeout` | Tool did not respond within declared rate_limits.retry_after_seconds |
| `payment_rejected` | Tool rejected valid payment proof |

**Rate limiting:** Agents may submit at most 1 outcome per tool call per session. The registry discards duplicates identified by `(session_id, slug, timestamp)`.

**Response 202 Accepted.** The registry processes outcomes asynchronously. No guarantee of immediate trust status impact.

**Trust demotion rule:** If a `continuously_monitored` tool accumulates an error rate (failure + timeout outcomes) above 15% over a rolling 24-hour window of at least 100 reported calls, the registry automatically sets `trust_status` to `disputed` and notifies the tool author. The author has 72 hours to respond before the status is published publicly. This rule is the spec-defined path from `continuously_monitored` to `disputed` (gap #28 from the system review).

---

## Key Management

### GET /api/v1/operators/{identity}/keys

List registered signing keys for an operator. Public endpoint.

**Response 200:**
```json
{
  "operator_identity": "acme-corp",
  "keys": [
    {
      "key_id": "acme-corp-2026-v1",
      "public_key_b64": "...",
      "registered_at": "2026-01-01T00:00:00Z",
      "expires_at": "2027-01-01T00:00:00Z",
      "status": "active"
    }
  ]
}
```

### POST /api/v1/operators/{identity}/keys

Register a new signing key. Requires authentication as the operator.

**Request body:**
```json
{
  "public_key_b64": "base64-encoded DER public key",
  "expires_at": "2027-01-01T00:00:00Z"
}
```

**Response 201:**
```json
{
  "key_id": "acme-corp-2026-v1"
}
```

### DELETE /api/v1/operators/{identity}/keys/{key_id}

Revoke a signing key. This immediately adds the key_id to the signed revocation list. All tokens signed with this key will be rejected by any agent that checks revocation. Use this immediately if a key is compromised.

**Response 200:**
```json
{
  "revoked_at": "2026-05-14T10:00:00Z",
  "key_id": "acme-corp-2026-v1"
}
```

---

## Well-Known Endpoints

These are served by all root registries. Agents should cache with the TTL in the response headers.

| Endpoint | Description | Cache TTL |
|---|---|---|
| `/.well-known/opentrust-keys.json` | Registry Ed25519 signing key set | 1 hour |
| `/.well-known/revoked-passports.json` | Signed revocation list | 5 min (or `ttl_seconds` field) |
| `/.well-known/revoked-operator-keys.json` | Included in signed-revocation-list.schema.json `operator_keys` | Same as above |
| `/.well-known/opentrust-registries.json` | Trusted registry list | 1 hour |
| `/.well-known/token-contracts.json` | Canonical token contract addresses per chain | 24 hours |

---

## Protocol Version

The `X-OpenTrust-Protocol-Version` response header declares which version of this spec the registry implements. Format: semver. Agents should warn operators when connecting to a registry running a different major version. Current version: `0.1.0`.

If a request includes `X-OpenTrust-Client-Version: {semver}`, the registry may use this to return version-appropriate responses or error messages — but must never silently downgrade behavior based on it.

---

## Webhook Registration

When a tool registers with the registry, the registration flow establishes the shared HMAC secret for webhook verification:

1. Tool author POSTs to `POST /api/v1/webhooks/register` with their tool's `verification_endpoint` URL.
2. The registry generates a cryptographically random 32-byte secret and returns it **once** in the response body. The registry stores a salted hash; the tool author stores the raw secret.
3. The registry sends a test webhook to `verification_endpoint` signed with the secret. The tool must respond 200 to complete registration.
4. All future webhooks (payment confirmations, escrow events) sent to this endpoint are signed with this secret.

**Key rotation:** Tool authors call `POST /api/v1/webhooks/{webhook_id}/rotate` to get a new secret. The registry sends webhooks with both the old and new secret for 5 minutes to allow a smooth cutover before retiring the old secret.

---

## Ownership Dispute (Anti-Squatting)

If a tool slug has been claimed (`creator_claimed` or above) by someone who is not the actual repository owner, the legitimate owner can file an ownership dispute:

**POST /api/v1/disputes/ownership**

```json
{
  "slug": "popular-mcp-tool",
  "evidence_type": "github_repo_owner",
  "github_repo_url": "https://github.com/real-owner/popular-mcp-tool",
  "claimant_github_handle": "real-owner"
}
```

The registry verifies the claimant controls the GitHub repo at `tool_identity.source_url` via OAuth. If verified:
1. The current claimant is notified and has 7 days to provide counter-evidence.
2. If no valid counter-evidence is submitted, the registry transfers ownership and resets the claim.
3. The original claimant's passport contributions are flagged as `SLUG_SQUATTED` in their history.

This is the spec-defined path for ownership disputes (gap #7 from the system review). Quality/trust disputes use the escrow dispute tiers instead.
