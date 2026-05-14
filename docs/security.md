# OpenTrust Security Model

## Threat Model

OpenTrust passports are trust documents. An attacker who can forge, intercept, or tamper with a passport can make a malicious tool appear trusted. The security model is designed around this specific threat.

| Threat | What an attacker gains | Mitigation |
|---|---|---|
| Serve a fake passport for a real tool | Make a malicious tool appear trusted | Registry signatures — verify offline |
| Tamper with a passport in transit | Downgrade trust status, change permissions | Registry signatures — payload hash |
| Forge a reviewer attestation | Fake `reviewer_signed` or `security_checked` | Reviewer keys registered, attestation format verifiable |
| Fake a payment webhook callback | Unlock paid tool access without paying | HMAC-SHA256 on all webhook payloads |
| Replay a valid payment webhook | Get multiple accesses from one payment | 300-second replay window, nonce enforcement |
| MITM between agent and registry | Intercept or modify passport responses | TLS 1.2+ required, certificate pinning for sensitive tools |

---

## Layer 1: Transport Security

All OpenTrust protocol communications require TLS 1.2 at minimum. TLS 1.3 is recommended.

Tools that declare `permission_manifest.wallet = true` or `permission_manifest.private_data = true` should also declare `security.transport.certificate_pinning = true` in their passport.

HSTS is required for all registry endpoints and strongly recommended for tool endpoints.

---

## Layer 2: Passport Integrity (Registry Signatures)

Every passport registered with OpenTrust is signed by the registry using Ed25519.

**Why this matters:** Without signatures, any proxy, CDN edge node, or DNS hijack can serve a modified passport. An agent trusting the content of a response without verifying the signature is trusting the network path, not the registry.

### How it works

1. The registry normalizes the passport JSON: keys sorted, whitespace stripped, `security.registry_signature` field excluded.
2. The registry computes `SHA-256(normalized_json)` to produce the `payload_hash`.
3. The registry signs `payload_hash` with its Ed25519 private key.
4. The `security.registry_signature` block is added to the returned passport.

### How to verify

```python
import json, hashlib, base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_public_key

# 1. Fetch the registry's public key set
# GET https://opentrust.dev/.well-known/opentrust-keys.json
# { "keys": [{ "key_id": "opentrust-registry-2026-v1", "public_key_der_b64": "..." }] }

# 2. Reconstruct the payload hash
passport = json.loads(raw_passport_json)
sig_block = passport.pop("security", {}).pop("registry_signature", {})
canonical = json.dumps(passport, sort_keys=True, separators=(',', ':'))
payload_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()

# 3. Verify the hash matches what the registry declared
assert payload_hash == sig_block["payload_hash"], "Payload hash mismatch"

# 4. Verify the signature
public_key = load_der_public_key(base64.b64decode(registry_public_key_der_b64))
public_key.verify(
    base64.urlsafe_b64decode(sig_block["signature"] + "=="),
    payload_hash.encode()
)
# If no exception is raised, the passport is authentic
```

### Key rotation

Registry keys are published at `https://opentrust.dev/.well-known/opentrust-keys.json` with expiry dates. Agents should cache this key set with a 1-hour TTL. Old keys are retained for 90 days after rotation to allow verification of passports signed with them.

---

## Layer 3: Reviewer Attestations

When a reviewer signs off at `reviewer_signed` or higher, the claim must be cryptographically verifiable, not just a string in a field.

### Attestation format

The reviewer signs the following canonical string:

```
{slug}:{version}:{trust_status}:{signed_at_iso8601}
```

Example:
```
github-file-search:1.2.0:reviewer_signed:2026-05-14T10:00:00Z
```

This string is hashed with SHA-256 and signed with the reviewer's Ed25519 private key.

### Reviewer key registration

Before a reviewer can sign attestations, they must register their Ed25519 public key with the registry via a verified GitHub OAuth session. The registry stores `{github_handle → public_key}`. Reviewers can rotate their key at any time, but old signatures remain verifiable against the key that was registered at signing time.

### Verification

