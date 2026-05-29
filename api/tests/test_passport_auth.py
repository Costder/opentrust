"""Tests for the agent passport validation endpoints.

These cover the contract the hands-body-and-feet client relies on:
  POST /api/v1/passports/validate  — token verification → claims
  GET  /api/v1/passports/{id}      — revocation oracle
"""

import pytest
from jose import jwt

from api.src.config import settings
from api.src.well_known import WELL_KNOWN_STORE

SECRET = "test-jwt-secret"


def _mint(claims: dict) -> str:
    return jwt.encode(claims, SECRET, algorithm="HS256")


def _valid_claims(**overrides) -> dict:
    base = {
        "passportId": "agent-123",
        "agentId": "agent-123",
        "trustLevel": 3,
        "trustStatus": "seller_confirmed",
        "flags": [],
        "isDisputed": False,
        "version": "1",
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", SECRET)


class TestValidate:
    async def test_valid_token_returns_claims(self, async_client):
        token = _mint(_valid_claims(spendCaps={"maxPerCallUsdc": 5, "dailyCapUsdc": 50}))
        resp = await async_client.post(
            "/api/v1/passports/validate",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["passportId"] == "agent-123"
        assert body["agentId"] == "agent-123"
        assert body["trustLevel"] == 3
        assert body["trustStatus"] == "seller_confirmed"
        assert body["spendCaps"] == {"maxPerCallUsdc": 5, "dailyCapUsdc": 50}
        assert body["isDisputed"] is False

    async def test_missing_authorization_header_401(self, async_client):
        resp = await async_client.post("/api/v1/passports/validate")
        assert resp.status_code == 401

    async def test_malformed_header_401(self, async_client):
        resp = await async_client.post(
            "/api/v1/passports/validate",
            headers={"Authorization": "Token abc"},
        )
        assert resp.status_code == 401

    async def test_bad_signature_401(self, async_client):
        token = jwt.encode(_valid_claims(), "the-wrong-secret", algorithm="HS256")
        resp = await async_client.post(
            "/api/v1/passports/validate",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401

    async def test_disputed_token_403(self, async_client):
        token = _mint(_valid_claims(trustStatus="disputed", isDisputed=True))
        resp = await async_client.post(
            "/api/v1/passports/validate",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_revoked_passport_403(self, async_client):
        pid = "revoked-agent-xyz"
        WELL_KNOWN_STORE.revoke_passport(pid, "test revocation")
        try:
            token = _mint(_valid_claims(passportId=pid, agentId=pid))
            resp = await async_client.post(
                "/api/v1/passports/validate",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 403
        finally:
            WELL_KNOWN_STORE.revoked_passports = [
                e for e in WELL_KNOWN_STORE.revoked_passports if e.get("passport_id") != pid
            ]


class TestStatusOracle:
    async def test_unknown_passport_is_active(self, async_client):
        resp = await async_client.get("/api/v1/passports/some-unrevoked-id")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "some-unrevoked-id"
        assert body["status"] == "active"

    async def test_revoked_passport_reports_revoked(self, async_client):
        pid = "revoked-status-check"
        WELL_KNOWN_STORE.revoke_passport(pid, "test")
        try:
            resp = await async_client.get(f"/api/v1/passports/{pid}")
            assert resp.status_code == 200
            assert resp.json()["status"] == "revoked"
        finally:
            WELL_KNOWN_STORE.revoked_passports = [
                e for e in WELL_KNOWN_STORE.revoked_passports if e.get("passport_id") != pid
            ]
