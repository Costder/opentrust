import json
from pathlib import Path
from jsonschema import Draft202012Validator

HIGH_RISK = {"terminal", "wallet", "private_data", "camera", "microphone"}


def validate(path: str) -> tuple[list[str], list[str]]:
    root = Path(__file__).resolve().parents[1]
    schema = json.loads((root / "passport-schema" / "passport.schema.json").read_text())
    data = json.loads(Path(path).read_text())
    errors = [error.message for error in Draft202012Validator(schema).iter_errors(data)]
    permissions = data.get("permission_manifest", {})
    flags = sorted(name for name in HIGH_RISK if permissions.get(name))
    return errors, flags
