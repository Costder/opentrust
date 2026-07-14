"""Canonical OpenTrust passport validation engine.

Every Python caller should use :func:`validate_passport` or
:func:`validate_passport_file`.  Both functions return the same structured
``ValidationResult`` so callers can render diagnostics for people or pass
them to another machine without parsing text.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Any, Literal
import warnings

from jsonschema import Draft202012Validator
from referencing import Registry, Resource


HIGH_RISK = frozenset({"terminal", "wallet", "private_data", "camera", "microphone"})
_EVIDENCE_REQUIRED = frozenset({"security_checked", "continuously_monitored"})
_SCORE_THRESHOLDS = ((4, "critical"), (3, "high"), (2, "medium"), (0, "low"))
_SCHEMA_FILENAMES = (
    "agent-identity.schema.json",
    "commercial-status.schema.json",
    "error-response.schema.json",
    "escrow.schema.json",
    "passport.schema.json",
    "permissions.schema.json",
    "registry-trust.schema.json",
    "security.schema.json",
    "signed-revocation-list.schema.json",
    "spend-policy.schema.json",
)


@dataclass(frozen=True)
class ValidationDiagnostic:
    """A stable, machine-readable validation diagnostic."""

    code: str
    path: str
    message: str
    severity: Literal["error", "warning"]


@dataclass(frozen=True)
class RiskAssessment:
    level: Literal["low", "medium", "high", "critical"]
    flags: tuple[str, ...]


@dataclass(frozen=True)
class ValidationResult:
    """The canonical result returned by every OpenTrust Python validator."""

    errors: tuple[ValidationDiagnostic, ...]
    warnings: tuple[ValidationDiagnostic, ...]
    risk: RiskAssessment

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": [asdict(diagnostic) for diagnostic in self.errors],
            "warnings": [asdict(diagnostic) for diagnostic in self.warnings],
            "risk": {"level": self.risk.level, "flags": list(self.risk.flags)},
        }


def _json_pointer(parts: Any) -> str:
    tokens = [str(part).replace("~", "~0").replace("/", "~1") for part in parts]
    return "/" + "/".join(tokens) if tokens else "/"


def _strip_comments(value: Any) -> Any:
    """Remove human-facing annotations accidentally included in passport data."""
    if isinstance(value, dict):
        return {
            key: _strip_comments(item)
            for key, item in value.items()
            if key not in {"$comment", "_comment"}
        }
    if isinstance(value, list):
        return [_strip_comments(item) for item in value]
    return value


def _development_schema_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "passport-schema"


def _load_schema_documents() -> dict[str, dict[str, Any]]:
    """Load bundled package data, with a repository fallback for editable work."""
    bundled = resources.files("manifest_validator").joinpath("schemas")
    if bundled.is_dir() and all(bundled.joinpath(name).is_file() for name in _SCHEMA_FILENAMES):
        return {
            name: json.loads(bundled.joinpath(name).read_text(encoding="utf-8"))
            for name in _SCHEMA_FILENAMES
        }

    schema_dir = _development_schema_dir()
    if schema_dir.is_dir() and all((schema_dir / name).is_file() for name in _SCHEMA_FILENAMES):
        return {
            name: json.loads((schema_dir / name).read_text(encoding="utf-8"))
            for name in _SCHEMA_FILENAMES
        }
    raise RuntimeError("OpenTrust schema resources are not installed with manifest-validator")


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    documents = _load_schema_documents()
    schema = documents["passport.schema.json"]
    resources = []
    for name, content in documents.items():
        if name == "passport.schema.json":
            continue
        resource = Resource.from_contents(content)
        schema_id = content.get("$id", f"https://opentrust.dev/schemas/{name}")
        resources.append((schema_id, resource))
        base_uri = f"https://opentrust.dev/schemas/{name}"
        if base_uri != schema_id:
            resources.append((base_uri, resource))
    return Draft202012Validator(schema, registry=Registry().with_resources(resources))


def _risk_assessment(permissions: dict[str, Any]) -> tuple[RiskAssessment, list[ValidationDiagnostic]]:
    warnings: list[ValidationDiagnostic] = []
    score = 0

    file_permission = permissions.get("file", False)
    if isinstance(file_permission, dict):
        if file_permission.get("write") and not file_permission.get("forbidden_paths"):
            warnings.append(ValidationDiagnostic("risk.unscoped_file_write", "/permission_manifest/file", "file.write is set with no forbidden_paths; write access is unscoped", "warning"))
            score += 3
        elif file_permission.get("write"):
            score += 2
        if file_permission.get("read"):
            score += 1
    elif file_permission is True:
        warnings.append(ValidationDiagnostic("risk.unrestricted_file_access", "/permission_manifest/file", "file: true grants unrestricted file access", "warning"))
        score += 2

    network_permission = permissions.get("network", False)
    if isinstance(network_permission, dict):
        if not network_permission.get("allowed_domains") and not network_permission.get("egress_only"):
            warnings.append(ValidationDiagnostic("risk.unrestricted_network", "/permission_manifest/network", "network has no allowed_domains restriction", "warning"))
            score += 2
        else:
            score += 1
    elif network_permission is True:
        warnings.append(ValidationDiagnostic("risk.unrestricted_network", "/permission_manifest/network", "network: true grants unrestricted network access", "warning"))
        score += 2

    terminal_permission = permissions.get("terminal", False)
    if isinstance(terminal_permission, dict):
        if terminal_permission.get("shell_access"):
            warnings.append(ValidationDiagnostic("risk.shell_access", "/permission_manifest/terminal", "terminal.shell_access grants arbitrary shell execution", "warning"))
            score += 4
        elif terminal_permission.get("allowed_commands"):
            score += 2
    elif terminal_permission is True:
        warnings.append(ValidationDiagnostic("risk.unrestricted_terminal", "/permission_manifest/terminal", "terminal: true grants unrestricted terminal access", "warning"))
        score += 3

    wallet_permission = permissions.get("wallet", False)
    if isinstance(wallet_permission, dict):
        if wallet_permission.get("send"):
            warnings.append(ValidationDiagnostic("risk.wallet_send", "/permission_manifest/wallet/send", "wallet.send allows autonomous fund transfers", "warning"))
            score += 4
        if wallet_permission.get("sign_transactions"):
            warnings.append(ValidationDiagnostic("risk.wallet_sign_transactions", "/permission_manifest/wallet/sign_transactions", "wallet.sign_transactions allows on-chain transaction signing", "warning"))
            score += 3
    elif wallet_permission is True:
        warnings.append(ValidationDiagnostic("risk.unrestricted_wallet", "/permission_manifest/wallet", "wallet: true grants unrestricted wallet access including transfers", "warning"))
        score += 4

    if permissions.get("private_data"):
        score += 2
    if permissions.get("camera") or permissions.get("microphone"):
        score += 2

    level = next(level for threshold, level in _SCORE_THRESHOLDS if score >= threshold)
    flags = tuple(sorted(name for name in HIGH_RISK if permissions.get(name)))
    return RiskAssessment(level=level, flags=flags), warnings


def _evidence_diagnostics(passport: dict[str, Any]) -> list[ValidationDiagnostic]:
    diagnostics: list[ValidationDiagnostic] = []
    review_history = passport.get("review_history", [])
    if not isinstance(review_history, list):
        return diagnostics

    statuses_to_check = set(_EVIDENCE_REQUIRED)
    top_level_status = passport.get("trust_status")
    if top_level_status in _EVIDENCE_REQUIRED and not any(entry.get("status") == top_level_status for entry in review_history if isinstance(entry, dict)):
        diagnostics.append(ValidationDiagnostic("evidence.missing_trust_review", "/review_history", f"trust_status '{top_level_status}' requires a matching review_history entry with security evidence", "error"))

    for index, entry in enumerate(review_history):
        if not isinstance(entry, dict) or entry.get("status") not in statuses_to_check:
            continue
        status = entry["status"]
        path = f"/review_history/{index}/security_evidence"
        evidence = entry.get("security_evidence")
        if not isinstance(evidence, dict):
            diagnostics.append(ValidationDiagnostic("evidence.missing_security_evidence", path, f"review_history[{index}] at '{status}' requires security_evidence", "error"))
            continue
        if not evidence.get("scanner_outputs"):
            diagnostics.append(ValidationDiagnostic("evidence.missing_scanner_outputs", f"{path}/scanner_outputs", f"review_history[{index}] at '{status}' requires at least one scanner output", "error"))
        if not evidence.get("dependency_snapshot"):
            diagnostics.append(ValidationDiagnostic("evidence.missing_dependency_snapshot", f"{path}/dependency_snapshot", f"review_history[{index}] at '{status}' requires a dependency snapshot", "error"))
        if status == "continuously_monitored" and not evidence.get("monitoring_config"):
            diagnostics.append(ValidationDiagnostic("evidence.missing_monitoring_config", f"{path}/monitoring_config", "continuously_monitored requires monitoring_config", "error"))
    return diagnostics


def validate_passport(passport: Any, *, check_evidence: bool = False) -> ValidationResult:
    """Validate an in-memory passport through the canonical protocol engine."""
    errors: list[ValidationDiagnostic] = []
    warnings: list[ValidationDiagnostic] = []
    clean_passport = _strip_comments(passport)

    for error in sorted(_validator().iter_errors(clean_passport), key=lambda item: (_json_pointer(item.absolute_path), item.message)):
        errors.append(ValidationDiagnostic(f"schema.{error.validator or 'validation'}", _json_pointer(error.absolute_path), error.message, "error"))

    permissions = clean_passport.get("permission_manifest", {}) if isinstance(clean_passport, dict) else {}
    risk, risk_warnings = _risk_assessment(permissions if isinstance(permissions, dict) else {})
    warnings.extend(risk_warnings)
    if check_evidence and isinstance(clean_passport, dict):
        errors.extend(_evidence_diagnostics(clean_passport))

    errors.sort(key=lambda diagnostic: (diagnostic.path, diagnostic.code, diagnostic.message))
    warnings.sort(key=lambda diagnostic: (diagnostic.path, diagnostic.code, diagnostic.message))
    return ValidationResult(tuple(errors), tuple(warnings), risk)


def validate_passport_file(path: str | Path, *, check_evidence: bool = False) -> ValidationResult:
    """Load and validate a JSON passport file through the canonical engine."""
    passport_path = Path(path)
    try:
        passport = json.loads(passport_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ValidationResult((ValidationDiagnostic("input.file_not_found", "/", f"Passport file not found: {passport_path}", "error"),), (), RiskAssessment("low", ()))
    except json.JSONDecodeError as error:
        return ValidationResult((ValidationDiagnostic("input.invalid_json", "/", f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}", "error"),), (), RiskAssessment("low", ()))
    return validate_passport(passport, check_evidence=check_evidence)


def validate(path: str | Path) -> ValidationResult:
    """Deprecated generic entry point returning the canonical structured result."""
    warnings.warn(
        "validate() now returns ValidationResult; use validate_passport_file() for new code.",
        DeprecationWarning,
        stacklevel=2,
    )
    return validate_passport_file(path)


def validate_legacy_tuple(path: str | Path) -> tuple[list[str], list[str], str, list[str]]:
    """Deprecated adapter for pre-0.3 callers expecting the packaged four-item tuple."""
    warnings.warn(
        "validate_legacy_tuple() is deprecated; migrate to validate_passport_file().",
        DeprecationWarning,
        stacklevel=2,
    )
    result = validate_passport_file(path)
    return (
        [diagnostic.message for diagnostic in result.errors],
        list(result.risk.flags),
        result.risk.level,
        [diagnostic.message for diagnostic in result.warnings],
    )


def validate_evidence(passport: dict[str, Any]) -> list[str]:
    """Deprecated compatibility adapter for the legacy evidence-only result."""
    warnings.warn(
        "validate_evidence() is deprecated; use validate_passport(..., check_evidence=True).",
        DeprecationWarning,
        stacklevel=2,
    )
    result = validate_passport(passport, check_evidence=True)
    return [
        diagnostic.message
        for diagnostic in result.errors
        if diagnostic.code.startswith("evidence.")
    ]


def compute_risk_score(permissions: dict[str, Any]) -> tuple[str, list[str]]:
    """Compatibility helper for callers that only need the legacy risk summary."""
    risk, warnings = _risk_assessment(permissions)
    return risk.level, [warning.message for warning in warnings]
