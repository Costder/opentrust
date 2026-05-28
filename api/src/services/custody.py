"""Embedded wallet custody service.

Generates EVM wallets using eth_account and encrypts the private key with
AES-256-GCM using a key derived from (wallet_encryption_secret, owner_id)
via PBKDF2-HMAC-SHA256.

Security model:
- The private key is encrypted with a key derived from both the server secret
  and the owner ID. Both are required to decrypt.
- Losing wallet_encryption_secret means all embedded wallets become permanently
  inaccessible. Rotate with caution and always re-encrypt before discarding the
  old secret.
- The nonce is randomly generated per encryption (12 bytes, prepended to ciphertext).
- The owner ID is used as Additional Authenticated Data (AAD), so decryption with
  the wrong owner ID fails even if the key matches.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from eth_account import Account


def generate_wallet() -> dict[str, str]:
    """Generate a fresh EVM wallet.

    Returns a dict with 'address' (EIP-55 checksummed) and 'private_key' (0x-prefixed hex).
    """
    account = Account.create()
    return {
        "address": account.address,
        "private_key": "0x" + account.key.hex(),
    }


def _derive_key(secret: str, owner: str) -> bytes:
    """Derive a 32-byte AES key from (secret, owner) using PBKDF2-HMAC-SHA256.

    The owner is used as the salt so that the same secret produces different keys
    for different owners — a wrong owner cannot decrypt even if they know the secret.
    """
    return hashlib.pbkdf2_hmac(
        "sha256",
        secret.encode(),
        owner.encode(),
        iterations=100_000,
        dklen=32,
    )


def encrypt_private_key(private_key: str, secret: str, owner: str) -> str:
    """Encrypt a private key for a specific owner.

    Args:
        private_key: 0x-prefixed hex private key string.
        secret: Server-side encryption secret (WALLET_ENCRYPTION_SECRET).
        owner: Owner identifier (e.g. user ID or JWT subject). Used as AAD.

    Returns:
        Base64url-encoded string: nonce (12 bytes) || ciphertext+tag.
    """
    key = _derive_key(secret, owner)
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, private_key.encode(), owner.encode())  # owner as AAD
    return base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_private_key(encrypted: str, secret: str, owner: str) -> str:
    """Decrypt a private key encrypted with encrypt_private_key.

    Args:
        encrypted: Base64url-encoded ciphertext from encrypt_private_key.
        secret: Server-side encryption secret.
        owner: Owner identifier — must match the one used during encryption.

    Raises:
        ValueError: If the secret or owner is wrong (AESGCM tag verification fails).

    Returns:
        The original 0x-prefixed hex private key string.
    """
    key = _derive_key(secret, owner)
    data = base64.urlsafe_b64decode(encrypted)
    nonce, ct = data[:12], data[12:]
    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(nonce, ct, owner.encode())
    except Exception as exc:
        raise ValueError("decryption failed — wrong secret or owner") from exc
    return plaintext.decode()
