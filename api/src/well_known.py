"""OpenTrust well-known registry data store.

This store is intentionally simple for the reference registry: it keeps one
online signing key in memory for tests/dev, publishes that key, signs registry
metadata, signs revocation lists with rollback-protected versions, and can sign
passport documents for offline verification.

Production hardening:
- Persistent key loading from environment variable or file path
- Persistent JSON state for revocations / version (survives restarts)
- Authenticated revocation via bearer token (admin token)
- Audit log for all revocation actions
"""

from __future__ import annotations

import copy
import json
import os
import time
from uuid import uuid4

import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .config import settings
from .crypto import generate_ed25519_keypair, public_key_to_b64, sign_data, sign_document


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _load_private_key_bytes() -> tuple[bytes, bytes, str]:
    """Load private key bytes from configured source.

    Priority: base64 env var > file path > generate fresh (dev).

    Returns
    -------
    tuple[bytes, bytes, str]
        (private_key_32_bytes, public_key_32_bytes, public_key_b64)
    """
    raw_priv: bytes | None = None

    if settings.registry_private_key_base64:
        raw_priv = base64.b64decode(settings.registry_private_key_base64)
    elif settings.registry_private_key_path:
        resolved_path = os.path.expanduser(settings.registry_private_key_path)
        with open(resolved_path, "r") as f:
            raw_priv = base64.b64decode(f.read().strip())

    if raw_priv is not None:
        if len(raw_priv) != 32:
            raise ValueError(
                f"Private key must be 32 bytes (got {len(raw_priv)}). "
                "Provide raw Ed25519 seed encoded as standard base64."
            )
        priv_key = Ed25519PrivateKey.from_private_bytes(raw_priv)
        pub_bytes = priv_key.public_key().public_bytes_raw()
        pub_b64 = public_key_to_b64(pub_bytes)
        return raw_priv, pub_bytes, pub_b64

    # Dev mode: generate fresh every boot.
    priv_bytes, pub_bytes = generate_ed25519_keypair()
    pub_b64 = public_key_to_b64(pub_bytes)
    return priv_bytes, pub_bytes, pub_b64


def _state_path() -> str | None:
    """Resolve state file path, or None if not configured."""
    raw = settings.registry_state_path
    if not raw:
        return None
    return os.path.expanduser(raw)


