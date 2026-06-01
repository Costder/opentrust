# @infinitestudios/hands-body-and-feet

Hands Body and Feet is an MCP server that gives AI agents bounded real-world capabilities: email, phone, wallets, USDC payments, virtual cards, GitHub, Docker, webhooks, RSS, IPFS, and durable state.

It is part of OpenTrust: a trust layer for agent tools, passports, and delegated action.

## Install

```bash
npm install -g @infinitestudios/hands-body-and-feet
```

## Use over stdio

```bash
hands-body-and-feet stdio
```

## Initialize local state

```bash
hands-body-and-feet init
```

## Run the HTTP MCP server

```bash
hands-body-and-feet serve
```

Default port: `3847`.

## Safety model

Hands Body and Feet is designed for explicit, bounded delegation. Configure credentials and spend/action limits before exposing tools to autonomous agents. External actions such as payments, email, SMS, public posting, or card operations should be approval-gated unless your policy explicitly allows them.

## Repository

https://github.com/Costder/opentrust/tree/main/packages/hands-body-and-feet

## License

MIT
