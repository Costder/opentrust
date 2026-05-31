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


app = FastAPI(title="OpenTrust API", version="0.1.0", lifespan=lifespan)

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
api.include_router(passport_auth.router)
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
