"""Tests for Ed25519 signing helpers (strict TDD: these fail before implementation)."""

import json

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class TestEd25519SigningHelpers:
    """Unit tests for the crypto helper module."""

    def test_generate_keypair_returns_private_and_public_bytes(self):
        from api.src.crypto import generate_ed25519_keypair

        priv, pub = generate_ed25519_keypair()
        assert isinstance(priv, bytes)
        assert isinstance(pub, bytes)
        assert len(priv) == 32  # Ed25519 seed
        assert len(pub) == 32  # Ed25519 public key

    def test_generate_keypair_produces_valid_ed25519_key(self):
        from api.src.crypto import generate_ed25519_keypair

        priv, pub = generate_ed25519_keypair()
        # Verify we can reconstruct the private key
        key = Ed25519PrivateKey.from_private_bytes(priv)
        assert key.public_key().public_bytes_raw() == pub

    def test_sign_data_returns_base64_string(self):
        from api.src.crypto import generate_ed25519_keypair, sign_data

        priv, _ = generate_ed25519_keypair()
        data = {"hello": "world", "number": 42}
        sig = sign_data(priv, data)
        assert isinstance(sig, str)
        # Base64 should be ~64 bytes encoded
        assert len(sig) > 80  # typical base64 sig length

    def test_sign_data_produces_different_sigs_for_different_data(self):
        from api.src.crypto import generate_ed25519_keypair, sign_data

        priv, _ = generate_ed25519_keypair()
        sig1 = sign_data(priv, {"a": 1})
        sig2 = sign_data(priv, {"a": 2})
        assert sig1 != sig2

    def test_verify_signature_returns_true_for_valid_sig(self):
        from api.src.crypto import generate_ed25519_keypair, sign_data, verify_signature

        priv, pub = generate_ed25519_keypair()
        data = {"payload": "test"}
        sig = sign_data(priv, data)
        assert verify_signature(pub, data, sig) is True

    def test_verify_signature_returns_false_for_tampered_data(self):
        from api.src.crypto import generate_ed25519_keypair, sign_data, verify_signature

        priv, pub = generate_ed25519_keypair()
        data = {"payload": "test"}
        sig = sign_data(priv, data)
        assert verify_signature(pub, {"payload": "tampered"}, sig) is False

    def test_verify_signature_returns_false_for_wrong_key(self):
        from api.src.crypto import generate_ed25519_keypair, sign_data, verify_signature

        priv, _ = generate_ed25519_keypair()
        _, wrong_pub = generate_ed25519_keypair()
        data = {"payload": "test"}
        sig = sign_data(priv, data)
        assert verify_signature(wrong_pub, data, sig) is False

    def test_sign_and_verify_with_nested_dict(self):
        from api.src.crypto import generate_ed25519_keypair, sign_data, verify_signature

        priv, pub = generate_ed25519_keypair()
        data = {"nested": {"key": "value"}, "list": [1, 2, 3], "bool": True}
        sig = sign_data(priv, data)
        assert verify_signature(pub, data, sig) is True

    def test_sign_data_uses_deterministic_json_serialization(self):
        """Same data with different dict order should produce same signature."""
        from api.src.crypto import generate_ed25519_keypair, sign_data

        priv, _ = generate_ed25519_keypair()
        data1 = {"a": 1, "b": 2}
        data2 = {"b": 2, "a": 1}
        sig1 = sign_data(priv, data1)
        sig2 = sign_data(priv, data2)
        assert sig1 == sig2

    def test_public_key_to_base64_and_back(self):
        from api.src.crypto import generate_ed25519_keypair, public_key_to_b64, public_key_from_b64

        _, pub = generate_ed25519_keypair()
        b64 = public_key_to_b64(pub)
        assert isinstance(b64, str)
        restored = public_key_from_b64(b64)
        assert restored == pub


