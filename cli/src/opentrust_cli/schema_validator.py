import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource


DANGEROUS_PERMISSION_FLAGS = (
    "wallet",
    "private_data",
    "terminal",
    "filesystem_write",
    "file_write",
    "code_execution",
    "network_unrestricted",
)

_REQUIRES_GRANULAR_AT_REVIEWER_SIGNED = frozenset({
    "file", "network", "terminal", "wallet", "private_data"
})

_TRUST_LEVELS_REQUIRING_GRANULAR = frozenset({
    "reviewer_signed", "security_checked", "continuously_monitored"
})


def _json_path(error) -> str:
    if not error.absolute_path:
        return "$"
    return "$" + "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in error.absolute_path)


def _load_schema_bundle(root: Path) -> tuple[dict[str, Any], Registry]:
    schema = json.loads((root / "passport.schema.json").read_text())
    permissions = json.loads((root / "permissions.schema.json").read_text())
    commercial = json.loads((root / "commercial-status.schema.json").read_text())
    security = json.loads((root / "security.schema.json").read_text())
    registry = Registry().with_resources(
        [
            ("permissions.schema.json", Resource.from_contents(permissions)),
            ("commercial-status.schema.json", Resource.from_contents(commercial)),
            ("security.schema.json", Resource.from_contents(security)),
            ("https://opentrust.dev/schemas/permissions.schema.json", Resource.from_contents(permissions)),
            ("https://opentrust.dev/schemas/commercial-status.schema.json", Resource.from_contents(commercial)),
            ("https://opentrust.dev/schemas/security.schema.json", Resource.from_contents(security)),
        ]
    )
    return schema, registry


def _format_schema_error(error) -> str:
    path = _json_path(error)
    if error.validator == "required":
        missing = ", ".join(repr(item) for item in error.validator_value if item not in error.instance)
        return f"{path}: missing required field(s): {missing}"
    if error.validator == "additionalProperties":
        return f"{path}: {error.message}; remove unknown fields or update the schema/RFC"
    if error.validator == "enum":
        allowed = ", ".join(repr(item) for item in error.validator_value)
        return f"{path}: {error.instance!r} is not allowed; expected one of: {allowed}"
    if error.validator == "pattern":
        return f"{path}: {error.instance!r} does not match required pattern {error.validator_value!r}"
    return f"{path}: {error.message}"


def _semantic_errors(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    version_hash = data.get("version_hash") or {}
    if not version_hash.get("commit") and not version_hash.get("artifact_hash"):
        errors.append(
            "$.version_hash: production passports must include either 'commit' or 'artifact_hash'; "
            "a version string alone is not enough to bind trust to code"
        )

    trust_status = data.get("trust_status")

    permission_manifest = data.get("permission_manifest") or {}
    for key in DANGEROUS_PERMISSION_FLAGS:
        if permission_manifest.get(key) is True:
            errors.append(
                f"$.permission_manifest.{key}: dangerous permissions must be scoped, justified, "
                "and denied by default in local policy; do not ship a broad boolean true for production"
            )

    # v0.2 enforcement: reviewer_signed+ must use granular scopes for high-risk surfaces
    if trust_status in _TRUST_LEVELS_REQUIRING_GRANULAR:
        for key in _REQUIRES_GRANULAR_AT_REVIEWER_SIGNED:
            val = permission_manifest.get(key)
            if val is True:
                errors.append(
                    f"$.permission_manifest.{key}: trust_status '{trust_status}' requires granular "
                    f"scope object (v0.2) — boolean true is not allowed at this trust level. "
                    f"Replace with a structured scope: e.g. network: {{allowed_domains: [...], outbound_only: true}}"
                )

    if trust_status in {"reviewer_signed", "security_checked", "continuously_monitored"}:
        if not data.get("review_history"):
            errors.append(
                f"$.review_history: trust_status '{trust_status}' requires at least one reviewer/security attestation"
            )
        security = data.get("security") or {}
        registry_signature = security.get("registry_signature") if isinstance(security, dict) else None
        if not registry_signature:
            errors.append(
                f"$.security.registry_signature: trust_status '{trust_status}' requires a signed registry passport"
            )

    revocation = data.get("revocation") or {}
    if revocation.get("revoked") is True and not revocation.get("reason"):
        errors.append("$.revocation.reason: revoked passports must publish a machine-readable reason")

    commercial_status = data.get("commercial_status") or {}
    payment_config = commercial_status.get("payment_config") if isinstance(commercial_status, dict) else None
    if payment_config:
        wallet = payment_config.get("wallet_address") or payment_config.get("recipient")
        signed_invoice = payment_config.get("signed_invoice_required")
        if wallet and signed_invoice is False:
            errors.append(
                "$.commercial_status.payment_config: wallet payments must be bound to a signed passport or signed invoice"
            )

    return errors


def validate_passport_file(path: str) -> list[str]:
    root = Path(__file__).resolve().parents[3] / "passport-schema"
    schema, registry = _load_schema_bundle(root)
    try:
        data = json.loads(Path(path).read_text())
    except json.JSONDecodeError as exc:
        return [f"$: invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"]

    validator = Draft202012Validator(schema, registry=registry)
    schema_errors = sorted(validator.iter_errors(data), key=lambda error: list(error.absolute_path))
    return [_format_schema_error(error) for error in schema_errors] + _semantic_errors(data)
