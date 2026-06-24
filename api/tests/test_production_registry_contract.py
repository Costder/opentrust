import copy
import json
import os
import tempfile
import time

import base64
import pytest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def test_sign_passport_adds_registry_signature_and_verifies():
    from api.src.well_known import WELL_KNOWN_STORE
    from api.src.crypto import verify_signed_document

    passport = {
        "spec_version": "0.1.0",
        "tool_identity": {"slug": "demo-tool", "name": "Demo Tool"},
        "trust_status": "community_reviewed",
        "version_hash": {"version": "1.0.0", "commit": "abc123"},
        "permission_manifest": {"wallet": False},
    }

    signed = WELL_KNOWN_STORE.sign_passport(passport)

    assert signed["security"]["registry_signature"]["key_id"] == WELL_KNOWN_STORE.key_id
    assert signed["security"]["registry_signature"]["algorithm"] == "ed25519"
    assert verify_signed_document(signed, WELL_KNOWN_STORE.public_key_bytes, signature_path=("security", "registry_signature")) is True


def test_signed_passport_tampering_fails_verification():
    from api.src.well_known import WELL_KNOWN_STORE
    from api.src.crypto import verify_signed_document

    signed = WELL_KNOWN_STORE.sign_passport({
        "tool_identity": {"slug": "demo-tool"},
        "trust_status": "community_reviewed",
        "version_hash": {"version": "1.0.0", "commit": "abc123"},
    })
    tampered = copy.deepcopy(signed)
    tampered["trust_status"] = "security_checked"

    assert verify_signed_document(tampered, WELL_KNOWN_STORE.public_key_bytes, signature_path=("security", "registry_signature")) is False


@pytest.mark.asyncio
async def test_keys_endpoint_supports_open_trust_key_contract(async_client):
    resp = await async_client.get("/.well-known/opentrust-keys.json")
    assert resp.status_code == 200
    key = resp.json()["keys"][0]
    assert key["key_id"] == key["kid"]
    assert key["public_key"] == key["x"]
    assert key["use"] == "registry-signing"
    assert key["status"] == "active"


@pytest.mark.asyncio
async def test_revocation_endpoint_uses_top_level_signed_contract(async_client):
    resp = await async_client.get("/.well-known/revoked-passports.json")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body["version"], int)
    assert "updated_at" in body
    assert "passports" in body
    assert "operator_keys" in body
    assert body["signature"]["algorithm"] == "ed25519"
    assert body["signature"]["key_id"]
    assert body["signature"]["payload_hash"].startswith("sha256:")
    assert body["signature"]["value"]


def test_revocation_rollback_detection_rejects_lower_version(tmp_path):
    from opentrust_cli.commands.verify import RevocationVersionStore, _check_revocation_rollback

    store = RevocationVersionStore(tmp_path / "versions.json")
    _check_revocation_rollback("https://registry.example", {"version": 3}, store)

    with pytest.raises(ValueError, match="rollback"):
        _check_revocation_rollback("https://registry.example", {"version": 2}, store)


# ══════════════════════════════════════════════════════════════════════════════
# Production hardening tests
# ══════════════════════════════════════════════════════════════════════════════


class TestPersistenceAcrossStoreInstances:
    """Verify that revocation state survives across WellKnownStore instances
    when a state file path is configured."""

    def test_revocations_persist_across_store_instances(self):
        from api.src.config import settings
        from api.src.well_known import WellKnownStore

        # Save original values
        orig_state_path = settings.registry_state_path
        orig_admin_token = settings.registry_admin_token

        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                state_path = f.name

            settings.registry_state_path = state_path
            settings.registry_admin_token = ""

            # First store instance
            store1 = WellKnownStore()
            assert store1.version == 1
            assert store1.revoked_passports == []

            result = store1.revoke_passport("persist-test-tool", "persistence test")
            v1 = store1.version
            assert v1 > 1
            store1.save_state()

            # Second store instance — should load from state file
            store2 = WellKnownStore()
            assert store2.version == v1
            assert len(store2.revoked_passports) == 1
            assert store2.revoked_passports[0]["passport_id"] == "persist-test-tool"
            assert store2.revoked_passports[0]["reason"] == "persistence test"

            # Audit log persisted too
            assert len(store2.audit_log) == 1
            assert store2.audit_log[0]["action"] == "revoke_passport"
            assert store2.audit_log[0]["passport_id"] == "persist-test-tool"

        finally:
            settings.registry_state_path = orig_state_path
            settings.registry_admin_token = orig_admin_token
            if os.path.exists(state_path):
                os.unlink(state_path)

    def test_state_not_loaded_when_path_empty(self):
        """With no state path configured, each store starts fresh."""
        from api.src.config import settings
        from api.src.well_known import WellKnownStore

        orig_state_path = settings.registry_state_path
        orig_admin_token = settings.registry_admin_token

        try:
            settings.registry_state_path = ""
            settings.registry_admin_token = ""

            store = WellKnownStore()
            assert store.version == 1
            assert store.revoked_passports == []
            assert store.audit_log == []
        finally:
            settings.registry_state_path = orig_state_path
            settings.registry_admin_token = orig_admin_token


