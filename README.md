# OpenTrust

The default trust layer for AI agent tools, MCP servers, gateways, businesses, payments, reviews, and reputation.

OpenTrust gives every callable tool one portable passport: identity, declared permissions, trust level, payment metadata, review history, and version evidence. Agents and humans can use that passport to decide whether a tool is safe enough to call, what it costs, and what controls apply before money or credentials move.

Live:

- Web registry: [opentrust.sh](https://opentrust.sh)
- API health: [api.opentrust.sh/api/v1/health](https://api.opentrust.sh/api/v1/health)
- Demo video: [docs/opentrust-demo.mp4](docs/opentrust-demo.mp4)

Important: OpenTrust has no affiliated token, memecoin, or cryptocurrency. Any token claiming to represent OpenTrust is unauthorized.

## What Is In This Repo

OpenTrust is a monorepo, not a single package:

| Path | Purpose |
|---|---|
| `api/` | FastAPI registry, marketplace, payments, OAuth, trust controls, and gateway control plane |
| `web/` | Next.js frontend for the registry, marketplace, passport pages, claims, launch lab, and gateway UI |
| `packages/opentrust-gateway/` | MCP/API gateway runtime for hosted tools, remote MCP servers, SaaS connectors, and local connectors |
| `packages/hands-body-and-feet/` | MCP server for bounded real-world agent capabilities: email, phone, wallets, payments, cards, GitHub, Docker, webhooks, RSS, IPFS, and memory |
| `passport-schema/` | Canonical JSON Schema and example passports |
| `sdk/` | Python SDK and optional MCP bridge |
| `sdk-ts/` | TypeScript client |
| `cli/` | Python/Typer CLI for inspect, validate, status, badge, and payment helpers |
| `payment-contracts/` | Abstract payment interfaces |
| `docs/` | Protocol, gateway, operations, release, and project documentation |

## Current State

The project is live and still moving quickly. The reference registry, frontend, passport schema, CLI, SDKs, Hands Body and Feet MCP server, and first Gateway MVP are implemented in this repository.

Recent verified state:

- `@infinitestudios/hands-body-and-feet` is at `2.3.0`.
- `@infinitestudios/opentrust-gateway` is a private `0.1.0` workspace package.
- The Gateway MVP includes REST tool calls, hosted Hands Body and Feet adapter support, remote MCP adapter support, policy enforcement, local connector registration, and a web gateway surface.
- Focused verification from the latest gateway work passed: API tests, gateway runtime tests/typecheck/build, and web tests/build.

For more detail, see [docs/project/status.md](docs/project/status.md), [docs/project/roadmap.md](docs/project/roadmap.md), and [docs/releases/](docs/releases/).

## Quick Start

### Local API

Requires Python 3.11+.

```bash
python -m pip install -r api/requirements.txt
python -m pip install -e cli -e payment-contracts
JWT_SECRET=dev uvicorn api.src.main:app --reload
```

Health check: `http://localhost:8000/api/v1/health`

### Local Web

Requires Node.js 20+.

```bash
cd web
npm ci
npm run dev
```

Web app: `http://localhost:3000`

### CLI

```bash
pip install opentrust-cli

opentrust inspect github/file-search-mcp
opentrust validate my-tool.json
opentrust status my-tool --format json
opentrust badge my-tool
```

### Hands Body and Feet MCP Server

```bash
npx -y @infinitestudios/hands-body-and-feet stdio
```

Claude Desktop / Cursor / any MCP client:

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

For HTTP mode, safety controls, and capability details, see [docs/hands-body-and-feet/README.md](docs/hands-body-and-feet/README.md).

### Gateway Runtime

```bash
cd packages/opentrust-gateway
npm ci
npm run dev
```

The gateway is the path for making local MCP servers, remote MCP servers, hosted OpenTrust tools, and user-credential API tools callable through one policy-enforced MCP/API surface. Start with [docs/gateway/architecture.md](docs/gateway/architecture.md).

## Documentation Map

- [docs/README.md](docs/README.md) - documentation index
- [docs/passport-spec.md](docs/passport-spec.md) - passport format
- [docs/trust-ladder.md](docs/trust-ladder.md) - trust levels and disputed state
- [docs/api-spec.md](docs/api-spec.md) - registry API
- [docs/gateway/architecture.md](docs/gateway/architecture.md) - MCP/API gateway design
- [docs/payment-contracts.md](docs/payment-contracts.md) - machine-readable payments
- [docs/security.md](docs/security.md) - security model
- [docs/governance.md](docs/governance.md) - RFC and governance process
- [docs/releases/changelog.md](docs/releases/changelog.md) - chronological changes
- [docs/releases/release-notes.md](docs/releases/release-notes.md) - user-facing release notes
- [docs/releases/upgrade-notes.md](docs/releases/upgrade-notes.md) - upgrade guidance
- [docs/releases/patch-notes.md](docs/releases/patch-notes.md) - small patches and hotfixes

## Passport Service

OpenTrust can generate a production-ready passport for an MCP server: validated JSON, declared permissions, network scope, credential handling, trust level, SVG badge, and public registry listing.

- Price: `$20 USDC` on Base
- Wallet: `0x0FDD9B72Be53D9b9b70C45B45cDADad679362342`
- Order: open a GitHub issue titled `Passport Request: [your tool name]`

Example passports live in [passport-schema/examples/](passport-schema/examples/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Schema changes go through the RFC process in [rfcs/README.md](rfcs/README.md). Most code, docs, tests, and examples can go straight to a pull request.

## License

MIT - [SoulForge](https://github.com/Costder) 2026
