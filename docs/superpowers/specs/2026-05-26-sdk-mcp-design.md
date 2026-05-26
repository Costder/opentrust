# OpenTrust SDK + MCP Server — Design Spec
**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** Three deliverables — Python SDK, MCP server, TypeScript SDK

---

## Overview

OpenTrust currently has a CLI (for humans) and a live REST API. This spec adds the agent-facing layer: a Python SDK, an MCP server that lets Claude and any MCP-compatible runtime query trust natively, and a TypeScript SDK for JS/TS agent frameworks.

---

## Package Layout

```
sdk/          Python SDK + MCP server (single pip-installable package)
sdk-ts/       TypeScript SDK (npm package: @opentrust/client)
```

Both are new top-level directories in the monorepo. The existing `cli/` package is unchanged.

---

## Deliverable 1 — Python SDK (`sdk/`)

### Package identity
- **PyPI name:** `opentrust-sdk`  
- **Import name:** `opentrust`  
- **Entry points:** `opentrust-mcp` → `opentrust.mcp:main`
- **Dependencies:** `httpx` only  
- **Python:** 3.11+

### Public API

```python
import opentrust

# Async (primary)
result = await opentrust.verify("github-file-search")
passport = await opentrust.get("github-file-search")
tools    = await opentrust.search("sql database")
page     = await opentrust.list(trust_status="security_checked", limit=20)

# Sync wrappers (convenience)
result  = opentrust.verify_sync("github-file-search")
passport = opentrust.get_sync("github-file-search")
```

### Return types

**`VerifyResult`**
```python
@dataclass
class VerifyResult:
    slug: str
    trust_status: str          # e.g. "community_reviewed"
    trust_level: int           # 1–7
    recommendation: str        # plain-English guidance
    risk: str                  # "low" | "medium" | "high"
    passport: dict             # full raw passport
    permissions: dict          # permission_manifest
```

**`ToolsPage`**
```python
@dataclass
class ToolsPage:
    items: list[dict]
    total: int
    page: int
    limit: int
```

### Recommendation logic

Recommendations are generated from a lookup table keyed by trust level, with extra warnings appended when `wallet` or `terminal` permissions are active:

| Level | Recommendation |
|-------|---------------|
| 1 | "Auto-generated draft. Do not use in any agent workflow." |
| 2 | "Creator claimed. Verify source independently before use." |
| 3 | "Owner confirmed. Suitable for sandboxed/test environments only." |
| 4 | "Community reviewed. Safe for low-risk tasks. Require level 6+ for production." |
| 5 | "Reviewer signed. Suitable for most production tasks without sensitive permissions." |
| 6 | "Security checked. Safe for production including sensitive permissions." |
| 7 | "Continuously monitored. Highest trust level available." |

Extra warning appended if `wallet=true`: `" ⚠ Wallet access active — verify payment amounts before use."`  
Extra warning appended if `terminal=true`: `" ⚠ Terminal access active — review allowed commands carefully."`

### Configuration

- `OPENTRUST_API_URL` env var — defaults to `https://api-kappa-pied-59.vercel.app`
- Can also be set per-call: `opentrust.verify("slug", api_url="https://my-registry.example.com")`

### File structure

```
sdk/
  pyproject.toml
  src/
    opentrust/
      __init__.py       # verify, get, search, list + sync variants
      _client.py        # httpx async client (internal)
      _types.py         # VerifyResult, ToolsPage dataclasses
      _recommend.py     # recommendation + risk logic
      mcp.py            # MCP server (see Deliverable 2)
  tests/
    test_sdk.py         # unit tests with httpx mock
```

---

## Deliverable 2 — MCP Server (`sdk/src/opentrust/mcp.py`)

Lives inside the Python SDK package. Run via `python -m opentrust.mcp` or the `opentrust-mcp` entry point.

### Protocol
stdio (standard MCP transport) — compatible with Claude Desktop, Cursor, Cline, and any MCP host.

### Tools exposed

**`verify_tool`**
```
Description: Look up a tool's trust passport and get a plain-English safety recommendation.
Input: { slug: string }
Output: {
  passport: object,
  trust_status: string,
  trust_level: number,   // 1–7
  recommendation: string,
  risk: "low" | "medium" | "high",
  permissions: object
}
```

**`search_tools`**
```
Description: Search the OpenTrust registry for tools matching a query.
Input: { query: string, trust_status?: string }
Output: [{ slug, name, trust_status, description, risk }]
```

**`list_tools`**
```
Description: List registered tools, optionally filtered by trust level.
Input: { page?: number, limit?: number, trust_status?: string }
Output: { items: [...], total: number }
```

### Claude Desktop config snippet (included in README)

```json
{
  "mcpServers": {
    "opentrust": {
      "command": "python",
      "args": ["-m", "opentrust.mcp"]
    }
  }
}
```

### Dependencies

`mcp` (Anthropic's official Python MCP SDK, installed as an optional extra):  
`pip install opentrust-sdk[mcp]`

---

## Deliverable 3 — TypeScript SDK (`sdk-ts/`)

### Package identity
- **npm name:** `@opentrust/client`  
- **Dependencies:** none (uses native `fetch`)  
- **Build:** `tsup` → ESM + CJS dual output  
- **TypeScript:** 5.x, strict mode

### Public API

```typescript
import { OpenTrust } from "@opentrust/client";

const client = new OpenTrust();
// or: new OpenTrust({ apiUrl: "https://my-registry.example.com" })

const result   = await client.verify("github-file-search");
const passport = await client.get("github-file-search");
const tools    = await client.search("sql database");
const page     = await client.list({ trustStatus: "security_checked" });
```

### Types

```typescript
interface VerifyResult {
  slug: string;
  trustStatus: string;
  trustLevel: number;
  recommendation: string;
  risk: "low" | "medium" | "high";
  passport: Passport;
  permissions: Record<string, unknown>;
}

interface ToolsPage {
  items: Passport[];
  total: number;
  page: number;
  limit: number;
}
```

Full `Passport` type is re-exported from `@opentrust/client` — same shape as `web/src/types/passport.ts`.

### File structure

```
sdk-ts/
  package.json          # name: "@opentrust/client"
  tsconfig.json
  tsup.config.ts
  src/
    index.ts            # OpenTrust class + exports
    types.ts            # VerifyResult, ToolsPage, Passport
    recommend.ts        # recommendation logic (mirrors Python)
  tests/
    sdk.test.ts         # vitest unit tests with fetch mock
```

---

## CI / Publish

- `publish.yml` already has the PyPI + npm stubs — wire them up:
  - Python: `cd sdk && python -m build` then `twine upload`
  - npm: `cd sdk-ts && npm run build && npm publish --provenance`
- Add `sdk/tests/` and `sdk-ts/tests/` to the CI test matrix

---

## What This Enables

After this ships, an Anthropic or OpenAI engineer can:

```bash
pip install opentrust-sdk
python -c "import asyncio, opentrust; print(asyncio.run(opentrust.verify('github-file-search')))"
```

Or add the MCP server to Claude Desktop and ask:  
*"Is the github-file-search tool safe to use?"* — Claude calls `verify_tool` and gets a structured answer with a recommendation.

---

## Out of Scope (this spec)

- Write operations in the SDK (`create_passport`, `claim_tool`) — add in a follow-up
- MCP resources (passport as a resource, not just a tool result)
- Authentication / API keys — left for when the API adds auth