class WellKnownStore:
    """In-memory + optionally persistent store for registry signing metadata."""

    def __init__(self) -> None:
        # ── Load or generate signing key ──────────────────────────────────
        self._private_key, self.public_key_bytes, self.public_key_b64 = _load_private_key_bytes()
        self.key_id: str = f"opentrust-registry-{uuid4().hex[:8]}"

        # ── Registry metadata ────────────────────────────────────────────
        self.registries: list[dict] = [
            {
                "name": settings.registry_name,
                "url": settings.registry_url,
                "operator": settings.registry_operator,
                "type": "root",
                "key_id": self.key_id,
            }
        ]

        # ── Revocation / version / audit state ────────────────────────────
        self.revoked_passports: list[dict] = []
        self.revoked_operator_keys: list[dict] = []
        self.version: int = 1
        self.audit_log: list[dict] = []

        # ── Load persistent state if configured ───────────────────────────
        state_file = _state_path()
        if state_file and os.path.exists(state_file):
            self._load_state(state_file)

    # ──────────────────────────────────────────────────────────────────────
    # State persistence
    # ──────────────────────────────────────────────────────────────────────

    def _load_state(self, path: str) -> None:
        try:
            with open(path, "r") as f:
                data = json.load(f)
            self.version = data.get("version", 1)
            self.revoked_passports = data.get("revoked_passports", [])
            self.revoked_operator_keys = data.get("revoked_operator_keys", [])
            self.audit_log = data.get("audit_log", [])
        except (FileNotFoundError, json.JSONDecodeError):
            pass  # Start fresh

    def save_state(self) -> None:
        """Persist current revocation/version/audit state to disk."""
        state_file = _state_path()
        if not state_file:
            return
        os.makedirs(os.path.dirname(os.path.abspath(state_file)) or ".", exist_ok=True)
        data = {
            "version": self.version,
            "revoked_passports": self.revoked_passports,
            "revoked_operator_keys": self.revoked_operator_keys,
            "audit_log": self.audit_log,
        }
        with open(state_file, "w") as f:
            json.dump(data, f, indent=2)

    # ──────────────────────────────────────────────────────────────────────
    # Audit helpers
    # ──────────────────────────────────────────────────────────────────────

    def _audit(self, action: str, *, actor: str | None = None, **extra: str) -> None:
        self.audit_log.append({
            "action": action,
            "actor": actor or "anonymous",
            "timestamp": _now_iso(),
            **extra,
        })

    # ──────────────────────────────────────────────────────────────────────
    # Public-key / keyset payload
    # ──────────────────────────────────────────────────────────────────────

    def build_keys_payload(self) -> dict:
        """Return keyset with both JWK-style and OpenTrust-friendly aliases."""
        return {
            "keys": [
                {
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "kid": self.key_id,
                    "x": self.public_key_b64,
                    "key_id": self.key_id,
                    "public_key": self.public_key_b64,
                    "use": "registry-signing",
                    "status": "active",
                    "created_at": _now_iso(),
                }
            ]
        }

    def sign_keys(self) -> dict:
        return self.build_keys_payload()

    # ──────────────────────────────────────────────────────────────────────
    # Document / passport signing
    # ──────────────────────────────────────────────────────────────────────

    def sign_document(self, document: dict, *, signature_path: tuple[str, ...] = ("signature",)) -> dict:
        signature = sign_document(
            self._private_key,
            document,
            key_id=self.key_id,
            signature_path=signature_path,
        )
        signed = copy.deepcopy(document)
        current = signed
        for part in signature_path[:-1]:
            current = current.setdefault(part, {})
        current[signature_path[-1]] = signature
        return signed

    def sign_passport(self, passport: dict) -> dict:
        """Attach security.registry_signature to a passport."""
        signed = copy.deepcopy(passport)
        signed.setdefault("security", {})
        signed["security"].pop("registry_signature", None)
        return self.sign_document(signed, signature_path=("security", "registry_signature"))

    # ──────────────────────────────────────────────────────────────────────
    # Registries payload
    # ──────────────────────────────────────────────────────────────────────

    def build_registries_payload(self) -> dict:
        now = _now_iso()
        return {
            "registries": self.registries,
            "updated_at": now,
            "timestamp": now,
            "version": self.version,
        }

    def sign_registries(self) -> dict:
        payload = self.build_registries_payload()
        document = {**payload, "payload": payload, "signer": self.public_key_b64}
        return self.sign_document(document)

    # ──────────────────────────────────────────────────────────────────────
    # Revocation payload
    # ──────────────────────────────────────────────────────────────────────

    def build_revoked_payload(self) -> dict:
        now = _now_iso()
        return {
            "version": self.version,
            "updated_at": now,
            "timestamp": now,
            "passports": self.revoked_passports,
            "operator_keys": self.revoked_operator_keys,
            # Backward-compatible alias for early tests/clients.
            "revoked": self.revoked_passports,
        }

    def sign_revoked(self) -> dict:
        payload = self.build_revoked_payload()
        document = {**payload, "payload": payload, "signer": self.public_key_b64}
        return self.sign_document(document)

    def sign_payload(self, payload: dict) -> str:
        """Legacy helper: sign canonical JSON payload directly."""
        return sign_data(self._private_key, payload)

    # ──────────────────────────────────────────────────────────────────────
    # Revocation action
    # ──────────────────────────────────────────────────────────────────────

    def revoke_passport(self, passport_id: str, reason: str, *, actor: str | None = None) -> dict:
        self.version += 1
        entry = {
            "passport_id": passport_id,
            "slug": passport_id,
            "version": "*",
            "reason": reason,
            "revoked_at": _now_iso(),
        }
        self.revoked_passports.append(entry)

        # Audit trail
        self._audit("revoke_passport", actor=actor, passport_id=passport_id, reason=reason)

        # Persist after each mutation if state file is configured
        self.save_state()

        receipt = {
            "passport_id": passport_id,
            "reason": reason,
            "revoked_at": entry["revoked_at"],
            "version": self.version,
        }
        signed = self.sign_document(receipt)
        # Backward-compatible response shape for earlier demo tests.
        return {
            "payload": receipt,
            "signature": self.sign_payload(receipt),
            "signature_block": signed["signature"],
            "signer": self.public_key_b64,
        }


WELL_KNOWN_STORE = WellKnownStore()