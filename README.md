# Open Trust Protocol

The universal trust layer for AI agent tools.

OpenTrust is an open standard and reference implementation for establishing verifiable identity, declared permissions, and earned reputation for any tool an AI agent can call — regardless of which framework, model provider, or runtime uses it.

A tool that exists as an MCP server, an OpenAI function, a LangChain tool, or an OpenAPI endpoint gets one passport. One trust status. One badge. Readable by any agent, any platform, any runtime.

## Get a Passport for Your MCP Server

**$20 USDC** delivered within 24 hours. Includes: full passport JSON + SVG trust badge + public registry listing.

- **Wallet (Base):** `0x0FDD9B72Be53D9b9b70C45B45cDADad679362342`
- **To order:** Open a GitHub issue titled "Passport Request: [your tool name]" with your tool's URL.

[See example passports](passport-schema/examples/) &mdash; Stripe, GitHub, Discord, and more.

---



## Important Clarification

OpenTrust has zero affiliated tokens, memecoins, or cryptocurrencies.

We will never launch, authorize, or endorse any token.

The only official way to support the project is through the transparent funding dashboard (USDC/fiat). Every contribution is publicly tracked and auditable on-chain.

Any token using our name, branding, or claiming connection to OpenTrust is unauthorized and fake. Do not buy them.

We are fully focused on building the actual open-source tools.

Thank you for the support &mdash; stay safe out there.

## Demo


https://github.com/user-attachments/assets/31afd91c-9bbc-4bd8-95fd-0ca88bd02361

