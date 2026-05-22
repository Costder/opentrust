# OpenTrust Implementation Plan

## Phase 0 — Reference Registry ✅ Complete

Shipped the public OpenTrust foundation.

- Agent Tool Passport schema and examples.
- FastAPI registry with machine-readable trust status in responses.
- Auto-generated draft warning for unverified passports.
- CLI for inspection, search, status, validation, claim, badge, and demo checkout creation.
- Next.js registry frontend with commercial status filters and passport pages.
- Badge generator, manifest validator, passport generator, docs, scripts, CI, and Docker Compose.
- Payment contract schema. Real payment provider integrations are implemented by registry operators against the schema — not part of the reference registry.

---

## Phase 1 — Production Hardening ✅ Complete

All security gates from the original production track checklist are done.

| Gate | Status | Detail |
|---|---|---|
| Signed passports with offline verification | ✅ Done | Ed25519, `crypto.py`, `opentrust verify` CLI command |
| Pinned registry keys | ✅ Done | `/.well-known/opentrust-keys.json` — permanent key `opentrust-registry-2f444004` deployed |
| Signed revocation lists with rollback protection | ✅ Done | Monotonic version, rollback rejection, offline verification in CLI |
| Version hashes bound to commit/artifact | ✅ Done | `version_hash` block required on all passports |
| Deny-first permission policy | ✅ Done | wallet, terminal, private_data, browser blocked by default |
| Spend policy enforcement | ✅ Done | Local max spend, chain allowlist, escrow + human approval thresholds |
| Signed, expiring, nonce-protected payment quotes | ✅ Done | 30+ tests across all quote safety properties |
| Private admin plane with audit log | ✅ Done | Bearer-token protected revoke endpoint, full audit log with timestamps |
| TLS + HSTS | ✅ Done | TLS via Vercel, HSTS header middleware |
| Security headers | ✅ Done | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Rate limiting | ✅ Done | Sliding window, per-IP, configurable via `RATE_LIMIT` env var |
| Cloud database | ✅ Done | Turso (SQLite-compatible), automatic failover to local aiosqlite in dev |
| Vercel deployment | ✅ Done | API at `api-kappa-pied-59.vercel.app`, web at `web-five-psi-74.vercel.app` |
| 155-test suite | ✅ Done | API, CLI, payment-contracts, passport CRUD, crypto, hardening, registry contract |
| CI | ✅ Done | GitHub Actions: Python tests, npm lockfile check, npm audit signatures, Next.js build |
| Claude Code compatibility | ✅ Done | `CLAUDE.md`, `pytest.ini`, `.claude/settings.json` |

### Still needed before a custom domain

- [ ] **Restore drill** — practice recovering Turso data on the actual host
- [ ] **Custom domain** — add real domain in Vercel, update `REGISTRY_URL` and `CORS_ORIGINS`

---

## Phase 2 — Granular Permissions (v0.2)

**Status: Not started. RFC open for contribution.**

The current permission manifest uses top-level booleans (`file: true`, `network: true`). Phase 2 adds path-level and domain-level scoping:

```json
"permission_manifest": {
  "file": {
    "read": ["./docs/**"],
    "write": []
  },
  "network": {
    "allowed_domains": ["api.github.com", "api.openai.com"],
    "blocked_domains": []
  },
  "terminal": {
    "forbidden_commands": ["rm -rf", "curl | sh", "wget | sh"]
  }
}
```

This makes the manifest machine-enforceable at the agent runtime level, not just declarative. A deny-first policy can parse allowed paths and reject calls that fall outside them without a human review step.

---

## Phase 3 — Evidence Requirements (v0.3)

**Status: Not started.**

`security_checked` currently has no structured evidence requirement. Phase 3 adds a required evidence block for levels 5+:

```json
"evidence": {
  "scanner": "semgrep",
  "run_at": "2026-05-21T00:00:00Z",
  "commit": "abc1234",
  "findings": { "critical": 0, "high": 0, "medium": 2 },
  "reviewer": { "identity": "...", "signature": "..." },
  "dependency_snapshot": "sha256:..."
}
```

---

## Phase 4 — Real Marketplace (v0.6)

**Status: Contracts and interfaces exist. Not live.**

- Live USDC payments on Base L2
- On-chain escrow contracts
- Wallet connect for sellers and buyers
- Custodial option for operators who don't want to deal with crypto
- Real Coinbase Commerce integration (keys exist in `.env.marketplace.example`)

---

## Phase 5 — Governance Transfer (v1.0)

**Status: Not started. Deferred until adoption exists.**

Once the schema is stable and in production use by at least a few third-party registries, governance moves to a neutral foundation. The spec will be versioned, the RFC process formalized, and no single entity will control changes.

---

## What Is Permanently Deferred

These are out of scope for the reference implementation and will always be left to operators:

- Custodial wallet management
- KYC / AML compliance
- Fiat on-ramp integration
- Research pools and sponsored discovery rankings
- Per-user billing and subscription management
