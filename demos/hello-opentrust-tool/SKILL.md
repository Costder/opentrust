# Hello Weather — OpenTrust Demo Tool

## Overview

A lightweight, read-only weather lookup tool built to demonstrate the OpenTrust
trust and payment framework. It simulates an API-based weather service that
agents can call to get current conditions for any city.

## Capabilities

- **Current weather lookup** — returns temperature, humidity, conditions, and
  wind speed for any city name.
- **JSON output** — supports `--json` for machine-readable responses.
- **Deterministic** — fixed mock dataset for demo cities; auto-generates
  plausible mock data for unknown cities.

## Permission Model (Safe Passport)

| Permission  | Value  | Notes                                          |
|-------------|--------|-------------------------------------------------|
| `file`      | false  | No file system access                           |
| `terminal`  | false  | No command execution                            |
| `browser`   | false  | No browser automation                           |
| `network`   | true   | Outbound HTTPS to `api.weather.example.com`     |
| `memory`    | false  | No memory or context access                     |
| `wallet`    | false  | No financial access                             |
| `api`       | true   | Read-only API queries                           |
| `private_data` | false | No PII or secrets collected                  |

## Usage

```bash
python tool/weather.py London
python tool/weather.py Tokyo --json
python tool/weather.py --version
```

## OpenTrust Passport

The passport for this tool is at:
- `passports/safe-passport.json` — clean permissions
- `passports/unsafe-passport.json` — dangerous permissions (demo only)

A signed version with registry Ed25519 signature is at:
- `artifacts/signed-passport.json`

## Payment

In production, this tool would charge 0.05 USDC per call on Base (Coinbase L2).
A signed payment quote is available at:
- `artifacts/payment-quote.json`

## Trust Level

Current trust status: `community_reviewed`
Minimum recommended for use: `community_reviewed` or higher.

## Artifact Hashes

- Version: `1.0.0`
- Commit SHA: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- Artifact hash: `sha256:aabbccddee0011223344556677889900aabbccddee0011223344556677889900`

## Security

No credentials are stored or logged. The tool makes ephemeral outbound
HTTPS requests only. Data is not retained between calls.