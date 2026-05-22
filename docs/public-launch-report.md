# OpenTrust Public Launch Readiness Report

Generated: 2026-05-21
Repo: `/home/joshua/opentrust`

## Executive status

OpenTrust is now ready for a public read/demo launch from the code side. The remaining work is operator/infrastructure work that cannot be safely completed without real production values: domain, TLS certificate/reverse proxy, production secrets, backup destination, and the final deployment host.

This is not just a doc pass. The implementation now includes signed registry material, offline verification, revocation rollback protection, deny-first policy checks, signed payment quotes, deployment hardening, and an interactive web Launch Lab.

## What changed

### 1. Registry signing and revocation

Files:
- `api/src/crypto.py`
- `api/src/well_known.py`
- `api/src/routes/well_known.py`
- `api/tests/test_crypto.py`
- `api/tests/test_production_registry_contract.py`

Implemented:
- Ed25519 signing helpers.
- Signed passports with payload hashes.
- Signed `/.well-known/opentrust-registries.json`.
- Signed `/.well-known/revoked-passports.json`.
- Monotonic revocation versioning.
- Rollback-aware CLI verification.
- Persistent registry state via `REGISTRY_STATE_PATH`.
- Registry private key loading via `REGISTRY_PRIVATE_KEY_PATH` or `REGISTRY_PRIVATE_KEY_BASE64`.
- Admin revocation guarded by `REGISTRY_ADMIN_TOKEN` when configured.
- Revocation audit log.
- Public key endpoints that do not expose private key material.

### 2. Validator and CLI policy gates

Files:
- `cli/src/opentrust_cli/schema_validator.py`
- `cli/src/opentrust_cli/commands/verify.py`
- `cli/src/opentrust_cli/commands/policy.py`
- `cli/src/opentrust_cli/main.py`
- `cli/tests/test_schema_validator.py`
- `cli/tests/test_verify.py`
- `cli/tests/test_policy_spend_file.py`
- `passport-schema/examples/default-spend-policy.json`

Implemented:
- Clear schema validation errors with JSON paths.
- Required commit or artifact hash for production-bound passports.
- Broad dangerous permissions rejected: `wallet`, `terminal`, `private_data`.
- High trust statuses require stronger provenance/signature data.
- `opentrust verify` for offline signature verification.
- `opentrust policy check` for local deny-first enforcement.
- Explicit spend policy file support.
- Chain/currency allowlists.
- Human approval and escrow thresholds.

### 3. Payment quote safety

Files:
- `payment-contracts/payment_contracts/models.py`
- `payment-contracts/payment_contracts/__init__.py`
- `payment-contracts/tests/test_quote_validation.py`
- `payment-contracts/tests/test_quote_production_safety.py`

Implemented:
- Signed payment quote model.
- Quote expiration checks.
- Nonce replay protection.
- Recipient wallet binding.
- Proof requirement field.
- Safer nonce handling: invalid quotes do not burn nonce before signature/wallet checks.

### 4. Production deployment hardening

Files:
- `api/src/config.py`
- `api/src/main.py`
- `api/src/middleware/rate_limit.py`
- `api/src/middleware/security_headers.py`
- `api/tests/test_production_hardening.py`
- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `.env.example`
- `Makefile`
- `scripts/backup.sh`
- `scripts/restore.sh`
- `docs/production-readiness.md`

Implemented:
- Non-root Docker runtime user.
- Docker healthcheck.
- Production compose override.
- Production config validation on startup.
- Hard failure for unsafe JWT secret in `ENVIRONMENT=production`.
- Real per-IP sliding-window rate limiting.
- Security headers middleware.
- HSTS support when TLS is configured.
- Dev/prod env documentation.
- Backup and restore scripts.
- Production Makefile targets.

### 5. Five-minute demo tool

Directory:
- `demos/hello-opentrust-tool/`

Implemented:
- Real toy tool: `tool/weather.py`.
- `SKILL.md` for the tool.
- Safe passport.
- Unsafe passport.
- Public demo registry key file with no private signing key.
- Signed passport artifact.
- Signed payment quote artifact with long-lived demo expiration.
- Policy file.
- End-to-end integration test: schema validation, signature verification, policy allow/deny, quote validation, replay protection, wallet mismatch, and tool execution.

