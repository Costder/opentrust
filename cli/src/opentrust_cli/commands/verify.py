import base64
import hashlib
import json
from pathlib import Path
from typing import Any

import typer
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from ecdsa import Ed25519, VerifyingKey
from ecdsa.keys import BadSignatureError

from opentrust_cli.formatters import console

app = typer.Typer()


VALID_TRUST_STATUSES = frozenset({
    "auto_generated_draft", "creator_claimed", "owner_confirmed",
    "community_reviewed", "reviewer_signed", "security_checked",
    "continuously_monitored", "disputed",
})


def _canonical_json(data: dict) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def _sha256_hex(canonical: str) -> str:
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def _without_path(data: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    copied = json.loads(json.dumps(data))
    current: Any = copied
    for part in path[:-1]:
        if not isinstance(current, dict):
            return copied
        current = current.get(part, {})
    if isinstance(current, dict):
        current.pop(path[-1], None)
    return copied


def _load_json(path_str: str) -> dict:
    path = Path(path_str)
    if not path.exists():
        raise typer.BadParameter(f"File not found: {path_str}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise typer.BadParameter(
            f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        )


def _find_key(keys_data: dict, key_id: str) -> dict | None:
    for key in keys_data.get("keys", []):
        if key.get("key_id") == key_id or key.get("kid") == key_id:
            return key
    return None


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _key_public_value(key_record: dict) -> str:
    return key_record.get("public_key") or key_record.get("x") or ""


def _signature_value(sig: dict) -> str:
    return sig.get("value") or sig.get("signature") or ""


def _verify_ed25519_digest(public_key_b64: str, signature_b64: str, digest: bytes) -> bool:
    """Verify legacy OpenTrust tests: ecdsa package signs raw sha256 digest bytes."""
    try:
        vk = VerifyingKey.from_string(_b64decode(public_key_b64), curve=Ed25519)
        vk.verify(_b64decode(signature_b64), digest)
        return True
    except (BadSignatureError, ValueError, Exception):
        return False


def _verify_ed25519_message(public_key_b64: str, signature_b64: str, message: bytes) -> bool:
    """Verify production OpenTrust signatures: cryptography signs payload_hash text."""
    try:
        public_key = Ed25519PublicKey.from_public_bytes(_b64decode(public_key_b64))
        public_key.verify(_b64decode(signature_b64), message)
        return True
    except (InvalidSignature, ValueError, Exception):
        return False


def _verify_signature_block(document: dict, signature_path: tuple[str, ...], keys_data: dict) -> list[str]:
    errors: list[str] = []
    current: Any = document
    for part in signature_path:
        if not isinstance(current, dict) or part not in current:
            return [f"MISSING SIGNATURE: {'.'.join(signature_path)}"]
        current = current[part]
    sig = current
    if not isinstance(sig, dict):
        return [f"INVALID SIGNATURE BLOCK: {'.'.join(signature_path)}"]

    candidates = [_without_path(document, signature_path)]
    # Older passport signatures removed the whole top-level security object
    # before hashing. Production signatures remove only security.registry_signature.
    if signature_path == ("security", "registry_signature"):
        candidates.append(_without_path(document, ("security",)))

    expected_hash = sig.get("payload_hash", "")
    matched_hash = ""
    for unsigned in candidates:
        candidate_hash = _sha256_hex(_canonical_json(unsigned))
        if candidate_hash == expected_hash:
            matched_hash = candidate_hash
            break
    if not matched_hash:
        computed = _sha256_hex(_canonical_json(candidates[0]))
        errors.append(
            f"PAYLOAD HASH MISMATCH: expected '{expected_hash}', computed '{computed}'"
        )
        matched_hash = computed

    key_id = sig.get("key_id") or sig.get("kid") or ""
    key_record = _find_key(keys_data, key_id)
    if not key_record:
        errors.append(f"KEY NOT FOUND: no key with key_id '{key_id}' in keys file")
        return errors

    public_key_b64 = _key_public_value(key_record)
    signature_b64 = _signature_value(sig)
    if not signature_b64:
        errors.append("MISSING SIGNATURE VALUE")
        return errors

    digest = bytes.fromhex(matched_hash[len("sha256:"):])
    valid = _verify_ed25519_message(public_key_b64, signature_b64, matched_hash.encode("utf-8"))
    valid = valid or _verify_ed25519_digest(public_key_b64, signature_b64, digest)
    if not valid:
        errors.append(f"INVALID SIGNATURE: Ed25519 signature verification failed (key_id: {key_id})")
    return errors


class RevocationVersionStore:
    """Tiny local JSON store for revocation monotonic-version rollback checks."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path or Path.home() / ".opentrust" / "revocation_versions.json")

    def load(self) -> dict[str, int]:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text())
        except json.JSONDecodeError:
            return {}

    def save(self, versions: dict[str, int]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(versions, sort_keys=True, indent=2))


def _check_revocation_rollback(registry_id: str, revocations_data: dict, store: RevocationVersionStore) -> None:
    version = int(revocations_data.get("version", (revocations_data.get("payload") or {}).get("version", 0)))
    versions = store.load()
    previous = versions.get(registry_id)
    if previous is not None and version < previous:
        raise ValueError(f"revocation rollback detected: version {version} < previous {previous}")
    versions[registry_id] = max(version, previous or 0)
    store.save(versions)


def _revocation_entries(revocations_data: dict) -> list[dict]:
    if "passports" in revocations_data:
        return revocations_data.get("passports") or []
    payload = revocations_data.get("payload") or {}
    return payload.get("passports") or payload.get("revoked") or []


@app.callback(invoke_without_command=True)
def verify(
    passport_path: str = typer.Argument(..., help="Path to passport JSON file"),
    keys: str = typer.Option(..., "--keys", help="Path to registry keys JSON file"),
    revocations: str | None = typer.Option(
        None, "--revocations", help="Path to signed revocation list JSON file"
    ),
):
    """Offline verify a passport's registry signature and revocation status."""
    errors: list[str] = []
    passport = _load_json(passport_path)
    keys_data = _load_json(keys)
    revocations_data = _load_json(revocations) if revocations else None

    revocation = passport.get("revocation") or {}
    if revocation.get("revoked") is True:
        errors.append(f"INLINE REVOKED: passport is revoked (reason: {revocation.get('reason', 'unspecified')})")

    trust_status = passport.get("trust_status", "")
    if trust_status == "disputed":
        errors.append("DISPUTED: passport trust_status is 'disputed'")

    errors.extend(_verify_signature_block(passport, ("security", "registry_signature"), keys_data))

    if revocations_data:
        try:
            _check_revocation_rollback("default", revocations_data, RevocationVersionStore())
        except ValueError as exc:
            errors.append(f"REVOCATION ROLLBACK: {exc}")

        errors.extend(_verify_signature_block(revocations_data, ("signature",), keys_data))
        slug = (passport.get("tool_identity") or {}).get("slug", "")
        version = (passport.get("version_hash") or {}).get("version", "")
        for entry in _revocation_entries(revocations_data):
            entry_slug = entry.get("slug") or entry.get("passport_id") or ""
            entry_version = entry.get("version", "*")
            if entry_slug == slug and (entry_version == version or entry_version == "*"):
                errors.append(
                    f"REVOKED: passport '{slug}:{version}' is in the revocation list "
                    f"(reason: {entry.get('reason', 'unspecified')})"
                )
                break

    _report_results(passport_path, errors)


def _report_results(passport_path: str, errors: list[str]):
    if errors:
        for err in errors:
            console.print(f"[red]FAIL:[/] {err}")
        raise typer.Exit(1)
    console.print(f"[green]VERIFIED:[/] {passport_path} — registry signature valid, no revocations found")
