import json
import pytest
from pathlib import Path
from manifest_validator.validator import validate, compute_risk_score


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
