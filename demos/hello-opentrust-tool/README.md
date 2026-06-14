# OpenTrust Demo: Hello Weather Tool Trust Flow

A complete five-minute walkthrough of the OpenTrust trust and payment framework
using a toy weather lookup tool. Demonstrates the entire lifecycle:

- Schema validation
- Registry signature verification
- Policy-based allow/deny decisions
- Signed payment quotes with nonce replay protection

## Prerequisites

- Python 3.11+
- OpenTrust CLI installed (included in this repo)
- Working directory: `opentrust/demos/hello-opentrust-tool/`

## Quick Start (5 minutes)

### 1. Activate the OpenTrust environment

```bash
cd /path/to/opentrust
source .venv/bin/activate
cd demos/hello-opentrust-tool
```

### 2. Try the toy tool

```bash
python tool/weather.py London
# Output:
#   Weather for London:
#     Temperature: 15.2°C
#     Conditions:  Partly cloudy
#     Humidity:    72%
#     Wind:        18 km/h
#     Source:      api.weather.example.com (mock)
#     Updated:     2026-05-21T12:00:00Z

python tool/weather.py Tokyo --json
python tool/weather.py --version
```

### 3. Validate passports against the OpenTrust schema

Safe passport (clean permissions — should pass):

```bash
opentrust validate passports/safe-passport.json
# Output: valid passport
```

Unsafe passport (dangerous permissions — should fail):

```bash
opentrust validate passports/unsafe-passport.json
# Output shows schema violations for wallet, terminal, private_data
```

### 4. Verify registry signature on a signed passport

```bash
opentrust verify --keys keys/registry-keys.json artifacts/signed-passport.json
# Output: VERIFIED — registry signature valid, no revocations found
```

The signed passport contains an Ed25519 signature over the canonical JSON
payload. The `verify` command checks:
- Payload hash integrity
- Ed25519 signature against the registry public key
- Inline revocation flag
- Revocation list (if provided)

### 5. Check policy — safe passport should ALLOW

```bash
opentrust policy check \
  --policy policies/default-policy.json \
  passports/safe-passport.json
# Output: ALLOW — policy checks passed
```

The safe "Hello Weather" tool has:
- `community_reviewed` trust status (meets minimum)
- Only `network` + `api` permissions (no blocked perms)
- Free commercial status (no payment needed)

### 6. Check policy — unsafe passport should DENY

```bash
opentrust policy check \
  --policy policies/default-policy.json \
  passports/unsafe-passport.json
# Output: DENY — multiple denial reasons
```

The unsafe "Weather Turbo" tool triggers:
- TRUST TOO LOW: `auto_generated_draft` below `community_reviewed`
- BROAD PERMISSION: `wallet`, `terminal`, `private_data` are boolean true
- SPEND CAP: $0.50 call exceeds $0.10 policy limit
- NETWORK DENIED: `solana` is not in allowed networks
- ESCROW/HUMAN APPROVAL REQUIRED: high amount without escrow

### 7. Validate a signed payment quote with replay protection

The `artifacts/payment-quote.json` contains an Ed25519-signed payment quote
for 0.05 USDC on Base. The Python integration test below verifies:

```python
from payment_contracts.models import (
    PaymentQuote, InMemoryNonceStore, validate_quote
)

# Load signed quote
with open("artifacts/payment-quote.json") as f:
    data = json.load(f)

# Load public key
with open("keys/registry-keys.json") as f:
    keys = json.load(f)
pub_raw = base64.urlsafe_b64decode(keys["keys"][0]["public_key"] + "==")

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
public_key = Ed25519PublicKey.from_public_bytes(pub_raw)

quote = PaymentQuote(**data)
store = InMemoryNonceStore()

# First use — ALLOWED
errors = validate_quote(quote, public_key, store, data["recipient_wallet"])
assert errors == [], f"Expected valid: {errors}"

# Replay — BLOCKED
errors = validate_quote(quote, public_key, store, data["recipient_wallet"])
assert "nonce replay" in str(errors)

# Wrong wallet — BLOCKED
errors = validate_quote(quote, public_key, store, "0xBadAddress")
assert "wallet mismatch" in str(errors)
```

## Run the Full Integration Test

```bash
python test_demo.py
```

This executes all 7 verification steps and reports pass/fail for each.

## Directory Structure

```
demos/hello-opentrust-tool/
├── README.md                        # This file — demo walkthrough
├── SKILL.md                         # Tool skill description for agents
├── generate_artifacts.py            # Build script (generates keys + signed artifacts)
├── test_demo.py                     # Integration test (7 verification steps)
├── tool/
│   └── weather.py                   # Toy weather lookup tool (executable)
├── passports/
│   ├── safe-passport.json           # Clean permissions — network + api only
│   └── unsafe-passport.json         # Dangerous permissions — terminal + wallet + private_data
├── keys/
│   └── registry-keys.json           # Ed25519 key pair for signing
├── artifacts/
│   ├── signed-passport.json         # Safe passport with registry signature
│   └── payment-quote.json           # Ed25519-signed payment quote with nonce
└── policies/
    └── default-policy.json          # Agent spend policy (community_reviewed min, no dangerous perms)
```

## Key Concepts Demonstrated

| Concept | What It Shows |
|---------|---------------|
| **Schema Validation** | Passports must conform to `passport.schema.json` — dangerous permissions (wallet, terminal, private_data) cannot be broad boolean true |
| **Signature Verification** | Ed25519 registry signatures prove passport integrity and authenticity |
| **Policy Enforcement** | Agents check `min_trust_status`, `blocked_permissions`, `max_cost_per_call`, allowed networks, and escrow requirements before approving use |
| **Payment Quotes** | Signed quotes with expiration prevent price manipulation; nonces prevent replay attacks |
| **Replay Protection** | Once a nonce is consumed, the same quote cannot be reused — an attacker cannot replay a payment quote to make an agent pay twice |

## Security Notes

- All keys in this demo are generated locally at build time and are **test keys only**
- The unsafe passport is intentionally malicious for demonstration purposes
- In production, registry keys would be published at `https://opentrust.sh/.well-known/keys.json`
- Revocation lists would be checked periodically from `https://opentrust.sh/.well-known/revoked-passports.json`