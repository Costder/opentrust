# OpenTrust — Claude Code Guide

OpenTrust is a monorepo implementing an open standard for AI agent tool trust. It answers: "Can I trust this tool?", "What does it cost, and can my agent pay automatically?", and "How does trust flow when my agent spawns sub-agents?"

---

## Repository layout

| Path | What it is |
|---|---|
| `api/` | FastAPI backend — passport registry, marketplace, payments, GitHub OAuth |
| `web/` | Next.js 16 frontend — tool browser, claim flow, launch lab |
| `cli/` | Python/Typer CLI — `opentrust inspect`, `validate`, `status`, `badge`, etc. |
| `sdk/` | Python SDK — `pip install opentrust-sdk`, imports as `opentrust`; MCP server via `opentrust-mcp` entry point |
| `sdk-ts/` | TypeScript SDK — `npm install @infinitestudios/opentrust-client`, `OpenTrust` class for JS/TS agent code |
| `passport-schema/` | JSON Schema definitions and examples for the passport format |
| `payment-contracts/` | Abstract payment interfaces (installable Python package) |
| `docs/` | Protocol documentation — architecture, security, API spec, governance |
| `badge-generator/` | SVG badge generation script |
| `manifest-validator/` | Standalone passport validator |
| `passport-generator/` | Passport creation helper |
| `packages/hands-body-and-feet/` | TypeScript MCP server — gives agents real-world capabilities; the persistent body |

---

## Python setup

Requires Python 3.11+.

```bash
python -m pip install -r api/requirements.txt
python -m pip install -e cli -e payment-contracts
```

This installs the FastAPI stack, the `opentrust` CLI, and the payment-contracts package — all in one go, matching exactly what CI does.

---

## Running the API

From the **repo root** (required — imports use `api.src.*`):

```bash
JWT_SECRET=dev uvicorn api.src.main:app --reload
```

The API listens on `http://localhost:8000`. Health check: `GET /api/v1/health`.

Default config uses SQLite (`opentrust.db` in the repo root, gitignored). No database setup needed for development.

For environment variables, copy `.env.marketplace.example` to `.env.marketplace` and fill in any secrets you need. The API loads `.env` then `.env.marketplace` on startup.

---

## Running the web frontend

Requires Node.js 20+.

```bash
cd web
npm ci
npm run dev          # http://localhost:3000
```

The web app proxies all `/api/` requests to the FastAPI backend via `INTERNAL_API_URL` (server-side) or `NEXT_PUBLIC_API_URL` (client-side). Both default to `http://localhost:8000`, so no env setup is needed when running both locally.

---

## Running tests

From the **repo root**:

```bash
pytest api/tests payment-contracts/tests cli/tests
```

All tests run without a live database or external secrets — the API tests call route functions directly, and payment tests use the in-memory mock store. The `pytest.ini` at the repo root sets `asyncio_mode = auto` and anchors the rootdir so `api.src.*` imports resolve correctly.

---

## Using the CLI

After `pip install -e cli`:

```bash
opentrust inspect github/file-search-mcp    # fetch and display a passport
opentrust validate my-tool.json             # validate against schema
opentrust status my-tool --format json      # check trust status
opentrust badge my-tool                     # generate SVG badge
opentrust payment create-checkout tool      # demo checkout (uses mock provider)
```

The CLI connects to `http://localhost:8000` by default. Set `OPENTRUST_API_URL` to point at a different registry.

---

## Key environment variables

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | _(empty — required)_ | Signs claim tokens. Generate: `openssl rand -hex 64` |
| `ENVIRONMENT` | `development` | Set to `production` to enable startup config validation |
| `DB_URL` | `sqlite+aiosqlite:///./opentrust.db` | Database connection string |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `RATE_LIMIT` | `100/60` | `<max_requests>/<window_seconds>` per IP |
| `TRUSTED_PROXIES` | _(empty)_ | Comma-separated proxy/edge IPs allowed to set `X-Forwarded-For`; else the header is ignored (anti-spoof). Set to edge ranges in prod |
| `REGISTRY_ADMIN_TOKEN` | _(empty)_ | Bearer token gating admin endpoints. **Required in production** — startup fails if empty and the endpoints fail closed |
| `PAYMENT_PROVIDER` | `mock` | `mock` for dev; `coinbase` for live payments |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | _(empty)_ | GitHub OAuth for claim flow |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY_PATH` | _(empty)_ | GitHub App for repo verification |
| `COINBASE_BUSINESS_API_KEY_ID` / `_SECRET` | _(empty)_ | Coinbase Commerce (real payments) |
| `REGISTRY_PRIVATE_KEY_PATH` or `REGISTRY_PRIVATE_KEY_BASE64` | _(empty)_ | Ed25519 key for signing passports |
| `TURSO_URL` | _(empty — uses SQLite)_ | Turso database URL (`libsql://...turso.io`) |
| `TURSO_AUTH_TOKEN` | _(empty — uses SQLite)_ | Turso auth token |
| `SQLITE_PATH` | `./opentrust.db` | Local SQLite file path (dev only) |

