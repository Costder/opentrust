"""Well-known endpoints for OpenTrust registry verification.

Served outside the /api/v1 prefix on the root path.
"""

import hmac
import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..config import settings
from ..well_known import WELL_KNOWN_STORE

logger = logging.getLogger("opentrust")

well_known_router = APIRouter(tags=["well-known"])
registry_router = APIRouter(prefix="/api/v1/registry", tags=["registry"])


# ──────────────────────────────────────────────
# Elevated access dependency
# ──────────────────────────────────────────────

_DEV_CREDENTIAL: str | None = None


def _resolve_credential() -> str:
    global _DEV_CREDENTIAL
    token = settings.registry_admin_token
    if token:
        return token
    if settings.environment != "production" and _DEV_CREDENTIAL is None:
        _DEV_CREDENTIAL = secrets.token_hex(32)
        logger.info(f"Dev mode credential generated: {_DEV_CREDENTIAL}")
    if _DEV_CREDENTIAL:
        return _DEV_CREDENTIAL
    raise HTTPException(status_code=503, detail="Service unavailable")


async def _resolve_actor(authorization: str | None = Header(None)) -> str:
    token = _resolve_credential()

    if not authorization:
        logger.warning("Elevated access denied: missing header")
        raise HTTPException(status_code=401, detail="Unauthorized")

    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.warning("Elevated access denied: invalid scheme")
        raise HTTPException(status_code=401, detail="Unauthorized")

    if not hmac.compare_digest(parts[1], token):
        logger.warning("Elevated access denied: invalid credential")
        raise HTTPException(status_code=403, detail="Forbidden")

    logger.info("Elevated access granted")
    return "admin"


# ──────────────────────────────────────────────
# Well-known endpoints (root level)
# ──────────────────────────────────────────────


@well_known_router.get("/.well-known/opentrust-keys.json")
async def get_keys():
    return WELL_KNOWN_STORE.sign_keys()


@well_known_router.get("/.well-known/opentrust-registries.json")
async def get_registries():
    return WELL_KNOWN_STORE.sign_registries()


@well_known_router.get("/.well-known/revoked-passports.json")
async def get_revoked():
    return WELL_KNOWN_STORE.sign_revoked()


# ──────────────────────────────────────────────
# Revocation endpoint
# ──────────────────────────────────────────────


class RevokeRequest(BaseModel):
    passport_id: str = Field(..., min_length=1, description="Passport ID")
    reason: str = Field(default="", description="Reason")


@registry_router.post("/revoke")
async def revoke_passport(body: RevokeRequest, actor: str | None = Depends(_resolve_actor)):
    return WELL_KNOWN_STORE.revoke_passport(body.passport_id, body.reason, actor=actor)
