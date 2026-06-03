#!/usr/bin/env python3
"""Seed the OpenTrust registry with 100 vetted MCP servers + agent skills.

Every entry is vendor-official or Anthropic-official/community-vetted. Vendor and
Anthropic-official entries are seeded at community_reviewed (L4) since the
registry operator is vouching for widely-used, known-good tools.

Usage:
    OPENTRUST_API_URL=https://api.opentrust.infiniterealms.io \
    OPENTRUST_ADMIN_TOKEN=<token> \
    python scripts/seed_registry_100.py

Idempotent: existing slugs (409) are treated as already-seeded and skipped.
"""
import os
import sys
import time

import httpx

API = os.environ.get("OPENTRUST_API_URL", "https://api.opentrust.infiniterealms.io").rstrip("/")
TOKEN = os.environ.get("OPENTRUST_ADMIN_TOKEN", "")

# (name, slug, category, kind, trust_status, description, source_url)
# kind: "mcp_server" | "skill"
L4 = "community_reviewed"

MCP_SERVERS = [
    ("Filesystem", "modelcontextprotocol-filesystem", "file-management", "Secure local file operations", "https://github.com/modelcontextprotocol/servers"),
    ("Git", "modelcontextprotocol-git", "version-control", "Read, search, manipulate Git repos", "https://github.com/modelcontextprotocol/servers"),
    ("Fetch", "modelcontextprotocol-fetch", "search", "Fetch and convert web content", "https://github.com/modelcontextprotocol/servers"),
    ("Memory", "modelcontextprotocol-memory", "productivity", "Knowledge-graph persistent memory", "https://github.com/modelcontextprotocol/servers"),
    ("Sequential Thinking", "modelcontextprotocol-sequential-thinking", "ai-models", "Step-by-step reflective reasoning", "https://github.com/modelcontextprotocol/servers"),
    ("Time", "modelcontextprotocol-time", "productivity", "Time and timezone conversion", "https://github.com/modelcontextprotocol/servers"),
    ("Everything", "modelcontextprotocol-everything", "developer-tools", "Reference/test MCP server", "https://github.com/modelcontextprotocol/servers"),
    ("GitHub", "github-mcp-server", "version-control", "GitHub PRs, issues, code search, workflows", "https://github.com/github/github-mcp-server"),
    ("GitLab", "gitlab-mcp-server", "version-control", "GitLab repos, MRs, issues, CI", "https://gitlab.com"),
    ("Azure DevOps", "azure-devops-mcp-server", "developer-tools", "Boards, repos, pipelines on Azure DevOps", "https://github.com/microsoft"),
    ("Sentry", "sentry-mcp-server", "monitoring", "Retrieve and analyze error issues", "https://github.com/getsentry/sentry-mcp"),
    ("CircleCI", "circleci-mcp-server", "developer-tools", "Diagnose and fix CI build failures", "https://github.com/CircleCI-Public"),
    ("Buildkite", "buildkite-mcp-server", "developer-tools", "Manage pipelines and builds", "https://github.com/buildkite"),
    ("Postman", "postman-mcp-server", "developer-tools", "Connect agents to APIs and collections", "https://github.com/postmanlabs"),
    ("Cloudflare", "cloudflare-mcp-server", "infrastructure", "Workers, KV, R2, D1 deploy/config", "https://github.com/cloudflare/mcp-server-cloudflare"),
    ("Render", "render-mcp-server", "infrastructure", "Deploy services, run DB queries, metrics", "https://github.com/render-oss"),
    ("E2B", "e2b-mcp-server", "code-execution", "Run code in secure cloud sandboxes", "https://github.com/e2b-dev"),
    ("Supabase", "supabase-mcp-server", "database", "Postgres DB, auth, edge functions", "https://github.com/supabase-community/supabase-mcp"),
    ("Neon", "neon-mcp-server", "database", "Serverless Postgres + branching", "https://github.com/neondatabase/mcp-server-neon"),
    ("MotherDuck", "motherduck-mcp-server", "data-analysis", "DuckDB / MotherDuck analytics", "https://github.com/motherduckdb"),
    ("ClickHouse", "clickhouse-mcp-server", "database", "Query ClickHouse columnar DB", "https://github.com/ClickHouse"),
    ("Prisma Postgres", "prisma-postgres-mcp-server", "database", "Manage Prisma Postgres + migrations", "https://github.com/prisma"),
    ("Neo4j", "neo4j-mcp-server", "database", "Graph DB schema + Cypher", "https://github.com/neo4j-contrib"),
    ("Qdrant", "qdrant-mcp-server", "database", "Vector search / semantic memory", "https://github.com/qdrant/mcp-server-qdrant"),
    ("Chroma", "chroma-mcp-server", "database", "Embeddings and vector search", "https://github.com/chroma-core"),
    ("SingleStore", "singlestore-mcp-server", "database", "Query the SingleStore platform", "https://github.com/singlestore-labs"),
    ("dbt", "dbt-mcp-server", "data-analysis", "Run/inspect dbt transformations", "https://github.com/dbt-labs"),
    ("Tinybird", "tinybird-mcp-server", "data-analysis", "Serverless ClickHouse pipelines", "https://github.com/tinybirdco"),
    ("Couchbase", "couchbase-mcp-server", "database", "Query Couchbase clusters", "https://github.com/couchbase-examples"),
    ("Meilisearch", "meilisearch-mcp-server", "search", "Full-text search index queries", "https://github.com/meilisearch"),
    ("Stripe", "stripe-mcp-server", "finance", "Payments, customers, invoices", "https://github.com/stripe/agent-toolkit"),
    ("PayPal", "paypal-mcp-server", "finance", "PayPal payments and orders", "https://github.com/paypal"),
    ("Square", "square-mcp-server", "finance", "Square commerce operations", "https://github.com/square"),
    ("Chargebee", "chargebee-mcp-server", "finance", "Subscription billing management", "https://github.com/chargebee"),
    ("RevenueCat", "revenuecat-mcp-server", "finance", "In-app purchases / subscriptions", "https://github.com/RevenueCat"),
    ("Notion", "notion-mcp-server", "productivity", "Read/write Notion pages and DBs", "https://github.com/makenotion/notion-mcp-server"),
    ("Slack", "slack-mcp-server", "communication", "Channel management and messaging", "https://github.com/modelcontextprotocol/servers"),
    ("Microsoft 365", "microsoft-365-mcp-server", "productivity", "Outlook, Excel, Office via Graph", "https://github.com/microsoft"),
    ("Linear", "linear-mcp-server", "productivity", "Issues, projects, cycles", "https://linear.app"),
    ("Atlassian", "atlassian-mcp-server", "productivity", "Jira + Confluence operations", "https://www.atlassian.com"),
    ("HubSpot", "hubspot-mcp-server", "productivity", "CRM contacts, deals, pipelines", "https://github.com/HubSpot"),
    ("Twilio", "twilio-mcp-server", "communication", "SMS, voice, messaging APIs", "https://github.com/twilio-labs"),
    ("Asana", "asana-mcp-server", "productivity", "Tasks, projects, workflows", "https://github.com/Asana"),
    ("Exa", "exa-mcp-server", "search", "AI-native web search", "https://github.com/exa-labs/exa-mcp-server"),
    ("Tavily", "tavily-mcp-server", "search", "Search + extraction for agents", "https://github.com/tavily-ai"),
    ("Perplexity", "perplexity-mcp-server", "search", "Sonar API web answers", "https://github.com/ppl-ai"),
    ("Kagi Search", "kagi-mcp-server", "search", "Privacy-first web search", "https://github.com/kagisearch"),
    ("Brave Search", "brave-search-mcp-server", "search", "Independent web + local search", "https://github.com/brave"),
    ("Playwright", "playwright-mcp-server", "browser-automation", "Browser automation and testing", "https://github.com/microsoft/playwright-mcp"),
    ("Grafana", "grafana-mcp-server", "monitoring", "Search dashboards, query datasources", "https://github.com/grafana/mcp-grafana"),
]

