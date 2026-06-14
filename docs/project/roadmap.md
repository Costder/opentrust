# OpenTrust Roadmap

This roadmap tracks the product and engineering direction. Detailed release history lives in [../releases/changelog.md](../releases/changelog.md).

## Done

- Reference passport registry, JSON schema, examples, CLI, badge generation, and validation.
- Signed registry and revocation surfaces.
- Granular permission scopes for file, network, terminal, wallet, and related tool permissions.
- Evidence requirements for higher trust levels.
- Marketplace and payment primitives, including mock payments for local development and on-chain USDC verification paths.
- Agent identity verification tiers through registry, wallet, GitHub owner claim, and USDC fee flows.
- Hands Body and Feet MCP server with real-world agent capabilities, stdio mode, HTTP mode, spend caps, kill switch, registry-backed trust checks, AgentMail support, and branded `opentrust.sh` defaults.
- Gateway MVP: policy-enforced MCP/API calls across hosted OpenTrust tools, remote MCP servers, local connectors, and user-credential API tools.

## Now

- Make onboarding simpler for developers and businesses.
- Make `opentrust.sh` the default place to discover, install, review, pay for, and safely call tools.
- Harden Gateway policy, approvals, metering, audit logs, and connector onboarding.
- Expand hosted marketplace flows so useful risky tools are available from day one while still controlled by trust level, spend limits, approvals, and revocation.

## Next

- Hosted Gateway deployment that can serve agents outside a developer's local machine.
- Better connector templates for common local MCP servers and SaaS APIs.
- Business trust controls: organization policies, approval queues, budgets, role-based access, and audit exports.
- Agent-commerce workflows: pricing, quotes, escrow, refunds, review signals, and reputation updates tied to successful work.
- More registry quality signals: signed reviews, security scans, dependency monitoring, and dispute workflows.

## Later

- Multi-operator registry support.
- Foundation or neutral governance structure when adoption warrants it.
- More payment providers if they support agent-native, programmatic, low-friction payments.
- Stronger cross-runtime compatibility for MCP, OpenAPI, OpenAI tools, LangChain, LlamaIndex, packages, and future agent tool formats.
