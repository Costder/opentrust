from fastapi import Header, HTTPException
from jose import JWTError, jwt
from ..config import settings


def decode_bearer(authorization: str | None = Header(default=None)) -> dict:
    # An empty signing secret would let HS256 accept tokens signed with "" —
    # refuse to authenticate anything rather than trust an unsigned token.
    if not settings.jwt_secret:
        raise HTTPException(status_code=503, detail="Registry JWT secret is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        return jwt.decode(authorization.removeprefix("Bearer "), settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