```python
# The attestation.payload field contains the exact string that was signed
# Any client can reconstruct it and verify independently:
expected_payload = f"{slug}:{version}:{trust_status}:{signed_at}"
assert attestation["payload"] == expected_payload

public_key.verify(
    base64.urlsafe_b64decode(attestation["signature"] + "=="),
    hashlib.sha256(attestation["payload"].encode()).digest()
)
```

---

## Layer 4: Payment Webhook Signatures

All payment callbacks, escrow events, and delivery confirmations sent to tool endpoints must be signed with HMAC-SHA256.

### Signing

The OpenTrust registry signs webhook payloads with a shared secret established during tool registration.

```
X-OpenTrust-Signature: hmac-sha256={base64(HMAC-SHA256(secret, raw_body))}
X-OpenTrust-Timestamp: {unix_timestamp}
```

### Verification (tool side)

```python
import hmac, hashlib, time, base64

def verify_webhook(secret: str, body: bytes, signature_header: str, timestamp_header: str):
    # 1. Reject replays older than 5 minutes
    ts = int(timestamp_header)
    if abs(time.time() - ts) > 300:
        raise ValueError("Webhook timestamp out of replay window")

    # 2. Compute expected signature
    expected = hmac.new(
        secret.encode(),
        body,
        hashlib.sha256
    ).digest()
    expected_b64 = base64.b64encode(expected).decode()

    # 3. Compare (constant-time)
    provided = signature_header.replace("hmac-sha256=", "")
    if not hmac.compare_digest(expected_b64, provided):
        raise ValueError("Webhook signature invalid")
```

**Never act on a payment event without verifying the HMAC.** An unverified callback is an arbitrary HTTP request.

---

## Layer 5: On-Chain Payment Verification

For `access_config.type = "transaction_proof"`, the tool receives a `txHash` in the `X-Payment-TxHash` header and must verify it on-chain before serving the response.

Required checks:
1. **Block finality** — transaction must have at least 2 confirmations on Base/Ethereum, or 32 on Solana.
2. **Recipient** — `payment_config.wallet_address` must match the transaction recipient.
3. **Amount** — transferred amount must be >= `pricing.amount` in the declared `pricing.currency`.
4. **Token contract** — must be the canonical USDC or USDT contract address for the declared network.
5. **Not already used** — the registry provides a nonce-check endpoint to prevent reuse of a single transaction across multiple calls.

Canonical token contract addresses are published at `https://opentrust.dev/.well-known/token-contracts.json`.

---

## Sybil Resistance

From the v3 doc — trust inputs that resist gaming:

| Signal | What it measures |
|---|---|
| GitHub account age | Longstanding accounts are harder to manufacture |
| Commit and package history | Establishes real developer identity |
| Signed commits | Links identity to a cryptographic key |
| Wallet age and transaction history | Establishes payment reputation |
| Prior successful deliveries | Track record on the platform |
| Low dispute rate | Behavior history |

Anti-gaming rules:
- No self-review. A tool author cannot review their own tool.
- Reviewer payout is for review labor, not positive outcomes. A rejected tool still pays the reviewer.
- Conflict of interest disclosure is required before review.
- Delayed payouts for new accounts (first 30 days).
- Contribution caps for new accounts.
- Public dispute windows and reviewer audit history.

---

---

## Revocation

Emergency revocation bypasses the normal dispute process. Use it when a tool is actively malicious, a signing key is compromised, or legal action requires immediate removal.

### How revocation works

1. The registry sets `revocation.revoked = true` on the passport and publishes the updated record.
2. The canonical revocation list at `https://opentrust.dev/.well-known/revoked-passports.json` is updated immediately.
3. Agents checking this list (required before acting on any cached passport) will see the revocation and must refuse to call the tool.

### Revocation list format

```json
{
  "updated_at": "2026-05-14T10:00:00Z",
  "revoked": [
    {
      "slug": "example-tool",
      "version": "1.2.0",
      "revoked_at": "2026-05-14T09:55:00Z",
      "reason": "malware_detected"
    }
  ]
}
```

### Agent revocation check requirement

