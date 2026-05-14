from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    db_url: str = "sqlite+aiosqlite:///./opentrust.db"
    github_client_id: str = ""
    github_client_secret: str = ""
    github_app_id: str = ""
    github_app_client_id: str = ""
    github_app_client_secret: str = ""
    github_app_private_key_path: str = ""
    github_app_webhook_secret: str = ""
    jwt_secret: str = ""  # Required — set JWT_SECRET in .env
    payment_provider: str | None = "mock"
    circle_api_key: str | None = None
    cors_origins: str = "http://localhost:3000"
    opentrust_price_trust_report_usdc: str = "19.00"
    opentrust_price_verified_badge_usdc: str = "49.00"
    opentrust_price_monitoring_monthly_usdc: str = "19.00"
    opentrust_raw_scan_purchase_enabled: bool = False
    opentrust_marketplace_enabled: bool = True
    opentrust_customer_wallets_enabled: bool = True
    opentrust_byo_wallet_enabled: bool = True
    opentrust_embedded_wallet_enabled: bool = False
    opentrust_custodial_wallets_enabled: bool = False
    opentrust_escrow_enabled: bool = False
    opentrust_marketplace_fee_enabled: bool = False
    coinbase_business_api_key_id: str = ""
    coinbase_business_api_key_secret: str = ""
    coinbase_business_webhook_secret: str = ""
    coinbase_business_checkout_currency: str = "USDC"

    model_config = SettingsConfigDict(env_file=(".env", ".env.marketplace"), extra="ignore")


settings = Settings()
