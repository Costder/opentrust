# OpenTrust Gateway Architecture

OpenTrust Gateway lets agents use powerful tools through a single trusted MCP/API endpoint. It supports hosted hands-body-and-feet tools, OpenTrust-hosted third-party MCP servers, vendor-hosted remote MCP servers, SaaS/API tools with user credentials, and local-only tools through the OpenTrust Local Connector.

## Request Flow

1. Agent calls OpenTrust Gateway over MCP or REST.
2. Gateway validates the agent's OpenTrust passport.
3. Gateway loads the marketplace tool spec and user's policy.
4. Gateway evaluates trust level, disputed state, permissions, spend cap, and approval rules.
5. Gateway either denies, queues approval, or dispatches to an adapter.
6. Adapter calls hosted HBF, hosted MCP, remote MCP, API/OAuth provider, or local connector.
7. Gateway records audit and billing events.
8. Marketplace surfaces usage, reviews, disputes, and reputation.

## Execution Modes

| Mode | Description |
|---|---|
| `hosted_hbf` | OpenTrust-hosted hands-body-and-feet tools |
| `hosted_mcp` | OpenTrust-hosted third-party MCP server |
| `remote_mcp` | Vendor-hosted HTTP MCP endpoint |
| `api_oauth` | SaaS/API integration using user OAuth or API key |
| `local_connector` | Outbound local bridge for local-only tools |

## Risk Principle

Risky tools are visible from day one. OpenTrust controls them with approval gates, spend caps, allowlists, and audit logs instead of hiding them.
