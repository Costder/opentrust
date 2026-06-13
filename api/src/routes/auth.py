import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException
from jose import jwt
from pydantic import BaseModel, Field

from ..config import settings
from ..services.github_verifier import build_github_oauth_url

router = APIRouter(prefix="/claim", tags=["claim"])
signup_router = APIRouter(prefix="/signup", tags=["signup"])


@router.post("")
async def start_claim(slug: str, redirect_uri: str = "http://localhost:8000/api/v1/claim/callback"):
    return {"auth_url": build_github_oauth_url(settings.github_client_id, redirect_uri), "slug": slug}


# ── Agent-driven human signup ────────────────────────────────────────────────


class SignupStartRequest(BaseModel):
    agent_id: str = Field(min_length=1)
    redirect_uri: str = "https://opentrust.infiniterealms.io/signup/github"


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
async def claim_callback(code: str | None = None):
    """Exchange a GitHub OAuth ``code`` for a registry JWT bound to the real user.

    Previously this minted a valid signed JWT (subject ``github-user``) for *any*
    caller, with or without a code — an authentication bypass. We now require a
    code, require GitHub OAuth to be configured, exchange the code server-side,
    and mint a token whose subject is the authenticated GitHub user's id.
    """
    if not code:
        raise HTTPException(status_code=400, detail="Missing OAuth code")
    if not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(status_code=503, detail="GitHub OAuth is not configured on this registry")

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
            raise HTTPException(status_code=400, detail="GitHub code exchange failed")
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
    if user_resp.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch GitHub user")
    user = user_resp.json()

    token = jwt.encode(
        {
            "sub": str(user["id"]),
            "login": user.get("login"),
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer"}
