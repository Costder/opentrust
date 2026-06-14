# OpenTrust Upgrade Notes

Upgrade notes are for developers and operators moving between package versions or deployment shapes.

## Gateway MVP

The gateway is a new workspace package, not a replacement for existing API, web, CLI, SDK, or Hands Body and Feet flows.

To work on the runtime:

```bash
cd packages/opentrust-gateway
npm ci
npm test
npm run typecheck
npm run build
```

To expose tools through OpenTrust Gateway, model each connector with:

- Tool identity and passport metadata.
- Adapter type: hosted, remote MCP, API with credentials, or local connector.
- Required trust level.
- Permission scopes.
- Spend policy.
- Approval policy.
- Audit and billing behavior.

Local-only MCP servers should stay local by default and connect through the local connector. Cloud-hosted tools should avoid storing raw user credentials unless the policy and product flow make ownership, revocation, and auditability clear.

## Hands Body and Feet 2.3.0

Set `AGENTMAIL_API_KEY` to use AgentMail-hosted inboxes. Existing Postmark, Resend, and local SMTP setups can continue using their current configuration.

The default OpenTrust domain is now `opentrust.sh`. If you run a private registry, set `OPENTRUST_REGISTRY_URL` explicitly.

## Hands Body and Feet 2.0.0

The package and binary names changed from the older Hands and Feet naming to Hands Body and Feet.

Update MCP client configs to use:

```jsonc
{
  "mcpServers": {
    "hands-body-and-feet": {
      "command": "npx",
      "args": ["-y", "@infinitestudios/hands-body-and-feet", "stdio"]
    }
  }
}
```

Docker users upgrading old deployments should check their data directory paths. The package preserves compatibility for existing local state, but compose deployments may need an explicit volume migration.
