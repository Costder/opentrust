# OpenTrust MCP Trust Audit

> Turn your MCP server into a verified, agent-ready tool.
> Powered by the OpenTrust passport standard and the HBF runtime.

---

## The Problem

MCP servers are exploding. npm hosts 2M+ packages. PyPI has hundreds of MCP packages. But the ecosystem has zero trust infrastructure:

- **Supply chain attacks** — 187+ npm packages compromised (2025), fake Postmark MCP stole emails with a one-liner, TanStack worm via CI cache poisoning
- **STDIO command injection** — CVEs across the ecosystem; OWASP MCP Top 10 lists command injection as #5
- **Stale/unmaintained packages** — AI-generated packages flood registries as abandonware, creating dormant attack vectors
- **No package provenance** — SLSA provenance proves the builder, not the safety. Most MCP servers have neither.
- **Agent trust gap** — AI agents can't distinguish a safe MCP server from a malicious one. They call whatever's configured.

The market is demanding a trust signal. BlueRock launched an MCP Trust Registry. OWASP published an MCP Top 10. But there's no standardized, verifiable passport for MCP servers — until OpenTrust.

---

## The Offer

We audit your public MCP server (npm, PyPI, or GitHub) and produce:

1. A **machine-readable OpenTrust passport** signed by the registry (Ed25519)
2. A **human-readable trust report** with findings, severity, and remediation
3. A **verified badge** on the OpenTrust marketplace ($0 listing fee)
4. **30 days of continuous monitoring** (error rate, dep alerts, dependency drift)

Your server becomes agent-trustable: any AI agent using the OpenTrust SDK can verify your passport before calling your tools.

---

## Price Ladder

| Tier | Price | What you get | Best for |
|------|-------|-------------|----------|
| **Basic** | **$0** (self-serve) | Automated CLI scan via `opentrust inspect`, schema validation, basic findings report | Solo devs, open-source projects, quick sanity check |
| **Standard** | **$500 USDC** | Full checklist audit (see below), written trust report, OpenTrust passport + badge, marketplace listing, 30-day monitoring | Published MCP servers with users, commercial tools |
| **Sponsor** | **$0** (OSS sponsorship) | Full Standard tier, free for qualifying open-source MCP servers with 100+ GitHub stars | Community infrastructure, popular OSS MCP tools |

Payment via USDC on Base L2. No subscription required (monitoring is included for 30 days; renew at $19/mo).

---

## Audit Scope (Standard Tier)

| Category | Checks |
|----------|--------|
| **Identity** | npm/PyPI package ownership matches GitHub repo owner. GitHub org verified. Maintainer identity history checked. |
| **Source** | Repository public, CI configured, provenance attestation present (npm provenance / PyPI OIDC) |
| **Dependencies** | Dependency tree audited for known CVEs, stale deps (>1 year), pinned vs. ranges |
| **Permissions** | Declared tools/resources match documented scope. No hidden/undocumented tools. OAuth scopes minimized. |
| **STDIO Risk** | Commands executed are bounded. No raw shell execution. Input sanitized. `stdio` transport respects privilege boundaries. |
| **Code Scanning** | semgrep + CodeQL scan: command injection, SSRF, path traversal, credential leaks |
| **Secrets** | No API keys, tokens, or passwords in source, README, examples, or commit history |
| **Provenance** | SLSA level assessed. npm provenance / PyPI OIDC attestation verified. Build reproducibility checked. |
| **Trust Ladder** | Passport assigned to appropriate trust status level. Registry signature applied. |
| **Dispute Readiness** | Dispute contact documented. Revocation key published. Publisher operations defined. |

---

## Deliverables

| Item | Format | Audience |
|------|--------|----------|
| Trust report (human) | PDF/Markdown (5–10 pages) | Publisher, users, security teams |
| OpenTrust passport | Signed JSON (Ed25519) | AI agents, MCP clients |
| Verified badge | SVG (embeddable) | README, website, marketplace |
| Monitoring dashboard | URL (30-day window) | Publisher, ongoing trust signal |

---

## Why OpenTrust?

- **Offline verification** — Passports are signed (Ed25519), cached, and verifiable without network calls
- **8-level trust ladder** — From `auto_generated_draft` to `continuously_monitored`; agents respect the minimum trust level
- **Escrow-ready** — Standard audit can feed into payment escrow (funds held until delivery is verified)
- **Sub-agent trust flow** — When your MCP tool spawns sub-tools, trust and budget flow via passport inheritance
- **HBF integration** — Hands Body and Feet (the OpenTrust MCP server runtime) natively enforces trust checks and spend caps

---

## How to get started

1. Run `npx opentrust-audit check <your-package>` (free, self-serve)
2. Purchase the Standard audit: `opentrust payment create-checkout trust_report`
3. We issue a signed passport + badge within 5 business days

**Questions?** Open an issue at https://github.com/Costder/opentrust or ping us via the OpenTrust GitHub Discussions.

---

*Draft v0.1 — Approval: Joshua only. No external outreach without explicit sign-off.*
