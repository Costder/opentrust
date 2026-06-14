# OpenTrust Changelog

This file is the detailed changelog for the OpenTrust monorepo. The root [../../CHANGELOG.md](../../CHANGELOG.md) remains the package-tooling entry point and should be kept in sync for tagged releases.

## Unreleased

### Added

- Documentation split: concise root README, docs index, project status, roadmap, Hands Body and Feet overview, and release documentation.
- OpenTrust Gateway MVP documentation and runtime references.

## 2026-06-13 - Gateway MVP

### Added

- Gateway control-plane routes for connector registration and policy.
- `@infinitestudios/opentrust-gateway` runtime package.
- REST tool-call path at `/api/v1/tools/call`.
- Strict Zod-validated gateway policy model.
- Hosted Hands Body and Feet adapter.
- Remote MCP adapter.
- Local connector registration model.
- Gateway web surface and marketplace entry points.
- Gateway docs under `docs/gateway/`.

### Verified

- API test suite passed.
- Gateway runtime tests, typecheck, and build passed.
- Web tests and build passed.

## 2026-06-03 - Hands Body and Feet 2.3.0

### Added

- AgentMail email transport for hosted inboxes that can send and receive mail.
- `create_mailbox`, `read_inbox`, `wait_for_email`, and AgentMail webhook ingestion support.
- `hands-body-and-feet init` now offers AgentMail as the easiest email setup.

### Changed

- Defaults switched to the branded OpenTrust domain, `opentrust.sh`.

## 2026-05-29 - Hands Body and Feet 2.2.0

### Added

- Registry validation routes required by Hands Body and Feet trust checks.
- Hosted registry default for fresh installs.

### Fixed

- Registry-backed trust checks no longer fail closed because of missing validation endpoints.

## 2026-05-29 - Hands Body and Feet 2.1.0

### Added

- Stdio transport for one-line MCP client setup.
- Zero-config local identity fallback for stdio mode.
- Logging separation so stdout carries JSON-RPC and stderr carries logs.

## 2026-05-28 - OpenTrust 1.0.0

### Added

- Stable passport schema baseline at `spec_version: 1.0.0`.
- Base L2 on-chain payment verification.
- Embedded wallet custody primitives.
- Escrow order flow.
- Standalone `/payments/verify-onchain` endpoint.
- `prepare_payment` composite MCP helper.
- Governance transfer documentation.

### Changed

- Core packages aligned around the 1.0.0 baseline.

### Security

- Production config validation for embedded wallet encryption.
- On-chain verification rejects pending transactions and malformed transfer events.