Setting `JWT_SECRET` is the only thing required to start the API for development. Everything else has safe defaults.

---

## Architecture notes

**Import convention:** All Python source uses absolute imports from the repo root (`api.src.*`, `opentrust_cli.*`, `payment_contracts.*`). Always run `pytest` and `uvicorn` from the repo root, not from within subdirectories.

**Payment provider:** Defaults to `mock`. The mock store is an in-memory singleton (`api/src/services/marketplace_store.py`) — all checkout, verification, and badge flows work without any payment credentials. Tests call `store.reset()` between cases.

**Database:** SQLite for development, PostgreSQL for production. The ORM is SQLAlchemy async; migrations are in `passport-schema/migrations/`. The Dockerfile expects `asyncpg` and a real `DB_URL`.

**Trust ladder:** Passports progress through 8 levels (`auto_generated_draft` → `creator_claimed` → `seller_confirmed` → `community_reviewed` → `reviewer_signed` → `security_checked` → `continuously_monitored`; `disputed` can apply at any level). Agents should only call tools at `seller_confirmed` (level 3) or higher.

**Web proxy:** `web/src/app/api/[...path]/route.ts` proxies all frontend API calls to the FastAPI backend. The proxy strips the `v1/` prefix handling so both `/api/health` and `/api/v1/health` work from the browser.

**Well-known endpoints:** `/.well-known/opentrust-keys.json`, `/.well-known/revoked-passports.json`, etc. are served at the root (not under `/api/v1/`). These are defined in `api/src/routes/well_known.py`.

**Production validation:** When `ENVIRONMENT=production`, startup validates JWT_SECRET strength, DB credentials, CORS origins, rate limit config, and HSTS. Missing/insecure values abort the process. This lives in `api/src/config.py:run_config_validation()`.

---

## Turso setup (production database)

Turso is a free SQLite-compatible cloud DB. When `TURSO_URL` and `TURSO_AUTH_TOKEN` are both set, the API uses Turso's HTTP pipeline API instead of local SQLite. Leave both empty for dev — aiosqlite kicks in automatically.

```bash
# One-time setup (install Turso CLI first: curl -sSfL https://get.tur.so/install.sh | bash)
turso auth signup
turso db create opentrust
turso db show opentrust --url        # → TURSO_URL
turso db tokens create opentrust     # → TURSO_AUTH_TOKEN
```

## Deployment

Two separate Vercel projects — frontend and API are deployed independently.

**Frontend (Next.js):** root `vercel.json` sets `rootDirectory: "web"`. Vercel auto-detects Next.js.

**API (FastAPI):** `api/vercel.json` uses `@vercel/python` runtime with `api/main.py` as entry point. Deploy the `api/` directory as its own Vercel project.

```bash
# Install Vercel CLI once:
npm i -g vercel

# Deploy frontend (from repo root):
vercel --prod

# Deploy API (from api/ directory):
cd api && vercel --prod
```

After deploying the API, set `INTERNAL_API_URL` in the frontend project's Vercel env vars to the API's `.vercel.app` URL. The Next.js proxy route (`web/src/app/api/[...path]/route.ts`) forwards all `/api/*` requests to it.

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:
1. Python install + pytest (API, CLI, payment-contracts, and SDK tests)
2. npm lockfile registry check (blocks non-npmjs.org deps)
3. npm audit signatures (verifies package integrity)
4. Next.js lint + build
5. `sdk-ts` typecheck + tests
6. `packages/hands-body-and-feet` typecheck + tests (377 tests)

All steps must pass before merge.

**Import resolution:** `pytest.ini` sets `pythonpath = .` so `api.src.*` imports
resolve under a bare `pytest` invocation (as CI runs it), not only under
`python -m pytest` (which adds the CWD to `sys.path` itself).

---

## Contribute

See `CONTRIBUTING.md`. Schema changes require an RFC (14-day comment period). Everything else — bug fixes, CLI improvements, docs, tests — can go straight to a PR.
