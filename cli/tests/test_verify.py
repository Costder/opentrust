import json
from pathlib import Path
from typer.testing import CliRunner
from opentrust_cli.main import app

runner = CliRunner()


def _make_keys(public_key_b64: str) -> dict:
    return {
        "keys": [
            {
                "key_id": "opentrust-registry-2026-1",
                "algorithm": "ed25519",
                "public_key": public_key_b64,
                "not_before": "2026-01-01T00:00:00Z",
                "not_after": "2027-01-01T00:00:00Z",
            }
        ]
    }


def _make_revocation_list(signature_value_b64: str, payload_hash: str, passports: list | None = None) -> dict:
    return {
        "version": 42,
        "updated_at": "2026-05-21T12:00:00Z",
        "passports": passports or [],
        "operator_keys": [],
        "signature": {
            "key_id": "opentrust-registry-2026-1",
            "algorithm": "ed25519",
            "value": signature_value_b64,
            "payload_hash": payload_hash,
        },
    }


def _build_passport_with_signature(slug: str = "test-tool", version: str = "1.0.0",
                                    trust_status: str = "community_reviewed",
                                    revoked: bool = False,
                                    sign_bytes: bytes | None = None,
                                    payload_hash: str | None = None) -> dict:
    passport = {
        "spec_version": "0.1.0",
        "tool_identity": {
            "name": "Test Tool",
            "slug": slug,
            "source_url": "https://github.com/example/test-tool",
            "category": "developer-tools",
        },
        "trust_status": trust_status,
        "version_hash": {"version": version, "commit": "abc123"},
        "capabilities": ["does one safe thing"],
        "permission_manifest": {
            "network": False,
            "file": False,
            "terminal": False,
            "browser": False,
            "memory": False,
            "wallet": False,
            "api": False,
            "camera": False,
            "microphone": False,
            "private_data": False,
        },
        "source_formats": ["cli"],
    }
    if revoked:
        passport["revocation"] = {"revoked": True, "reason": "malware_detected"}
    sig = {
        "key_id": "opentrust-registry-2026-1",
        "algorithm": "ed25519",
        "signature": sign_bytes,
        "signed_at": "2026-05-21T12:00:00Z",
        "payload_hash": payload_hash,
    }
    if sign_bytes is not None and payload_hash is not None:
        import base64
        if isinstance(sign_bytes, bytes):
            sig["signature"] = base64.urlsafe_b64encode(sign_bytes).rstrip(b"=").decode()
    passport["security"] = {"registry_signature": sig}
    return passport


def _write_json(tmp_path: Path, name: str, data: dict) -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(data))
    return p


# ── Verify command ──────────────────────────────────────────────────────────


def test_verify_requires_passport_path():
    """Running verify without args should show help/error."""
    result = runner.invoke(app, ["verify"])
    assert result.exit_code != 0


def test_verify_reports_missing_file(tmp_path):
    keys = _make_keys("dGVzdA==")
    _write_json(tmp_path, "keys.json", keys)
    # typer requires options before positional args with invoke_without_command=True
    result = runner.invoke(app, ["verify", "--keys", str(tmp_path / "keys.json"), str(tmp_path / "nope.json")])
    assert result.exit_code != 0
    assert "nope.json" in result.output.lower() or "Error" in result.output or "not found" in result.output


