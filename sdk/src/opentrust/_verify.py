"""Ed25519 passport signature verification.

Mirrors the registry signing scheme (api.src.crypto.sign_document): the Ed25519
signature is computed over the *payload hash string*
``"sha256:" + sha256(canonical_json(passport_without_signature))`` and the
signature value is URL-safe base64 without padding.
"""
from __future__ import annotations

import base64
import hashlib
import json
from typing import Any


def _canonical_json(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def _payload_hash(data: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(_canonical_json(data).encode("utf-8")).hexdigest()


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_passport_signature(passport: dict[str, Any], public_key_b64: str) -> bool:
    """Return True iff the passport carries a valid Ed25519 signature block that
    matches its content and verifies against ``public_key_b64`` (URL-safe base64,
    padding optional)."""
    signature = passport.get("signature")
    if not isinstance(signature, dict) or signature.get("algorithm") != "ed25519":
        return False
    unsigned = {k: v for k, v in passport.items() if k != "signature"}
    payload_hash = _payload_hash(unsigned)
    if payload_hash != signature.get("payload_hash"):
        return False
    value = signature.get("value")
    if not value:
        return False
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        public_key = Ed25519PublicKey.from_public_bytes(_b64url_decode(public_key_b64))
        public_key.verify(_b64url_decode(value), payload_hash.encode("utf-8"))
        return True
    except (InvalidSignature, ValueError, Exception):
        return False


def extract_registry_key(keys_doc: dict[str, Any]) -> str | None:
    """Pull the active Ed25519 public key (base64url) from an opentrust-keys.json doc."""
    keys = keys_doc.get("keys") or []
    for key in keys:
        if key.get("crv") == "Ed25519" and key.get("status", "active") != "revoked":
            return key.get("x") or key.get("public_key")
    return None
