"""OpenTrust API configuration using pydantic-settings.

All settings are loaded from .env files with sensible defaults for development.
Production startup validates that insecure defaults are not used when ENVIRONMENT=production.
"""

import logging
import os
import sys

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("opentrust.config")


class Settings(BaseSettings):
    # Runtime environment
    environment: str = "development"  # "development" | "production"

    # Database
    db_url: str = "sqlite+aiosqlite:///./opentrust.db"
    postgres_user: str = "opentrust"
    postgres_password: str = "opentrust_dev"
    postgres_db: str = "opentrust"

    # GitHub auth
    github_client_id: str = ""
    github_client_secret: str = ""

    # GitHub App
    github_app_id: str = ""
    github_app_client_id: str = ""
    github_app_client_secret: str = ""
    github_app_private_key_path: str = ""
    github_app_webhook_secret: str = ""

    # JWT
    jwt_secret: str = ""  # Required — set JWT_SECRET in .env

    # Payment
    payment_provider: str | None = "mock"
    circle_api_key: str | None = None

    # CORS
    cors_origins: str = "http://localhost:3000"

    # OAuth redirect allowlist (hosts permitted as GitHub OAuth redirect_uri).
    # Comma-separated hostnames; cors_origins hosts are merged in at runtime.
    oauth_allowed_redirect_hosts: str = "localhost,127.0.0.1,opentrust.sh,www.opentrust.sh,opentrust.infiniterealms.io"

    # Pricing
    opentrust_price_trust_report_usdc: str = "19.00"
    opentrust_price_verified_badge_usdc: str = "49.00"
    opentrust_price_monitoring_monthly_usdc: str = "19.00"

    # Feature flags
    opentrust_raw_scan_purchase_enabled: bool = False
    opentrust_marketplace_enabled: bool = True
    opentrust_customer_wallets_enabled: bool = True
    opentrust_byo_wallet_enabled: bool = True
    opentrust_embedded_wallet_enabled: bool = False
    opentrust_custodial_wallets_enabled: bool = False
    opentrust_escrow_enabled: bool = False  # set True only when ESCROW_WALLET_PRIVATE_KEY + ESCROW_WALLET_ADDRESS are set
    opentrust_marketplace_fee_enabled: bool = False
    opentrust_reputation_gate_enabled: bool = True

    # Fee schedule
    opentrust_marketplace_fee_pct: str = "5.00"      # 5% seller-side fee on orders/escrow settlements
    opentrust_job_listing_fee_usdc: str = "2.00"     # $2 flat fee per job posting
    opentrust_job_settlement_fee_pct: str = "4.00"   # 4% fee on job escrow settlement
    # 90-day launch waiver: settlement fees are 0 until this date (ISO 8601, UTC).
    # Leave OPENTRUST_FEE_WAIVER_END_DATE empty to disable the waiver.
    opentrust_fee_waiver_enabled: bool = True
    opentrust_fee_waiver_end_date: str = ""           # e.g. "2026-09-20"

    # Verification
    opentrust_registry_treasury_address: str = ""  # USDC recipient for $10 verification fees
    opentrust_verification_fee_usdc: str = "10.00"

    # Escrow treasury wallet — operator secret, never commit to repo
    # Set OPENTRUST_ESCROW_ENABLED=true only when both are provided.
    escrow_wallet_private_key: str = ""
    escrow_wallet_address: str = ""

    # Coinbase Commerce
    coinbase_business_api_key_id: str = ""
    coinbase_business_api_key_secret: str = ""
    coinbase_business_webhook_secret: str = ""
    coinbase_business_checkout_currency: str = "USDC"
    coinbase_business_success_url: str = "http://localhost:3000/payments/success"
    coinbase_business_cancel_url: str = "http://localhost:3000/payments/cancel"

    # Base L2 on-chain
    base_rpc_url: str = "https://mainnet.base.org"  # Base L2 public RPC
    base_usdc_contract: str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # USDC on Base
    wallet_encryption_secret: str = ""  # Set in .env — AES key derivation for embedded wallets

    # Rate limiting
    rate_limit: str = "100/60"

    # Security headers
    security_hsts_enabled: bool = False
    security_hsts_max_age: int = 31536000
    security_hsts_include_subdomains: bool = True
    security_hsts_preload: bool = True

    # ── Registry production hardening ─────────────────────────────────────
    registry_private_key_path: str = ""
    registry_private_key_base64: str = ""
    registry_state_path: str = ""
    registry_admin_token: str = ""
    registry_url: str = "https://opentrust.sh"
    registry_operator: str = "Joshua Herron"
    registry_name: str = "Joshua Herron / SoulForge Registry"

    # ── Database ───────────────────────────────────────────────────────────
    # Set TURSO_URL + TURSO_AUTH_TOKEN for production (Turso HTTP API).
    # Leave both empty to use local aiosqlite (development / CI).
    turso_url: str = ""
    turso_auth_token: str = ""
    sqlite_path: str = "./opentrust.db"

    model_config = SettingsConfigDict(env_file=(".env", ".env.marketplace"), extra="ignore")


