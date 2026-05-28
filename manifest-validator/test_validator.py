import json
import pytest
from pathlib import Path
from validator import validate


def _write(tmp_path, data):
    p = tmp_path / "passport.json"
    p.write_text(json.dumps(data))
    return str(p)


MINIMAL = {
    "spec_version": "0.2.0",
    "tool_identity": {
        "slug": "mv-test",
        "name": "MV Test",
        "source_url": "https://github.com/example/mv-test",
        "category": "developer-tools",
    },
    "trust_status": "creator_claimed",
    "version_hash": {"version": "1.0.0", "commit": "abc123def456"},
    "capabilities": ["search"],
    "permission_manifest": {
        "network": {
            "allowed_domains": ["api.github.com"],
            "allowed_schemes": ["https"],
        }
    },
    "source_formats": ["mcp"],
    "commercial_status": {"status": "free"},
}


def test_clean_passport_returns_no_errors_no_flags(tmp_path):
    errors, flags = validate(_write(tmp_path, MINIMAL))
    assert errors == []
    assert flags == []


def test_wallet_permission_is_flagged_as_high_risk(tmp_path):
    data = {**MINIMAL, "permission_manifest": {"wallet": True}}
    _, flags = validate(_write(tmp_path, data))
    assert "wallet" in flags


def test_terminal_permission_is_flagged(tmp_path):
    data = {**MINIMAL, "permission_manifest": {"terminal": True}}
    _, flags = validate(_write(tmp_path, data))
    assert "terminal" in flags


def test_invalid_permission_field_returns_schema_error(tmp_path):
    data = {**MINIMAL, "permission_manifest": {"network": {"unknown_field": True}}}
    errors, _ = validate(_write(tmp_path, data))
    assert len(errors) > 0


def test_passport_with_security_field_does_not_crash(tmp_path):
    """Regression: security.schema.json must be registered."""
    data = {
        **MINIMAL,
        "trust_status": "reviewer_signed",
        "security": {
            "registry_signature": {
                "key_id": "opentrust-registry-2026-1",
                "algorithm": "ed25519",
                "signature": "AAAA",
                "signed_at": "2026-01-01T00:00:00Z",
                "payload_hash": "sha256:abc",
            }
        },
        "review_history": [{"status": "approved", "timestamp": "2026-01-01T00:00:00Z", "reviewer": "alice"}],
    }
    errors, _ = validate(_write(tmp_path, data))
    assert isinstance(errors, list)  # no crash
