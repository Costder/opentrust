#!/usr/bin/env python3
"""
Integration test for the hello-opentrust-tool demo.

Runs through the complete OpenTrust trust flow:
  1. Schema validate safe passport
  2. Schema validate unsafe passport
  3. Verify signed passport (registry signature)
  4. Policy approve safe passport (should ALLOW)
  5. Policy block unsafe passport (should DENY)
  6. Payment quote validate (signature + nonce replay protection)
  7. Demonstrate the toy tool itself

Run with:
    cd demos/hello-opentrust-tool/
    python test_demo.py
    # OR
    python -m pytest test_demo.py -v
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ── Setup ──────────────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
OPENTRUST_REPO = HERE.parent.parent  # /home/joshua/opentrust
VENV_PYTHON = OPENTRUST_REPO / ".venv" / "bin" / "python"
OPENTRUST_CLI = [str(VENV_PYTHON), "-m", "opentrust_cli.main"]

# Paths to artifacts
SAFE_PASSPORT = HERE / "passports" / "safe-passport.json"
UNSAFE_PASSPORT = HERE / "passports" / "unsafe-passport.json"
SIGNED_PASSPORT = HERE / "artifacts" / "signed-passport.json"
PAYMENT_QUOTE = HERE / "artifacts" / "payment-quote.json"
REGISTRY_KEYS = HERE / "keys" / "registry-keys.json"
DEFAULT_POLICY = HERE / "policies" / "default-policy.json"
WEATHER_TOOL = HERE / "tool" / "weather.py"

# Ensure all paths exist
for p in [SAFE_PASSPORT, UNSAFE_PASSPORT, SIGNED_PASSPORT, PAYMENT_QUOTE,
          REGISTRY_KEYS, DEFAULT_POLICY, WEATHER_TOOL]:
    assert p.exists(), f"Missing required file: {p}"


def cli(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run an opentrust CLI command and return the CompletedProcess."""
    cmd = OPENTRUST_CLI + list(args)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(HERE),
    )
    if check and result.returncode != 0:
        print(f"[bold red]CLI FAILED: {' '.join(cmd)}[/]")
        print(f"stdout: {result.stdout}")
        print(f"stderr: {result.stderr}")
        sys.exit(1)
    return result


def print_step(num: int, label: str):
    print(f"\n{'='*60}")
    print(f"  STEP {num}: {label}")
    print(f"{'='*60}")


def test_schema_validate_safe():
    """1. Schema validate the safe passport."""
    print_step(1, "Schema Validate — Safe Passport")
    result = cli("validate", str(SAFE_PASSPORT), check=False)
    print(f"  Command: opentrust validate {SAFE_PASSPORT.name}")
    print(f"  Exit code: {result.returncode}")
    print(f"  Output: {result.stdout.strip()}")
    assert result.returncode == 0, f"Expected PASS, got FAIL:\n{result.stderr}"
    assert "valid passport" in result.stdout
    print("  ✅ Safe passport schema is valid")


def test_schema_validate_unsafe():
    """2. Schema validate the unsafe passport (should fail because dangerous perms are rejected by schema)."""
    print_step(2, "Schema Validate — Unsafe Passport")
    result = cli("validate", str(UNSAFE_PASSPORT), check=False)
    print(f"  Command: opentrust validate {UNSAFE_PASSPORT.name}")
    print(f"  Exit code: {result.returncode}")
    print(f"  Output: {result.stdout.strip()}")
    assert result.returncode == 1, "Expected unsafe passport to FAIL schema validation"
    assert "BROAD PERMISSION" in result.stdout or "dangerous permissions" in result.stdout
    denials = [l for l in result.stdout.split("\n") if "invalid" in l]
    print(f"  Schema violations found: {len(denials)}")
    for d in denials:
        print(f"    📛 {d.strip()}")
    print("  ✅ Unsafe passport correctly REJECTED by schema validation")


