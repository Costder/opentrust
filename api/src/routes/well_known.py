"""Well-known endpoints for OpenTrust registry verification.

These are served **outside** the ``/api/v1`` prefix on the root path so they
are discoverable at ``/.well-known/opentrust-keys.json`` etc.

Production hardening:
- POST /api/v1/registry/revoke is protected by Bearer admin token when
  ``REGISTRY_ADMIN_TOKEN`` is configured.  In dev mode (empty token) the
  endpoint remains unauthenticated for backward compatibility.

No secrets are leaked through public GET endpoints.
"""

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
from ..well_known import WELL_KNOWN_STORE

# Router mounted directly on the root in main.py (no prefix).
well_known_router = APIRouter(tags=["well-known"])

# Additionally, the signed revocation action lives under /api/v1/registry
registry_router = APIRouter(prefix="/api/v1/registry", tags=["registry"])


# ──────────────────────────────────────────────
# Admin auth dependency
# ──────────────────────────────────────────────


async def _require_admin(authorization: str | None = Header(None)) -> str | None:
    """Return actor identifier or None.

    When ``registry_admin_token`` is set (production mode), the caller MUST
    supply an ``Authorization: Bearer <token>`` header matching the configured
    value.  A mismatch raises 403; a missing header raises 401.

    When the token is empty (development / test mode), any request is allowed
    and the actor is recorded as ``"anonymous"``.
    """
    token = settings.registry_admin_token
    if not token:
        # Fail closed in production: an unset admin token must never silently
        # leave admin endpoints open to everyone.
        if settings.environment == "production":
            raise HTTPException(status_code=503, detail="admin access is not configured")
        return None  # Dev mode — allow all, record as anonymous

    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")

    if parts[1] != token:
        raise HTTPException(status_code=403, detail="Invalid admin token")

    return "admin"


# ──────────────────────────────────────────────
# Well-known endpoints (root level)
# ──────────────────────────────────────────────


@well_known_router.get("/.well-known/opentrust-keys.json")
async def get_keys():
    """Return the Ed25519 public key(s) in JWK format."""
    return WELL_KNOWN_STORE.sign_keys()


@well_known_router.get("/.well-known/opentrust-registries.json")
async def get_registries():
    """Return the signed registries list."""
    return WELL_KNOWN_STORE.sign_registries()


@well_known_router.get("/.well-known/revoked-passports.json")
async def get_revoked():
    """Return the signed list of revoked passports."""
    return WELL_KNOWN_STORE.sign_revoked()


# ──────────────────────────────────────────────
# Revocation action endpoint
# ──────────────────────────────────────────────


class RevokeRequest(BaseModel):
    passport_id: str = Field(..., min_length=1, description="Passport ID to revoke")
    reason: str = Field(default="", description="Reason for revocation")


@registry_router.post("/revoke")
async def revoke_passport(body: RevokeRequest, actor: str | None = Depends(_require_admin)):
    """Revoke a passport and return a signed revocation receipt.

    Requires admin auth when ``REGISTRY_ADMIN_TOKEN`` is set.
    """
    return WELL_KNOWN_STORE.revoke_passport(body.passport_id, body.reason, actor=actor)