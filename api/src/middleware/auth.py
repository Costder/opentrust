from datetime import datetime, timedelta, timezone
import logging
import secrets

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from ..config import settings

logger = logging.getLogger("opentrust")

WALLET_SCOPE = "wallet"

_invalidated: set[str] = set()


def _is_invalidated(jti: str | None) -> bool:
    if not jti:
        return False
    return jti in _invalidated


def decode_bearer(authorization: str | None = Header(default=None)) -> dict:
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Service unavailable")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        payload = jwt.decode(authorization.removeprefix("Bearer "), settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        logger.warning(f"Token decode failed")
        raise HTTPException(status_code=401, detail="Unauthorized") from exc
    if _is_invalidated(payload.get("jti")):
        logger.warning(f"Token invalidated")
        raise HTTPException(status_code=401, detail="Unauthorized")
    return payload


# ── Party authentication ────────────────────────────────────────────────────


def wallet_connect_message(owner: str, address: str) -> str:
    return f"OpenTrust wallet ownership proof\nowner: {owner}\naddress: {address.lower()}"


def verify_wallet_ownership(owner: str, address: str, signature: str | None) -> bool:
    if not signature:
        return False
    try:
        from eth_account import Account
        from eth_account.messages import encode_defunct

        message = encode_defunct(text=wallet_connect_message(owner, address))
        recovered = Account.recover_message(message, signature=signature)
    except Exception:
        return False
    return recovered.lower() == address.lower()


def mint_wallet_token(wallet_id: str, *, ttl_hours: int = 24) -> str:
    now = datetime.now(timezone.utc)
    jti = secrets.token_urlsafe(16)
    return jwt.encode(
        {
            "sub": wallet_id,
            "scope": WALLET_SCOPE,
            "jti": jti,
            "iat": now,
            "exp": now + timedelta(hours=ttl_hours),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def current_wallet(authorization: str | None = Header(default=None)) -> str:
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Service unavailable")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        payload = jwt.decode(authorization.removeprefix("Bearer "), settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        logger.warning(f"Token decode failed")
        raise HTTPException(status_code=401, detail="Unauthorized") from exc
    if _is_invalidated(payload.get("jti")):
        logger.warning(f"Token invalidated")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if payload.get("scope") != WALLET_SCOPE or not payload.get("sub"):
        raise HTTPException(status_code=403, detail="Forbidden")
    logger.info(f"Access granted: {payload['sub']}")
    return str(payload["sub"])
