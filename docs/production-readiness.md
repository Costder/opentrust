# OpenTrust Production Readiness Plan

This is the practical checklist for turning OpenTrust from a good protocol demo into a production-grade registry and trust layer.

The short version: OpenTrust should not win by being the one server everyone trusts. It should win by making trust portable, signed, locally verifiable, revocable, and safe for money.

## Production definition

OpenTrust is production ready when an agent can safely answer these questions without trusting chat text, unsigned APIs, or Joshua personally:

1. Is this tool who it claims to be?
2. Is this exact version the reviewed version?
3. What can it access?
4. Has it been revoked or disputed?
5. Who signed the claims?
6. Can my local policy call it?
7. If it costs money, is the quote real and replay-proof?
8. Does the payment wallet match signed metadata?
9. Can I prove what happened later?

## Non-negotiable security gates

These block public production launch.

### 1. Signed passports

Every registry-served passport must include a registry signature over canonical JSON.

Required behavior:
- Remove the signature block before canonicalization.
- Sort keys and strip whitespace.
- Hash canonical JSON with SHA-256.
- Sign the hash with Ed25519.
- Include `key_id`, `algorithm`, `payload_hash`, `signature`, and `signed_at`.

Agent behavior:
- Verify the registry key is pinned or delegated.
- Recompute payload hash.
- Verify signature offline.
- Refuse if signature fails.

### 2. Pinned or delegated registry keys

A registry response is not trusted because it came from HTTPS. HTTPS is transport. OpenTrust needs content authenticity.

Required endpoints:
- `/.well-known/opentrust-keys.json`
- `/.well-known/opentrust-registries.json`

Required key model:
- Root key kept offline.
- Online signing key signs normal passports.
- Delegated registry keys signed by root.
- Key rotation document signed by both old and new key when possible.
- Expired keys retained for verification of older records.

### 3. Signed revocation list with rollback protection

Revocation is the kill switch. It must not be unsigned.

Required endpoint:
- `/.well-known/revoked-passports.json`

Required fields:
- `version`: monotonic integer.
- `updated_at`: timestamp.
- `passports`: revoked passport IDs/version hashes.
- `operator_keys`: revoked signing keys.
- `signature`: Ed25519 signature over the document.

Agent behavior:
- Reject any revocation list with invalid signature.
- Store last verified version.
- Reject older versions.
- Fail closed for payments if revocation status cannot be checked.

### 4. Version hash binding

Trust must bind to code, not a name.

Production passports must include at least one:
- Git commit hash.
- Release artifact hash.
- Container image digest.
- Package lock/dependency snapshot hash.

A plain version string is not enough.

### 5. Deny-first permission manifests

Boolean permissions are okay for draft demos. Production passports need scopes.

Bad production manifest:

```json
{ "terminal": true, "wallet": true, "private_data": true }
```

Good production manifest:

```json
{
  "terminal": {
    "allowed_commands": ["git", "python3"],
    "forbidden_commands": ["sudo", "rm -rf", "curl | sh"],
    "shell_access": false,
    "timeout_seconds": 60
  },
  "wallet": {
    "read_balance": true,
    "sign_transactions": false,
    "allowed_chains": ["base"],
    "allowed_tokens": ["USDC"],
    "escrow_only": true
  }
}
```

### 6. Local spend policy enforcement

The registry can publish facts. The caller decides what is allowed.

Default policy:
- Unknown tools: deny.
- Disputed/revoked tools: deny.
- Wallet/private data/terminal broad access: deny.
- Payments above tiny threshold: escrow or human approval.
- Recursive agent spending: deny.

### 7. Signed quotes and anti-replay payments

Payment metadata must not be a loose JSON blob.

A production quote needs:
- Quote ID.
- Passport slug and version hash.
- Amount.
- Currency.
- Chain.
- Recipient wallet.
- Expiration.
- Nonce.
- Terms/proof requirement.
- Signature.

