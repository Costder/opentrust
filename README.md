# Open Trust Protocol

The universal trust layer for AI agent tools.

OpenTrust is an open standard and reference implementation for establishing verifiable identity, declared permissions, and earned reputation for any tool an AI agent can call — regardless of which framework, model provider, or runtime uses it.

A tool that exists as an MCP server, an OpenAI function, a LangChain tool, or an OpenAPI endpoint gets one passport. One trust status. One badge. Readable by any agent, any platform, any runtime.

> **Project status — read this before you rely on it.** OpenTrust is **solo-built and AI-assisted** (openly disclosed). The passport **spec, SDK, and CLI are stable at `v1.0.x`** — schema frozen (no breaking changes without a 90-day migration window), governed, and tagged `v1.0.0`–`v1.0.2`. What it is *not* yet: independently audited, or widely adopted. The design is security-minded (Ed25519-signed passports, revocation, spend caps, kill switch), but treat it as **stable-but-unaudited** — don't connect live funds or production credentials without your own review. — [@Costder](https://github.com/Costder)

## Important Clarification

OpenTrust has zero affiliated tokens, memecoins, or cryptocurrencies.

We will never launch, authorize, or endorse any token.

The only official way to support the project is through the transparent funding dashboard (USDC/fiat). Every contribution is publicly tracked and auditable on-chain.

Any token using our name, branding, or claiming connection to OpenTrust is unauthorized and fake. Do not buy them.

We are fully focused on building the actual open-source tools.

Thank you for the support &mdash; stay safe out there.

## Maintainer & Identity