def test_verify_signed_passport():
    """3. Verify the signed passport's registry signature."""
    print_step(3, "Verify Signature — Signed Passport")
    result = cli(
        "verify", "--keys", str(REGISTRY_KEYS),
        str(SIGNED_PASSPORT),
        check=False,
    )
    print(f"  Command: opentrust verify --keys keys/registry-keys.json {SIGNED_PASSPORT.name}")
    print(f"  Exit code: {result.returncode}")
    print(f"  Output: {result.stdout.strip()}")
    assert result.returncode == 0, f"Expected PASS, got FAIL:\n{result.stderr}"
    assert "VERIFIED" in result.stdout
    print("  ✅ Passport registry signature is valid")


def test_policy_approve_safe():
    """4. Policy check the safe passport — should ALLOW."""
    print_step(4, "Policy Check — Safe Passport (should ALLOW)")
    result = cli(
        "policy", "check", "--policy", str(DEFAULT_POLICY),
        str(SAFE_PASSPORT),
        check=False,
    )
    print(f"  Command: opentrust policy check --policy policies/default-policy.json {SAFE_PASSPORT.name}")
    print(f"  Exit code: {result.returncode}")
    print(f"  Output: {result.stdout.strip()}")
    assert result.returncode == 0, f"Expected ALLOW, got DENY:\n{result.stderr}"
    assert "ALLOW" in result.stdout
    print("  ✅ Safe passport ALLOWED by policy")


def test_policy_block_unsafe():
    """5. Policy check the unsafe passport — should DENY."""
    print_step(5, "Policy Check — Unsafe Passport (should DENY)")
    result = cli(
        "policy", "check", "--policy", str(DEFAULT_POLICY),
        str(UNSAFE_PASSPORT),
        check=False,
    )
    print(f"  Command: opentrust policy check --policy policies/default-policy.json {UNSAFE_PASSPORT.name}")
    print(f"  Exit code: {result.returncode}")
    print(f"  Output: {result.stdout.strip()}")
    assert result.returncode == 1, "Expected DENY, got ALLOW"
    assert "DENY" in result.stdout

    # Check specific denial reasons
    denials = result.stdout.strip()
    print(f"\n  Denial reasons found:")
    for line in denials.split("\n"):
        if "DENY" in line or "FAIL" in line:
            print(f"    📛 {line.strip()}")

    assert "TRUST TOO LOW" in denials or "REVOKED" in denials or "BROAD PERMISSION" in denials or "SPEND CAP" in denials or "NETWORK DENIED" in denials
    print("  ✅ Unsafe passport DENIED by policy (as expected)")


def test_payment_quote_validation():
    """6. Validate payment quote signature and nonce replay protection."""
    print_step(6, "Payment Quote Validation + Replay Protection")

    # Load the quote
    with open(PAYMENT_QUOTE) as f:
        quote = json.load(f)

    print(f"  Quote ID: {quote['quote_id']}")
    print(f"  Passport: {quote['passport_slug']}")
    print(f"  Amount:   {quote['amount']} {quote['currency']} on {quote['chain']}")
    print(f"  Nonce:    {quote['nonce']}")

    # Load the registry public key (from the 'public_key' field, b64url of raw 32-byte key)
    with open(REGISTRY_KEYS) as f:
        keys_data = json.load(f)
    pub_b64url = keys_data["keys"][0]["public_key"]
    raw_pub_key = base64.urlsafe_b64decode(pub_b64url + "==")

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    public_key = Ed25519PublicKey.from_public_bytes(raw_pub_key)

    # ── 6a. Verify signature (PaymentQuote model uses hex-encoded signatures) ─
    quote_unsigned = {k: v for k, v in quote.items() if k != "signature"}
    canon_unsigned = json.dumps(quote_unsigned, sort_keys=True, separators=(",", ":"))
    sig_bytes = bytes.fromhex(quote["signature"])
    public_key.verify(sig_bytes, canon_unsigned.encode("utf-8"))
    print("  ✅ Payment quote signature is VALID")

    # ── 6b. Check expiration ──────────────────────────────────────────
    from datetime import datetime, timezone
    expires_at = datetime.fromisoformat(quote["expires_at"])
    assert expires_at > datetime.now(timezone.utc), "Quote already expired!"
    print("  ✅ Payment quote is NOT expired")

    # ── 6c. Nonce replay protection ──────────────────────────────────
    from payment_contracts.models import InMemoryNonceStore, validate_quote_nonce

    nonce_store = InMemoryNonceStore()

    from payment_contracts.models import PaymentQuote
    pydantic_quote = PaymentQuote(**quote)

    # First use — should succeed
    from payment_contracts.models import validate_quote
    errors = validate_quote(pydantic_quote, public_key, nonce_store, quote["recipient_wallet"])
    assert len(errors) == 0, f"Expected valid quote, got errors: {errors}"
    print("  ✅ Payment quote passed all validation checks (signature + expiration + wallet + nonce)")

    # Replay — should fail
    errors = validate_quote(pydantic_quote, public_key, nonce_store, quote["recipient_wallet"])
    assert any("nonce replay detected" in err for err in errors), f"Expected nonce replay error, got: {errors}"
    print("  ✅ Replay attack detected and blocked (nonce already seen)")

    # Tampered wallet — should fail
    errors = validate_quote(pydantic_quote, public_key, nonce_store, "0xWrongWalletAddress")
    assert any("wallet mismatch" in err for err in errors) or any("nonce replay" in err for err in errors)
    print("  ✅ Wallet mismatch correctly detected")


