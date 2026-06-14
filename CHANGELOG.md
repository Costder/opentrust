# Changelog

All notable changes to OpenTrust are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Long-form release documentation lives in [docs/releases/](docs/releases/).

---

## [Unreleased]

### Added

- Documentation split: concise root README, docs index, project status, roadmap, Hands Body and Feet overview, and release documentation.
- OpenTrust Gateway MVP release notes and upgrade notes under `docs/releases/`.

## [Gateway MVP] - 2026-06-13

### Added

- `@infinitestudios/opentrust-gateway` runtime package for policy-enforced MCP/API tool calls.
- Gateway control-plane routes for connector registration and policy.
- REST tool-call path, hosted Hands Body and Feet adapter, remote MCP adapter, and local connector registration model.
- Gateway web surface and docs under `docs/gateway/`.

### Verified

- API tests passed.
- Gateway runtime tests, typecheck, and build passed.
- Web tests and build passed.

---

## [1.0.0] - 2026-05-28

### Added

- **Passport schema v1.0.0** - stable, frozen baseline; all examples updated to `spec_version: 1.0.0`.
- **Base L2 on-chain payments** - `verify_usdc_transfer()` verifies USDC Transfer events via web3.py and supports HexBytes normalization.
- **Embedded wallet custody** - `generate_wallet()` plus AES-256-GCM encrypted key storage; `WALLET_ENCRYPTION_SECRET` config guard.
- **Escrow order flow** - `POST /api/v1/marketplace/orders` accepts `transaction_hash`, calls `verify_usdc_transfer()`, and supports `custody: "none"` for BYO-wallet orders.
- **`/payments/verify-onchain` endpoint** - standalone on-chain USDC verification with address hex validation and decimal guard.
- **`prepare_payment` MCP tool** - composite helper for balance check, optional Base bridge, and USDC payment.
- **Governance transfer section** - `docs/governance.md` documents RFC process and multi-operator path.

### Changed

- Core package versions aligned to the 1.0.0 baseline.
- Passport examples and `default-spend-policy.json` updated for `spec_version: 1.0.0`.

### Security

- Production config validation errors on empty `WALLET_ENCRYPTION_SECRET` when embedded wallets are enabled.
- On-chain verification rejects pending transactions and malformed Transfer event topics.

### Versions

| Component | Version |
|---|---|
| Passport schema | 1.0.0 |
| API (FastAPI) | 1.0.0 |
| hands-and-feet (TS) | 1.0.0 |
| sdk-ts | 1.0.0 |
| sdk (Python) | 1.0.0 |
| cli | 1.0.0 |
| payment-contracts | 1.0.0 |
| web | 1.0.0 |