def test_verify_reports_invalid_json(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("not json")
    keys = _make_keys("dGVzdA==")
    _write_json(tmp_path, "keys.json", keys)
    result = runner.invoke(app, ["verify", "--keys", str(tmp_path / "keys.json"), str(p)])
    assert result.exit_code != 0
    assert "JSON" in result.output


def test_verify_reports_missing_registry_signature(tmp_path):
    passport = _build_passport_with_signature()
    del passport["security"]["registry_signature"]
    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys("dGVzdA==")
    _write_json(tmp_path, "keys.json", keys)
    result = runner.invoke(app, ["verify", "--keys", str(tmp_path / "keys.json"), str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["signature", "missing"])


def test_verify_reports_payload_hash_mismatch(tmp_path):
    """If payload_hash doesn't match computed hash, verification fails."""
    import base64
    passport = _build_passport_with_signature()
    passport["security"]["registry_signature"]["payload_hash"] = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    _write_json(tmp_path, "passport.json", passport)

    pub = base64.urlsafe_b64encode(b"x" * 32).rstrip(b"=").decode()
    keys = _make_keys(pub)
    _write_json(tmp_path, "keys.json", keys)

    result = runner.invoke(app, ["verify", "--keys", str(tmp_path / "keys.json"), str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["payload_hash", "hash", "mismatch"])


def test_verify_reports_bad_signature(tmp_path):
    """If signature doesn't verify against public key, verification fails."""
    import base64, hashlib
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport = _build_passport_with_signature()
    sig = passport["security"]["registry_signature"]
    payload_hash = sig["payload_hash"]

    bad_sk = SigningKey.generate(curve=Ed25519)
    bad_sig = bad_sk.sign(hashlib.sha256(b"canonical").digest())
    sig["signature"] = base64.urlsafe_b64encode(bad_sig).rstrip(b"=").decode()

    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    result = runner.invoke(app, ["verify", "--keys", str(tmp_path / "keys.json"), str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["signature", "invalid", "verify"])


def test_verify_reports_key_id_not_found(tmp_path):
    """If key_id in signature doesn't match any key in keys.json, fail."""
    passport = _build_passport_with_signature()
    passport["security"]["registry_signature"]["key_id"] = "nonexistent-key"
    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys("dGVzdA==")
    _write_json(tmp_path, "keys.json", keys)

    result = runner.invoke(app, ["verify", "--keys", str(tmp_path / "keys.json"), str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["key_id", "not found"])


def test_verify_reports_revocation_signature_invalid(tmp_path):
    """If revocation list signature is invalid, verification fails."""
    import base64
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport = _build_passport_with_signature(sign_bytes=b"", payload_hash="sha256:ab" + "0" * 62)
    passport["security"]["registry_signature"]["signature"] = base64.urlsafe_b64encode(b"x" * 64).rstrip(b"=").decode()
    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    revocations = _make_revocation_list("bad_sig_here", "sha256:bad" + "0" * 60)
    _write_json(tmp_path, "revoked.json", revocations)

    result = runner.invoke(app, [
        "verify", "--keys", str(tmp_path / "keys.json"),
        "--revocations", str(tmp_path / "revoked.json"),
        str(tmp_path / "passport.json"),
    ])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["revocation", "signature", "invalid"])


def test_verify_fails_closed_on_revoked_passport(tmp_path):
    """A passport listed in the revoked list must fail verification."""
    import base64
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport = _build_passport_with_signature(slug="my-tool", version="1.0.0",
                                               sign_bytes=b"x" * 64, payload_hash="sha256:ab" + "0" * 62)
    passport["security"]["registry_signature"]["signature"] = base64.urlsafe_b64encode(b"x" * 64).rstrip(b"=").decode()
    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    rev_sig_value = base64.urlsafe_b64encode(b"y" * 64).rstrip(b"=").decode()
    revocations = _make_revocation_list(rev_sig_value, "sha256:ba" + "0" * 62, passports=[
        {"slug": "my-tool", "version": "1.0.0", "revoked_at": "2026-05-21T12:00:00Z", "reason": "malware_detected"}
    ])
    _write_json(tmp_path, "revoked.json", revocations)

    result = runner.invoke(app, [
        "verify", "--keys", str(tmp_path / "keys.json"),
        "--revocations", str(tmp_path / "revoked.json"),
        str(tmp_path / "passport.json"),
    ])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["revoked", "denied"])


def test_verify_fails_closed_on_disputed_passport(tmp_path):
    """A passport with trust_status=disputed must fail even without revocations file."""
    import base64
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport = _build_passport_with_signature(trust_status="disputed",
                                               sign_bytes=b"x" * 64, payload_hash="sha256:ab" + "0" * 62)
    passport["security"]["registry_signature"]["signature"] = base64.urlsafe_b64encode(b"x" * 64).rstrip(b"=").decode()
    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    result = runner.invoke(app, [
        "verify", "--keys", str(tmp_path / "keys.json"),
        str(tmp_path / "passport.json"),
    ])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["disputed", "denied"])


def test_verify_fails_closed_on_inline_revoked(tmp_path):
    """A passport with revocation.revoked=true must fail."""
    import base64
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport = _build_passport_with_signature(revoked=True,
                                               sign_bytes=b"x" * 64, payload_hash="sha256:ab" + "0" * 62)
    passport["security"]["registry_signature"]["signature"] = base64.urlsafe_b64encode(b"x" * 64).rstrip(b"=").decode()
    _write_json(tmp_path, "passport.json", passport)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    result = runner.invoke(app, [
        "verify", "--keys", str(tmp_path / "keys.json"),
        str(tmp_path / "passport.json"),
    ])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["revoked", "denied"])


def test_verify_passes_on_valid_passport_no_revocations(tmp_path):
    """A clean passport with valid signature and no revocations passes."""
    import base64, hashlib, json
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport_body = _build_passport_with_signature()
    del passport_body["security"]

    canonical = json.dumps(passport_body, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode()).digest()
    payload_hash = "sha256:" + digest.hex()

    sig_bytes_ed = sk.sign(digest)
    sig_b64 = base64.urlsafe_b64encode(sig_bytes_ed).rstrip(b"=").decode()

    passport_body["security"] = {
        "registry_signature": {
            "key_id": "opentrust-registry-2026-1",
            "algorithm": "ed25519",
            "signature": sig_b64,
            "signed_at": "2026-05-21T12:00:00Z",
            "payload_hash": payload_hash,
        }
    }
    _write_json(tmp_path, "passport.json", passport_body)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    result = runner.invoke(app, [
        "verify", "--keys", str(tmp_path / "keys.json"),
        str(tmp_path / "passport.json"),
    ])
    assert result.exit_code == 0
    assert any(w in result.output.lower() for w in ["verified", "valid", "pass"])


def test_verify_passes_with_valid_revocations_not_matching(tmp_path):
    """A valid passport with a valid revocation list that doesn't list it passes."""
    import base64, hashlib, json
    from ecdsa import SigningKey, Ed25519

    sk = SigningKey.generate(curve=Ed25519)
    vk = sk.verifying_key
    pub_b64 = base64.urlsafe_b64encode(vk.to_string()).rstrip(b"=").decode()

    passport_body = _build_passport_with_signature(slug="safe-tool", version="2.0.0")
    del passport_body["security"]
    canonical = json.dumps(passport_body, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode()).digest()
    payload_hash = "sha256:" + digest.hex()
    sig_bytes_ed = sk.sign(digest)
    sig_b64 = base64.urlsafe_b64encode(sig_bytes_ed).rstrip(b"=").decode()

    passport_body["security"] = {
        "registry_signature": {
            "key_id": "opentrust-registry-2026-1",
            "algorithm": "ed25519",
            "signature": sig_b64,
            "signed_at": "2026-05-21T12:00:00Z",
            "payload_hash": payload_hash,
        }
    }
    _write_json(tmp_path, "passport.json", passport_body)
    keys = _make_keys(pub_b64)
    _write_json(tmp_path, "keys.json", keys)

    revocations_body = {
        "version": 42,
        "updated_at": "2026-05-21T12:00:00Z",
        "passports": [
            {"slug": "other-tool", "version": "1.0.0", "revoked_at": "2026-05-21T12:00:00Z", "reason": "malware_detected"}
        ],
        "operator_keys": [],
    }
    rev_canonical = json.dumps(revocations_body, sort_keys=True, separators=(",", ":"))
    rev_digest = hashlib.sha256(rev_canonical.encode()).digest()
    rev_payload_hash = "sha256:" + rev_digest.hex()
    rev_sig = sk.sign(rev_digest)
    rev_sig_b64 = base64.urlsafe_b64encode(rev_sig).rstrip(b"=").decode()

    revocations_body["signature"] = {
        "key_id": "opentrust-registry-2026-1",
        "algorithm": "ed25519",
        "value": rev_sig_b64,
        "payload_hash": rev_payload_hash,
    }
    _write_json(tmp_path, "revoked.json", revocations_body)

    result = runner.invoke(app, [
        "verify", "--keys", str(tmp_path / "keys.json"),
        "--revocations", str(tmp_path / "revoked.json"),
        str(tmp_path / "passport.json"),
    ])
    assert result.exit_code == 0
    assert any(w in result.output.lower() for w in ["verified", "valid", "pass"])


# ── Policy check command ─────────────────────────────────────────────────────


def test_policy_check_requires_passport_path():
    result = runner.invoke(app, ["policy", "check"])
    assert result.exit_code != 0


def test_policy_check_reports_missing_file(tmp_path):
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "nope.json")])
    assert result.exit_code != 0


