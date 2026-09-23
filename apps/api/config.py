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

    # Razorpay. The key pair decides test or live mode by its prefix
    # (rzp_test_ / rzp_live_); the webhook secret is the one typed into the
    # Razorpay dashboard for /v1/billing/webhook. With no key set, the paywall
    # still shows but says payments are not open yet.
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    # Full access is one SKU, priced in US dollars and charged in rupees at
    # the day's exchange rate.
    full_access_price_usd: int = 200

    # Razorpay takes its fee out of every payment. The buyer pays it on top
    # of the plan price, so the full plan price reaches the account: 2%
    # platform fee plus 18% GST on that fee, the standard rate for Indian
    # cards, UPI, netbanking and wallets. Change these if Razorpay's pricing
    # for the account changes.
    razorpay_fee_percent: float = 2.0
    razorpay_fee_gst_percent: float = 18.0

    # Shared with the web app (INTERNAL_API_SECRET there too). The API uses it
    # to ask the web app to send the "full access" email, since the email
    # templates and the Resend key live on the web side.
    internal_api_secret: str = ""

    @property
    def jwks_url(self) -> str:
        return f"{self.web_url}/api/auth/jwks"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
