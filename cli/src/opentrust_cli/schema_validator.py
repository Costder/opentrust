import json
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource


def validate_passport_file(path: str) -> list[str]:
    root = Path(__file__).resolve().parents[3] / "passport-schema"
    with (root / "passport.schema.json").open() as f:
        schema = json.load(f)
    permissions = json.loads((root / "permissions.schema.json").read_text())
    commercial = json.loads((root / "commercial-status.schema.json").read_text())
    with Path(path).open() as f:
        data = json.load(f)
    registry = Registry().with_resources(
        [
            ("permissions.schema.json", Resource.from_contents(permissions)),
            ("commercial-status.schema.json", Resource.from_contents(commercial)),
        ]
    )
    validator = Draft202012Validator(schema, registry=registry)
    return [error.message for error in validator.iter_errors(data)]