def test_policy_check_denies_disputed(tmp_path):
    """trust_status=disputed is denied."""
    passport = _build_passport_with_signature(trust_status="disputed")
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["disputed", "denied", "blocked"])


def test_policy_check_denies_inline_revoked(tmp_path):
    """revocation.revoked=true is denied."""
    passport = _build_passport_with_signature(revoked=True)
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["revoked", "denied"])


def test_policy_check_denies_unknown_trust_status(tmp_path):
    """An unrecognized trust_status is denied."""
    passport = _build_passport_with_signature(trust_status="completely_unknown")
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["unknown", "denied", "invalid"])


def test_policy_check_denies_broad_wallet(tmp_path):
    """Boolean true for wallet permission is denied."""
    passport = _build_passport_with_signature()
    passport["permission_manifest"]["wallet"] = True
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["wallet", "denied", "blocked"])


def test_policy_check_denies_broad_private_data(tmp_path):
    """Boolean true for private_data permission is denied."""
    passport = _build_passport_with_signature()
    passport["permission_manifest"]["private_data"] = True
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["private_data", "denied", "blocked"])


def test_policy_check_denies_broad_terminal(tmp_path):
    """Boolean true for terminal permission is denied."""
    passport = _build_passport_with_signature()
    passport["permission_manifest"]["terminal"] = True
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["terminal", "denied", "blocked"])


