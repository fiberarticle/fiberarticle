from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://fiberarticle:fiberarticle@localhost:5432/fiberarticle"
    web_url: str = "http://localhost:3000"
    allowed_origins: str = "http://localhost:3000"
    key_encryption_secret: str = "change-me-long-random-string"

    fiberarticle_ai_api_key: str = ""
    fiberarticle_ai_base_url: str = "https://opencode.ai/zen/v1"
    fiberarticle_ai_model: str = ""
    # Fast, non-reasoning model used when the user turns max reasoning off.
    fiberarticle_ai_fast_model: str = ""

    contact_email: str = "noreply@fiberarticle.com"

    @property
    def jwks_url(self) -> str:
        return f"{self.web_url}/api/auth/jwks"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
