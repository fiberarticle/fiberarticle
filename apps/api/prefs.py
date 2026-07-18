"""Per-user preferences: global citation style and AI generation language.

The citation style is any CSL id from the catalog (citations.catalog). The
language is threaded into every prose-generating prompt via
language_instruction(); English variants add nothing so default behavior is
untouched.
"""

from db import execute, fetch_one

DEFAULT_CITATION_STYLE = "apa"
DEFAULT_LANGUAGE = "en-US"

# value -> English label shown in the UI.
LANGUAGES: dict[str, str] = {
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "hi": "Hindi",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "it": "Italian",
    "nl": "Dutch",
    "tr": "Turkish",
    "ru": "Russian",
    "ar": "Arabic",
    "zh": "Chinese (Simplified)",
    "ja": "Japanese",
    "ko": "Korean",
}


async def get_prefs(user_id: str) -> dict:
    row = await fetch_one(
        "SELECT citation_style, ai_language FROM user_prefs WHERE user_id = %s",
        user_id,
    )
    if row is None:
        return {
            "citation_style": DEFAULT_CITATION_STYLE,
            "ai_language": DEFAULT_LANGUAGE,
        }
    return dict(row)


async def set_prefs(
    user_id: str, citation_style: str | None, ai_language: str | None
) -> dict:
    current = await get_prefs(user_id)
    style = citation_style or current["citation_style"]
    language = ai_language or current["ai_language"]
    await execute(
        """
        INSERT INTO user_prefs (user_id, citation_style, ai_language)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id) DO UPDATE SET
            citation_style = EXCLUDED.citation_style,
            ai_language = EXCLUDED.ai_language,
            updated_at = now()
        """,
        user_id,
        style,
        language,
    )
    return {"citation_style": style, "ai_language": language}


# House writing style, appended to every prose-generating prompt.
STYLE_RULES = (
    " Never use em dashes or en dashes anywhere in your writing; use commas, "
    "colons, or parentheses instead. Never use emojis."
)


async def language_instruction(user_id: str) -> str:
    """House style rules plus the user's writing language, appended to
    system prompts. The style rules always apply."""
    prefs = await get_prefs(user_id)
    language = prefs["ai_language"]
    if language.startswith("en"):
        return STYLE_RULES
    name = LANGUAGES.get(language, language)
    return STYLE_RULES + (
        f" Write all prose in {name}. Keep technical terms, paper titles, and "
        "citation markers exactly as they are."
    )
