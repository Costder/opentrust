"""Seed realistic demo tools into the OpenTrust live API."""
import urllib.request
import json
import sys

API = "https://api-kappa-pied-59.vercel.app/api/v1"

TOOLS = [
  {
    "tool_identity": {"slug": "github-file-search", "name": "GitHub File Search", "version": "2.1.0", "publisher": "community"},
    "description": "Search file contents and paths across any GitHub repository. Supports regex, glob patterns, and branch targeting.",
    "trust_status": "community_reviewed",
    "version_hash": {"version": "2.1.0", "commit": "a3f9c214d8e07b19c"},
    "capabilities": ["search_files", "read_repository"],
    "permission_manifest": {"network": True, "file": False, "terminal": False, "wallet": False, "private_data": False},
    "commercial_status": {"status": "free"},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "web-scraper-mcp", "name": "Web Scraper MCP", "version": "1.4.2", "publisher": "scrapehq"},
    "description": "Extract structured data from any URL. Returns clean markdown, JSON, or plain text. Respects robots.txt.",
    "trust_status": "reviewer_signed",
    "version_hash": {"version": "1.4.2", "commit": "b7e22a0f94d1c836a"},
    "capabilities": ["scrape_url", "extract_data"],
    "permission_manifest": {"network": True, "file": False, "terminal": False, "wallet": False, "private_data": False},
    "commercial_status": {"status": "freemium", "pricing": {"amount": 0.01, "currency": "USDC"}},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "code-audit-semgrep", "name": "Code Audit (Semgrep)", "version": "3.0.1", "publisher": "openaudit"},
    "description": "Runs semgrep static analysis on your codebase. Returns findings grouped by severity with line references.",
    "trust_status": "security_checked",
    "version_hash": {"version": "3.0.1", "commit": "c19d3f8a2b047e51c"},
    "capabilities": ["static_analysis", "security_scan"],
    "permission_manifest": {"file": {"read": ["./src/**", "./lib/**"], "write": []}, "terminal": False, "network": False, "wallet": False, "private_data": False},
    "evidence": {"scanner": "semgrep", "run_at": "2026-05-01T00:00:00Z", "commit": "c19d3f8a2b047e51c", "findings": {"critical": 0, "high": 0, "medium": 2, "low": 7}},
    "commercial_status": {"status": "paid", "pricing": {"amount": 0.25, "currency": "USDC"}},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "sql-query-runner", "name": "SQL Query Runner", "version": "1.0.5", "publisher": "datatools"},
    "description": "Execute read-only SQL queries against a connected database. Returns results as JSON. Never modifies data.",
    "trust_status": "community_reviewed",
    "version_hash": {"version": "1.0.5", "commit": "d44a7c3e19f08b62d"},
    "capabilities": ["execute_sql", "read_database"],
    "permission_manifest": {"network": True, "file": False, "terminal": False, "wallet": False, "private_data": {"data_types": ["database_schema"], "purpose": "read-only query execution"}},
    "commercial_status": {"status": "free"},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "weather-lookup", "name": "Weather Lookup", "version": "1.2.0", "publisher": "meteo-ai"},
    "description": "Get current conditions and 7-day forecasts for any location. Returns data in metric or imperial units.",
    "trust_status": "creator_claimed",
    "version_hash": {"version": "1.2.0", "commit": "e55b8d4f20a19c73e"},
    "capabilities": ["weather_current", "weather_forecast"],
    "permission_manifest": {"network": True, "file": False, "terminal": False, "wallet": False, "private_data": False},
    "commercial_status": {"status": "free"},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "pdf-extractor", "name": "PDF Extractor", "version": "2.0.0", "publisher": "doctools"},
    "description": "Extract text, tables, and metadata from PDF files. Handles scanned documents via OCR.",
    "trust_status": "reviewer_signed",
    "version_hash": {"version": "2.0.0", "commit": "f66c9e5031b20d84f"},
    "capabilities": ["extract_text", "ocr", "extract_tables"],
    "permission_manifest": {"file": {"read": ["./**/*.pdf"], "write": []}, "network": False, "terminal": False, "wallet": False, "private_data": False},
    "commercial_status": {"status": "freemium", "pricing": {"amount": 0.05, "currency": "USDC"}},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "slack-poster", "name": "Slack Poster", "version": "1.1.0", "publisher": "automations-co"},
    "description": "Post messages, threads, and file attachments to any Slack channel your bot is invited to.",
    "trust_status": "auto_generated_draft",
    "version_hash": {"version": "1.1.0", "commit": "g77d0f6042c31e95g"},
    "capabilities": ["post_message", "upload_file"],
    "permission_manifest": {"network": True, "file": False, "terminal": False, "wallet": False, "private_data": False},
    "commercial_status": {"status": "free"},
    "agent_access": {"allowed": True},
  },
  {
    "tool_identity": {"slug": "cve-monitor", "name": "CVE Monitor", "version": "1.3.0", "publisher": "sec-intel"},
    "description": "Watch for new CVEs affecting your dependencies. Alerts on critical and high severity findings within 24h of NVD publication.",
    "trust_status": "security_checked",
    "version_hash": {"version": "1.3.0", "commit": "h88e1g753d42f06h"},
    "capabilities": ["monitor_cves", "dependency_scan"],
    "permission_manifest": {"network": True, "file": {"read": ["./package.json", "./requirements.txt", "./go.mod"], "write": []}, "terminal": False, "wallet": False, "private_data": False},
    "evidence": {"scanner": "nvd-sync", "run_at": "2026-05-15T00:00:00Z", "commit": "h88e1g753d42f06h", "findings": {"critical": 0, "high": 0, "medium": 0, "low": 0}},
    "commercial_status": {"status": "paid", "pricing": {"amount": 9.00, "currency": "USDC"}},
    "agent_access": {"allowed": True},
  },
]

headers = {"Content-Type": "application/json"}
created, skipped, failed = 0, 0, 0

for tool in TOOLS:
    slug = tool["tool_identity"]["slug"]
    try:
        data = json.dumps(tool).encode("utf-8")
        req = urllib.request.Request(f"{API}/tools", data=data, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.loads(r.read())
            print(f"OK {resp['slug']} ({resp['trust_status']})")
            created += 1
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        if e.code == 409 or "already exists" in body:
            print(f"SKIP {slug} (already exists)")
            skipped += 1
        else:
            print(f"FAIL {slug}: HTTP {e.code} {body[:80]}")
            failed += 1
    except Exception as e:
        print(f"FAIL {slug}: {e}")
        failed += 1

print(f"\nDone: {created} created, {skipped} skipped, {failed} failed")
