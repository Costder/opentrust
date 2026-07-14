import json
from pathlib import Path

from typer.testing import CliRunner

from manifest_validator import validate_passport_file
from opentrust_cli.main import app


EXAMPLE = Path(__file__).resolve().parents[2] / "passport-schema" / "examples" / "minimal-passport.json"


def test_validate_command_emits_the_canonical_structured_result():
    expected = validate_passport_file(EXAMPLE).to_dict()

    result = CliRunner().invoke(app, ["validate", str(EXAMPLE), "--output", "json"])

    assert result.exit_code == 0
    assert json.loads(result.output) == expected


def test_validate_command_rejects_statuses_outside_the_schema_contract(tmp_path):
    passport = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    passport["trust_status"] = "seller_confirmed"
    path = tmp_path / "drifted-status.json"
    path.write_text(json.dumps(passport), encoding="utf-8")

    result = CliRunner().invoke(app, ["validate", str(path), "--output", "json"])

    assert result.exit_code == 1
    output = json.loads(result.output)
    assert any(error["code"] == "schema.enum" and error["path"] == "/trust_status" for error in output["errors"])
