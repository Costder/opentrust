from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    db_url: str = "sqlite+aiosqlite:///./opentrust.db"
    github_client_id: str = ""
    github_client_secret: str = ""
    jwt_secret: str = "change_me"
    payment_provider: str | None = None
    circle_api_key: str | None = None
    cors_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
