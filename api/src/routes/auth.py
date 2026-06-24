import secrets
import time
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from jose import jwt
from pydantic import BaseModel, Field

from ..config import settings
from ..database import Database, get_db
from ..services.github_verifier import build_github_oauth_url

logger = logging.getLogger("opentrust")

router = APIRouter(prefix="/claim", tags=["claim"])

_invalidated: set[str] = set()
signup_router = APIRouter(prefix="/signup", tags=["signup"])

_STATE_TTL_SECONDS = 600


def _allowed_redirect_hosts() -> set[str]:
    hosts = {h.strip().lower() for h in settings.oauth_allowed_redirect_hosts.split(",") if h.strip()}
    for origin in settings.cors_origins.split(","):
        netloc = urlparse(origin.strip()).hostname
        if netloc:
            hosts.add(netloc.lower())
    return hosts


def _validate_redirect_uri(redirect_uri: str) -> None:
    host = (urlparse(redirect_uri).hostname or "").lower()
    if host not in _allowed_redirect_hosts():
        raise HTTPException(status_code=400, detail=f"redirect_uri host '{host}' is not allowed")


async def _new_state(db: Database) -> str:
    nonce = secrets.token_urlsafe(32)
    await db.save_object("oauth_state", nonce, {"created": time.time()})
    return nonce


async def _consume_state(db: Database, state: str | None) -> None:
    if not state:
        raise HTTPException(status_code=400, detail="invalid or missing OAuth state")
    record = await db.get_object("oauth_state", state)
    if record is None:
        raise HTTPException(status_code=400, detail="invalid or missing OAuth state")
    await db.delete_object("oauth_state", state)  # one-time use
    if time.time() - float(record.get("created", 0)) > _STATE_TTL_SECONDS:
        raise HTTPException(status_code=400, detail="OAuth state has expired")


@router.post("")
async def start_claim(
    slug: str,
    redirect_uri: str = "http://localhost:8000/api/v1/claim/callback",
    db: Database = Depends(get_db),
):
    _validate_redirect_uri(redirect_uri)
    state = await _new_state(db)
    return {
        "auth_url": build_github_oauth_url(settings.github_client_id, redirect_uri, state),
        "slug": slug,
        "state": state,
    }


# ── Agent-driven human signup ────────────────────────────────────────────────


class SignupStartRequest(BaseModel):
    agent_id: str = Field(min_length=1)
    redirect_uri: str = "https://opentrust.sh/signup/github"


@signup_router.post("/start")
async def signup_start(request: SignupStartRequest):
    """An agent requests a GitHub sign-in link to onboard its human operator.

    Returns a GitHub OAuth URL the agent hands to its human. The human only has
    to click "Sign in with GitHub" — no forms. The `pending_token` correlates
    the eventual callback back to the requesting agent. Reuses the registry's
    GitHub OAuth app; no agent ever sees a secret.
    """
    if not settings.github_client_id:
        raise HTTPException(status_code=503, detail="GitHub sign-in is not configured on this registry")
    _validate_redirect_uri(request.redirect_uri)

    pending = secrets.token_urlsafe(16)
    state = f"signup:{request.agent_id}:{pending}"
    signin_url = (
        "https://github.com/login/oauth/authorize"
        f"?client_id={settings.github_client_id}"
        f"&redirect_uri={request.redirect_uri}"
        "&scope=read:user%20user:email"
        f"&state={state}"
    )
    return {
        "signin_url": signin_url,
        "pending_token": pending,
        "agent_id": request.agent_id,
        "instructions": (
            "Send this link to your human and ask them to click 'Sign in with GitHub'. "
            "That's all they need to do to create their OpenTrust account."
        ),
    }


@router.get("/callback")
async def claim_callback(
    code: str | None = None,
    state: str | None = None,
    db: Database = Depends(get_db),
):
    """Exchange a GitHub OAuth code for a registry token."""
    await _consume_state(db, state)
    if not code:
        logger.warning("Callback failed: missing code")
        raise HTTPException(status_code=400, detail="Bad request")
    if not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(status_code=503, detail="Service unavailable")

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )
        access_token = token_resp.json().get("access_token") if token_resp.status_code == 200 else None
        if not access_token:
            logger.warning("Callback failed: code exchange")
            raise HTTPException(status_code=400, detail="Bad request")
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
    if user_resp.status_code != 200:
        logger.warning(f"Callback failed: user fetch status={user_resp.status_code}")
        raise HTTPException(status_code=400, detail="Bad request")
    user = user_resp.json()

    jti = secrets.token_urlsafe(16)
    token = jwt.encode(
        {
            "sub": str(user["id"]),
            "login": user.get("login"),
            "jti": jti,
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    logger.info(f"Session issued: sub={user['id']}")
    return {"access_token": token, "token_type": "bearer"}


@router.post("/revoke")
async def revoke_token(
    token: str = "",
    db: Database = Depends(get_db),
):
    """Invalidate a token."""
    if not token:
        raise HTTPException(status_code=400, detail="Bad request")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except Exception:
        return {"status": "already_invalid"}
    jti = payload.get("jti")
    if jti:
        _invalidated.add(jti)
        await db.save_object("revoked_jti", jti, {"revoked_at": time.time()})
        logger.info(f"Token invalidated: sub={payload.get('sub')}")
    return {"status": "revoked"}
