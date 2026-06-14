# OpenTrust Documentation

This folder holds the long-form documentation for OpenTrust. The root README is the project front door; this index is the working map for builders, operators, reviewers, and contributors.

## Start Here

- [Project status](project/status.md) - what is live, what is experimental, and what was recently verified
- [Roadmap](project/roadmap.md) - completed milestones and near-term direction
- [System overview](SYSTEM-OVERVIEW.md) - repository-wide architecture notes
- [Architecture](architecture.md) - protocol and registry architecture
- [Security](security.md) - threat model and operational security notes

## Protocol

- [Passport spec](passport-spec.md) - canonical passport fields and semantics
- [Trust ladder](trust-ladder.md) - trust levels, disputed state, and agent policy guidance
- [Agent guide](agent-guide.md) - how agents should read and apply passport decisions
- [Sub-agents](sub-agents.md) - trust propagation for delegated agents
- [Governance](governance.md) - RFC process and future multi-operator governance

## Developer Tools

- [API spec](api-spec.md) - registry API
- [API guide](api.md) - backend usage notes
- [CLI guide](cli.md) - `opentrust` command usage
- [Payment contracts](payment-contracts.md) - payment and escrow interfaces
- [Agent key management](agent-key-management.md) - key handling guidance

## MCP And Gateway

- [Gateway architecture](gateway/architecture.md) - policy-enforced MCP/API gateway
- [Gateway connector manifest](gateway/connector-manifest.md) - connector manifest format
- [Local connector](gateway/local-connector.md) - exposing local-only tools safely
- [Hands Body and Feet](hands-body-and-feet/README.md) - OpenTrust's real-world capability MCP server
- [Hands Body and Feet recipes](hbf-recipes.md) - usage patterns

## Releases

- [Release docs index](releases/README.md)
- [Changelog](releases/changelog.md)
- [Release notes](releases/release-notes.md)
- [Upgrade notes](releases/upgrade-notes.md)
- [Patch notes](releases/patch-notes.md)

## Operations And Launch

- [Production readiness](production-readiness.md)
- [Registry privacy](registry-privacy.md)
- [Seller pricing guide](seller-pricing-guide.md)
- [Passport service page](passport-service.html)
