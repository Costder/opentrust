import json
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

HIGH_RISK = {"terminal", "wallet", "private_data", "camera", "microphone"}

_SCORE_THRESHOLDS = [
    (4, "critical"),
    (3, "high"),
    (2, "medium"),
    (0, "low"),
]


def compute_risk_score(permissions: dict) -> tuple[str, list[str]]:
    """Return (risk_level, warnings) for a permission_manifest dict."""
    warnings: list[str] = []
    score = 0

    file_perm = permissions.get("file", False)
    if isinstance(file_perm, dict):
        if file_perm.get("write") and not file_perm.get("forbidden_paths"):
            warnings.append(
                "file.write is set with no forbidden_paths — unscoped write access to filesystem"
            )
            score += 3
        elif file_perm.get("write"):
            # write present but forbidden_paths provided — lower risk
            score += 2
        if file_perm.get("read"):
            score += 1
    elif file_perm is True:
        warnings.append("file: true grants unrestricted file access — migrate to v0.2 granular scopes")
        score += 2

    network_perm = permissions.get("network", False)
    if isinstance(network_perm, dict):
        if not network_perm.get("allowed_domains") and not network_perm.get("egress_only"):
            warnings.append(
                "network has no allowed_domains restriction — tool can reach any host"
            )
            score += 2
        else:
            score += 1
    elif network_perm is True:
        warnings.append("network: true grants unrestricted network access — migrate to v0.2 granular scopes")
        score += 2

    terminal_perm = permissions.get("terminal", False)
    if isinstance(terminal_perm, dict):
        if terminal_perm.get("shell_access"):
            warnings.append("terminal.shell_access: true grants arbitrary shell execution")
            score += 4
        elif terminal_perm.get("allowed_commands"):
            score += 2
    elif terminal_perm is True:
        warnings.append("terminal: true grants unrestricted terminal access — migrate to v0.2 granular scopes")
        score += 3

    wallet_perm = permissions.get("wallet", False)
    if isinstance(wallet_perm, dict):
        if wallet_perm.get("send"):
            warnings.append("wallet.send: true — this tool can transfer funds autonomously")
            score += 4
        if wallet_perm.get("sign_transactions"):
            warnings.append("wallet.sign_transactions: true — this tool can sign on-chain transactions")
            score += 3
    elif wallet_perm is True:
        warnings.append("wallet: true grants unrestricted wallet access including fund transfers")
        score += 4

    if permissions.get("private_data"):
        score += 2
    if permissions.get("camera") or permissions.get("microphone"):
        score += 2

    for threshold, level in _SCORE_THRESHOLDS:
        if score >= threshold:
            return level, warnings
    return "low", warnings


def _strip_comments(obj):
    """Recursively remove $comment keys — JSON Schema annotations, not instance data."""
    if isinstance(obj, dict):
        return {k: _strip_comments(v) for k, v in obj.items() if k != "$comment"}
    if isinstance(obj, list):
        return [_strip_comments(v) for v in obj]
    return obj


def _load_registry(schema_dir: Path) -> Registry:
    """Load all sub-schemas from the passport-schema directory into a Registry.

    Reads each schema's $id field and registers it. Also registers each schema
    under the base URI path (without /v0.2/ if present) to handle relative $refs
    from passport.schema.json that don't include version segments.
    """
    sub_schemas = [
        "permissions.schema.json",
        "commercial-status.schema.json",
        "security.schema.json",
        "escrow.schema.json",
        "agent-identity.schema.json",
        "spend-policy.schema.json",
    ]
    resources = []
    for name in sub_schemas:
        path = schema_dir / name
        if path.exists():
            content = json.loads(path.read_text())
            # Register under the $id from the schema file
            schema_id = content.get("$id", f"https://opentrust.dev/schemas/{name}")
            resources.append((schema_id, Resource.from_contents(content)))
            # Also register under the base URI path (without version) to handle
            # relative $refs from passport.schema.json (e.g., permissions.schema.json
            # resolves to https://opentrust.dev/schemas/permissions.schema.json)
            base_uri = f"https://opentrust.dev/schemas/{name}"
            if base_uri != schema_id:
                resources.append((base_uri, Resource.from_contents(content)))
    return Registry().with_resources(resources)


def validate(path: str) -> tuple[list[str], list[str], str, list[str]]:
    """Validate a passport file.

    Returns:
        errors: JSON Schema validation errors
        flags: high-risk permission names present
        risk: "low" | "medium" | "high" | "critical"
        warnings: human-readable risk pattern descriptions
    """
    root = Path(__file__).resolve().parents[2]
    schema_dir = root / "passport-schema"

    schema = json.loads((schema_dir / "passport.schema.json").read_text())

    # Strip $comment keys — they are JSON Schema annotations not recognised by
    # validators that enforce additionalProperties: false on the passport schema.
    data = _strip_comments(json.loads(Path(path).read_text()))

    # Load all sub-schemas into the registry using their $id values
    registry = _load_registry(schema_dir)
    errors = [e.message for e in Draft202012Validator(schema, registry=registry).iter_errors(data)]

    permissions = data.get("permission_manifest", {})
    flags = sorted(name for name in HIGH_RISK if permissions.get(name))
    risk, warnings = compute_risk_score(permissions)

    return errors, flags, risk, warnings