settings = Settings()


# ── Production startup validation ──────────────────────────────────────────
_INFOS = []
_WARNINGS = []
_ERRORS = []


def _check_jwt_secret() -> None:
    """Fail if JWT_SECRET is empty or the known-insecure placeholder."""
    raw = settings.jwt_secret.strip()
    if not raw:
        _ERRORS.append("JWT_SECRET is empty. Generate one with: openssl rand -hex 64")
        return
    insecure_secrets = {"change_me", "changeme", "secret", "password", "jwt_secret"}
    if raw.lower() in insecure_secrets:
        _ERRORS.append(f"JWT_SECRET is set to an insecure value ('{raw}'). Generate a strong secret with: openssl rand -hex 64")
        return
    if len(raw) < 32:
        _ERRORS.append(
            f"JWT_SECRET is too short ({len(raw)} characters). "
            "Use at least 32 characters: openssl rand -hex 64"
        )


def _check_db_url() -> None:
    """Warn if DB_URL contains default dev credentials in production."""
    if settings.environment == "production":
        db = settings.db_url.lower()
        unsafe_patterns = ["postgres:postgres@", "opentrust:opentrust_dev@", ":changeme@", ":password@"]
        for pattern in unsafe_patterns:
            if pattern in db:
                _WARNINGS.append(
                    f"DB_URL appears to use default/weak credentials (matched '{pattern}'). "
                    "Use a strong random password."
                )
                break


def _check_cors_origins() -> None:
    """Warn if CORS origins include localhost in production."""
    if settings.environment == "production":
        origins = settings.cors_origins.lower()
        if "localhost" in origins or "127.0.0.1" in origins:
            _WARNINGS.append(
                "CORS_ORIGINS includes localhost/127.0.0.1 in production. "
                "Set it to your actual domain(s) only."
            )


def _check_rate_limit() -> None:
    """Warn if rate limiting is disabled or very permissive in production."""
    if settings.environment == "production":
        raw = settings.rate_limit.strip()
        if raw == "0/0" or not raw:
            _WARNINGS.append(
                "Rate limiting is disabled (RATE_LIMIT=0/0). "
                "Set a sensible limit like 200/60 for production."
            )
        try:
            parts = raw.split("/")
            max_req = int(parts[0])
            if max_req == 0:
                _WARNINGS.append("Rate limiting max_requests is 0 — effectively disabled.")
        except (ValueError, IndexError):
            _WARNINGS.append(f"Could not parse RATE_LIMIT='{raw}'. Use format <max>/<window_seconds>.")


def _check_hsts() -> None:
    """Warn if HSTS is not enabled in production."""
    if settings.environment == "production" and not settings.security_hsts_enabled:
        _WARNINGS.append(
            "SECURITY_HSTS_ENABLED is not set to true in production. "
            "Enable HSTS once TLS is configured."
        )


