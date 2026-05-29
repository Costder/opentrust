"""Seed the OpenTrust registry with REAL, official MCP servers.

Every entry below is a real, published MCP server — verified against the npm
and PyPI registries and the official modelcontextprotocol/servers catalog.
No fabricated tools. Package names, versions, and repositories are accurate as
of seeding.

Trust levels are kept honest. These passports are seeded from public package
metadata, not from a real OpenTrust claim/review flow, so they sit at:
  - community_reviewed (L4) for the open-source reference servers
    (open code, widely used and inspected by the community)
  - seller_confirmed   (L3) for first-party company servers
    (the named company/maintainer ships and maintains the server)
Neither level requires granular permission scopes or a signed evidence block
(those kick in at reviewer_signed / security_checked / continuously_monitored),
so boolean permission manifests are accepted and nothing is fabricated.

Usage:
    JWT_SECRET=dev python -m uvicorn api.src.main:app --port 8000   # in one shell
    python scripts/seed_real_mcp_servers.py                          # in another

Set OPENTRUST_API_URL to target a non-local registry.
Re-runnable: existing slugs (HTTP 409) are skipped, not duplicated.
"""
import json
import os
import urllib.error
import urllib.request

API = os.environ.get("OPENTRUST_API_URL", "http://127.0.0.1:8000/api/v1").rstrip("/")

REF_REPO = "https://github.com/modelcontextprotocol/servers"


def _net(domains, note, schemes=("https",)):
    return {
        "allowed_domains": list(domains),
        "allowed_schemes": list(schemes),
        "outbound_only": True,
        "notes": note,
    }