Verification must check:
- Quote signature.
- Quote has not expired.
- Nonce has not been used.
- Wallet matches signed passport or signed invoice.
- Amount and token match policy.

### 8. Escrow before real marketplace payments

Do not launch a real paid marketplace with direct payments only.

Escrow is required for:
- New sellers.
- Code/security work.
- Private-data workflows.
- Anything above the local threshold.
- Anything with subjective delivery quality.

OpenTrust itself should not custody funds by default. It should define escrow metadata, allowlist escrow contracts, and verify escrow state.

### 9. Private admin plane

The admin panel cannot be public with normal password auth.

Required:
- Admin disabled by default in public demo.
- Separate admin hostname or VPN/Tailscale access.
- Strong auth with MFA/passkeys.
- Audit logs for trust changes, key changes, revocations, and payment config changes.
- No trust-level mutation without reason text.

### 10. Production deployment basics

Minimum public deploy gates:
- TLS 1.3.
- HSTS.
- Strict CORS allowlist.
- Secure cookies.
- Rate limits.
- Backups tested with restore drill.
- Monitoring and alerts.
- Error tracking.
- Secret rotation process.
- Non-root containers where possible.
- Database not exposed to public internet.

## Production deployment guide

### Docker

The `Dockerfile` now runs as a non-root `opentrust` user and includes a `HEALTHCHECK`.

```dockerfile
USER opentrust
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "..." || exit 1
```

### Compose

- **`docker-compose.yml`** — Development defaults. Secrets come from `.env` via `${VAR:-default}` interpolation. No hardcoded secrets.
- **`docker-compose.prod.yml`** — Production override. Adds `restart: unless-stopped`, resource limits/ reservations, multi-worker uvicorn, production Node.js build, and DB-only port binding to `127.0.0.1`.

```bash
# Production launch
cp .env.example .env
# Edit .env: ENVIRONMENT=production, JWT_SECRET=<strong>, POSTGRES_PASSWORD=<strong>
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

### Required .env variables for production

| Variable | Guidance |
|---|---|
| `ENVIRONMENT` | Set to `production`. Triggers startup validation. |
| `JWT_SECRET` | Generate with `openssl rand -hex 64`. Must not be `change_me`. |
| `POSTGRES_PASSWORD` | Random strong password. |
| `DB_URL` | Must match POSTGRES_PASSWORD. |
| `CORS_ORIGINS` | Your actual domain(s), comma-separated. No localhost. |
| `RATE_LIMIT` | E.g. `200/60` (200 requests per 60 seconds per IP). |
| `SECURITY_HSTS_ENABLED` | `true` once TLS is terminated. |

### Security headers

The `SecurityHeadersMiddleware` adds these headers to every HTTP response:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; base-uri 'self'`
- `Strict-Transport-Security` (only when `SECURITY_HSTS_ENABLED=true`)

### Rate limiting

The `RateLimitMiddleware` implements per-IP sliding window rate limiting. Configured via `RATE_LIMIT=<max>/<window>`:

- `RATE_LIMIT=100/60` — Allow 100 requests per 60 seconds per client IP.
- `RATE_LIMIT=0/0` or unset — Rate limiting disabled (development).
- Respects `X-Forwarded-For` for reverse proxy deployments.
- Different IPs have independent counters.

### Production config validation

On startup (via FastAPI `lifespan`), the API runs `run_config_validation()`:

- **Errors** (hard fail, exit code 1 in production):
  - `JWT_SECRET` is empty or set to an insecure placeholder (`change_me`, `password`, etc.)
- **Warnings** (logged, non-fatal):
  - `DB_URL` uses default dev credentials
  - `CORS_ORIGINS` includes localhost
  - `RATE_LIMIT` is disabled or very permissive
  - HSTS is not enabled

### Backup and restore

Two scripts in `scripts/`:

```bash
# Backup: dumps to backups/opentrust_<timestamp>.sql.gz, prunes after 30 days
./scripts/backup.sh

# Restore: drops + recreates DB, restores latest or specified backup
./scripts/restore.sh backups/opentrust_20250101_120000.sql.gz

# Docker-based backup (no local psql needed)
docker compose exec -T db pg_dump -U opentrust -d opentrust --compress=9 > backups/opentrust_$(date +%Y%m%d_%H%M%S).sql.gz
```

Also available via Make:
```bash
make backup
make restore
make docker-backup
```

### Makefile production targets

```bash
make docker-prod-up        # docker compose with prod override
make docker-prod-down      # tear down production stack
make prod-check            # validate .env config without starting server
make backup                # run backup script
make restore               # run restore script
make docker-backup         # backup via db container
```

## Registry security model for Joshua's registry

Using Joshua's name as the first registry is fine if the registry is honest about its role:

- `Joshua Herron / SoulForge Registry` can be the first root/demo registry.
- It should be a signed reference registry, not a permanent gatekeeper.
- The public messaging should say: "This registry is one operator in a federated OpenTrust network. Agents verify signed passports locally."

That keeps credibility without pretending there is already a foundation.

## Production phases

### Phase A — Local production-grade verifier

Goal: agents can verify passports safely without a live server.

Build:
- Better CLI validation errors.
- Semantic validation rules.
- Local registry key pin file.
- Signature verifier.
- Signed revocation-list verifier.
- Test vectors for good signature, bad signature, stale revocation, rollback revocation.

Exit gate:
- `opentrust validate` gives clear reasons.
- `opentrust verify passport.json --registry-key keys.json --revocations revoked.json` fails closed.

### Phase B — Signed registry API

Goal: registry responses are signed and cacheable.

Build:
- Registry signing service.
- `/.well-known/opentrust-keys.json`.
- `/.well-known/revoked-passports.json`.
- Signature block on passport responses.
- Key rotation docs and tests.
- Admin audit log.

Exit gate:
- CLI verifies live registry response offline.
- Tampered response fails.
- Old revocation version fails.

### Phase C — Permission and spend enforcement

Goal: agents can deny risky tools before calling them.

Build:
- Production spend policy schema.
- Default deny-first policy file.
- Permission risk scoring.
- CLI `policy check passport.json`.
- Block wallet/private_data/terminal broad booleans.
- Human-readable denial reasons.

Exit gate:
- Unsafe passport fails policy check with exact reason.
- Safe scoped passport passes.

### Phase D — Signed payment quotes

Goal: paid tool calls are safe enough for testnet/sandbox.

Build:
- Quote schema.
- Quote signer/verifier.
- Nonce store.
- Expiration checks.
- Wallet binding check.
- Ledger-first payment flow.

Exit gate:
- Replayed quote fails.
- Expired quote fails.
- Wallet-swapped quote fails.

### Phase E — Escrow and marketplace safety

Goal: real payments can happen without OpenTrust custody.

Build:
- Escrow contract allowlist.
- Escrow state verifier.
- Delivery proof schema.
- Dispute/refund path.
- Hot wallet limits.
- Manual approval threshold.

Exit gate:
- Payment above threshold cannot bypass escrow.
- Delivery proof must match contract before release.

### Phase F — Public demo that people understand in five minutes

Goal: make the idea obvious.

Demo story:
1. Agent wants to call a tool.
2. Tool shows OpenTrust passport.
3. CLI verifies signature, version hash, revocation, permission manifest, and spend policy.
4. Unsafe tool gets blocked.
5. Safe tool gets called.
6. Paid tool quote gets verified but uses mock/testnet payment.

Exit gate:
- A developer can run the demo in under five minutes.
- The demo shows one real tool using both `SKILL.md` and OpenTrust Passport.

## What not to do yet

Do not spend time on:
- Token launch.
- DAO/foundation theater.
- Complex blockchain consensus.
- Paid trust labels.
- Custodial wallets.
- Full public marketplace before signed passports and revocation work.

The boring security pieces are the product. If those are weak, OpenTrust becomes another badge site.
