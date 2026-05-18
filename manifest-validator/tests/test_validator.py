import json
import pytest
from pathlib import Path
from manifest_validator.validator import validate, compute_risk_score, validate_evidence


# ── risk score unit tests ──────────────────────────────────────────────────

def test_risk_low_no_permissions():
    score, warnings = compute_risk_score({})
    assert score == "low"
    assert warnings == []


def test_risk_medium_network_boolean():
    score, warnings = compute_risk_score({"network": True})
    assert score == "medium"
    assert any("network" in w for w in warnings)


def test_risk_medium_network_no_domains():
    score, warnings = compute_risk_score({"network": {"allowed_domains": [], "egress_only": False}})
    assert score == "medium"
    assert any("allowed_domains" in w for w in warnings)


def test_risk_high_file_write_no_forbidden():
    score, warnings = compute_risk_score({"file": {"write": ["./output/**"], "forbidden_paths": []}})
    assert score == "high"
    assert any("forbidden_paths" in w for w in warnings)


def test_risk_critical_shell_access():
    score, warnings = compute_risk_score({"terminal": {"shell_access": True, "allowed_commands": []}})
    assert score == "critical"
    assert any("shell_access" in w for w in warnings)


def test_risk_critical_wallet_send():
    score, warnings = compute_risk_score({"wallet": {"send": True, "read_balance": False}})
    assert score == "critical"
    assert any("wallet.send" in w for w in warnings)


def test_risk_high_terminal_boolean():
    score, warnings = compute_risk_score({"terminal": True})
    assert score == "high"
    assert any("terminal" in w for w in warnings)


# ── integration tests with real passport files ─────────────────────────────

EXAMPLES = Path(__file__).resolve().parents[2] / "passport-schema" / "examples"


def test_validate_free_tool_no_errors():
    errors, flags, risk, warnings = validate(str(EXAMPLES / "free-tool.json"))
    assert errors == [], f"Unexpected errors: {errors}"


def test_validate_minimal_passport_no_errors():
    errors, flags, risk, warnings = validate(str(EXAMPLES / "minimal-passport.json"))
    assert errors == []


def test_validate_returns_risk_score():
    errors, flags, risk, warnings = validate(str(EXAMPLES / "free-tool.json"))
    assert risk in ("low", "medium", "high", "critical")


def test_validate_invalid_file_raises_errors(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"spec_version": "0.1.0"}))
    errors, flags, risk, warnings = validate(str(bad))
    assert len(errors) > 0


# ── evidence validation tests ──────────────────────────────────────────────

EVIDENCE_REQUIRED_LEVELS = {"security_checked", "continuously_monitored"}


def _passport_at_level(trust_status: str, with_evidence: bool) -> dict:
    entry = {
        "status": trust_status,
        "timestamp": "2026-05-01T12:00:00Z",
        "reviewer": "alice",
    }
    if with_evidence:
        entry["security_evidence"] = {
            "scanner_outputs": [
                {"tool": "semgrep", "version": "1.62.0", "findings_count": 0}
            ],
            "dependency_snapshot": {
                "sbom_url": "https://example.com/sbom.cdx.json",
                "sbom_format": "cyclonedx",
            },
            "commit_hash": "abc123",
            "review_scope": "Full review",
            "known_issues": [],
        }
    return {
        "spec_version": "0.1.0",
        "trust_status": trust_status,
        "tool_identity": {
            "name": "Test Tool", "slug": "test-tool",
            "source_url": "https://github.com/test/test", "category": "search",
            "license": "MIT", "maintainers": ["test"],
        },
        "version_hash": {"version": "1.0.0", "commit": "abc123", "artifact_hash": "sha256:abc"},
        "capabilities": ["test"],
        "permission_manifest": {},
        "source_formats": ["mcp"],
        "review_history": [entry],
    }


def test_validate_evidence_security_checked_with_evidence_passes():
    passport = _passport_at_level("security_checked", with_evidence=True)
    errors = validate_evidence(passport)
    assert errors == []


def test_validate_evidence_security_checked_without_evidence_fails():
    passport = _passport_at_level("security_checked", with_evidence=False)
    errors = validate_evidence(passport)
    assert len(errors) > 0
    assert any("security_evidence" in e for e in errors)


def test_validate_evidence_reviewer_signed_without_evidence_passes():
    passport = _passport_at_level("reviewer_signed", with_evidence=False)
    errors = validate_evidence(passport)
    assert errors == []


def test_validate_evidence_missing_sbom_fails():
    passport = _passport_at_level("security_checked", with_evidence=True)
    del passport["review_history"][0]["security_evidence"]["dependency_snapshot"]
    errors = validate_evidence(passport)
    assert any("dependency_snapshot" in e or "SBOM" in e or "sbom" in e.lower() for e in errors)


def test_validate_evidence_empty_scanner_outputs_fails():
    passport = _passport_at_level("security_checked", with_evidence=True)
    passport["review_history"][0]["security_evidence"]["scanner_outputs"] = []
    errors = validate_evidence(passport)
    assert any("scanner" in e.lower() for e in errors)
