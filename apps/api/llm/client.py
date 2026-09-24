"""Unified LLM access. Every completion in the API goes through here, via LiteLLM.

The agent never talks to a provider directly and never sees raw keys:
it receives a ResolvedLlm bound to the user's stored configuration.
"""

import asyncio
import logging
import random
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import litellm

logger = logging.getLogger("fiberarticle.llm")

# Free provider tiers throttle by the minute and occasionally drop a request
# outright. A research run makes dozens of calls, so a single 429 must not
# silently cost the user a whole section of their review. Back off and retry.
_RETRY_ATTEMPTS = 4
_RETRY_DELAYS = (5.0, 12.0, 25.0)
_TRANSIENT_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
_TRANSIENT_NAMES = {
    "RateLimitError",
    "ServiceUnavailableError",
    "InternalServerError",
    "APIConnectionError",
    "APIError",
    "Timeout",
    "APITimeoutError",
}


def _is_transient(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and status in _TRANSIENT_STATUS:
        return True
    return type(exc).__name__ in _TRANSIENT_NAMES


def _refuses_classic_params(exc: Exception) -> bool:
    """Whether the provider refused max_tokens or a custom temperature, the way
    OpenAI's reasoning models (gpt-5, o-series) do: "Unsupported parameter:
    'max_tokens' is not supported with this model. Use 'max_completion_tokens'
    instead." LiteLLM adapts the call itself when it recognises the model
    name, but not for an Azure deployment or a custom endpoint named freely.
    """
    if getattr(exc, "status_code", None) != 400:
        return False
    text = str(exc)
    return "max_completion_tokens" in text or (
        "temperature" in text and "nsupported" in text
    )


# House style enforcement on every completion: no em/en dashes, no emojis.
# The prompts already forbid them; this is the guarantee for models that
# ignore instructions.
_EMOJI_RE = re.compile(
    "["
    "\U0001f300-\U0001faff"  # symbols, pictographs, extended
    "\U00002600-\U000027bf"  # misc symbols, dingbats
    "\U0001f1e6-\U0001f1ff"  # regional indicators
    "️"  # variation selector
    "]"
)


def _apply_style_rules(text: str) -> str:
    text = text.replace(" — ", ", ").replace("—", ", ")
    text = text.replace(" – ", ", ").replace("–", "-")
    return _EMOJI_RE.sub("", text)

from config import get_settings
from db import fetch_one
from security import decrypt_secret

litellm.suppress_debug_info = True
# Never log prompts, completions, or keys.
litellm.turn_off_message_logging = True


class LlmNotConfigured(Exception):
    pass


@dataclass
class ResolvedLlm:
    model: str
    api_key: str | None
    api_base: str | None
    mode: str
    extra_headers: dict | None = None
    reasoning: bool = False
    # Set once the model refused max_tokens or a custom temperature: from
    # then on it gets max_completion_tokens and its default temperature.
    reasoning_params: bool = False

    async def complete(
        self,
        messages: list[dict],
        max_tokens: int = 1200,
        temperature: float = 0.3,
    ) -> str:
        if not self.reasoning:
            content, finish = await self._call(messages, max_tokens, temperature)
            # Even "fast" managed models can emit hidden reasoning that eats the
            # token budget, leaving the visible answer truncated or empty. Both
            # break JSON parsing and cut prose mid-sentence. Retry once with far
            # more room whenever the reply was cut off or came back empty.
            if not content or finish == "length":
                content, _ = await self._call(
                    messages, max(max_tokens * 4, 4000), temperature
                )
            return _apply_style_rules(content)

        # Reasoning models spend most of the token budget on hidden reasoning
        # before the visible answer, and they keep that reasoning in a separate
        # `reasoning_content` channel. If the budget runs out mid-thought the
        # answer channel comes back empty; we must NOT surface the raw reasoning
        # transcript as the answer. Instead give generous headroom, and retry
        # once with more room if the model was truncated before it answered.
        budget = max(max_tokens * 6, 8000)
        content, finish = await self._call(messages, budget, temperature)
        if not content and finish == "length":
            content, _ = await self._call(messages, budget * 2, temperature)
        return _apply_style_rules(content)

    async def _call(
        self, messages: list[dict], max_tokens: int, temperature: float
    ) -> tuple[str, str | None]:
        attempt = -1
        while attempt < _RETRY_ATTEMPTS - 1:
            attempt += 1
            limits = (
                {"max_completion_tokens": max_tokens}
                if self.reasoning_params
                else {"max_tokens": max_tokens, "temperature": temperature}
            )
            try:
                response = await litellm.acompletion(
                    model=self.model,
                    messages=messages,
                    api_key=self.api_key,
                    api_base=self.api_base,
                    extra_headers=self.extra_headers or {},
                    timeout=240,
                    # Models LiteLLM knows to refuse a parameter (a custom
                    # temperature on gpt-5 or the o-series) get it translated
                    # or dropped instead of the whole call failing.
                    drop_params=True,
                    **limits,
                )
            except Exception as exc:
                if not self.reasoning_params and _refuses_classic_params(exc):
                    # Resend the way reasoning models take it. Not counted as
                    # an attempt: nothing was wrong with the connection.
                    self.reasoning_params = True
                    attempt -= 1
                    continue
                if attempt == _RETRY_ATTEMPTS - 1 or not _is_transient(exc):
                    raise
                # Jitter keeps concurrent sections from retrying in lockstep
                # and hitting the same per-minute quota all over again.
                delay = _RETRY_DELAYS[attempt] + random.uniform(0, 1.5)
                logger.info(
                    "%s from the provider; retrying in %.0fs (attempt %d of %d)",
                    type(exc).__name__,
                    delay,
                    attempt + 2,
                    _RETRY_ATTEMPTS,
                )
                await asyncio.sleep(delay)
                continue
            choice = response.choices[0]
            return (choice.message.content or "").strip(), choice.finish_reason
        raise RuntimeError("The model could not be reached after several retries.")


_PROVIDER_PREFIXES = {
    "openai": "openai/{model}",
    "anthropic": "anthropic/{model}",
    "gemini": "gemini/{model}",
    "groq": "groq/{model}",
    "openrouter": "openrouter/{model}",
}

# Azure OpenAI and Microsoft Foundry resource hosts. Each serves the v1 API
# at /openai/v1, which takes the resource key the same way OpenAI does.
_AZURE_HOST_SUFFIXES = (
    ".openai.azure.com",
    ".services.ai.azure.com",
    ".cognitiveservices.azure.com",
)


def azure_openai_base(endpoint: str | None) -> str | None:
    """The v1 API base URL of an Azure OpenAI or Foundry resource, from
    whatever the user pasted: the bare endpoint, the v1 URL, a project URL or
    a full deployment URL copied from the portal. None when it is none of
    these, so the key is only ever sent to Microsoft's own hosts."""
    if not endpoint:
        return None
    try:
        parsed = urlsplit(endpoint.strip())
        host = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme != "https" or port not in (None, 443):
        return None
    if not host.endswith(_AZURE_HOST_SUFFIXES):
        return None
    return f"https://{host}/openai/v1"


async def resolve_llm(user_id: str) -> ResolvedLlm:
    row = await fetch_one("SELECT * FROM llm_config WHERE user_id = %s", user_id)
    if row is None:
        # Zero-setup default: accounts without a saved config use managed
        # Fiberarticle AI with the fast (non-reasoning) model.
        row = {"mode": "fiberarticle_ai", "reasoning": False}

    mode = row["mode"]
    settings = get_settings()

    if mode == "fiberarticle_ai":
        # Per-user toggle: max reasoning uses the (slow, thorough) reasoning
        # model; off (the default) uses the fast non-reasoning model. Falls
        # back to the reasoning model if no fast model is configured.
        want_reasoning = bool(row.get("reasoning"))
        reasoning_model = settings.fiberarticle_ai_model
        fast_model = settings.fiberarticle_ai_fast_model or reasoning_model
        model = reasoning_model if want_reasoning else fast_model
        if not model:
            raise LlmNotConfigured(
                "Fiberarticle AI is not available in this environment yet. Bring your own key or connect a local endpoint in Settings."
            )
        is_reasoning = want_reasoning and ("deepseek" in model or "reason" in model)
        if settings.fiberarticle_ai_api_key:
            return ResolvedLlm(
                model=f"openai/{model}",
                api_key=settings.fiberarticle_ai_api_key,
                api_base=settings.fiberarticle_ai_base_url,
                mode=mode,
                reasoning=is_reasoning,
            )
        # Keyless free-tier models: the endpoint rejects any Authorization
        # header, so send an explicitly blank one (the SDK insists on a key).
        return ResolvedLlm(
            model=f"openai/{model}",
            api_key="zen-free",
            api_base=settings.fiberarticle_ai_base_url,
            mode=mode,
            extra_headers={"Authorization": ""},
            reasoning=is_reasoning,
        )

    api_key = decrypt_secret(row["encrypted_key"]) if row["encrypted_key"] else None
    model = row["model"]
    provider = row["provider"]
    base_url = row["base_url"]

    if mode == "local":
        if not base_url or not model:
            raise LlmNotConfigured("Local LLM needs a base URL and a model in Settings.")
        return ResolvedLlm(
            model=f"openai/{model}",
            api_key=api_key or "local",
            api_base=base_url,
            mode=mode,
        )

    # BYOK
    if not model:
        raise LlmNotConfigured("Choose a model for your provider in Settings.")
    if provider in _PROVIDER_PREFIXES:
        return ResolvedLlm(
            model=_PROVIDER_PREFIXES[provider].format(model=model),
            api_key=api_key,
            api_base=None,
            mode=mode,
        )
    if provider == "zen":
        return ResolvedLlm(
            model=f"openai/{model}",
            api_key=api_key,
            api_base="https://opencode.ai/zen/v1",
            mode=mode,
        )
    if provider == "azure":
        # The model is the deployment name, as Azure routes by deployment.
        azure_base = azure_openai_base(base_url)
        if not azure_base:
            raise LlmNotConfigured(
                "Azure OpenAI needs your resource endpoint in Settings, for example https://my-resource.openai.azure.com"
            )
        return ResolvedLlm(
            model=f"openai/{model}",
            api_key=api_key,
            api_base=azure_base,
            mode=mode,
        )
    if provider == "custom":
        if not base_url:
            raise LlmNotConfigured("Custom providers need a base URL in Settings.")
        return ResolvedLlm(
            model=f"openai/{model}",
            api_key=api_key,
            api_base=base_url,
            mode=mode,
        )
    raise LlmNotConfigured(f"Unknown provider '{provider}'. Update your Settings.")
