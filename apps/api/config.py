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

    # Full access is one SKU, priced and charged in Indian rupees (whole
    # rupees). Razorpay's fee is added on top of it, see billing.quote().
    full_access_price_inr: int = 19999

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

    # Microsoft Marketplace ("Sell through Microsoft" SaaS offer). These are
    # the single-tenant Entra app named in the offer's technical
    # configuration: the API signs in with it to call the SaaS Fulfillment
    # API, and Microsoft addresses every webhook call to it. With them blank
    # the marketplace routes answer 503 and nothing else changes.
    marketplace_tenant_id: str = ""
    marketplace_client_id: str = ""
    marketplace_client_secret: str = ""
    # The offer id in Partner Center. When set, purchases of any other offer
    # are refused, so a token for someone else's offer can never unlock this
    # app.
    marketplace_offer_id: str = ""
    # Only changed to point at Microsoft's SaaS API emulator in development.
    marketplace_api_base: str = "https://marketplaceapi.microsoft.com/api"
    # Comma-separated app ids allowed to call the webhook. Microsoft's own
    # marketplace service is the only production caller; the emulator used
    # in development signs its calls as our own app, so a dev machine adds
    # MARKETPLACE_CLIENT_ID here. Never add anything in production.
    marketplace_webhook_extra_app_ids: str = ""

    @property
    def jwks_url(self) -> str:
        return f"{self.web_url}/api/auth/jwks"

    @property
    def marketplace_configured(self) -> bool:
        return bool(
            self.marketplace_tenant_id
            and self.marketplace_client_id
            and self.marketplace_client_secret
        )

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
