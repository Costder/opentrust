# Registry Cleanup, Demo Separation & Admin Login — Design

Status: **Draft — awaiting sign-off**
Author: Claude Opus 4.8
Date: 2026-06-01

Addresses three asks:
1. Real, reachable API docs
2. Separate demo artifacts from the real registry (a dedicated demo page, not deletion)
3. An elevated admin login (for the operator + their agents) to manually add/manage MCP servers and tools

---

## 1. API docs — FIXED (already done this session)

**Root cause:** FastAPI serves Swagger at `/docs` + `/openapi.json` (root level), and those
**work live** (verified 200). The nav linked to `/api/v1/docs`, which the web proxy mangles.

**Fix:** nav now links to `${NEXT_PUBLIC_API_URL}/docs`. FastAPI metadata enriched with a real
description, contact, license, version 1.0.0. Done — just needs deploy.

---

## 2. Demo / real separation (not deletion)

The registry has two seed sources:
- `scripts/seed_tools.py` → 8 **fictional demo** tools (github-file-search, weather-lookup,
  slack-poster, cve-monitor, web-scraper-mcp, code-audit-semgrep, sql-query-runner, pdf-extractor)
- `scripts/seed_real_mcp_servers.py` → **real** MCP servers (modelcontextprotocol-*,
  github-mcp-server, notion-mcp-server, stripe-mcp-server, etc.)

### Design: an `is_demo` flag

- New nullable column `is_demo` on `passports` (additive migration, defaults false/0)
- `PassportRead` exposes `is_demo: bool`
- `/tools` **excludes** demo passports by default (real registry stays clean)
- `/tools?include_demo=true` or `/tools?demo_only=true` to view demo set
- A dedicated web page `/demo` renders the demo catalog, clearly labeled "Demo / examples"
- The real `/tools` page and registry show only real entries

This keeps the demo tools as a *showcase* (your call — not deleted) while the production
registry only surfaces real, claimable tools.

### Marking existing demo data

- `seed_tools.py` updated to set `is_demo=true` on its 8 slugs
- A one-shot admin action (or migration) flags those 8 slugs as demo in prod if present
- Anything already malformed in prod is already skipped by the resilience fix

---

## 3. Admin login (elevated, Bearer-token)

Reuse the existing `REGISTRY_ADMIN_TOKEN` + `_require_admin` pattern (already in prod, already
used for `/revoke`). No new auth system.

### New admin endpoints (all gated by `_require_admin`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/admin/tools` | Create a passport at any trust level (operator vouching) |
| `DELETE` | `/admin/tools/{slug}` | Remove a passport (real deletion, admin only) |
| `PATCH` | `/admin/tools/{slug}` | Edit metadata / trust_status / is_demo flag |

- Auth: `Authorization: Bearer <REGISTRY_ADMIN_TOKEN>`. Works for the operator AND their agents
  (agents send the same header). 401 missing / 403 wrong token / open in dev (empty token).
- `POST /admin/tools` lets the operator set `trust_status` directly (e.g. straight to
  `community_reviewed`) — the registry operator vouching for a real MCP server, bypassing the
  earn-trust flow. This is how you "manually add MCP servers and tools."
- `PATCH` can flip `is_demo`, fix a broken row, or promote/demote trust.

### Web admin panel `/admin`

- A simple page: paste the admin token (stored in `sessionStorage`, never committed)
- Form to add a tool (name, slug, category, trust level, demo flag, MCP command/url)
- A table of all tools with delete + edit-trust + toggle-demo actions
- Gated client-side by token presence; server enforces on every call

---

## Implementation Units (TDD)

1. `is_demo` column + migration + `PassportRead.is_demo` (+ resilience already done)
2. `/tools` demo filtering (exclude by default, `include_demo`/`demo_only` params)
3. Admin endpoints (`POST`/`DELETE`/`PATCH /admin/tools`) gated by `_require_admin`
4. Flag the 8 demo slugs in `seed_tools.py`
5. Web `/demo` page (demo catalog) + `/admin` page (token + CRUD)
6. Deploy API + web; flag existing prod demo rows via admin PATCH

---

## Out of Scope

- GitHub-handle-based admin (chose Bearer token — simpler, agent-friendly)
- Per-user roles / multiple admins (single shared admin token for now)
- Editing passports via the public flow (admin only)

---

## Sign-Off Criteria

- [ ] API docs reachable from the nav (links to working /docs)
- [ ] Real registry (`/tools`) shows only real tools; demo tools on a separate `/demo` page
- [ ] Admin can add an MCP server/tool at elevated trust via Bearer-token endpoint
- [ ] Admin can delete/edit/flag any passport
- [ ] /tools never 500s on a malformed row (done)
- [ ] Full suite green; new behavior TDD'd
