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
