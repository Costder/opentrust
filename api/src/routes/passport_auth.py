"""Agent passport validation endpoints.

These implement the contract the `@opentrust/hands-body-and-feet` client depends
on for runtime trust enforcement:

- ``POST /api/v1/passports/validate`` — verify an agent's passport token (a JWT
  signed with the registry's ``JWT_SECRET``) and return its claims. Used by the
  MCP server's HTTP transport to authenticate every tool call, and by the stdio
  transport when ``OPENTRUST_PASSPORT_TOKEN`` is supplied.

- ``GET /api/v1/passports/{passport_id}`` — a stateless revocation oracle. A
  passport is valid unless it appears in the signed revocation list. Used by the
  scheduled-task and delegation re-validation path at fire time.

Trust model: the registry is the issuing + revocation authority. Claims live in
the signed token (only the holder of ``JWT_SECRET`` can mint one); the registry
verifies the signature and checks the revocation/disputed state.
"""

from fastapi import APIRouter, Header, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel

from ..config import settings
from ..well_known import WELL_KNOWN_STORE

router = APIRouter(prefix="/passports", tags=["passport-auth"])


def _is_revoked(passport_id: str) -> bool:
    """True if the passport id (or its slug alias) is in the revocation list."""
    return any(
        entry.get("passport_id") == passport_id or entry.get("slug") == passport_id
        for entry in WELL_KNOWN_STORE.revoked_passports
    )


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authorization must be a Bearer token")
    token = parts[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty bearer token")
    return token


class PassportStatus(BaseModel):
    id: str
    version: str | None = None
    status: str  # 'active' | 'revoked'
    spendCaps: dict | None = None


@router.post("/validate")
async def validate_passport(authorization: str | None = Header(default=None)):
    """Validate an agent passport token and return its claims.

    Returns the claims (camelCase) the client's ``PassportClaims`` expects.
    401 for a missing/malformed/invalid/expired token; 403 if revoked or disputed.
    """
    token = _extract_bearer(authorization)

    if not settings.jwt_secret:
        # Misconfiguration guard: without a secret we cannot verify anything.
        raise HTTPException(status_code=503, detail="Registry JWT secret not configured")

    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid passport token: {exc}") from exc

    passport_id = payload.get("passportId") or payload.get("sub")
    if not passport_id:
        raise HTTPException(status_code=401, detail="Token is missing passport identity")

    if _is_revoked(passport_id):
        raise HTTPException(status_code=403, detail="revoked")

    trust_status = payload.get("trustStatus", "")
    is_disputed = bool(payload.get("isDisputed", False)) or trust_status == "disputed"
    if is_disputed:
        raise HTTPException(status_code=403, detail="disputed")

    return {
        "passportId": passport_id,
        "agentId": payload.get("agentId", passport_id),
        "trustLevel": payload.get("trustLevel", 0),
        "trustStatus": trust_status or "auto_generated_draft",
        "flags": payload.get("flags", []),
        "spendCaps": payload.get("spendCaps"),
        "isDisputed": False,
        "version": str(payload.get("version", "1")),
    }


@router.get("/{passport_id}", response_model=PassportStatus)
async def get_passport_status(passport_id: str) -> PassportStatus:
    """Revocation oracle for runtime re-validation.

    Stateless: a passport is ``active`` unless explicitly revoked. Returns the
    shape the client's ``validateTaskPassport`` expects so it can fail-closed on
    revocation while allowing valid passports through with their stored caps.
    """
    if _is_revoked(passport_id):
        return PassportStatus(id=passport_id, version="*", status="revoked", spendCaps=None)
    return PassportStatus(id=passport_id, version=None, status="active", spendCaps=None)
