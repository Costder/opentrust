"""Ed25519 signing helpers for OpenTrust registry signing.

Provides deterministic JSON canonicalization and Ed25519 sign/verify using
the ``cryptography`` library.
"""

import base64
import copy
import hashlib
import json
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def generate_ed25519_keypair() -> tuple[bytes, bytes]:
    """Generate a fresh Ed25519 keypair.

    Returns
    -------
    tuple[bytes, bytes]
        (private_key_bytes, public_key_bytes).  The private key is the 32-byte
        seed used by Ed25519PrivateKey.from_private_bytes().  The public key is
        the 32-byte raw public key.
    """
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    # Export private key as raw 32-byte seed
    private_bytes = private_key.private_bytes_raw()
    public_bytes = public_key.public_bytes_raw()
    return private_bytes, public_bytes


def _canonical_json(data: dict) -> bytes:
    """Serialize *data* to a canonical JSON string (sorted keys, no whitespace)."""
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sign_data(private_key_bytes: bytes, data: dict) -> str:
    """Sign a dictionary with an Ed25519 private key.

    The dict is first canonicalised (sorted keys, compact JSON), then signed.
    The signature is returned as a base64-encoded string.

    Parameters
    ----------
    private_key_bytes : bytes
        32-byte Ed25519 seed.
    data : dict
        Arbitrary JSON-serialisable dictionary.

    Returns
    -------
    str
        Base64-encoded signature.
    """
    key = Ed25519PrivateKey.from_private_bytes(private_key_bytes)
    payload = _canonical_json(data)
    signature = key.sign(payload)
    return base64.b64encode(signature).decode("ascii")


def verify_signature(public_key_bytes: bytes, data: dict, signature_b64: str) -> bool:
    """Verify an Ed25519 signature against a dictionary.

    Parameters
    ----------
    public_key_bytes : bytes
        32-byte Ed25519 public key.
    data : dict
        The original dict that was signed.
    signature_b64 : str
        Base64-encoded signature to verify.

    Returns
    -------
    bool
        True if signature is valid, False otherwise.
    """
    try:
        key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
        payload = _canonical_json(data)
        signature = base64.b64decode(signature_b64)
        key.verify(signature, payload)
        return True
    except Exception:
        return False


def public_key_to_b64(public_key_bytes: bytes) -> str:
    """Encode a raw Ed25519 public key as a URL-safe base64 string without padding."""
    return base64.urlsafe_b64encode(public_key_bytes).decode("ascii").rstrip("=")


def public_key_from_b64(b64: str) -> bytes:
    """Decode a URL-safe base64 public key back to raw bytes."""
    # Re-pad for standard base64url
    padding = 4 - len(b64) % 4
    if padding != 4:
        b64 += "=" * padding
    return base64.urlsafe_b64decode(b64)


def canonical_json_text(data: dict[str, Any]) -> str:
    """Return canonical JSON text for signing and hashing."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def sha256_payload_hash(data: dict[str, Any]) -> str:
    """Return OpenTrust payload hash for canonical JSON."""
    return "sha256:" + hashlib.sha256(canonical_json_text(data).encode("utf-8")).hexdigest()


def _remove_path(data: dict[str, Any], path: tuple[str, ...]) -> dict[str, Any]:
    copied = copy.deepcopy(data)
    current: Any = copied
    for part in path[:-1]:
        if not isinstance(current, dict):
            return copied
        current = current.get(part, {})
    if isinstance(current, dict):
        current.pop(path[-1], None)
    return copied


def sign_document(
    private_key_bytes: bytes,
    document: dict[str, Any],
    *,
    key_id: str,
    signature_path: tuple[str, ...] = ("signature",),
) -> dict[str, str]:
    """Create an OpenTrust signature block for a document.

    The payload hash is calculated after removing the target signature field.
    The Ed25519 signature signs the payload hash string, not raw JSON, matching
    the protocol docs and making verification cheap and explicit.
    """
    unsigned = _remove_path(document, signature_path)
    payload_hash = sha256_payload_hash(unsigned)
    private_key = Ed25519PrivateKey.from_private_bytes(private_key_bytes)
    value = base64.urlsafe_b64encode(private_key.sign(payload_hash.encode("utf-8"))).decode("ascii").rstrip("=")
    return {
        "algorithm": "ed25519",
        "key_id": key_id,
        "payload_hash": payload_hash,
        "value": value,
    }


def verify_signed_document(
    document: dict[str, Any],
    public_key_bytes: bytes,
    *,
    signature_path: tuple[str, ...] = ("signature",),
) -> bool:
    """Verify an OpenTrust signature block embedded in a document."""
    current: Any = document
    for part in signature_path:
        if not isinstance(current, dict) or part not in current:
            return False
        current = current[part]
    signature = current
    if not isinstance(signature, dict) or signature.get("algorithm") != "ed25519":
        return False

    unsigned = _remove_path(document, signature_path)
    payload_hash = sha256_payload_hash(unsigned)
    if payload_hash != signature.get("payload_hash"):
        return False

    value = signature.get("value") or signature.get("signature")
    if not value:
        return False
    try:
        padded = value + "=" * (-len(value) % 4)
        public_key = Ed25519PublicKey.from_public_bytes(public_key_bytes)
        public_key.verify(base64.urlsafe_b64decode(padded), payload_hash.encode("utf-8"))
        return True
    except (ValueError, InvalidSignature):
        return False