SKILLS = [
    ("PDF", "anthropic-skill-pdf", "documentation", "Read, fill, merge, split, OCR PDFs", "https://github.com/anthropics/skills"),
    ("DOCX", "anthropic-skill-docx", "documentation", "Create/edit Word documents", "https://github.com/anthropics/skills"),
    ("PPTX", "anthropic-skill-pptx", "documentation", "Build and edit PowerPoint decks", "https://github.com/anthropics/skills"),
    ("XLSX", "anthropic-skill-xlsx", "data-analysis", "Create/analyze Excel spreadsheets", "https://github.com/anthropics/skills"),
    ("Frontend Design", "anthropic-skill-frontend-design", "developer-tools", "Production-grade UI generation", "https://github.com/anthropics/skills"),
    ("MCP Builder", "anthropic-skill-mcp-builder", "developer-tools", "Scaffold high-quality MCP servers", "https://github.com/anthropics/skills"),
    ("Skill Creator", "anthropic-skill-skill-creator", "developer-tools", "Create, edit, eval new skills", "https://github.com/anthropics/skills"),
    ("Theme Factory", "anthropic-skill-theme-factory", "image-processing", "Apply visual themes to artifacts", "https://github.com/anthropics/skills"),
    ("Web Artifacts Builder", "anthropic-skill-web-artifacts-builder", "developer-tools", "Multi-component React/Tailwind artifacts", "https://github.com/anthropics/skills"),
    ("Brand Voice", "anthropic-skill-brand-voice", "communication", "Generate + enforce brand voice", "https://github.com/anthropics/skills"),
    ("Code Review", "anthropic-skill-code-review", "developer-tools", "Review diffs for security/perf/correctness", "https://github.com/anthropics/skills"),
    ("Architecture", "anthropic-skill-architecture", "developer-tools", "Create/evaluate architecture ADRs", "https://github.com/anthropics/skills"),
    ("Debug", "anthropic-skill-debug", "developer-tools", "Structured reproduce-isolate-fix debugging", "https://github.com/anthropics/skills"),
    ("System Design", "anthropic-skill-system-design", "developer-tools", "Design systems, services, APIs", "https://github.com/anthropics/skills"),
    ("Testing Strategy", "anthropic-skill-testing-strategy", "testing", "Test plans and coverage strategy", "https://github.com/anthropics/skills"),
    ("Incident Response", "anthropic-skill-incident-response", "monitoring", "Triage, communicate, postmortems", "https://github.com/anthropics/skills"),
    ("Deploy Checklist", "anthropic-skill-deploy-checklist", "developer-tools", "Pre-deploy verification checklist", "https://github.com/anthropics/skills"),
    ("Tech Debt", "anthropic-skill-tech-debt", "developer-tools", "Identify and prioritize tech debt", "https://github.com/anthropics/skills"),
    ("Account Research", "anthropic-skill-account-research", "research", "Research company/person for sales", "https://github.com/anthropics/skills"),
    ("Call Prep", "anthropic-skill-call-prep", "productivity", "Prepare for a sales call", "https://github.com/anthropics/skills"),
    ("Call Summary", "anthropic-skill-call-summary", "productivity", "Action items + follow-ups from calls", "https://github.com/anthropics/skills"),
    ("Competitive Intelligence", "anthropic-skill-competitive-intel", "research", "Build competitor battlecards", "https://github.com/anthropics/skills"),
    ("Draft Outreach", "anthropic-skill-draft-outreach", "communication", "Research + draft personalized outreach", "https://github.com/anthropics/skills"),
    ("Forecast", "anthropic-skill-forecast", "data-analysis", "Weighted sales forecast + gap analysis", "https://github.com/anthropics/skills"),
    ("Pipeline Review", "anthropic-skill-pipeline-review", "productivity", "Prioritize deals, flag risks", "https://github.com/anthropics/skills"),
    ("Daily Briefing", "anthropic-skill-daily-briefing", "productivity", "Prioritized daily sales briefing", "https://github.com/anthropics/skills"),
    ("Financial Statements", "anthropic-skill-financial-statements", "finance", "P&L, balance sheet, cash flow", "https://github.com/anthropics/skills"),
    ("Reconciliation", "anthropic-skill-reconciliation", "finance", "Reconcile GL to subledgers/bank", "https://github.com/anthropics/skills"),
    ("Journal Entry", "anthropic-skill-journal-entry", "finance", "Prepare debits/credits with support", "https://github.com/anthropics/skills"),
    ("Variance Analysis", "anthropic-skill-variance-analysis", "finance", "Budget vs actuals variance", "https://github.com/anthropics/skills"),
    ("SOX Testing", "anthropic-skill-sox-testing", "finance", "SOX 404 sampling + workpapers", "https://github.com/anthropics/skills"),
    ("Close Management", "anthropic-skill-close-management", "finance", "Month-end close sequencing", "https://github.com/anthropics/skills"),
    ("Campaign Plan", "anthropic-skill-campaign-plan", "communication", "Plan multi-channel campaigns", "https://github.com/anthropics/skills"),
    ("Content Creation", "anthropic-skill-content-creation", "communication", "Create on-brand content", "https://github.com/anthropics/skills"),
    ("SEO Audit", "anthropic-skill-seo-audit", "research", "Audit a site for SEO issues", "https://github.com/anthropics/skills"),
    ("Email Sequence", "anthropic-skill-email-sequence", "communication", "Draft multi-step email sequences", "https://github.com/anthropics/skills"),
    ("Performance Report", "anthropic-skill-performance-report", "data-analysis", "Marketing performance reporting", "https://github.com/anthropics/skills"),
    ("Write Spec", "anthropic-skill-write-spec", "documentation", "Turn an idea into a feature spec/PRD", "https://github.com/anthropics/skills"),
    ("Product Brainstorming", "anthropic-skill-product-brainstorming", "productivity", "Brainstorm + stress-test ideas", "https://github.com/anthropics/skills"),
    ("Roadmap Update", "anthropic-skill-roadmap-update", "productivity", "Build/reprioritize a roadmap", "https://github.com/anthropics/skills"),
    ("Sprint Planning", "anthropic-skill-sprint-planning", "productivity", "Scope work + estimate capacity", "https://github.com/anthropics/skills"),
    ("Metrics Review", "anthropic-skill-metrics-review", "data-analysis", "Analyze product metrics + trends", "https://github.com/anthropics/skills"),
    ("Stakeholder Update", "anthropic-skill-stakeholder-update", "communication", "Tailored stakeholder updates", "https://github.com/anthropics/skills"),
    ("Analyze Data", "anthropic-skill-analyze-data", "data-analysis", "Analyze datasets, surface insights", "https://github.com/anthropics/skills"),
    ("Build Dashboard", "anthropic-skill-build-dashboard", "data-analysis", "Build dashboards from data", "https://github.com/anthropics/skills"),
    ("SQL Queries", "anthropic-skill-sql-queries", "database", "Write and optimize SQL", "https://github.com/anthropics/skills"),
    ("Statistical Analysis", "anthropic-skill-statistical-analysis", "data-analysis", "Run statistical analysis", "https://github.com/anthropics/skills"),
    ("Design System", "anthropic-skill-design-system", "image-processing", "Define/extend a design system", "https://github.com/anthropics/skills"),
    ("Review Contract", "anthropic-skill-review-contract", "documentation", "Review contracts for risk + redlines", "https://github.com/anthropics/skills"),
    ("Interview Prep", "anthropic-skill-interview-prep", "productivity", "Prepare structured interview kits", "https://github.com/anthropics/skills"),
]


