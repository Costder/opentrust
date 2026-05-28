"""Tests for embedded wallet custody service."""

import pytest
from api.src.services.custody import generate_wallet, encrypt_private_key, decrypt_private_key


class TestGenerateWallet:
    def test_generates_valid_evm_address(self):
        wallet = generate_wallet()
        assert wallet["address"].startswith("0x")
        assert len(wallet["address"]) == 42

    def test_two_wallets_are_different(self):
        w1 = generate_wallet()
        w2 = generate_wallet()
        assert w1["address"] != w2["address"]
        assert w1["private_key"] != w2["private_key"]

    def test_wallet_has_required_fields(self):
        wallet = generate_wallet()
        assert "address" in wallet
        assert "private_key" in wallet


class TestEncryptDecrypt:
    def test_roundtrip(self):
        private_key = "0x" + "a" * 64
        secret = "test-secret-key-32-chars-xxxxxxxxx"
        owner = "user-123"
        encrypted = encrypt_private_key(private_key, secret, owner)
        assert encrypted != private_key  # must not be plaintext
        decrypted = decrypt_private_key(encrypted, secret, owner)
        assert decrypted == private_key

    def test_wrong_owner_cannot_decrypt(self):
        private_key = "0x" + "a" * 64
        secret = "test-secret-key-32-chars-xxxxxxxxx"
        encrypted = encrypt_private_key(private_key, secret, "user-123")
        with pytest.raises(ValueError):
            decrypt_private_key(encrypted, secret, "user-999")

    def test_wrong_secret_cannot_decrypt(self):
        private_key = "0x" + "a" * 64
        encrypted = encrypt_private_key(private_key, "correct-secret-xxxxxxxxxxxxxxxxxx", "user-123")
        with pytest.raises(ValueError):
            decrypt_private_key(encrypted, "wrong-secret-xxxxxxxxxxxxxxxxxxx", "user-123")