def test_policy_check_denies_payment_above_threshold_no_escrow(tmp_path):
    """Payment above 0.10 USDC without escrow is denied."""
    passport = _build_passport_with_signature()
    passport["commercial_status"] = {
        "status": "paid",
        "pricing": {"model": "per_call", "amount": 0.50, "currency": "USDC"},
        "payment_config": {"type": "crypto_direct", "wallet_address": "0xabc"},
    }
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["escrow", "denied", "threshold"])


def test_policy_check_denies_payment_above_human_approval_no_human(tmp_path):
    """Payment above 0.01 USDC without human approval path is flagged/denied."""
    passport = _build_passport_with_signature()
    passport["commercial_status"] = {
        "status": "paid",
        "pricing": {"model": "per_call", "amount": 0.05, "currency": "USDC"},
        "payment_config": {"type": "crypto_direct", "wallet_address": "0xabc"},
    }
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code != 0
    assert any(w in result.output.lower() for w in ["human", "approval", "denied"])


def test_policy_check_allows_free_passport(tmp_path):
    """A free, non-disputed, non-revoked passport passes policy."""
    passport = _build_passport_with_signature()
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code == 0
    assert any(w in result.output.lower() for w in ["pass", "allowed", "approved"])


def test_policy_check_allows_escrowed_payment(tmp_path):
    """Payment with escrow support passes policy."""
    passport = _build_passport_with_signature()
    passport["commercial_status"] = {
        "status": "paid",
        "pricing": {"model": "per_call", "amount": 0.50, "currency": "USDC"},
        "payment_config": {"type": "crypto_direct", "wallet_address": "0xabc"},
        "escrow_config": {
            "supported": True,
            "type": "smart_contract",
            "contract": {"network": "base", "address": "0xescrow"},
        },
    }
    _write_json(tmp_path, "passport.json", passport)
    result = runner.invoke(app, ["policy", "check", str(tmp_path / "passport.json")])
    assert result.exit_code == 0