def passport(name, slug, category, kind, description, source_url):
    return {
        "tool_identity": {"name": name, "slug": slug, "category": category, "source_url": source_url},
        "creator_identity": {"creator": source_url.split("/")[3] if "github.com" in source_url else "official"},
        "trust_status": L4,
        "version_hash": {"version": "1.0.0", "commit": "seedseed"},
        "capabilities": [description],
        "permission_manifest": {"network": True},
        "commercial_status": {"model": "free"},
        "agent_access": {"allowed": True, "kind": kind},
        "description": description,
        "source_formats": ["mcp"] if kind == "mcp_server" else ["custom"],
        "is_demo": False,
    }


def main() -> int:
    if not TOKEN:
        print("ERROR: set OPENTRUST_ADMIN_TOKEN", file=sys.stderr)
        return 1

    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    items = [(*row, "mcp_server") for row in MCP_SERVERS] + [(*row, "skill") for row in SKILLS]
    created = skipped = failed = 0

    with httpx.Client(timeout=30.0) as client:
        for name, slug, category, description, source_url, kind in items:
            body = passport(name, slug, category, kind, description, source_url)
            try:
                r = client.post(f"{API}/api/v1/admin/tools", headers=headers, json=body)
            except httpx.HTTPError as e:
                print(f"  ! {slug}: network error {e}")
                failed += 1
                continue
            if r.status_code == 201:
                created += 1
                print(f"  + {slug}")
            elif r.status_code == 409:
                skipped += 1
                print(f"  = {slug} (exists)")
            else:
                failed += 1
                print(f"  ! {slug}: {r.status_code} {r.text[:120]}")
            time.sleep(0.05)

    print(f"\nDone. created={created} skipped={skipped} failed={failed} total={len(items)}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
