# OpenTrust — Claude Code Guide

OpenTrust is the protocol standard for AI agent tool trust. It answers: "Can I trust this tool?", "What permissions does it claim?", and "How does trust flow when my agent spawns sub-agents?"

**This repo is the protocol layer only.** The marketplace/registry and the MCP capability server live in separate repos:

- **[Costder/OpenTrustWeb](https://github.com/Costder/OpenTrustWeb)** — FastAPI backend + Next.js frontend + payment contracts
- **[Costder/hands-body-and-feet](https://github.com/Costder/hands-body-and-feet)** — MCP capability server (email, phone, wallet, payments, cards, etc.)

---

## Repository layout

| Path | What it is |
|---|---|
| `passport-schema/` | JSON Schema definitions and examples for the passport format |
| `sdk/` | Python SDK — `pip install opentrust-sdk`, imports as `opentrust`; MCP server via `opentrust-mcp` entry point |
| `sdk-ts/` | TypeScript SDK — `npm install @infinitestudios/opentrust-client`, `OpenTrust` class for JS/TS agent code |
| `cli/` | Python/Typer CLI — `opentrust inspect`, `validate`, `status`, `badge`, etc. |
| `packages/opentrust-gateway/` | MCP/API gateway runtime for hosted, remote, and local connector tools |
| `badge-generator/` | SVG badge generation script |
| `manifest-validator/` | Standalone passport validator |
| `passport-generator/` | Passport creation helper |
| `rfcs/` | Spec proposals — how the standard evolves |
| `docs/` | Protocol documentation — architecture, security, governance |
| `demos/` | Example tool with generated passport artifacts |
| `tests/` | Cross-cutting test vectors |

---

## Python setup

Requires Python 3.11+.

```bash
python -m pip install -e cli
python -m pip install -e "sdk[mcp]"
```

---

## Running tests

From the **repo root**:

```bash
pytest cli/tests sdk/tests
```

---

## Using the CLI

After `pip install -e cli`:

```bash
opentrust inspect github/file-search-mcp    # fetch and display a passport
opentrust validate my-tool.json             # validate against schema
opentrust status my-tool --format json      # check trust status
opentrust badge my-tool                     # generate SVG badge
```

The CLI connects to `http://localhost:8000` by default. Set `OPENTRUST_API_URL` to point at a different registry (e.g. `https://opentrust.sh`).

---

## TypeScript SDK

```bash
cd sdk-ts
npm ci
npm run build      # build dist
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

---

## Gateway

```bash
cd packages/opentrust-gateway
npm ci
npm run build
npm test
```

---

## CI

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. Python install + pytest (CLI and SDK tests)
2. npm audit signatures (sdk-ts)
3. sdk-ts typecheck + tests
4. Gateway lockfile registry check + typecheck + tests + build

All steps must pass before merge.

---

## Architecture notes

**Import convention:** All Python source uses absolute imports from the repo root (`opentrust_cli.*`, `opentrust.*`). Always run `pytest` from the repo root.

**Trust ladder:** Passports progress through 8 levels (`auto_generated_draft` → `creator_claimed` → `seller_confirmed` → `community_reviewed` → `reviewer_signed` → `security_checked` → `continuously_monitored`; `disputed` can apply at any level). Agents should only call tools at `seller_confirmed` (level 3) or higher.

---

## Contribute

See `CONTRIBUTING.md`. Schema changes require an RFC (14-day comment period). Everything else — bug fixes, CLI improvements, docs, tests — can go straight to a PR.
