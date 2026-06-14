# Hands Body and Feet

Hands Body and Feet is OpenTrust's MCP server for bounded real-world agent capabilities. It gives agents controlled access to email, phone, wallets, USDC payments, virtual cards, GitHub, Docker, tunnels, webhooks, scheduled tasks, RSS, IPFS, physical mail APIs, and durable memory.

The package is published as `@infinitestudios/hands-body-and-feet`. The current workspace version is `2.3.0`.

## Why It Exists

Many safe tasks can be handled by a normal agent with filesystem and browser access. Hands Body and Feet focuses on the risky and valuable actions where security and convenience matter:

- Spending money
- Moving funds
- Sending messages
- Managing phone numbers and inboxes
- Creating public or durable infrastructure
- Running containers
- Creating repositories or pull requests
- Handling unattended triggers and delegated tasks

OpenTrust provides the trust and identity layer underneath. Tool calls can be gated by passport trust level, spend caps, kill switch state, and credential policy.

## Install

Stdio mode is the easiest path for local MCP clients:

```bash
npx -y @infinitestudios/hands-body-and-feet stdio
```

Claude Desktop, Cursor, or any MCP client:

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

HTTP mode is for multi-tenant or gateway scenarios:

```bash
npx @infinitestudios/hands-body-and-feet init
npx @infinitestudios/hands-body-and-feet serve
```

Default HTTP endpoint: `http://localhost:3847/mcp`

## Capability Areas

| Area | Examples | Typical trust floor |
|---|---|---|
| Notify | `notify_human` | L2 |
| Email | mailbox creation, send, read, wait for email | L2 |
| Phone | provision number, SMS send/read/release | L3 |
| Wallet | create wallet, balances, signatures | L3-L4 |
| Payments | USDC payments and status checks | L4 |
| Cards | virtual card create, fund, freeze, delete, transactions | L4 |
| Tunnels and webhooks | expose local services, receive events | L3 |
| Scheduled tasks | create/list/delete/pause recurring work | L3 |
| Docker | run, stop, remove, logs, exec | L4 |
| GitHub | repo, file, pull request, repo listing | L3 |
| IPFS and RSS | publish/pin content, create feeds | L3 |
| Physical mail | list, forward, shred, scan mail | L3 |
| Memory and identity | durable KV and stable bindings | L3 |

## Safety Controls

- Trust enforcement matrix per tool.
- Spend caps for wallet, payment, bridge, and card operations.
- Kill switch via `hands-body-and-feet pause` and `hands-body-and-feet resume`.
- EIP-712 typed-data guard for new signing domains and primary types.
- Fail-closed registry-backed secret and passport validation by default.
- Delegation lifecycle for unattended triggers and scheduled tasks.
- Narrower-wins policy when a stored delegation is revalidated against newer passport permissions.

## Gateway Role

Hands Body and Feet can run locally, self-hosted, or behind the OpenTrust Gateway. The gateway path is important for agents that need cloud-accessible capabilities without giving every caller direct access to a local machine or raw credentials.

See [../gateway/architecture.md](../gateway/architecture.md) for how hosted tools, local connectors, remote MCP servers, and user-credential APIs fit together.