class TestAdminAuth:
    """Verify that the revoke endpoint enforces admin token when configured."""

    @pytest.mark.asyncio
    async def test_revoke_without_auth_when_token_empty(self, async_client):
        """Dev mode: no admin token configured → auto-generated token required (401 without header)."""
        from api.src.config import settings
        orig_token = settings.registry_admin_token

        try:
            settings.registry_admin_token = ""
            # In dev mode, a token is auto-generated. Without the header, 401 is expected.
            resp = await async_client.post(
                "/api/v1/registry/revoke",
                json={"passport_id": "dev-tool", "reason": "dev test"},
            )
            assert resp.status_code == 401
        finally:
            settings.registry_admin_token = orig_token

    @pytest.mark.asyncio
    async def test_revoke_requires_auth_when_token_set(self, async_client):
        """Production mode: admin token configured → 401 without header."""
        from api.src.config import settings
        orig_token = settings.registry_admin_token

        try:
            settings.registry_admin_token = "super-secret-admin-token"
            resp = await async_client.post(
                "/api/v1/registry/revoke",
                json={"passport_id": "prod-tool", "reason": "prod test"},
            )
            assert resp.status_code == 401
        finally:
            settings.registry_admin_token = orig_token

    @pytest.mark.asyncio
    async def test_revoke_with_wrong_token_returns_403(self, async_client):
        from api.src.config import settings
        orig_token = settings.registry_admin_token

        try:
            settings.registry_admin_token = "real-token"
            resp = await async_client.post(
                "/api/v1/registry/revoke",
                json={"passport_id": "prod-tool", "reason": "prod test"},
                headers={"Authorization": "Bearer wrong-token"},
            )
            assert resp.status_code == 403
        finally:
            settings.registry_admin_token = orig_token

    @pytest.mark.asyncio
    async def test_revoke_with_correct_token_succeeds(self, async_client):
        from api.src.config import settings
        orig_token = settings.registry_admin_token

        try:
            settings.registry_admin_token = "correct-admin-token"
            resp = await async_client.post(
                "/api/v1/registry/revoke",
                json={"passport_id": "auth-tool", "reason": "authorized"},
                headers={"Authorization": "Bearer correct-admin-token"},
            )
            assert resp.status_code == 200
        finally:
            settings.registry_admin_token = orig_token

    @pytest.mark.asyncio
    async def test_non_bearer_auth_rejected(self, async_client):
        from api.src.config import settings
        orig_token = settings.registry_admin_token

        try:
            settings.registry_admin_token = "token-007"
            resp = await async_client.post(
                "/api/v1/registry/revoke",
                json={"passport_id": "x", "reason": "x"},
                headers={"Authorization": "Basic dGVzdDp0ZXN0"},
            )
            assert resp.status_code == 401
        finally:
            settings.registry_admin_token = orig_token