def _check_wallet_encryption_secret() -> None:
    """Warn if WALLET_ENCRYPTION_SECRET is empty when embedded wallets are enabled."""
    if settings.opentrust_embedded_wallet_enabled:
        secret = settings.wallet_encryption_secret.strip()
        if not secret:
            _ERRORS.append(
                "WALLET_ENCRYPTION_SECRET is empty but OPENTRUST_EMBEDDED_WALLET_ENABLED=true. "
                "Generate a strong secret with: openssl rand -hex 32"
            )
        elif len(secret) < 32:
            _WARNINGS.append(
                f"WALLET_ENCRYPTION_SECRET is only {len(secret)} characters. "
                "Use at least 32 characters (64 hex chars from: openssl rand -hex 32)."
            )


def _check_admin_token() -> None:
    """In production the admin token MUST be set, else admin-gated endpoints
    (passport overwrite, revocation) fall open to anyone."""
    if settings.environment == "production" and not settings.registry_admin_token.strip():
        _ERRORS.append(
            "REGISTRY_ADMIN_TOKEN is empty in production. Admin endpoints would be "
            "unauthenticated. Set a strong token: openssl rand -hex 32"
        )


def _check_payment_config() -> None:
    """In production, live payment rails must have their verifying secrets set."""
    if settings.environment != "production":
        return
    if (settings.payment_provider or "").lower() == "coinbase" and not settings.coinbase_business_webhook_secret.strip():
        _ERRORS.append(
            "PAYMENT_PROVIDER=coinbase but COINBASE_BUSINESS_WEBHOOK_SECRET is empty — "
            "webhook signatures cannot be verified."
        )
    fee_or_escrow = settings.opentrust_escrow_enabled or settings.opentrust_marketplace_fee_enabled
    if fee_or_escrow and not settings.opentrust_registry_treasury_address.strip():
        _WARNINGS.append(
            "Escrow/fee flows are enabled but OPENTRUST_REGISTRY_TREASURY_ADDRESS is empty."
        )


def _check_escrow_wallet_config() -> None:
    """In production with escrow enabled, both wallet key and address are required."""
    if not settings.opentrust_escrow_enabled:
        return
    if not settings.escrow_wallet_private_key.strip():
        _ERRORS.append(
            "OPENTRUST_ESCROW_ENABLED=true but ESCROW_WALLET_PRIVATE_KEY is empty. "
            "Set the treasury wallet private key in .env (never commit it)."
        )
    if not settings.escrow_wallet_address.strip():
        _ERRORS.append(
            "OPENTRUST_ESCROW_ENABLED=true but ESCROW_WALLET_ADDRESS is empty. "
            "Set the treasury wallet address (0x…) in .env."
        )


def _check_trusted_proxies() -> None:
    """Warn if rate limiting is on in production without a trusted-proxy list, in
    which case the real client IP can't be derived behind a proxy/edge."""
    if settings.environment != "production":
        return
    rate_on = settings.rate_limit.strip() not in ("", "0/0")
    if rate_on and not os.environ.get("TRUSTED_PROXIES", "").strip():
        _WARNINGS.append(
            "RATE_LIMIT is set but TRUSTED_PROXIES is empty. Behind a proxy/edge the "
            "client IP cannot be trusted — set TRUSTED_PROXIES to your edge ranges."
        )


def _check_environment() -> None:
    """Log the environment mode."""
    _INFOS.append(f"Running in '{settings.environment}' mode")


def run_config_validation() -> None:
    """Run all production config checks. Logs warnings and raises on errors."""
    _INFOS.clear()
    _WARNINGS.clear()
    _ERRORS.clear()

    _check_environment()
    _check_jwt_secret()
    _check_admin_token()
    _check_payment_config()
    _check_escrow_wallet_config()
    _check_trusted_proxies()
    _check_db_url()
    _check_cors_origins()
    _check_rate_limit()
    _check_hsts()
    _check_wallet_encryption_secret()

    for msg in _INFOS:
        logger.info(msg)
    for msg in _WARNINGS:
        logger.warning(msg)
    for msg in _ERRORS:
        logger.error(msg)

    if _ERRORS and settings.environment == "production":
        print("FATAL: Production configuration validation failed:", file=sys.stderr)
        for msg in _ERRORS:
            print(f"  - {msg}", file=sys.stderr)
        print("Fix the above issues before starting the server.", file=sys.stderr)
        sys.exit(1)
