# OpenTrust

OpenTrust is the public foundation for an open-source trust registry and payment contract layer for AI-agent tools.

Phase 0 provides Agent Tool Passports, trust status labels, schema validation, registry APIs, a CLI, badge generation, and payment interfaces. This repository contains payment contracts only. Real Circle, USDC, wallet, checkout, subscription, and escrow implementations belong in the separate private repository `opentrust-private`.

## Quick Start

```bash
cp .env.example .env
make docker-up
```

API: `http://localhost:8000/api/v1/health`

Web: `http://localhost:3000`

## Architecture

- `passport-schema/`: JSON Schema source of truth for Agent Tool Passports.
- `api/`: FastAPI registry API with stateless GitHub OAuth and payment stubs.
- `cli/`: Rich/Typer CLI for inspection, search, validation, claim, badges, and payment stub commands.
- `web/`: Next.js 14 App Router frontend.
- `payment-contracts/`: standalone installable Python package of abstract payment interfaces.
- `payment-webhook-handler/`: public webhook event contract for private payment implementations.

## Payment Boundary

This repo does not include real payment code. It exposes abstract interfaces and 501 API stubs so `opentrust-private` can provide a private implementation without mixing secrets or regulated payment flows into the public registry.
