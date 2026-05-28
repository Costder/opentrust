import json
from pathlib import Path

from opentrust_cli.schema_validator import validate_passport_file


def _write(tmp_path: Path, payload: dict) -> Path:
    path = tmp_path / "passport.json"
    path.write_text(json.dumps(payload))
    return path


def _base_passport() -> dict:
    return {
        "spec_version": "0.1.0",
        "tool_identity": {
            "name": "Example Tool",
            "slug": "example-tool",
            "source_url": "https://github.com/example/example-tool",
            "category": "developer-tools",
        },
        "trust_status": "community_reviewed",
        "version_hash": {"version": "1.0.0", "commit": "abc123"},
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


def _minimal_passport(overrides: dict) -> dict:
    """Return a minimal valid v0.2 passport dict, merging overrides at the top level."""
    base = {
        "spec_version": "0.2.0",
        "tool_identity": {
            "slug": "test-granular",
            "name": "Test Granular",
            "source_url": "https://github.com/example/test",
            "category": "developer-tools",
        },
        "trust_status": "creator_claimed",
        "version_hash": {"version": "1.0.0", "commit": "abc123def456"},
        "capabilities": ["search"],
        "permission_manifest": {},
        "source_formats": ["mcp"],
        "commercial_status": {"status": "free"},
    }
    base.update(overrides)
    return base


def test_validate_passport_file_accepts_production_bound_hash(tmp_path):
    path = _write(tmp_path, _base_passport())
    assert validate_passport_file(str(path)) == []


def test_validate_passport_file_requires_commit_or_artifact_hash(tmp_path):
    payload = _base_passport()
    payload["version_hash"] = {"version": "1.0.0"}
    path = _write(tmp_path, payload)
    errors = validate_passport_file(str(path))
    assert any("commit" in error and "artifact_hash" in error for error in errors)


def test_validate_passport_file_reports_json_path_for_schema_errors(tmp_path):
    payload = _base_passport()
    del payload["tool_identity"]["category"]
    path = _write(tmp_path, payload)
    errors = validate_passport_file(str(path))
    assert any(error.startswith("$.tool_identity") and "category" in error for error in errors)


def test_validate_passport_file_blocks_dangerous_broad_permissions(tmp_path):
    payload = _base_passport()
    payload["permission_manifest"]["wallet"] = True
    path = _write(tmp_path, payload)
    errors = validate_passport_file(str(path))
    assert any("$.permission_manifest.wallet" in error for error in errors)


def test_validate_passport_with_security_field_does_not_crash(tmp_path):
    """Passports with a security field must not crash the validator (regression: security.schema.json was not registered)."""
    passport = {
        "spec_version": "0.1.0",
        "tool_identity": {
            "slug": "secure-tool",
            "name": "Secure Tool",
            "source_url": "https://github.com/example/secure-tool",
            "category": "developer-tools",
        },
        "trust_status": "reviewer_signed",
        "version_hash": {"version": "1.0.0", "commit": "abc123def456"},
        "capabilities": ["code_review"],
        "permission_manifest": {
            "network": {
                "allowed_domains": ["api.github.com"],
                "allowed_schemes": ["https"],
                "outbound_only": True,
            }
        },
        "source_formats": ["mcp"],
        "commercial_status": {"status": "free"},
        "agent_access": {"mcp_readable": True},
        "security": {
            "registry_signature": {
                "key_id": "opentrust-registry-2026-1",
                "algorithm": "ed25519",
                "signature": "AAAA",
                "signed_at": "2026-01-01T00:00:00Z",
                "payload_hash": "sha256:abc",
            }
        },
        "review_history": [
            {"status": "approved", "timestamp": "2026-01-01T00:00:00Z", "reviewer": "alice"}
        ],
    }
    path = tmp_path / "passport.json"
    path.write_text(json.dumps(passport))
    # Must not raise — previously crashed with Unresolvable: security.schema.json
    errors = validate_passport_file(str(path))
    # A valid reviewer_signed passport with a security field must produce zero validation errors
    assert errors == []


def test_granular_network_scope_is_valid(tmp_path):
    passport = _minimal_passport({
        "permission_manifest": {
            "network": {
                "allowed_domains": ["api.github.com"],
                "allowed_schemes": ["https"],
                "outbound_only": True,
            }
        }
    })
    path = tmp_path / "p.json"
    path.write_text(json.dumps(passport))
    errors = validate_passport_file(str(path))
    assert errors == [], f"Expected no errors for valid granular network scope, got: {errors}"


def test_granular_file_scope_is_valid(tmp_path):
    passport = _minimal_passport({
        "permission_manifest": {
            "file": {
                "read": ["./docs/**"],
                "write": ["./output/**"],
            }
        }
    })
    path = tmp_path / "p.json"
    path.write_text(json.dumps(passport))
    errors = validate_passport_file(str(path))
    assert errors == [], f"Expected no errors for valid granular file scope, got: {errors}"


def test_granular_terminal_scope_is_valid(tmp_path):
    passport = _minimal_passport({
        "permission_manifest": {
            "terminal": {
                "allowed_commands": ["git", "npm"],
                "forbidden_commands": ["rm -rf", "curl | sh"],
                "shell_access": False,
            }
        }
    })
    path = tmp_path / "p.json"
    path.write_text(json.dumps(passport))
    errors = validate_passport_file(str(path))
    assert errors == [], f"Expected no errors for valid granular terminal scope, got: {errors}"


def test_boolean_true_network_is_valid_for_low_trust(tmp_path):
    """v0.1-style boolean true must remain valid at creator_claimed (backward compat)."""
    passport = _minimal_passport({"permission_manifest": {"network": True}})
    path = tmp_path / "p.json"
    path.write_text(json.dumps(passport))
    errors = validate_passport_file(str(path))
    # Schema-level error for network:true must NOT appear (semantic enforcement only at reviewer_signed+)
    assert errors == [], f"Boolean true for network broke backward compat: {errors}"


def test_invalid_granular_network_field_is_rejected(tmp_path):
    """Unknown field inside network scope object must fail schema validation."""
    passport = _minimal_passport({
        "permission_manifest": {
            "network": {
                "allowed_domains": ["api.github.com"],
                "unknown_extra_field": True,  # not in schema
            }
        }
    })
    path = tmp_path / "p.json"
    path.write_text(json.dumps(passport))
    errors = validate_passport_file(str(path))
    assert len(errors) > 0, "Expected a schema error for unknown network field, got none"
    assert any(
        "network" in e.lower() and ("additional" in e.lower() or "unknown_extra_field" in e.lower() or "remove unknown" in e.lower())
        for e in errors
    ), f"Expected an additionalProperties error for network scope, got: {errors}"
