"""Application settings loaded from environment variables (.env)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    supabase_jwt_secret: str

    # CORS — comma-separated exact origins (prod host, localhost), parsed via
    # cors_origins. For per-issue Vercel previews, set cors_allowed_origin_regex
    # to a pattern that covers all preview frontends (see docs/deployment.md).
    cors_allowed_origins: str = "http://localhost:5000"
    cors_allowed_origin_regex: str = ""

    # App
    app_env: str = "development"
    log_level: str = "INFO"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


settings = Settings()