Agents **must** check the revocation list:
- Before using any cached passport older than `cache_ttl_seconds`
- Before any payment transaction regardless of cache age
- Before calling any tool with `security_checked` or higher trust_status

The revocation list has a 5-minute TTL. Agents may cache it within that window.

### Disputed vs revoked

`trust_status = disputed` is the normal escalation path for quality or trust concerns — it goes through the review process.

`revocation.revoked = true` is the emergency path for active threats — it is immediate and does not require review. Only registry administrators can set revocation. Revocation reasons are published publicly.

---

---

## Layer 6: Signed Revocation List

The revocation list at `/.well-known/revoked-passports.json` is a JSON document signed with the registry's Ed25519 key. Agents must verify this signature before trusting any entry. See [signed-revocation-list.schema.json](../passport-schema/signed-revocation-list.schema.json).

### Why this matters

An unsigned revocation list can be manipulated by a MITM attacker (DNS hijack, BGP hijack, compromised CDN edge) to serve an empty list, making every revoked tool appear valid. The signature ties the list's authenticity to the registry's key, which is verified independently via the key set.

### Version number (rollback protection)

The revocation list includes a monotonically increasing `version` integer. Agents must track the last successfully verified version and reject any list with a lower version — this prevents a rollback attack where an attacker caches and re-serves an older, shorter list.

### Operator key revocation

The revocation list also carries `operator_keys` — a list of revoked agent signing key IDs. Agents must check both `passports` and `operator_keys` arrays. A token signed by a revoked operator key must be rejected even if the signature itself is cryptographically valid.

### Verification code

```python
import json, hashlib, base64, requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import load_der_public_key
from datetime import datetime, timezone

_last_verified_version = 0

def fetch_and_verify_revocation_list(registry_url: str, key_map: dict) -> dict:
    global _last_verified_version

    resp = requests.get(f"{registry_url}/.well-known/revoked-passports.json")
    doc = resp.json()

    # 1. Verify the signature
    sig_block = doc.pop("signature")
    if sig_block["algorithm"] != "ed25519":
        raise ValueError("Unsupported algorithm")

    canonical = json.dumps(doc, sort_keys=True, separators=(',', ':'))
    payload_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    assert payload_hash == sig_block["payload_hash"], "Payload hash mismatch"

    pub_key = load_der_public_key(base64.b64decode(key_map[sig_block["key_id"]]))
    pub_key.verify(
        base64.urlsafe_b64decode(sig_block["value"] + "=="),
        payload_hash.encode()
    )

    # 2. Check version is not a rollback
    if doc["version"] < _last_verified_version:
        raise ValueError(f"Rollback detected: got version {doc['version']}, expected >= {_last_verified_version}")
    _last_verified_version = doc["version"]

    # 3. Check the list is not stale
    updated_at = datetime.fromisoformat(doc["updated_at"])
    age_seconds = (datetime.now(timezone.utc) - updated_at).total_seconds()
    if age_seconds > 600:  # 10 minutes max age
        raise ValueError(f"Revocation list is stale: {age_seconds:.0f} seconds old")

    doc["signature"] = sig_block  # restore
    return doc
```

---

## Layer 7: Spend Policy Authentication

The `X-OpenTrust-Spend-Policy` header is a convenience pre-flight hint. It is **not authenticated** on its own. A malicious caller can forge any spend policy they want in this header.

### The rule

Tools that enforce spend policy requirements must extract the policy from the **verified** `X-OpenTrust-Agent-Identity` JWT (`spend_policy` field), not from the standalone header. The JWT is signed by the operator's registered Ed25519 key — a forged policy inside a JWT would require forging the signature.

```python
# WRONG — do not do this
spend_policy = json.loads(request.headers.get("X-OpenTrust-Spend-Policy"))

# CORRECT — extract from the verified JWT
agent_identity = verify_agent_identity(request.headers.get("X-OpenTrust-Agent-Identity"))
spend_policy = agent_identity.get("spend_policy")

# When policy_url is used instead of embedded policy:
if not spend_policy and "policy_url" in agent_identity:
    spend_policy = fetch_and_verify_policy(agent_identity["policy_url"])
```