# Each tool is a complete PassportCreate body. Fields match
# api/src/schemas/passport.py (PassportBase).
TOOLS = [
    # ---- modelcontextprotocol reference servers (npm, open source) ----
    {
        "tool_identity": {
            "name": "Filesystem (MCP reference server)",
            "slug": "modelcontextprotocol-filesystem",
            "source_url": f"{REF_REPO}/tree/main/src/filesystem",
            "category": "files",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2026.1.14", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Read and write files within explicitly allowed directories",
            "List and search directory contents",
            "Create, move, and edit text files",
            "Directory access is restricted to roots passed at startup",
        ],
        "permission_manifest": {
            "network": False,
            "file": True,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @modelcontextprotocol/server-filesystem", "transport": "stdio"},
        },
        "description": "Official MCP reference server for sandboxed local filesystem access. npm: @modelcontextprotocol/server-filesystem.",
    },
    {
        "tool_identity": {
            "name": "Memory (MCP reference server)",
            "slug": "modelcontextprotocol-memory",
            "source_url": f"{REF_REPO}/tree/main/src/memory",
            "category": "knowledge",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2026.1.26", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Persistent knowledge-graph memory across sessions",
            "Create, read, and relate entities and observations",
            "Stored locally; no network access",
        ],
        "permission_manifest": {
            "network": False,
            "file": True,
            "terminal": False,
            "browser": False,
            "memory": True,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @modelcontextprotocol/server-memory", "transport": "stdio"},
        },
        "description": "Official MCP reference server providing a persistent local knowledge-graph memory. npm: @modelcontextprotocol/server-memory.",
    },
    {
        "tool_identity": {
            "name": "Sequential Thinking (MCP reference server)",
            "slug": "modelcontextprotocol-sequential-thinking",
            "source_url": f"{REF_REPO}/tree/main/src/sequentialthinking",
            "category": "reasoning",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2025.12.18", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Structured step-by-step reasoning scaffold",
            "Pure computation: no file, network, or system access",
        ],
        "permission_manifest": {
            "network": False,
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @modelcontextprotocol/server-sequential-thinking", "transport": "stdio"},
        },
        "description": "Official MCP reference server for structured sequential reasoning. No external access. npm: @modelcontextprotocol/server-sequential-thinking.",
    },
    {
        "tool_identity": {
            "name": "Everything (MCP reference/test server)",
            "slug": "modelcontextprotocol-everything",
            "source_url": f"{REF_REPO}/tree/main/src/everything",
            "category": "developer-tools",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2026.1.26", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Reference server exercising every MCP feature (tools, prompts, resources)",
            "Intended for testing MCP clients; no real-world side effects",
        ],
        "permission_manifest": {
            "network": False,
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @modelcontextprotocol/server-everything", "transport": "stdio"},
        },
        "description": "Official MCP test/reference server demonstrating all protocol features. npm: @modelcontextprotocol/server-everything.",
    },
    # ---- modelcontextprotocol reference servers (PyPI / uvx) ----
    {
        "tool_identity": {
            "name": "Fetch (MCP reference server)",
            "slug": "modelcontextprotocol-fetch",
            "source_url": f"{REF_REPO}/tree/main/src/fetch",
            "category": "web",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2025.4.7", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Fetch a URL and convert HTML content to markdown for the model",
            "Outbound HTTP(S) only; fetches the URLs the agent requests",
        ],
        "permission_manifest": {
            "network": True,
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "uvx mcp-server-fetch", "transport": "stdio"},
        },
        "description": "Official MCP reference server that fetches web content and converts it to markdown. PyPI: mcp-server-fetch (uvx).",
    },
    {
        "tool_identity": {
            "name": "Git (MCP reference server)",
            "slug": "modelcontextprotocol-git",
            "source_url": f"{REF_REPO}/tree/main/src/git",
            "category": "developer-tools",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2026.1.14", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Read, search, and manipulate local Git repositories",
            "Status, diff, log, commit, branch operations on a local repo",
        ],
        "permission_manifest": {
            "network": False,
            "file": True,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "uvx mcp-server-git", "transport": "stdio"},
        },
        "description": "Official MCP reference server for reading and operating on local Git repositories. PyPI: mcp-server-git (uvx).",
    },
    {
        "tool_identity": {
            "name": "Time (MCP reference server)",
            "slug": "modelcontextprotocol-time",
            "source_url": f"{REF_REPO}/tree/main/src/time",
            "category": "utilities",
            "license": "MIT",
            "maintainers": ["modelcontextprotocol"],
        },
        "creator_identity": {
            "creator": "Anthropic / MCP maintainers",
            "organization": "modelcontextprotocol",
            "github": "modelcontextprotocol",
            "verification_state": "unverified",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "2026.1.26", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Get the current time in any IANA timezone",
            "Convert times between timezones",
            "Pure computation: no external access",
        ],
        "permission_manifest": {
            "network": False,
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "uvx mcp-server-time", "transport": "stdio"},
        },
        "description": "Official MCP reference server for timezone-aware time and conversions. PyPI: mcp-server-time (uvx).",
    },
    # ---- first-party company MCP servers ----
    {
        "tool_identity": {
            "name": "GitHub MCP Server",
            "slug": "github-mcp-server",
            "source_url": "https://github.com/github/github-mcp-server",
            "category": "developer-tools",
            "license": "MIT",
            "maintainers": ["github"],
        },
        "creator_identity": {
            "creator": "GitHub",
            "organization": "github",
            "github": "github",
            "domain": "github.com",
            "verification_state": "unverified",
        },
        "trust_status": "seller_confirmed",
        "version_hash": {"version": "", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Read and search repositories, issues, and pull requests",
            "Create and comment on issues and PRs (with a scoped token)",
            "Access GitHub Actions and code scanning data",
        ],
        "permission_manifest": {
            "network": _net(["api.github.com"], "Outbound HTTPS to the GitHub REST/GraphQL API using a user-provided token."),
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": True,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "github-mcp-server", "transport": "stdio", "notes": "Official Go binary; also offered as a hosted remote server by GitHub."},
        },
        "description": "GitHub's official MCP server for interacting with repositories, issues, PRs, and Actions. Repo: github/github-mcp-server.",
    },
    {
        "tool_identity": {
            "name": "Notion MCP Server",
            "slug": "notion-mcp-server",
            "source_url": "https://github.com/makenotion/notion-mcp-server",
            "category": "productivity",
            "license": "MIT",
            "maintainers": ["makenotion"],
        },
        "creator_identity": {
            "creator": "Notion",
            "organization": "makenotion",
            "github": "makenotion",
            "domain": "notion.so",
            "verification_state": "unverified",
        },
        "trust_status": "seller_confirmed",
        "version_hash": {"version": "2.2.1", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Search, read, create, and update Notion pages and databases",
            "Query database entries and append content blocks",
        ],
        "permission_manifest": {
            "network": _net(["api.notion.com"], "Outbound HTTPS to the Notion API using a user-provided integration token."),
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": True,
            "private_data": True,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @notionhq/notion-mcp-server", "transport": "stdio"},
        },
        "description": "Notion's official MCP server for reading and writing Notion workspaces. npm: @notionhq/notion-mcp-server.",
    },
    {
        "tool_identity": {
            "name": "Stripe MCP Server",
            "slug": "stripe-mcp-server",
            "source_url": "https://github.com/stripe/ai",
            "category": "payments",
            "license": "MIT",
            "maintainers": ["stripe"],
        },
        "creator_identity": {
            "creator": "Stripe",
            "organization": "stripe",
            "github": "stripe",
            "domain": "stripe.com",
            "verification_state": "unverified",
        },
        "trust_status": "seller_confirmed",
        "version_hash": {"version": "0.3.3", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Create and manage Stripe customers, products, prices, and payment links",
            "Create invoices and read balance/transaction data",
            "Acts on the Stripe account behind the provided API key",
        ],
        "permission_manifest": {
            "network": _net(["api.stripe.com"], "Outbound HTTPS to the Stripe API using a user-provided secret key."),
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": True,
            "private_data": True,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @stripe/mcp", "transport": "stdio"},
        },
        "description": "Stripe's official MCP server for managing payments, customers, and billing objects. npm: @stripe/mcp (stripe/ai).",
    },
    {
        "tool_identity": {
            "name": "Sentry MCP Server",
            "slug": "sentry-mcp-server",
            "source_url": "https://github.com/getsentry/sentry-mcp",
            "category": "observability",
            "license": "Apache-2.0",
            "maintainers": ["getsentry"],
        },
        "creator_identity": {
            "creator": "Sentry",
            "organization": "getsentry",
            "github": "getsentry",
            "domain": "sentry.io",
            "verification_state": "unverified",
        },
        "trust_status": "seller_confirmed",
        "version_hash": {"version": "0.35.0", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Query Sentry issues, events, and error details",
            "Inspect projects and releases",
            "Use Seer to investigate and suggest fixes for issues",
        ],
        "permission_manifest": {
            "network": _net(["sentry.io", "*.sentry.io"], "Outbound HTTPS to the Sentry API using a user-provided token."),
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": True,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @sentry/mcp-server", "transport": "stdio", "notes": "Also offered as a hosted remote server at mcp.sentry.dev."},
        },
        "description": "Sentry's official MCP server for querying errors, issues, and releases. npm: @sentry/mcp-server.",
    },
    {
        "tool_identity": {
            "name": "Playwright MCP Server",
            "slug": "playwright-mcp-server",
            "source_url": "https://github.com/microsoft/playwright-mcp",
            "category": "browser-automation",
            "license": "Apache-2.0",
            "maintainers": ["microsoft"],
        },
        "creator_identity": {
            "creator": "Microsoft",
            "organization": "microsoft",
            "github": "microsoft",
            "domain": "microsoft.com",
            "verification_state": "unverified",
        },
        "trust_status": "seller_confirmed",
        "version_hash": {"version": "0.0.75", "commit": "", "artifact_hash": ""},
        "capabilities": [
            "Drive a real browser: navigate, click, type, and read pages",
            "Uses the accessibility tree for structured, deterministic automation",
            "Can reach any site the agent navigates to",
        ],
        "permission_manifest": {
            "network": True,
            "file": False,
            "terminal": False,
            "browser": True,
            "memory": False,
            "wallet": False,
            "api": False,
            "private_data": False,
        },
        "commercial_status": {"status": "free"},
        "agent_access": {
            "mcp_readable": True,
            "mcp": {"server_command": "npx -y @playwright/mcp", "transport": "stdio"},
        },
        "description": "Microsoft's official Playwright MCP server for browser automation via the accessibility tree. npm: @playwright/mcp.",
    },
]


def main() -> int:
    headers = {"Content-Type": "application/json"}
    created = skipped = failed = 0
    for tool in TOOLS:
        slug = tool["tool_identity"]["slug"]
        try:
            data = json.dumps(tool).encode("utf-8")
            req = urllib.request.Request(f"{API}/tools", data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=15) as r:
                resp = json.loads(r.read())
                print(f"OK    {resp['slug']:42s} ({resp['trust_status']})")
                created += 1
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8")
            if e.code == 409 or "already exists" in body:
                print(f"SKIP  {slug:42s} (already exists)")
                skipped += 1
            else:
                print(f"FAIL  {slug:42s} HTTP {e.code} {body[:120]}")
                failed += 1
        except Exception as e:  # noqa: BLE001
            print(f"FAIL  {slug:42s} {e}")
            failed += 1
    print(f"\nDone: {created} created, {skipped} skipped, {failed} failed  (target: {API})")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
