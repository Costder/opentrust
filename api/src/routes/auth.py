import secrets
from datetime import datetime, timedelta, timezone

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
    token = jwt.encode(
        {"sub": "github-user", "iat": datetime.now(timezone.utc), "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer", "code_received": bool(code)}