The `X-OpenTrust-Spend-Policy` header may still be used for informational logging or non-security-critical pre-flight checks (e.g., early rejection to save bandwidth), but must never be used as the authoritative source for access decisions.

---

## Dependency Trust Propagation

If a tool's declared dependency has `trust_status = disputed` or `revocation.revoked = true`, the dependent tool's effective trust is capped.

### Rule

A tool's effective trust status cannot exceed `community_reviewed` if any of its direct dependencies:
- Have `trust_status = disputed`
- Have `revocation.revoked = true`
- Have no corresponding passport in any trusted registry

This is enforced by the registry at query time — the `GET /api/v1/passports/{slug}` response includes the effective trust status after dependency checking, which may be lower than the stored `trust_status`.

Transitive dependencies (dependencies of dependencies) are checked one level deep. Full transitive propagation is not required in v0.1 but recommended for future versions.

### Why not full transitive propagation

Transitive checking can be expensive and creates circular dependency edge cases. The one-level rule catches the most common attack vector (malicious sub-dependency) without requiring a full graph traversal.

---

## Offline Operation

Agents must have a defined behavior when the registry is unreachable. The rule is **fail closed on payment and high-trust operations; fail open on cached reads.**

### Permitted offline behavior

- Serving responses from cached passports within their `cache_ttl_seconds`
- Calling tools at `owner_confirmed` or `community_reviewed` trust status using a valid cached passport
- Logging offline periods for operator review

### Required offline blocking

Agents must refuse to proceed when offline for:
- **Any payment operation** — cannot verify nonce, cannot confirm current trust status or revocation
- **Any tool at `security_checked` or higher** — high-trust tools require fresh revocation checks
- **Any tool whose cached passport has exceeded `cache_ttl_seconds`** — the agent must not extend trust beyond the declared TTL

### Recommended implementation

```python
def should_block_offline(passport: dict, is_payment: bool) -> bool:
    if is_payment:
        return True  # always block payments offline

    cache_ttl = passport.get("cache_ttl_seconds", 3600)
    cached_at = passport.get("_cached_at_timestamp")
    cache_age = time.time() - cached_at if cached_at else float("inf")

    if cache_age > cache_ttl:
        return True  # cache expired

    high_trust = {"security_checked", "continuously_monitored"}
    if passport["trust_status"] in high_trust:
        return True  # high-trust tools require live revocation check

    return False  # allow cached read
```

---

## Webhook Secret Bootstrap

The HMAC shared secret for webhook verification is established during tool registration. The flow:

1. Tool author POSTs to `POST /api/v1/webhooks/register` with their `verification_endpoint` URL (authenticated with GitHub OAuth).
2. The registry generates a 32-byte cryptographically random secret using `secrets.token_bytes(32)` (Python) or equivalent.
3. The raw secret is returned **once** in the registration response body — the tool author must store it immediately. The registry stores only a salted hash (SHA-256 with a random salt, not PBKDF2 — this is for lookup, not password storage).
4. The registry sends a test POST to `verification_endpoint` signed with the new secret. The tool must respond 200 within 30 seconds to confirm receipt.
5. If the test POST fails, registration is incomplete and the endpoint is not active.

**Secret rotation:** See `POST /api/v1/webhooks/{webhook_id}/rotate` in [api-spec.md](api-spec.md). The registry sends webhooks signed with both old and new secrets for 5 minutes during cutover.

**Secret storage (tool side):** Store in a secrets manager. Never hardcode or commit. The secret should be treated with the same care as an API private key.

---

## What Is Out of Scope for This Spec

The spec defines interfaces and data models. The following are left to implementations:

- The actual Ed25519 key generation and storage for the registry (HSM or KMS recommended for production)
- The smart contract code for on-chain escrow (must be audited independently before use with real funds)
- KYC/AML and sanctions screening for high-value transactions (required before Phase 3 custodial escrow)
- Tier 3 dispute arbitration mechanics (human judgment, not defined by protocol)
- The authentication mechanism for `budget_adjustment_endpoint` (defined as HMAC or JWT in spend-policy.schema.json; implementation specifics left to the orchestration system)
