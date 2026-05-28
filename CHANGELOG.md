# Changelog

All notable changes to OpenTrust are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] — 2026-05-28

### Added

- **Passport schema v1.0.0** — stable, frozen baseline; all examples updated to `spec_version: 1.0.0`
- **Base L2 on-chain payments** — `verify_usdc_transfer()` verifies USDC Transfer events via web3.py; supports HexBytes normalization and Byzantine tolerance
- **Embedded wallet custody** — `generate_wallet()` + AES-256-GCM encrypted key storage; `WALLET_ENCRYPTION_SECRET` config guard
- **Escrow order flow** — `POST /api/v1/marketplace/orders` accepts `transaction_hash`; calls `verify_usdc_transfer()` before creating order; `custody: "none"` for BYO-wallet orders
- **`/payments/verify-onchain` endpoint** — standalone on-chain USDC verification with address hex validation and decimal guard
- **`prepare_payment` MCP tool** — composite tool in `hands-and-feet`: balance check → optional Base bridge → pay; bigint USDC comparison; `enforceTrust` guard at `minTrustLevel: 4`
- **Governance transfer section** — `docs/governance.md` documents RFC process and multi-operator path

### Changed

- All package versions bumped to `1.0.0` (`sdk-ts`, `web`, `cli`, `sdk`, `payment-contracts`, `hands-and-feet`)
- `hands-and-feet` built and dist compiled; TypeScript typecheck zero errors; 333 tests passing
- `passport-schema` examples and `default-spend-policy.json` all at version `1.0.0`

### Security

- Production config validation (`ENVIRONMENT=production`) now errors on empty `WALLET_ENCRYPTION_SECRET` when embedded wallets are enabled
- On-chain verification rejects pending transactions (`status != 1`) and malformed Transfer event topics

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
