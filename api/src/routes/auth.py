from datetime import datetime, timedelta, timezone
from fastapi import APIRouter
from jose import jwt
from api.src.config import settings
from api.src.services.github_verifier import build_github_oauth_url

router = APIRouter(prefix="/claim", tags=["claim"])


@router.post("")
async def start_claim(slug: str, redirect_uri: str = "http://localhost:8000/api/v1/claim/callback"):
    return {"auth_url": build_github_oauth_url(settings.github_client_id, redirect_uri), "slug": slug}


@router.get("/callback")
async def claim_callback(code: str | None = None):
    token = jwt.encode(
        {"sub": "github-user", "iat": datetime.now(timezone.utc), "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer", "code_received": bool(code)}
