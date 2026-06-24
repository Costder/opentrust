# MCP Trust Audit — Outreach Drafts

> **APPROVAL STATUS:** Draft only. Do not send without Joshua's explicit sign-off.
> These are templated for the prospect type; actual recipients would be chosen per-approval.

---

## Draft 1: Indie MCP publisher (npm solo dev)

**Target persona:** Individual open-source maintainer who published an MCP server on npm.
**Model prospect:** @delorenj — `mcp-server-trello` (npm, stdio transport, ~1K+ downloads)

**Channel:** GitHub Issues (tagged `question` or `feature`) or X/Twitter DM

---

**Subject:** [open source] Trust audit for your MCP server?

Hi [name],

I saw your [mcp-server-trello / airtable-mcp-server] — nice work. The MCP ecosystem is moving fast, and as npm/pypi get crowded with AI-generated packages, users are starting to ask: "how do I know this server is safe to give my API keys?"

We're building OpenTrust — a free, open trust registry for MCP tools (think: a passport + badge that proves your server is legitimate). We're offering **free trust audits** for established open-source MCP servers:

- Automated scan of your package for CVEs, stale deps, command injection risks
- A machine-readable passport (Ed25519 signed) that agents can verify
- A verified badge for your README
- Listing in the OpenTrust marketplace ($0)

No strings, no subscription. If the audit passes, your users get a trust signal. If it finds something, you get a free security improvement list.

Interested? Happy to run it and share results — takes ~2 business days.

— Joshua / OpenTrust  
GitHub Issue if easier: [link to template issue]

---

## Draft 2: Ecosystem platform with MCP surface

**Target persona:** Project or company whose product connects to / surfaces MCP servers.
**Model prospect:** n8n — `n8n-nodes-mcp` connects arbitrary MCP servers into n8n workflows. High risk surface: n8n users connect un-vetted MCP servers that then get called in automated pipelines.

**Channel:** GitHub Discussion or email (if available)

---

**Subject:** Trust layer for the MCP servers your users connect through n8n

Hi n8n team,

I'm with OpenTrust. I noticed `n8n-nodes-mcp` — it exposes MCP server tools as n8n workflow nodes, which is powerful, but it also creates a unique trust challenge: your users are pulling in arbitrary MCP servers (npm packages with API access, filesystem access, email access) and calling them in automated workflows.

The MCP supply chain is already under attack:
- Fake Postmark MCP package stolen emails via a one-liner
- 187+ npm packages compromised in a single worm campaign
- OWASP MCP Top 10 lists command injection, tool poisoning, and SSRF as critical

**What we're proposing:** A free sponsored trust audit for `n8n-nodes-mcp` itself, plus a structured way for n8n users to verify the MCP servers they connect:

1. **n8n-node audit** — We scan the node's MCP server connections for known vulnerabilities, dependency risks, and transport security issues
2. **Trust badge** — Your README gets a "OpenTrust Verified" badge showing the audit passed
3. **Verification SDK** — Optionally, `n8n-nodes-mcp` could call the OpenTrust verify endpoint before connecting to a server, blocking any with `trust_status < seller_confirmed`
4. **Continuous monitoring** — 30 days free, then $19/mo for ongoing CVE monitoring

This is a sponsored offer — $0 for qualifying OSS projects. Happy to walk through the scan results and talk integration.

— Joshua, OpenTrust

---

## Draft 3: Commercial MCP service targeting enterprise

**Target persona:** Company providing a paid MCP server product with enterprise customers.
**Model prospect:** Browserbase — `mcp-server-browserbase` (cloud browser automation via Stagehand, commercial product). Enterprise buyers need trust signals for procurement.

**Channel:** Email (hello@ or security@)

---

**Subject:** Browserbase MCP trust verification for enterprise customers

Hi Browserbase team,

I've been following `mcp-server-browserbase` / Stagehand — cloud browser automation is exactly the kind of capability enterprise agents need, and it's also exactly the kind of tool that procurement departments will scrutinize for security before they approve.

We're OpenTrust, and we maintain the open standard for MCP tool trust (passport spec, signed verification, 8-level trust ladder). We'd like to offer a **complimentary trust audit** of Browserbase's MCP server:

**What we'd produce:**
- Full security audit (CLI scan + manual review): STDIO safety, credential handling, dependency tree, OWASP MCP Top 10 categories
- Signed OpenTrust passport at `reviewer_signed` (level 6) status — the highest trust tier available to a fully audited commercial tool
- Embeddable badge: "OpenTrust Verified · Level 6" for your docs site and README
- Marketplace listing where enterprise agents discover and purchase Browserbase access

**For Browserbase:**
- Differentiator in enterprise RFPs: "independently audited MCP trust passport"
- Agent discovery: agents looking for browser automation find your server with a verified passport
- User confidence: every agent checks trust before spending — Browserbase starts at the top tier

**For OpenTrust:** A marquee commercial MCP server showing the trust standard in action.

**Pricing:** Standard tier ($500 USDC) or sponsored ($0) depending on the scope — open to discussion.

Want to hop on a call? I can share a sample report from a recent audit.

— Joshua, OpenTrust

---

## Usage Notes

| Prospect Type | Channel | Template | Price Tier | Notes |
|--------------|---------|----------|------------|-------|
| Indie publisher | GitHub Issue / DM | Draft 1 | $0 (sponsored) | Low effort, builds registry inventory |
| Platform ecosystem | GitHub Discussion | Draft 2 | $0 (sponsored) | High leverage — one audit covers many users |
| Commercial MCP | Email / LinkedIn | Draft 3 | $500 or sponsored | Enterprise upsell, marquee customer example |

- Do NOT send as cold outreach without Joshua approving each recipient
- For Draft 1, file the offer as a GitHub Issue on the target repo so discussion is public (prospect can say yes/no transparently)
- For Draft 3, prepare a sample report PDF from a real `opentrust inspect` run before reaching out
- If the response asks "why audit my server?" — link to the OWASP MCP Top 10 and the supply chain attack roundups from SC World / Docker blog

---

*Draft v0.1 — Approval status: DRAFT ONLY. No external contact without explicit sign-off from Joshua.*
