"""Manifest validator — uses the full passport schema bundle (v0.2)."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

HIGH_RISK = {"terminal", "wallet", "private_data", "camera", "microphone"}


def _load_bundle() -> tuple[dict, Registry]:
    root = Path(__file__).resolve().parents[1] / "passport-schema"
    schema = json.loads((root / "passport.schema.json").read_text())
    permissions = json.loads((root / "permissions.schema.json").read_text())
    commercial = json.loads((root / "commercial-status.schema.json").read_text())
    security = json.loads((root / "security.schema.json").read_text())
    registry = Registry().with_resources([
        ("permissions.schema.json", Resource.from_contents(permissions)),
        ("commercial-status.schema.json", Resource.from_contents(commercial)),
        ("security.schema.json", Resource.from_contents(security)),
        ("https://opentrust.dev/schemas/permissions.schema.json", Resource.from_contents(permissions)),
        ("https://opentrust.dev/schemas/commercial-status.schema.json", Resource.from_contents(commercial)),
        ("https://opentrust.dev/schemas/security.schema.json", Resource.from_contents(security)),
    ])
    return schema, registry


def validate(path: str) -> tuple[list[str], list[str]]:
    """Validate a passport file. Returns (schema_errors, high_risk_flags)."""
    schema, registry = _load_bundle()
    try:
        data = json.loads(Path(path).read_text())
    except json.JSONDecodeError as exc:
        return [f"Invalid JSON at line {exc.lineno}: {exc.msg}"], []

    validator = Draft202012Validator(schema, registry=registry)
    errors = [error.message for error in validator.iter_errors(data)]
    permissions = data.get("permission_manifest", {})
    flags = sorted(name for name in HIGH_RISK if permissions.get(name))
    return errors, flags
