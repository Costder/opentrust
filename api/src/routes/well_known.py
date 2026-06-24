"""Well-known endpoints for OpenTrust registry verification.

These are served **outside** the ``/api/v1`` prefix on the root path so they
are discoverable at ``/.well-known/opentrust-keys.json`` etc.

Production hardening:
- POST /api/v1/registry/revoke is protected by Bearer admin token.
- In dev mode, a random admin token is auto-generated and printed on startup.
"""

import hmac
import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
from ..well_known import WELL_KNOWN_STORE

logger = logging.getLogger("opentrust.security")

# Router mounted directly on the root in main.py (no prefix).
well_known_router = APIRouter(tags=["well-known"])

# Additionally, the signed revocation action lives under /api/v1/registry
registry_router = APIRouter(prefix="/api/v1/registry", tags=["registry"])


# ──────────────────────────────────────────────
# Admin auth dependency
# ──────────────────────────────────────────────

# Auto-generate a dev-mode admin token so admin endpoints are never left open.
_DEV_ADMIN_TOKEN: str | None = None


def _get_admin_token() -> str:
    """Return the configured admin token, auto-generating one for dev mode."""
    global _DEV_ADMIN_TOKEN
    token = settings.registry_admin_token
    if token:
        return token
    # Dev mode: auto-generate a random token on first access.
    if settings.environment != "production" and _DEV_ADMIN_TOKEN is None:
        _DEV_ADMIN_TOKEN = secrets.token_hex(32)
        logger.info(
            f"DEV MODE: Auto-generated admin token (set REGISTRY_ADMIN_TOKEN to override): "
            f"{_DEV_ADMIN_TOKEN}"
        )
    if _DEV_ADMIN_TOKEN:
        return _DEV_ADMIN_TOKEN
    # Production with no token — should never reach here (config validation catches it).
    raise HTTPException(status_code=503, detail="admin access is not configured")


async def _require_admin(authorization: str | None = Header(None)) -> str:
    """Return actor identifier. Requires a valid Bearer token in all environments.

    In production, REGISTRY_ADMIN_TOKEN must be set (startup fails otherwise).
    In dev mode, a random token is auto-generated and logged on first use.
    """
    token = _get_admin_token()

    if not authorization:
        logger.warning("ADMIN_AUTH_FAILED reason=missing_header")
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.warning("ADMIN_AUTH_FAILED reason=invalid_scheme")
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")

    # Constant-time comparison to prevent timing attacks.
    if not hmac.compare_digest(parts[1], token):
        logger.warning("ADMIN_AUTH_FAILED reason=invalid_token")
        raise HTTPException(status_code=403, detail="Invalid admin token")

    logger.info("ADMIN_AUTH_SUCCESS actor=admin")
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