### 6. Interactive web UI

Files:
- `web/src/app/launch-lab/page.tsx`
- `web/src/components/LaunchLab.tsx`
- `web/src/components/Navigation.tsx`
- `web/src/app/page.tsx`
- `web/src/app/api/[...path]/route.ts`
- `web/package.json`
- `web/package-lock.json`
- `web/tsconfig.json`

Implemented:
- `/launch-lab` interactive Launch Lab.
- Launch-gate checklist.
- Safe vs unsafe passport policy simulator.
- Live registry probe for:
  - `/api/v1/health`
  - `/.well-known/opentrust-keys.json`
  - `/.well-known/opentrust-registries.json`
  - `/.well-known/revoked-passports.json`
- Home page entry point to Launch Lab.
- Web dependency upgrade to Next 16 / React 19.
- `npm audit --audit-level=moderate` reports zero vulnerabilities.

## Verification evidence

Python/API/CLI/payment/demo:

```bash
. .venv/bin/activate && python -m pytest api/tests payment-contracts/tests cli/tests demos/hello-opentrust-tool/test_demo.py
```

Result:

```text
145 passed in 1.52s
```

Python compilation:

```bash
. .venv/bin/activate && python -m compileall api/src cli/src payment-contracts/payment_contracts demos/hello-opentrust-tool
```

Result: exit 0.

Web tests/build/audit:

```bash
cd web
npm test
npm run build
npm audit --audit-level=moderate
```

Result:

```text
1 web test passed
Next.js production build succeeded
found 0 vulnerabilities
```

Demo artifact regeneration:

```bash
cd demos/hello-opentrust-tool
source ../../.venv/bin/activate
python generate_artifacts.py
```

Result:

```text
Passport signature self-verification PASSED
Payment quote self-verification PASSED
Nonce replay protection verified
CLI verify PASSED
CLI policy check safe ALLOWED
CLI policy check unsafe DENIED
```

## Security posture

### Ready in code

- Signed passports.
- Pinned/delegated registry key document shape.
- Signed revocation list.
- Revocation rollback protection.
- Local deny-first policy checks.
- Signed and replay-protected payment quotes.
- Wallet binding on quotes.
- Non-custodial default posture.
- Admin mutation route protected by bearer token when configured.
- Audit log for revocation actions.
- Non-root container runtime.
- Production startup validation for unsafe secrets.
- Rate limiting.
- Security headers and HSTS support.
- Backup/restore scripts.
- Interactive public demo UI.

### Still requires operator input before real public launch

These are not code tasks; they require real production values or external infrastructure:

1. Choose final public domain and API domain.
2. Configure TLS certificate and reverse proxy.
3. Set real `JWT_SECRET`.
4. Generate and store real registry signing key outside git.
5. Set `REGISTRY_PRIVATE_KEY_PATH` or secrets-manager equivalent.
6. Set strong `REGISTRY_ADMIN_TOKEN`.
7. Set strong Postgres password and production `DB_URL`.
8. Set production `CORS_ORIGINS`.
9. Run a real backup and restore drill on the production host.
10. Decide whether payments stay mock/testnet for public demo or move to real escrow.

## Recommended public launch mode

Use a public read/demo launch first:

- Public web UI and registry read endpoints enabled.
- Public demo tool enabled.
- Mock/testnet payment quote demo only.
- No custody of user funds.
- No real marketplace payment settlement until escrow contracts are independently reviewed.
- Admin endpoints private behind strong token and, preferably, Tailscale/VPN or reverse-proxy auth.

## Suggested run commands

Local API:

```bash
cd /home/joshua/opentrust
source .venv/bin/activate
uvicorn api.src.main:app --reload --host 0.0.0.0 --port 8000
```

Local web UI:

```bash
cd /home/joshua/opentrust/web
npm run dev
```

Then open:

```text
http://localhost:3000/launch-lab
```

Production-style compose:

```bash
cp .env.example .env
# edit .env with real secrets/domains first
make prod-check
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

## Bottom line

All no-input engineering tasks I can safely do locally are done. The codebase is now ready for a public read/demo launch once Joshua supplies or chooses the external production values: domain, TLS, deployment host, real secrets, and final payment mode.
