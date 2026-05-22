# Refined Phase 0 Implementation Plan

This build implements the public OpenTrust foundation from the updated Agent Tool Trust Protocol strategy.

## Scope

Phase 0 is a trust registry first:

- Agent Tool Passport schema and examples.
- FastAPI registry with machine-readable trust status in responses.
- Auto-generated draft warning for unverified passports.
- CLI for inspection, search, status, validation, claim, badge, and demo checkout creation.
- Next.js registry frontend with commercial status filters and pricing stubs.
- Badge generator, manifest validator, passport generator, docs, scripts, CI, and Docker Compose.
- Payment contract schema and 501 stub endpoints. Real payment provider integrations are implemented by registry operators against the schema — not part of the reference registry.

## Production track

The production track is separate from the demo track. Demo payments and unsigned local data are fine for explaining the idea, but public production requires the security gates in [production-readiness.md](production-readiness.md):

- Signed passports with offline verification.
- Pinned or delegated registry keys.
- Signed revocation lists with rollback protection.
- Version hashes bound to commit/artifact/container digest.
- Deny-first permission and spend policy checks.
- Signed, expiring, nonce-protected payment quotes.
- Escrow before real marketplace payments.
- Private, strongly authenticated admin plane.
- TLS, HSTS, backups, monitoring, and tested restore path.

## Deferred

- Real payment provider integrations.
- Custodial escrow.
- Wallet connect.
- Production billing tables.
- Real marketplace transaction flows.
- Research pools and sponsored discovery.

## Success Gates

- Python tests pass.
- Passport examples validate against JSON Schema.
- Web lint, tests, and production build pass.
- Payment API and CLI paths return 501 with clear schema reference messaging.
- Repo initializes on `main` with the Phase 0 implementation committed.
