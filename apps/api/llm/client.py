"""Unified LLM access. Every completion in the API goes through here, via LiteLLM.

The agent never talks to a provider directly and never sees raw keys:
it receives a ResolvedLlm bound to the user's stored configuration.
"""

from dataclasses import dataclass

import litellm

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
            return content

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
        return content

    async def _call(
        self, messages: list[dict], max_tokens: int, temperature: float
    ) -> tuple[str, str | None]:
        response = await litellm.acompletion(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            api_key=self.api_key,
            api_base=self.api_base,
            extra_headers=self.extra_headers or {},
            timeout=240,
        )
        choice = response.choices[0]
        return (choice.message.content or "").strip(), choice.finish_reason


_PROVIDER_PREFIXES = {
    "openai": "openai/{model}",
    "anthropic": "anthropic/{model}",
    "gemini": "gemini/{model}",
    "groq": "groq/{model}",
    "openrouter": "openrouter/{model}",
}


async def resolve_llm(user_id: str) -> ResolvedLlm:
    row = await fetch_one("SELECT * FROM llm_config WHERE user_id = %s", user_id)
    if row is None:
        raise LlmNotConfigured(
            "No LLM configured. Choose Fiberarticle AI, bring your own key, or connect a local endpoint in Settings."
        )

    mode = row["mode"]
    settings = get_settings()

    if mode == "fiberarticle_ai":
        # Per-user toggle: max reasoning uses the (slow, thorough) reasoning
        # model; off uses a fast non-reasoning model. Falls back to the
        # reasoning model if no fast model is configured.
        want_reasoning = row["reasoning"] if row["reasoning"] is not None else True
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