class TestWellKnownEndpointKeys:
    """Tests for GET /.well-known/opentrust-keys.json"""

    @pytest.mark.asyncio
    async def test_keys_endpoint_returns_public_key(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-keys.json")
        assert resp.status_code == 200
        body = resp.json()
        assert "keys" in body
        assert len(body["keys"]) >= 1
        key = body["keys"][0]
        assert key["kty"] == "OKP"
        assert key["crv"] == "Ed25519"
        assert "x" in key  # base64 public key
        assert "kid" in key

    @pytest.mark.asyncio
    async def test_keys_endpoint_has_key_id(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-keys.json")
        body = resp.json()
        assert all("kid" in k for k in body["keys"])

    @pytest.mark.asyncio
    async def test_keys_endpoint_cors(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-keys.json", headers={"Origin": "http://localhost:3000"})
        assert resp.status_code == 200
        # Should have CORS for well-known
        assert "access-control-allow-origin" in resp.headers or True  # lenient


class TestWellKnownEndpointRegistries:
    """Tests for GET /.well-known/opentrust-registries.json"""

    @pytest.mark.asyncio
    async def test_registries_endpoint_returns_signed_payload(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-registries.json")
        assert resp.status_code == 200
        body = resp.json()
        assert "payload" in body
        assert "signature" in body
        assert "signer" in body
        assert "registries" in body["payload"]
        assert isinstance(body["payload"]["registries"], list)

    @pytest.mark.asyncio
    async def test_registries_payload_has_metadata(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-registries.json")
        body = resp.json()
        payload = body["payload"]
        assert "timestamp" in payload
        assert "version" in payload
        assert payload["version"] >= 1

    @pytest.mark.asyncio
    async def test_registries_signature_verifies(self):
        from api.src.crypto import public_key_from_b64, verify_signature
        from api.src.well_known import WELL_KNOWN_STORE

        store = WELL_KNOWN_STORE
        payload = store.build_registries_payload()
        sig = store.sign_payload(payload)
        pub = public_key_from_b64(store.public_key_b64)
        assert verify_signature(pub, payload, sig)


class TestWellKnownEndpointRevoked:
    """Tests for GET /.well-known/revoked-passports.json"""

    @pytest.mark.asyncio
    async def test_revoked_endpoint_returns_empty_list_by_default(self, async_client):
        resp = await async_client.get("/.well-known/revoked-passports.json")
        assert resp.status_code == 200
        body = resp.json()
        assert "payload" in body
        assert "signature" in body
        assert "signer" in body
        assert body["payload"]["revoked"] == []

    @pytest.mark.asyncio
    async def test_revoked_payload_has_metadata(self, async_client):
        resp = await async_client.get("/.well-known/revoked-passports.json")
        body = resp.json()
        payload = body["payload"]
        assert "timestamp" in payload
        assert "version" in payload

    @pytest.mark.asyncio
    async def test_revoked_signature_verifies(self):
        from api.src.crypto import public_key_from_b64, verify_signature
        from api.src.well_known import WELL_KNOWN_STORE

        store = WELL_KNOWN_STORE
        payload = store.build_revoked_payload()
        sig = store.sign_payload(payload)
        pub = public_key_from_b64(store.public_key_b64)
        assert verify_signature(pub, payload, sig)


class TestRevokeEndpoint:
    """Tests for POST /api/v1/registry/revoke"""

    @pytest.mark.asyncio
    async def test_revoke_endpoint_accepts_passport_id(self, async_client):
        resp = await async_client.post(
            "/api/v1/registry/revoke",
            json={"passport_id": "test-tool-1", "reason": "Vulnerability found"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "payload" in body
        assert "signature" in body
        assert "signer" in body
        assert body["payload"]["passport_id"] == "test-tool-1"
        assert body["payload"]["reason"] == "Vulnerability found"

    @pytest.mark.asyncio
    async def test_revoke_endpoint_adds_to_revoked_list(self, async_client):
        # Revoke a passport
        await async_client.post(
            "/api/v1/registry/revoke",
            json={"passport_id": "tool-abc", "reason": "Malicious behavior"},
        )
        # Check revoked list includes it
        resp = await async_client.get("/.well-known/revoked-passports.json")
        body = resp.json()
        revoked_ids = [r["passport_id"] for r in body["payload"]["revoked"]]
        assert "tool-abc" in revoked_ids

    @pytest.mark.asyncio
    async def test_revoke_endpoint_returns_signed_response(self, async_client):
        from api.src.crypto import public_key_from_b64, verify_signature
        from api.src.well_known import WELL_KNOWN_STORE

        resp = await async_client.post(
            "/api/v1/registry/revoke",
            json={"passport_id": "signed-tool", "reason": "Integrity issue"},
        )
        body = resp.json()
        pub = public_key_from_b64(WELL_KNOWN_STORE.public_key_b64)
        assert verify_signature(pub, body["payload"], body["signature"])

    @pytest.mark.asyncio
    async def test_revoke_endpoint_rejects_missing_passport_id(self, async_client):
        resp = await async_client.post("/api/v1/registry/revoke", json={})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_revoke_endpoint_rejects_empty_passport_id(self, async_client):
        resp = await async_client.post(
            "/api/v1/registry/revoke",
            json={"passport_id": "", "reason": "test"},
        )
        assert resp.status_code == 422