class TestKeyLoading:
    """Verify key loading from base64 env var and file path."""

    def test_load_key_from_base64_env(self):
        """Loading a known private key via base64 produces the same public key."""
        from api.src.config import settings
        from api.src.well_known import WellKnownStore

        # Generate a known keypair
        orig_priv_path = settings.registry_private_key_path
        orig_priv_b64 = settings.registry_private_key_base64
        orig_state_path = settings.registry_state_path
        orig_admin_token = settings.registry_admin_token

        try:
            # First, get a known private key
            temp_store = WellKnownStore()
            known_priv = temp_store._private_key
            known_pub = temp_store.public_key_bytes
            known_pub_b64 = temp_store.public_key_b64

            # Encode as base64
            priv_b64 = base64.b64encode(known_priv).decode("ascii")

            settings.registry_private_key_base64 = priv_b64
            settings.registry_private_key_path = ""
            settings.registry_state_path = ""
            settings.registry_admin_token = ""

            store = WellKnownStore()
            assert store.public_key_bytes == known_pub
            assert store.public_key_b64 == known_pub_b64
            assert store._private_key == known_priv
        finally:
            settings.registry_private_key_base64 = orig_priv_b64
            settings.registry_private_key_path = orig_priv_path
            settings.registry_state_path = orig_state_path
            settings.registry_admin_token = orig_admin_token

    def test_load_key_from_file(self):
        """Loading a private key from a file produces the same public key."""
        from api.src.config import settings
        from api.src.well_known import WellKnownStore

        orig_priv_path = settings.registry_private_key_path
        orig_priv_b64 = settings.registry_private_key_base64
        orig_state_path = settings.registry_state_path
        orig_admin_token = settings.registry_admin_token

        try:
            # Generate a known keypair
            temp_store = WellKnownStore()
            known_priv = temp_store._private_key
            known_pub = temp_store.public_key_bytes
            known_pub_b64 = temp_store.public_key_b64

            # Write to temp file
            priv_b64 = base64.b64encode(known_priv).decode("ascii")
            with tempfile.NamedTemporaryFile(mode="w", suffix=".key", delete=False) as f:
                f.write(priv_b64 + "\n")
                key_path = f.name

            settings.registry_private_key_path = key_path
            settings.registry_private_key_base64 = ""
            settings.registry_state_path = ""
            settings.registry_admin_token = ""

            store = WellKnownStore()
            assert store.public_key_bytes == known_pub
            assert store.public_key_b64 == known_pub_b64
            assert store._private_key == known_priv
        finally:
            settings.registry_private_key_base64 = orig_priv_b64
            settings.registry_private_key_path = orig_priv_path
            settings.registry_state_path = orig_state_path
            settings.registry_admin_token = orig_admin_token
            if os.path.exists(key_path):
                os.unlink(key_path)


class TestSecretsLeakage:
    """Verify that no private key material is exposed in public endpoints."""

    @pytest.mark.asyncio
    async def test_keys_endpoint_has_no_private_key(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-keys.json")
        body = resp.json()
        raw = json.dumps(body)
        # No private key fields
        assert "private" not in raw.lower()
        assert "d" not in body.get("keys", [{}])[0]  # JWK private exponent

    @pytest.mark.asyncio
    async def test_registries_endpoint_has_no_private_key(self, async_client):
        resp = await async_client.get("/.well-known/opentrust-registries.json")
        raw = json.dumps(resp.json())
        assert "private" not in raw.lower()

    @pytest.mark.asyncio
    async def test_revoked_endpoint_has_no_private_key(self, async_client):
        resp = await async_client.get("/.well-known/revoked-passports.json")
        raw = json.dumps(resp.json())
        assert "private" not in raw.lower()


class TestAuditLog:
    """Verify that audit records are created for revocation actions."""

    def test_audit_log_created_on_revoke(self):
        from api.src.config import settings
        from api.src.well_known import WellKnownStore

        orig_state_path = settings.registry_state_path
        orig_admin_token = settings.registry_admin_token

        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                state_path = f.name

            settings.registry_state_path = state_path
            settings.registry_admin_token = ""

            store = WellKnownStore()
            assert store.audit_log == []

            store.revoke_passport("audit-tool-1", "audit test one")
            assert len(store.audit_log) == 1
            entry = store.audit_log[0]
            assert entry["action"] == "revoke_passport"
            assert entry["passport_id"] == "audit-tool-1"
            assert entry["reason"] == "audit test one"
            assert "timestamp" in entry
            assert entry["actor"] == "anonymous"

            store.revoke_passport("audit-tool-2", "audit test two")
            assert len(store.audit_log) == 2
            assert store.audit_log[1]["passport_id"] == "audit-tool-2"

        finally:
            settings.registry_state_path = orig_state_path
            settings.registry_admin_token = orig_admin_token
            if os.path.exists(state_path):
                os.unlink(state_path)

    def test_audit_log_survives_restart_via_state_file(self):
        from api.src.config import settings
        from api.src.well_known import WellKnownStore

        orig_state_path = settings.registry_state_path
        orig_admin_token = settings.registry_admin_token

        try:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
                state_path = f.name

            settings.registry_state_path = state_path
            settings.registry_admin_token = ""

            store1 = WellKnownStore()
            store1.revoke_passport("survive-tool", "survival test")
            store1.save_state()

            store2 = WellKnownStore()
            assert len(store2.audit_log) == 1
            assert store2.audit_log[0]["passport_id"] == "survive-tool"

        finally:
            settings.registry_state_path = orig_state_path
            settings.registry_admin_token = orig_admin_token
            if os.path.exists(state_path):
                os.unlink(state_path)
