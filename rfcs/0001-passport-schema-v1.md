# RFC 0001: Passport Schema v1

- **Status:** accepted
- **Author:** Costder
- **Created:** 2026-05-14
- **PR:** initial commit

## Summary

Establishes the v1 Agent Tool Passport schema — the canonical data model for AI tool identity, permissions, trust status, and cross-platform format metadata.

## Motivation

AI agents call tools. Those tools can access files, the network, wallets, terminal sessions, and user memory. There is currently no standard way to declare what permissions a tool needs, verify the creator is who they claim, or establish earned trust over time. Every agent framework reinvents this independently, creating a fragmented ecosystem where trust signals are non-transferable between platforms.

The passport schema establishes a single document format that any framework can read, any creator can publish, and any reviewer can sign.

## Proposed Change

### Core object structure

A passport is a JSON document with these top-level sections:

- `tool_identity` — name, slug, source URL, license, maintainers
- `creator_identity` — creator, org, GitHub, domain, verification state
- `trust_status` — current position on the 8-level trust ladder
- `version_hash` — version, commit SHA, artifact hash (trust is per-release)
- `capabilities` — what the tool claims to do
- `permission_manifest` — boolean flags for each permission type
- `source_formats` — which ecosystems the tool ships in
- `format_manifests` — format-specific metadata per ecosystem
- `risk_summary` — AI-generated notes and human-reviewed findings
- `review_history` — timestamped log of status changes and reviewer attestations
- `commercial_status` — free / freemium / paid / subscription / pay_per_use / enterprise
- `agent_access` — API URL, CLI command, MCP readability flag

### Trust ladder

Eight levels in order:

1. `auto_generated_draft` — AI-generated, no human review. Not agent-usable.
2. `creator_claimed` — Ownership verified via GitHub OAuth or domain. Not agent-usable.
3. `owner_confirmed` — Creator manually confirmed metadata. Agent-usable.
4. `community_reviewed` — Community feedback received. Agent-usable.
5. `reviewer_signed` — Technical reviewer signed attestation. Agent-usable.
6. `security_checked` — Passed automated security checks. Agent-usable.
7. `continuously_monitored` — Active version/dependency monitoring. Agent-usable.
8. `disputed` — Claims challenged. Not agent-usable until resolved.

### Permission manifest

Boolean flags: `file`, `terminal`, `browser`, `network`, `memory`, `wallet`, `api`, `camera`, `microphone`, `private_data`, plus a `notes` string.

### Source formats and format manifests

`source_formats` is an array of ecosystem identifiers: `mcp`, `openai_function`, `langchain`, `openapi`, `npm_package`, `pypi_package`, `cargo_crate`, `cli`, `custom`.

`format_manifests` is an object keyed by format name containing ecosystem-specific metadata. A single passport can describe a tool that ships as both an MCP server and a PyPI package.

## Alternatives Considered

**Tool-format-specific registries** (e.g. an MCP-only registry): Rejected because it fragments the ecosystem and requires tool authors to register separately on each platform. One passport per tool is better for creators and consumers.

**Per-platform schema extensions**: Rejected in favour of a single canonical schema with optional `format_manifests`. Platforms can read only the fields relevant to them.

**Trust as a numeric score**: Rejected in favour of a named ladder. Named levels are more actionable — "community_reviewed" tells you what happened; a score of 42 does not.

## Backwards Compatibility

This is the initial version. No migration needed.

## Open Questions

- Should `format_manifests` allow arbitrary additional properties under `custom` without restriction? Currently allows `metadata: object`.
- Should `agent_usable` be a field on the passport itself (derived from trust_status) or only defined in the trust ladder spec?
- Should review signatures be arbitrary strings or a defined format (e.g. Ed25519 public key + base64 signature)?