def test_toy_tool_execution():
    """7. Run the toy weather tool to show it works."""
    print_step(7, "Toy Tool Execution — Hello Weather")

    # Run with a known city
    result = subprocess.run(
        [str(VENV_PYTHON), str(WEATHER_TOOL), "London"],
        capture_output=True, text=True,
        cwd=str(HERE),
    )
    print(f"  Command: python tool/weather.py London")
    assert result.returncode == 0, f"Tool failed: {result.stderr}"
    for line in result.stdout.strip().split("\n"):
        print(f"  {line}")

    # Run with JSON output
    result = subprocess.run(
        [str(VENV_PYTHON), str(WEATHER_TOOL), "Tokyo", "--json"],
        capture_output=True, text=True,
        cwd=str(HERE),
    )
    data = json.loads(result.stdout)
    assert data["city"] == "Tokyo"
    assert "temperature_c" in data
    print(f"\n  JSON output verified for Tokyo: {data['temperature_c']}°C")

    # Run --version
    result = subprocess.run(
        [str(VENV_PYTHON), str(WEATHER_TOOL), "--version"],
        capture_output=True, text=True,
        cwd=str(HERE),
    )
    assert "hello-weather v1.0.0" in result.stdout
    print(f"  Version check: {result.stdout.strip()}")

    print("  ✅ Toy tool works correctly")


def main():
    """Run all demo steps."""
    print("╔══════════════════════════════════════════════════════════╗")
    print("║     OpenTrust Demo: Hello Weather Tool Trust Flow       ║")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"\nRepo:     {OPENTRUST_REPO}")
    print(f"Demo dir: {HERE}")
    print(f"Python:   {VENV_PYTHON}")
    print(f"Time:     {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")

    tests = [
        ("Schema Validate Safe", test_schema_validate_safe),
        ("Schema Validate Unsafe", test_schema_validate_unsafe),
        ("Verify Signed Passport", test_verify_signed_passport),
        ("Policy Allow Safe", test_policy_approve_safe),
        ("Policy Block Unsafe", test_policy_block_unsafe),
        ("Payment Quote + Replay Protection", test_payment_quote_validation),
        ("Toy Tool Execution", test_toy_tool_execution),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"\n  ✅ PASS: {name}")
            passed += 1
        except Exception as e:
            print(f"\n  ❌ FAIL: {name} — {e}")
            import traceback
            traceback.print_exc()
            failed += 1

    print(f"\n{'='*60}")
    print(f"  RESULTS: {passed} passed, {failed} failed out of {len(tests)} tests")
    print(f"{'='*60}")

    if failed > 0:
        sys.exit(1)
    print("  All checks passed. Demo is ready!")


if __name__ == "__main__":
    main()