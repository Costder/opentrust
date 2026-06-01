from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import run_config_validation, settings
from .database import db
from .middleware.rate_limit import RateLimitMiddleware
from .middleware.security_headers import SecurityHeadersMiddleware
from .routes import (
    auth,
    badges,
    github_app,
    jobs,
    marketplace,
    passport_auth,
    passport_verify,
    passports,
    payments,
    reputation,
    search,
)
from .routes.well_known import registry_router, well_known_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_config_validation()
    await db.init()
    yield


_API_DESCRIPTION = """
The **OpenTrust** registry API — verifiable identity, earned reputation, and
agent-native payments for AI agent tools.

### What you can do
- **Tools / passports** — register and look up tool passports with trust levels
- **Verification** — advance trust via wallet signature (L2), GitHub owner-claim
  (L3), or an on-chain USDC fee (L4)
- **Marketplace** — list and buy tools/services, paid in real USDC on Base L2
- **Jobs** — post work, engage providers (mints escrow), build two-way reputation
- **Reputation** — registry-computed trust earned from settled deals

Most read endpoints are public. State-changing registry actions (revoke, admin)
require an `Authorization: Bearer <token>` header.
"""

app = FastAPI(
    title="OpenTrust API",
    version="1.0.0",
    description=_API_DESCRIPTION,
    contact={"name": "OpenTrust", "url": "https://github.com/Costder/opentrust"},
    license_info={"name": "MIT", "url": "https://github.com/Costder/opentrust/blob/main/LICENSE"},
    lifespan=lifespan,
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api/v1")
api.include_router(passports.router)
api.include_router(passports.admin_router)
api.include_router(passport_auth.router)
api.include_router(passport_verify.router)
api.include_router(search.router)
api.include_router(auth.router)
api.include_router(badges.router)
api.include_router(payments.router)
api.include_router(payments.subscriptions_router)
api.include_router(payments.escrow_router)
api.include_router(reputation.router)
api.include_router(jobs.router)
api.include_router(github_app.router)
api.include_router(github_app.github_router)
api.include_router(github_app.repos_router)
api.include_router(marketplace.coinbase_router)
api.include_router(marketplace.wallets_router)
api.include_router(marketplace.router)
api.include_router(marketplace.evidence_router)
api.include_router(marketplace.reports_router)
api.include_router(marketplace.badges_router)


@api.get("/health")
async def health():
    return {"status": "ok", "payment_provider": settings.payment_provider, "trust_status": "service"}


app.include_router(api)
app.include_router(well_known_router)
app.include_router(registry_router)
