import json
import runpy
from pathlib import Path

import pytest

from manifest_validator.validator import (
    compute_risk_score,
    validate,
    validate_evidence,
    validate_legacy_tuple,
    validate_passport,
    validate_passport_file,
)


EXAMPLES = Path(__file__).resolve().parents[2] / "passport-schema" / "examples"


def load_example(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


def test_validate_file_returns_a_structured_result_for_a_valid_passport():
    result = validate_passport_file(EXAMPLES / "free-tool.json")

    assert result.valid
    assert result.to_dict()["valid"] is True
    assert result.to_dict()["errors"] == []
    assert result.risk.level in {"low", "medium", "high", "critical"}


def test_schema_diagnostics_have_stable_codes_paths_and_order():
    passport = load_example("minimal-passport.json")
    passport["trust_status"] = "seller_confirmed"
    del passport["tool_identity"]["name"]

    result = validate_passport(passport)

    assert not result.valid
    assert [(error.path, error.code, error.message) for error in result.errors] == sorted(
        (error.path, error.code, error.message) for error in result.errors
    )
    assert any(error.code == "schema.enum" and error.path == "/trust_status" for error in result.errors)
    assert any(error.code == "schema.required" and error.path == "/tool_identity" for error in result.errors)


def test_risk_output_is_structured_and_legacy_helper_remains_consistent():
    permissions = {"wallet": {"send": True}}
    result = validate_passport({"permission_manifest": permissions})
    legacy_level, legacy_warnings = compute_risk_score(permissions)

    assert result.risk.level == legacy_level == "critical"
    assert any(warning.code == "risk.wallet_send" for warning in result.warnings)
    assert legacy_warnings == [warning.message for warning in result.warnings]


def test_security_checked_requires_matching_review_evidence():
    passport = load_example("minimal-passport.json")
    passport["trust_status"] = "security_checked"

    assert validate_passport(passport).valid
    result = validate_passport(passport, check_evidence=True)

    assert any(error.code == "evidence.missing_trust_review" for error in result.errors)


def test_security_checked_with_complete_evidence_is_valid():
    passport = load_example("minimal-passport.json")
    passport["trust_status"] = "security_checked"
    passport["review_history"] = [
        {
            "status": "security_checked",
            "timestamp": "2026-05-01T12:00:00Z",
            "security_evidence": {
                "scanner_outputs": [{"tool": "semgrep", "version": "1.0", "findings_count": 0}],
                "dependency_snapshot": {
                    "sbom_url": "https://example.com/sbom.cdx.json",
                    "sbom_format": "cyclonedx",
                },
            },
        }
    ]

    result = validate_passport(passport, check_evidence=True)

    assert result.valid, result.to_dict()


def test_invalid_json_is_a_structured_input_error(tmp_path):
    passport = tmp_path / "broken.json"
    passport.write_text("{not json", encoding="utf-8")

    result = validate_passport_file(passport)

    assert not result.valid
    assert result.errors[0].code == "input.invalid_json"
    assert result.errors[0].path == "/"


def test_deprecated_validate_entry_point_returns_the_same_result_contract():
    with pytest.warns(DeprecationWarning):
        result = validate(EXAMPLES / "minimal-passport.json")

    assert result.valid
    assert result.to_dict()["risk"]["level"] == result.risk.level


def test_legacy_tuple_and_evidence_adapters_preserve_their_old_shapes():
    with pytest.warns(DeprecationWarning):
        legacy = validate_legacy_tuple(EXAMPLES / "minimal-passport.json")
    assert len(legacy) == 4
    assert legacy[0] == []

    passport = load_example("minimal-passport.json")
    passport["trust_status"] = "security_checked"
    with pytest.warns(DeprecationWarning):
        evidence_errors = validate_evidence(passport)
    assert any("security evidence" in error for error in evidence_errors)


def test_legacy_root_validator_reexports_the_canonical_structured_entry_point():
    root_adapter = Path(__file__).resolve().parents[1] / "validator.py"
    namespace = runpy.run_path(str(root_adapter))

    assert namespace["validate_passport_file"] is validate_passport_file
    result = namespace["validate_passport_file"](EXAMPLES / "minimal-passport.json")
    assert result.valid


@pytest.mark.parametrize("example", sorted(EXAMPLES.glob("*.json")), ids=lambda path: path.name)
def test_every_published_passport_example_validates(example):
    result = validate_passport_file(example)

    assert result.valid, result.to_dict()
