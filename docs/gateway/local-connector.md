# OpenTrust Local Connector

The OpenTrust Local Connector is an outbound-only bridge for MCP servers and tools that must run on a user's machine.

## Why It Exists

Some tools need local files, localhost apps, a desktop browser, private network access, or local stdio MCP servers. The cloud gateway must not pretend it can safely access those resources directly. The connector keeps those resources local while still giving OpenTrust policy, approvals, audit logs, and marketplace management.

## Security Rules

- The connector opens outbound connections only.
- No inbound port is required.
- Every requested tool call includes an OpenTrust decision id.
- The connector verifies the decision before execution.
- The connector may refuse any call locally even when the cloud allowed it.
- File, browser, terminal, and private-network access must be scoped by policy.
- The user can pause or revoke the connector from the OpenTrust dashboard.

## Initial Contract

`POST /api/v1/gateway/local-connectors/register`

Request:

```json
{
  "machine_name": "joshua-laptop",
  "connector_version": "0.1.0",
  "supported_modes": ["stdio_mcp", "filesystem", "browser"]
}
```

Response:

```json
{
  "connector_id": "lc_0123456789abcdef",
  "status": "registered"
}
```
