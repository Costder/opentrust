from datetime import datetime, timedelta, timezone
import logging
import secrets

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from ..config import settings

logger = logging.getLogger("opentrust.security")

# Scope marker for party (wallet) session tokens. A wallet token only grants
# authority to act *as that wallet* on escrow/job/payment endpoints — it is not
# interchangeable with the GitHub-claim token (different scope).
WALLET_SCOPE = "wallet"

# In-process set of revoked JWT IDs.
_revoked_jtis: set[str] = set()


def _is_revoked(jti: str | None) -> bool:
    """Check if a JWT ID has been revoked."""
    if not jti:
        return False
    return jti in _revoked_jtis


def decode_bearer(authorization: str | None = Header(default=None)) -> dict:
    # An empty signing secret would let HS256 accept tokens signed with "" —
    # refuse to authenticate anything rather than trust an unsigned token.
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Registry JWT secret is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        payload = jwt.decode(authorization.removeprefix("Bearer "), settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        logger.warning(f"JWT_DECODE_FAILED reason={exc}")
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if _is_revoked(payload.get("jti")):
        logger.warning(f"JWT_REVOKED jti={payload.get('jti')} sub={payload.get('sub')}")
        raise HTTPException(status_code=401, detail="Token has been revoked")
    return payload


# ── Party (wallet) authentication ───────────────────────────────────────────


def wallet_connect_message(owner: str, address: str) -> str:
    """Canonical message a wallet must sign to prove it controls ``address``.

    Deterministic so the browser (personal_sign) and server agree byte-for-byte.
    """
    return f"OpenTrust wallet ownership proof\nowner: {owner}\naddress: {address.lower()}"


def verify_wallet_ownership(owner: str, address: str, signature: str | None) -> bool:
    """Return True iff ``signature`` is a valid EIP-191 signature of the
    canonical connect message by the private key for ``address``."""
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
    """Mint a signed session token bound to a specific wallet_id."""
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
    """FastAPI dependency: authenticate the caller and return their wallet_id.

    Raises 503 if the registry has no signing secret, 401 if the bearer token is
    missing/invalid/revoked, 403 if it is not a wallet session token.
    """
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Registry JWT secret is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        payload = jwt.decode(authorization.removeprefix("Bearer "), settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        logger.warning(f"WALLET_AUTH_FAILED reason=invalid_token")
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    if _is_revoked(payload.get("jti")):
        logger.warning(f"WALLET_AUTH_FAILED reason=revoked jti={payload.get('jti')}")
        raise HTTPException(status_code=401, detail="Token has been revoked")
    if payload.get("scope") != WALLET_SCOPE or not payload.get("sub"):
        raise HTTPException(status_code=403, detail="Not a wallet session token")
    logger.info(f"WALLET_AUTH_SUCCESS wallet_id={payload['sub']}")
    return str(payload["sub"])