OpenTrust is built and maintained by **Joshua Herron** ([@Costder](https://github.com/Costder)), a solo developer (with AI assistance — see the disclosure in the Passport Service section).

For full transparency, the packages ship under a couple of names that don't obviously read as "OpenTrust." **They're all me:**

| Where | Name you'll see | What it is |
|---|---|---|
| GitHub | [@Costder](https://github.com/Costder) (Joshua Herron) | **canonical identity** |
| npm | `@infinitestudios/*` | my own company's npm scope (I run a game studio) |
| PyPI | `Joshua Herron` | author on the `opentrust-*` packages |

**[@Costder](https://github.com/Costder) is the canonical identity** for OpenTrust — every official package and release traces back to this GitHub account. Anything that doesn't is not official (see the anti-token notice above).

## Repository Ecosystem

This repo contains **the protocol and standard** — schemas, SDKs, CLI, and the MCP bridge. The marketplace/registry and the capability server are maintained separately.

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

**Two independent version tracks — don't conflate them:**

- **OpenTrust protocol — `v1.0.x`, stable.** Passport spec frozen at `spec_version 1.0.0` (no breaking changes without a 90-day migration window). Reference registry, API, and frontend are live; all four agent verification tiers (L1–L4) are operational. Tagged `v1.0.0`–`v1.0.2`, with a written governance model and a CHANGELOG.
- **Hands and Feet — `v2.3.1`.** The capability server is well past its `v2.0.0` "Persistence Epic" bump. It versions independently of the protocol — that's why a v2 package sits alongside a v1 spec.

| | |
|---|---|
| **Registry API** | https://opentrust.sh/api/v1/health |
| **Web frontend** | https://opentrust.sh |
| **Verification tiers** | L1 (register) · L2 (wallet sig) · L3 (GitHub OAuth) · L4 (USDC fee) — operational |
| **Treasury** | `0xCB3E…700b` (Base L2) |
| **npm packages** | `@infinitestudios/opentrust-client` v1.0.2 · `@infinitestudios/opentrust-gateway` v0.1.0 |
| **PyPI packages** | `opentrust-sdk` 1.0.1 · `opentrust-cli` 1.0.1 |
| **Maturity** | Solo-built, AI-assisted, **not yet independently audited**, early adoption — see the status note at the top |

## Roadmap

### Done

- ✅ **v0.1 — Reference registry.** Passport schema, FastAPI CRUD, CLI, Next.js frontend, badge generator, Docker Compose, CI.
- ✅ **v0.4 — Signed registry + revocation.** Ed25519 signing on all passports, pinned public keys at `/.well-known/opentrust-keys.json`, signed revocation list with monotonic versioning and rollback rejection, offline CLI verification. Permanent registry key deployed to production.
- ✅ **v0.5 — Spend policy + signed payment quotes.** Deny-first local spend policy, signed and expiring payment quotes, nonce protection against replay, wallet-bound quotes, escrow threshold enforcement. 30+ tests across all quote safety properties.
- ✅ **v0.2 — Granular permission scopes.** Path-level and domain-level scoping — `file.read: ["./docs/**"]`, `network.allowed_domains: ["api.github.com"]`, `terminal.forbidden_commands: ["rm -rf", "curl | sh"]`. Machine-enforceable manifests, not just declarative. Enforced at `reviewer_signed+` in API and CLI.
- ✅ **v0.3 — Evidence requirements per trust level.** Structured `SecurityEvidenceBlock` on passports: scanner output, reviewer identity, commit hash, dependency snapshot, signed attestation. Required at `security_checked`.
- ✅ **v0.6 — Real marketplace flows.** On-chain USDC verification via web3.py on Base L2, embedded wallet custody (AES-256-GCM), escrow order flow with `verify_usdc_transfer` gating, `/payments/verify-onchain` endpoint.
- ✅ **v1.0 — Stable spec + governance transfer.** Passport schema frozen at `spec_version: 1.0.0`. All packages at 1.0.0. Governance transfer and RFC process documented in `docs/governance.md`.

### Up next

- **v1.1 — RFC process opens.** Community contributions to the schema via the 14-day RFC process. Multi-operator registry support (`registry-operators.json`). See `docs/governance.md`.
- **v1.2 — Agent identity passports.** Passports for agents themselves (not just tools), enabling the trust-flow model when an agent spawns sub-agents.
- **v1.3 — Neutral foundation.** Governance moves to a foundation once adoption warrants it.

## Quick Start

### Published packages

```bash
# Python SDK and CLI
pip install opentrust-sdk opentrust-cli

# Optional MCP bridge for the Python SDK
pip install "opentrust-sdk[mcp]"

# JavaScript/TypeScript client
npm install @infinitestudios/opentrust-client
```

### CLI

```bash
pip install opentrust-cli

opentrust inspect github/file-search-mcp
opentrust validate my-tool-manifest.json
opentrust status my-tool --format json
opentrust badge my-tool
```

### MCP Server (Smithery / Claude / Cursor)

```bash
# Via Smithery:
npx @smithery/cli install opentrust-sdk

# Or directly:
pip install "opentrust-sdk[mcp]"
opentrust-mcp
```

### Local dev

```bash
git clone https://github.com/Costder/opentrust
cd opentrust
python -m pip install -e cli
python -m pip install -e "sdk[mcp]"
cd sdk-ts && npm ci && npm run build
```

### Hands and Feet (MCP capability server)

The capability server is maintained as a separate package: `@infinitestudios/hands-body-and-feet`.

```bash
npm install -g @infinitestudios/hands-body-and-feet
npx @infinitestudios/hands-body-and-feet init
npx @infinitestudios/hands-body-and-feet serve
```

### Marketplace & Registry

The marketplace and registry are maintained separately.

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
sdk/                     opentrust-sdk — Python SDK + optional MCP bridge
sdk-ts/                  @infinitestudios/opentrust-client — TypeScript SDK
cli/                     opentrust-cli — inspect, validate, search, claim, badge
packages/
  opentrust-gateway/     @infinitestudios/opentrust-gateway — MCP/API gateway runtime
badge-generator/         SVG badge generator for all 8 trust levels
manifest-validator/      Permission manifest validator with risk flagging
passport-generator/      Auto-draft passports from GitHub metadata
rfcs/                    Spec proposals — how the standard evolves
docs/                    Architecture, spec docs, governance
demos/                   Example tool with generated passport artifacts
tests/                   Cross-cutting test vectors
```

## Spec Governance

The passport schema evolves through a public RFC process. Anyone can propose a change. See [rfcs/README.md](rfcs/README.md) for how it works and [docs/governance.md](docs/governance.md) for the full governance model.

OpenTrust is not controlled by any single company or model provider. The spec is designed to be framework-agnostic and eventually governed by a neutral foundation.

## See It in Action

**Try it now:**

```bash
pip install opentrust-sdk
python -c "import asyncio, opentrust; print(asyncio.run(opentrust.verify('github-file-search')))"`
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

MIT — [Joshua Herron](https://github.com/Costder) 2026