> **Live:** [opentrust.sh](https://opentrust.sh) · [API](https://opentrust.sh/api/v1/health)

---

## Hands and Feet — Agent Real-World Capabilities

[`packages/hands-body-and-feet`](packages/hands-body-and-feet/) is a local MCP server that gives AI agents real-world hands. Any MCP-compatible agent (Claude, Codex, Hermes, hyperagent, etc.) connects via Bearer token and gains the ability to send and receive email, provision phone numbers, manage crypto wallets, make USDC payments, issue virtual Visa cards, browse the web, manage infrastructure, and more — with no human-in-the-loop required after initial setup.

**OpenTrust is the trust and identity layer underneath.** Every tool call is gated by the agent's OpenTrust passport trust level (L1–L7). Spend caps, a kill switch, and fail-closed secret loading are enforced throughout.

**Easiest — stdio (one line, any harness, zero config):**

Add it like any other MCP server. Claude Code:

```bash
claude mcp add hands-body-and-feet -- npx -y @infinitestudios/hands-body-and-feet stdio
```

Claude Desktop / Cursor / any MCP client (`claude_desktop_config.json` etc.):

```jsonc
{ "mcpServers": { "hands-body-and-feet": {
  "command": "npx", "args": ["-y", "@infinitestudios/hands-body-and-feet", "stdio"]
}}}
```

No `init`, no daemon, no token header. Identity defaults to a local L3 agent;
set `OPENTRUST_PASSPORT_TOKEN` (real passport) or `OPENTRUST_AGENT_ID` /
`OPENTRUST_TRUST_STATUS` to customize. Trust levels, spend caps, and the kill
switch are still enforced per tool call.

**Advanced — HTTP (multi-tenant, per-request passport auth):**

```bash
npx @infinitestudios/hands-body-and-feet init    # interactive config
npx @infinitestudios/hands-body-and-feet serve   # http://localhost:3847/mcp
# Then POST /mcp with: Authorization: Bearer <agent passport token>
```

### V1 — Foundation & Core Capabilities

| Capability | Tools | Min trust |
|---|---|---|
| **Notify** | `notify_human` — push notification via ntfy.sh | L2 |
| **Wallet** | `create_wallet`, `get_address`, `get_balance`, `send_usdc`, `sign_message`, `sign_typed_data` | L3–L4 |
| **Bridge** | `bridge_to_polygon`, `bridge_to_base`, `get_bridge_status` (Across Protocol) | L4 |
| **Payments** | `pay_with_usdc`, `get_payment_status` — USDC on Base, thin wrapper over OpenTrust's payment schema | L4 |
| **Cards** | `create_virtual_card`, `get_card_details`, `add_funds_to_card`, `top_up_moon_credit`, `freeze_card`, `delete_card`, `get_card_transactions` — Pay with Moon virtual Visa | L4 |
| **Phone** | `provision_phone_number`, `send_sms`, `read_sms`, `release_phone_number` — Twilio or SignalWire | L3 |
| **Email** | `create_mailbox`, `send_email`, `read_inbox`, `wait_for_email`, `delete_mailbox` — local SMTP or Postmark/Resend | L2 |

### V2 — Reach & Autonomy

| Capability | Tools | Min trust |
|---|---|---|
| **Tunnel** | `create_tunnel`, `get_tunnel_url`, `close_tunnel` — cloudflared or ngrok | L3 |
| **Webhook** | `create_webhook`, `get_webhook_url`, `read_webhook_events`, `wait_for_webhook`, `delete_webhook` | L3 |
| **Scheduled Tasks** | `create_task`, `list_tasks`, `delete_task`, `pause_task` — node-cron with passport credential lifecycle | L3 |
| **Docker** | `run_container`, `stop_container`, `remove_container`, `list_containers`, `container_logs`, `exec_in_container` | L4 |
| **Phone (JMP)** | `provision_phone_number_jmp`, `send_sms_jmp`, `read_sms_jmp`, `release_phone_number_jmp` — no-KYC XMPP/JMP | L3 |

### V3 — Full Power

| Capability | Tools | Min trust |
|---|---|---|
| **GitHub** | `create_repo`, `create_file`, `create_pull_request`, `list_repos` — `@octokit/rest` | L3 |
| **IPFS** | `publish_content`, `get_ipfs_content`, `pin_content` — kubo-rpc-client + web3.storage fallback | L3 |
| **RSS Feed** | `create_feed`, `add_feed_item`, `serve_feed` — served at `/feeds/:label` | L3 |
| **PostScan Mail** | `list_mail`, `forward_mail`, `shred_mail`, `scan_mail` — physical mailbox API, requires USPS Form 1583 | L3 |

### Safety features

- **Trust enforcement matrix** — every tool enforces a minimum passport trust level before executing. L4 tools (wallets, cards, Docker) require elevated trust.
- **Spend caps** — per-wallet `max_per_call`, `daily_cap`, and `gas_reserve_amount`. Transactions rejected pre-broadcast; never silently downgraded.
- **Kill switch** — `hands-body-and-feet pause / resume`, passphrase-protected, CLI only. Propagates across all instances via registry flag.
- **EIP-712 guard** — first use of any new `(domain, primaryType)` pair is rejected with `notify_human` fired. Human adds to allowlist via `hands-body-and-feet allowlist-add-typed-data`.
- **Fail-closed secrets** — if the OpenTrust registry is unreachable, the server refuses to start. `--allow-local-fallback` opts in with a prominent warning.
- **Scheduled task credential lifecycle** — task stores passport ID + version + permission snapshot at schedule time. On fire: narrower-of-(old, new) scope wins; widened permissions require task re-creation. Never silently elevated.
- **`unwind-impossible` flagging** — `send_usdc`, `bridge_to_polygon`, `top_up_moon_credit` flag mid-op if pause fires after broadcast.

```bash
hands-body-and-feet status   # kill switch state, wallets, spend policy, active bridges, outsourced deps
hands-body-and-feet pause    # passphrase required — halts all tool calls (503 PAUSED)
hands-body-and-feet resume   # re-validates all passports against revocation list before resuming
```

---

## Why This Exists

AI agents call tools. Those tools can read files, hit the network, access wallets, and execute terminal commands. Today there is no standardized way to know what permissions a tool claims to need, whether the creator is who they say, or whether anyone has reviewed it. OpenTrust is the trust infrastructure that should exist before agents are widely deployed with tool access.

## What a Passport Is

An Agent Tool Passport is a structured, versioned document tied to a specific tool release that declares:

- **Identity** — name, source, creator, license, maintainers
- **Permissions** — what the tool claims to need (file, network, terminal, wallet, memory, etc.)
- **Trust status** — where on the 8-level ladder this tool currently sits
- **Source formats** — which ecosystems the tool is available in (MCP, OpenAI functions, LangChain, OpenAPI, etc.)
- **Version hash** — trust is tied to a specific commit/release, not forever
- **Review history** — who reviewed it, when, and what they found

## Trust Ladder

| Level | Status | Meaning |
|---|---|---|
| 1 | `auto_generated_draft` | AI-generated, no human review |
| 2 | `creator_claimed` | Creator has claimed ownership |
| 3 | `seller_confirmed` | Seller confirmed metadata accuracy |
| 4 | `community_reviewed` | Community feedback received |
| 5 | `reviewer_signed` | Technical reviewer signed attestation |
| 6 | `security_checked` | Passed defined security checks |
| 7 | `continuously_monitored` | Version/dependency tracking active |

`disputed` is not a level — it is an overlay state that can apply to any trust level. A tool can be `security_checked` and `disputed` simultaneously. It means claims on the current passport have been formally challenged and are under review. Agents should treat a disputed tool as untrustworthy regardless of its base level until the dispute is resolved.

## Agent Identity Verification

Agents (and humans) register on OpenTrust to earn trust and qualify for escrow-protected work. Four verification tiers are live in production:

| Tier | Mechanism | What it proves | Escrow |
|---|---|---|---|
| **L1** | Register unverified | You exist on the registry. Free. | ❌ |
| **L2** | Wallet signature (MetaMask) | You control a crypto wallet. Cryptographic proof, no OAuth. | ❌ |
| **L3** | GitHub OAuth owner-claim | A human stakes their GitHub identity on this agent. Handle shown publicly. | ✅ |
| **L4** | $10 USDC verification fee | Skin in the game. On-chain payment verified against treasury (`0xCB3E…700b`). Highest starting trust. | ✅ |

Tiers are cumulative — L4 includes everything L1–L3 proved. Higher trust unlocks escrow-protected jobs where funds are held in a smart contract until the work is verified complete. No human-in-the-loop required after initial setup.

## Neutrality and Payments

OpenTrust does not receive money, custody funds, broker payments, or take a cut from tool reviews or marketplace transactions. The protocol has no fee, no treasury, and no financial stake in how tools are rated.

The payment and escrow schemas in this repository are optional extension examples. They describe how a **third-party marketplace or tool provider** can attach machine-readable payment metadata to a trust passport — so an AI agent can discover cost, send payment, and get access in one step without a human in the loop. OpenTrust defines the format. What happens with the money is entirely outside this project.

If a trust label could be purchased, the system would be worthless. It cannot be.

## Payment Rails — Crypto *and* Stripe

**OpenTrust is rail-agnostic.** A tool's `payment_config.type` can be `crypto_direct`, `coinbase_commerce`, `payment_gateway`, or **`stripe`** — and OpenTrust's role is identical no matter which: it is the **authorization layer**, not a payment processor. When an agent goes to pay, OpenTrust decides whether it is *allowed* to, based on the tool's trust level and the agent's spend caps. **The rail moves the money; OpenTrust says yes or no.**

### Stripe is first-class

We're big fans of what Stripe is building for agent commerce. Stripe is supported in the spec today — a tool can price in USD and declare `payment_config.type: "stripe"`, and an agent can pay through a Stripe Payment Link / Checkout Session or the Stripe Skills its runtime exposes, with OpenTrust gating every charge by trust level and spend cap. See [`examples/stripe-paid-tool-passport.json`](passport-schema/examples/stripe-paid-tool-passport.json). Deeper, direct Stripe integration is on the near-term roadmap — and we'd love to build it with the Stripe team.

### Why crypto, too

Crypto was the *first* rail that worked for fully autonomous agents, and it is still the best fit for some jobs, so OpenTrust supports it natively alongside Stripe:

- **Micropayments** — per-call pricing with ~$0.001 fees on Base L2, where flat processing fees would otherwise dwarf a $0.05 call.
- **Proof-of-payment** — a transaction hash *is* the receipt; no reconciliation step.
- **Programmatic escrow** — funds can rest in a smart contract and auto-refund on non-delivery, with no human dispute process.
- **Permissionless and stable** — USDC is dollar-stable and works without geographic gating.

### Pick the rail that fits

Crypto shines for high-frequency micropayments and trustless escrow; Stripe shines for familiar card/SaaS billing and for enterprises that already run on Stripe. OpenTrust doesn't force the choice — `payment_config.type` is extensible and the trust + spend-cap enforcement is identical across rails. Machine-native payments are the point; the rail is an implementation detail.

## Status

OpenTrust is live. The reference registry, frontend, and all four agent verification tiers (L1–L4) are operational. GitHub OAuth owner-claim (L3) and on-chain USDC fee verification (L4) are newly live as of June 2026.

| | |
|---|---|
| **Registry API** | https://opentrust.sh/api/v1/health |
| **Web frontend** | https://opentrust.sh |
| **Verification tiers** | L1 (register) · L2 (wallet sig) · L3 (GitHub OAuth) · L4 (USDC fee) — all operational |
| **Treasury** | `0xCB3E…700b` (Base L2) |
| **Database** | Turso (SQLite-compatible cloud, free tier) |
| **Tests** | 694 passing (210 core + 377 hands-body-and-feet + 107 Python package tests) |
| **CI** | GitHub Actions — Python tests, npm audit, Next.js build |
| **npm packages** | `@infinitestudios/hands-body-and-feet` v2.2.0 · `@infinitestudios/opentrust-client` v1.0.0 |
| **PyPI packages** | `opentrust-sdk` v1.0.0 · `opentrust-cli` v1.0.0 · `opentrust-payment-contracts` v1.0.0 |
| **Hands Body and Feet** | `@infinitestudios/hands-body-and-feet` v2.2.0 — V1/V2/V3 + persistence epic, stdio + HTTP transports, registry-backed trust, ~60 MCP tools |

## Roadmap

### Done

- ✅ **v0.1 — Reference registry.** Passport schema, FastAPI CRUD, CLI, Next.js frontend, badge generator, Docker Compose, CI.
- ✅ **v0.4 — Signed registry + revocation.** Ed25519 signing on all passports, pinned public keys at `/.well-known/opentrust-keys.json`, signed revocation list with monotonic versioning and rollback rejection, offline CLI verification. Permanent registry key deployed to production.
- ✅ **v0.5 — Spend policy + signed payment quotes.** Deny-first local spend policy, signed and expiring payment quotes, nonce protection against replay, wallet-bound quotes, escrow threshold enforcement. 30+ tests across all quote safety properties.
- ✅ **Production hardening.** HSTS, security headers, rate limiting, bearer-token-protected admin plane with audit log, Turso cloud database, Vercel deployment, 155-test suite.
- ✅ **v0.2 — Granular permission scopes.** Path-level and domain-level scoping — `file.read: ["./docs/**"]`, `network.allowed_domains: ["api.github.com"]`, `terminal.forbidden_commands: ["rm -rf", "curl | sh"]`. Machine-enforceable manifests, not just declarative. Enforced at `reviewer_signed+` in API and CLI.
- ✅ **v0.3 — Evidence requirements per trust level.** Structured `SecurityEvidenceBlock` on passports: scanner output, reviewer identity, commit hash, dependency snapshot, signed attestation. Required at `security_checked`.
- ✅ **v0.6 — Real marketplace flows.** On-chain USDC verification via web3.py on Base L2, embedded wallet custody (AES-256-GCM), escrow order flow with `verify_usdc_transfer` gating, `/payments/verify-onchain` endpoint.
- ✅ **Hands Body and Feet v1.0.** Full V1–V3 MCP capability layer shipped as `@infinitestudios/hands-body-and-feet`. ~50 tools: notify, wallet (Base + Polygon), USDC payments, Across Protocol bridge, Moon virtual cards, phone (Twilio/SignalWire/JMP), email (local SMTP + Postmark/Resend), tunnel, webhooks, scheduled tasks, Docker, GitHub, IPFS, RSS, PostScan Mail. Trust enforcement matrix, spend caps, kill switch, EIP-712 guard, fail-closed secrets, scheduled task credential lifecycle. 333 tests.
- ✅ **Hands Body and Feet v2.2.0 package release.** Published to npm as `@infinitestudios/hands-body-and-feet`; TypeScript client published as `@infinitestudios/opentrust-client`; Python packages published to PyPI as `opentrust-sdk`, `opentrust-cli`, and `opentrust-payment-contracts`.
- ✅ **Hands Body and Feet v1.x — `prepare_payment` composite helper.** Detects chain balances, bridges Polygon→Base if needed, polls bridge status, then executes `pay_with_usdc` — internalizes the multi-step bridge-then-pay workflow into one tool call. Bridge fees surface in the receipt.
- ✅ **v1.0 — Stable spec + governance transfer.** Passport schema frozen at `spec_version: 1.0.0`. All packages at 1.0.0. Governance transfer and RFC process documented in `docs/governance.md`.

### Up next

- **v1.1 — RFC process opens.** Community contributions to the schema via the 14-day RFC process. Multi-operator registry support (`registry-operators.json`). See `docs/governance.md`.
- **v1.2 — Agent identity passports.** Passports for agents themselves (not just tools), enabling the trust-flow model when an agent spawns sub-agents.
- **v1.3 — Neutral foundation.** Governance moves to a foundation once adoption warrants it.

## Quick Start

### Live (no setup)

```
API:  https://opentrust.sh/api/v1/health
Web:  https://opentrust.sh
```

### Published packages

```bash
# Python SDK, CLI, and payment contract interfaces
pip install opentrust-sdk opentrust-cli opentrust-payment-contracts

# Optional MCP bridge for the Python SDK
pip install "opentrust-sdk[mcp]"

# JavaScript/TypeScript client
npm install @infinitestudios/opentrust-client

# Hands Body and Feet MCP server
npm install -g @infinitestudios/hands-body-and-feet
```

### Local dev

```bash
# Clone and install
git clone https://github.com/Costder/opentrust
cd opentrust
python -m pip install -r api/requirements.txt
python -m pip install -e cli -e payment-contracts

# Run the API (from repo root)
JWT_SECRET=dev uvicorn api.src.main:app --reload

# Run the frontend (separate terminal)
cd web && npm ci && npm run dev
```

API: `http://localhost:8000/api/v1/health`  
Web: `http://localhost:3000`

### Docker

```bash
cp .env.example .env
make docker-up
```

### CLI

```bash
pip install opentrust-cli

opentrust inspect github/file-search-mcp
opentrust validate my-tool-manifest.json
opentrust status my-tool --format json
opentrust badge my-tool
```

### Hands and Feet (MCP capability server)

```bash
# Install and run interactive setup
npx @infinitestudios/hands-body-and-feet init

# Start the MCP server (localhost:3847 by default)
npx @infinitestudios/hands-body-and-feet serve

# Or with Docker Compose
cd packages/hands-body-and-feet
docker-compose up
```

Configure your MCP-compatible agent to connect:
```
POST http://localhost:3847/mcp
Authorization: Bearer <OpenTrust-signed agent passport token>
```

See [`packages/hands-body-and-feet/`](packages/hands-body-and-feet/) for the full setup guide, capability docs, and CLI reference.

## Demo Payments

OpenTrust is 100% open source. The reference API includes a mock payment provider for demos:

- `POST /api/v1/payments/checkout` creates a paid demo checkout.
- `POST /api/v1/payments/verify` verifies a checkout by id.
- `POST /api/v1/payments/coinbase/checkouts` exposes the Coinbase-shaped checkout path for local demos.

Set `PAYMENT_PROVIDER=mock` for no-secret demo payments. Production operators can replace the provider while keeping the public payment contract schema.

## Example Passports

See [`passport-schema/examples/`](passport-schema/examples/) for complete, working passport examples:

- [`free-tool.json`](passport-schema/examples/free-tool.json) — freemium MCP search tool at `community_reviewed`
- [`paid-tool-with-escrow.json`](passport-schema/examples/paid-tool-with-escrow.json) — paid code-execution tool with escrow, reviewer attestation, and full agent identity requirements

## Ecosystem Support

OpenTrust passports understand every major AI tool format. A single passport can describe a tool across all the frameworks it ships in:

- **MCP** (Model Context Protocol) — Claude, Cursor, Cline, and any MCP-compatible runtime
- **OpenAI functions/tools** — GPT-4, any OpenAI-compatible model
- **LangChain / LlamaIndex** — Python agent frameworks
- **OpenAPI** — Any HTTP-accessible tool
- **Packages** — npm, PyPI, Cargo crates

## Repository Structure

```
passport-schema/         JSON Schema — the canonical spec (single source of truth)
api/                     FastAPI registry — CRUD, search, GitHub OAuth, badges
web/                     Next.js frontend — directory, passport pages, claim flow
packages/
  hands-body-and-feet/   @infinitestudios/hands-body-and-feet — MCP server giving agents
                         real-world capabilities (email, phone, wallet, cards,
                         tunnel, docker, GitHub, IPFS, and more)
sdk-ts/                  @infinitestudios/opentrust-client — TypeScript SDK
sdk/                     opentrust-sdk — Python SDK + optional MCP bridge
cli/                     opentrust-cli — inspect, validate, search, claim, badge
payment-contracts/       opentrust-payment-contracts — payment interfaces
badge-generator/         SVG badge generator for all 8 trust levels
manifest-validator/      Permission manifest validator with risk flagging
passport-generator/      Auto-draft passports from GitHub metadata
rfcs/                    Spec proposals — how the standard evolves
docs/                    Architecture, spec docs, governance
```

## Spec Governance

The passport schema evolves through a public RFC process. Anyone can propose a change. See [rfcs/README.md](rfcs/README.md) for how it works and [docs/governance.md](docs/governance.md) for the full governance model.

OpenTrust is not controlled by any single company or model provider. The spec is designed to be framework-agnostic and eventually governed by a neutral foundation.

## See It in Action

[![Watch the OpenTrust demo](https://github.com/Costder/opentrust/raw/main/docs/opentrust-demo-thumb.jpg)](https://github.com/Costder/opentrust/raw/main/docs/opentrust-demo.mp4)

**Try it now:**

```bash
pip install opentrust-sdk
python -c "import asyncio, opentrust; print(asyncio.run(opentrust.verify('github-file-search')))"
```

Or install the MCP server and ask Claude *"Is this tool safe to use?"* — it answers with a trust level, permissions breakdown, and a plain-English recommendation.

```bash
pip install "opentrust-sdk[mcp]"
```

**Live registry:** [opentrust.sh](https://opentrust.sh)

---

## Passport Service — $20 / tool

We generate a production-ready OpenTrust passport for your MCP server: a signed JSON document declaring permissions, network scope, credential handling, and trust level — plus an SVG badge for your README.

**Delivered within 24 hours via a PR or Gist link.**

| What you get | Details |
|---|---|
| `your-tool-passport.json` | Validated against OpenTrust schema, signed |
| SVG trust badge | Embeddable in your README |
| Registry listing | Listed at opentrust.sh |

**Price:** $20 USDC on Base
**Payment address:** `0x0FDD9B72Be53D9b9b70C45B45cDADad679362342`
**To order:** [Open an issue](https://github.com/Costder/opentrust/issues/new?title=Passport+request) with your tool's GitHub/npm URL. Pay after delivery if you're happy.

> **Example:** [`discord-mcp-passport.json`](passport-schema/examples/discord-mcp-passport.json) — auto-generated for [SaseQ/discord-mcp](https://github.com/SaseQ/discord-mcp).

*Disclosed: built and operated with AI assistance (Claude + OpenTrust Scout).*

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: open an RFC for schema changes, open a PR for everything else.

## License

MIT — [SoulForge](https://github.com/Costder) 2026
