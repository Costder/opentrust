# OpenTrust Release Notes

Release notes are written for users deciding what changed and whether they should care. For implementation detail, see [changelog.md](changelog.md).

## Latest: Gateway MVP

The Gateway MVP turns OpenTrust from a registry and passport system into a policy-enforced tool calling layer.

Agents can call tools through a single gateway surface while OpenTrust evaluates trust level, disputed state, permissions, spend policy, approval requirements, and adapter type before dispatching the action.

This matters because many useful MCP servers and APIs were designed to run locally or with a user's own credentials. The gateway gives OpenTrust a path to support all of these shapes:

- OpenTrust-hosted tools such as hosted Hands Body and Feet capabilities.
- Vendor-hosted remote MCP servers.
- SaaS or API tools that require user-owned credentials.
- Local-only MCP servers exposed through an OpenTrust local connector.

The first gateway release is intentionally narrow. It establishes the control plane, runtime package, REST call path, adapter boundary, policy model, and web entry point. The next work should harden approvals, billing, audit logs, hosted deployment, and connector onboarding.

## Hands Body and Feet 2.3.0

Hands Body and Feet added AgentMail support for hosted inboxes that can send and receive mail. This makes email setup easier for agents that need real inboxes without running a local SMTP server.

The package also switched defaults to `opentrust.sh`, making the branded hosted registry the default starting point.

## OpenTrust 1.0.0

OpenTrust 1.0.0 established the stable passport schema baseline, governance process, marketplace/payment primitives, and package set needed for early adoption.
