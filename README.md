# Open Trust Protocol

The universal trust layer for AI agent tools.

OpenTrust is an open standard and reference implementation for establishing verifiable identity, declared permissions, and earned reputation for any tool an AI agent can call — regardless of which framework, model provider, or runtime uses it.

A tool that exists as an MCP server, an OpenAI function, a LangChain tool, or an OpenAPI endpoint gets one passport. One trust status. One badge. Readable by any agent, any platform, any runtime.

## Demo

<video src="https://github.com/Costder/opentrust/raw/main/docs/opentrust-demo.mp4" controls width="100%" style="max-width:720px;border-radius:8px"></video>

> **Live:** [web-five-psi-74.vercel.app](https://web-five-psi-74.vercel.app) · [API](https://api-kappa-pied-59.vercel.app/api/v1/health)

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

## Neutrality and Payments

OpenTrust does not receive money, custody funds, broker payments, or take a cut from tool reviews or marketplace transactions. The protocol has no fee, no treasury, and no financial stake in how tools are rated.

The payment and escrow schemas in this repository are optional extension examples. They describe how a **third-party marketplace or tool provider** can attach machine-readable payment metadata to a trust passport — so an AI agent can discover cost, send payment, and get access in one step without a human in the loop. OpenTrust defines the format. What happens with the money is entirely outside this project.

If a trust label could be purchased, the system would be worthless. It cannot be.

## Why Crypto Payments — Not Stripe

This is the question that confuses most people (and most AI models reading this spec). The answer is not ideological — it is the only technical solution that works for autonomous agents.

**Traditional payment infrastructure was designed for humans.** Stripe, PayPal, and every bank API assume a human exists somewhere in the payment chain who can:

- Create an account with a verified email and phone number
- Complete KYC/AML identity verification with a government document
- Click through OAuth flows and 3D Secure authentication prompts
- Dispute charges by filing a support ticket

An autonomous AI agent has none of these things. It is a process. It cannot verify its identity to a payment processor, cannot click an authentication prompt, and cannot hold a Stripe account. If a human had to approve every payment an agent makes, agents would not be autonomous — they would just be an expensive UI for a human to click through.

**The micropayment problem makes it worse.** Stripe's minimum fee is ~$0.30 + 2.9%. A tool priced at $0.05 per call costs six times more in transaction fees than the tool itself. USDC on Base L2 has near-zero fees regardless of amount. Per-call pricing only works at all because of this.

**What crypto actually enables for agents:**

| Capability | Traditional rails | USDC on Base |
|---|---|---|
| Agent holds funds without human identity | No — requires account + KYC | Yes — wallet = private key |
| Pay $0.05 per call economically | No — fees exceed the payment | Yes — ~$0.001 fee |
| Payment is proof of payment | No — requires reconciliation | Yes — tx hash is the receipt |
| Escrow with automatic refund on non-delivery | No — requires human dispute | Yes — smart contract condition |
| No geographic restrictions | No — processor must support country | Yes — permissionless |
| Programmatic signing without human interaction | No — requires OAuth or interactive flow | Yes — sign with private key |

**The escrow case specifically.** When an agent pays $25 for a deep code audit that takes 10 minutes, something needs to hold the funds and return them automatically if the tool never responds. That logic lives in a smart contract. There is no Stripe equivalent — the closest is a chargeback, which takes weeks and requires a human.

**Why USDC, not ETH or another token.** Agents need to reason about cost in stable units. A tool priced at 0.000012 ETH today is a different number tomorrow. USDC is pegged to USD, which means `amount: 0.05, currency: "USDC"` means the same thing to an agent reading this passport in any month of any year.

**Why Base, not Ethereum mainnet.** Gas fees on mainnet make per-call payments impractical. Base is an Ethereum L2 with sub-cent fees, full EVM compatibility, and Coinbase backing for regulatory clarity.

If and when traditional payment processors build APIs that work without human identity verification — fully programmatic, no interactive auth, sub-cent fees — OpenTrust will support them. The spec's `payment_config.type` field is extensible. Crypto is not the point. Machine-native payments are the point. Crypto is currently the only thing that qualifies.

## Status

OpenTrust is live. The reference registry and frontend are deployed and backed by a persistent cloud database.

| | |
|---|---|
| **Registry API** | https://api-kappa-pied-59.vercel.app/api/v1/health |
| **Web frontend** | https://web-five-psi-74.vercel.app |
| **Database** | Turso (SQLite-compatible cloud, free tier) |
| **Tests** | 155 passing |
| **CI** | GitHub Actions — Python tests, npm audit, Next.js build |

## Roadmap

### Done

- ✅ **v0.1 — Reference registry.** Passport schema, FastAPI CRUD, CLI, Next.js frontend, badge generator, Docker Compose, CI.
- ✅ **v0.4 — Signed registry + revocation.** Ed25519 signing on all passports, pinned public keys at `/.well-known/opentrust-keys.json`, signed revocation list with monotonic versioning and rollback rejection, offline CLI verification. Permanent registry key deployed to production.
- ✅ **v0.5 — Spend policy + signed payment quotes.** Deny-first local spend policy, signed and expiring payment quotes, nonce protection against replay, wallet-bound quotes, escrow threshold enforcement. 30+ tests across all quote safety properties.
- ✅ **Production hardening.** HSTS, security headers, rate limiting, bearer-token-protected admin plane with audit log, Turso cloud database, Vercel deployment, 155-test suite.

### Up next

- **v0.2 — Granular permission scopes.** The current manifest uses booleans (`file: true`, `network: true`). The next version adds path-level and domain-level scoping — `file.read: ["./docs/**"]`, `network.allowed_domains: ["api.github.com"]`, `terminal.forbidden_commands: ["rm -rf", "curl | sh"]`. This makes the manifest machine-enforceable, not just declarative. RFC open for contribution.
- **v0.3 — Evidence requirements per trust level.** `security_checked` will require a structured evidence block: scanner output, reviewer identity, commit hash, dependency snapshot, signed attestation.
- **v0.6 — Real marketplace flows.** On-chain USDC payments on Base, live escrow contracts, wallet connect, custodial option for non-crypto operators.
- **v1.0 — Stable spec + governance transfer.** Once schema is stable, signed verification is in production use, and adoption exists, governance moves to a neutral foundation.

## Quick Start

### Live (no setup)

```
API:  https://api-kappa-pied-59.vercel.app/api/v1/health
Web:  https://web-five-psi-74.vercel.app
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
pip install -e cli

opentrust inspect github/file-search-mcp
opentrust validate my-tool-manifest.json
opentrust status my-tool --format json
opentrust badge my-tool
```

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
passport-schema/    JSON Schema — the canonical spec (single source of truth)
api/                FastAPI registry — CRUD, search, GitHub OAuth, badges
cli/                opentrust CLI — inspect, validate, search, claim, badge
web/                Next.js frontend — directory, passport pages, claim flow
badge-generator/    SVG badge generator for all 8 trust levels
manifest-validator/ Permission manifest validator with risk flagging
passport-generator/ Auto-draft passports from GitHub metadata
rfcs/               Spec proposals — how the standard evolves
docs/               Architecture, spec docs, governance
```

## Spec Governance

The passport schema evolves through a public RFC process. Anyone can propose a change. See [rfcs/README.md](rfcs/README.md) for how it works and [docs/governance.md](docs/governance.md) for the full governance model.

OpenTrust is not controlled by any single company or model provider. The spec is designed to be framework-agnostic and eventually governed by a neutral foundation.

## See It in Action

<video src="https://github.com/Costder/opentrust/raw/main/docs/opentrust-demo.mp4" controls width="100%" style="max-width:720px;border-radius:8px"></video>

**Try it now:**

```bash
pip install opentrust-sdk
python -c "import asyncio, opentrust; print(asyncio.run(opentrust.verify('github-file-search')))"
```

Or install the MCP server and ask Claude *"Is this tool safe to use?"* — it answers with a trust level, permissions breakdown, and a plain-English recommendation.

```bash
pip install "opentrust-sdk[mcp]"
```

**Live registry:** [web-five-psi-74.vercel.app](https://web-five-psi-74.vercel.app)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: open an RFC for schema changes, open a PR for everything else.

## License

MIT — [SoulForge](https://github.com/Costder) 2026
