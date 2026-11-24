"""PostHog for the API: product events, error tracking, AI monitoring and logs.

Everything here does nothing until POSTHOG_API_KEY is set, so local
development and a missing key never change how the API behaves. No call in
this module ever raises: telemetry is never worth failing a request or a run.

- capture(): product events for funnels (run started, purchase completed).
- Errors: the ASGI middleware added in main.py reports exceptions that escape
  a route, and a logging handler reports every logger.exception(...) the
  code already makes, such as a failed run. PostHog skips an exception it has
  already seen, so nothing is reported twice.
- AI: every LLM call made through llm/client.py becomes one $ai_generation
  event with the prompt, the answer, tokens and timing. bind() names the work
  the calls belong to (a run, a chat, an article) so PostHog groups them.
- Logs: standard Python logging is shipped to PostHog Logs over OpenTelemetry.
"""

import contextvars
import logging
import time
import uuid
from typing import Any

from config import get_settings

logger = logging.getLogger("fiberarticle.telemetry")

_client = None
_logger_provider = None

# Who and what the LLM calls and errors on this task belong to. Set by bind();
# asyncio copies it into every task started afterwards, so a whole run or chat
# shares one value.
_scope: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "fiberarticle_telemetry_scope", default=None
)

# Loggers kept out of PostHog Logs below WARNING: the exporters themselves
# (shipping their own logs would loop) and httpx, which writes one line for
# every outgoing request a research run makes.
_QUIET_LOGGERS = ("opentelemetry", "urllib3", "posthog", "httpx", "httpcore", "hpack")


def client():
    """The PostHog client, or None when telemetry is off."""
    return _client


def setup() -> None:
    """Start PostHog once, at API startup. Safe to call more than once."""
    global _client
    settings = get_settings()
    if _client is not None or not settings.posthog_api_key:
        return
    try:
        from posthog import Posthog

        _client = Posthog(
            settings.posthog_api_key,
            host=settings.posthog_host,
            enable_exception_autocapture=True,
            # The server's IP is not the user's location.
            disable_geoip=True,
        )
        root = logging.getLogger()
        root.addHandler(_ExceptionHandler())
        _setup_logs(settings, root)
        logger.info("PostHog telemetry is on")
    except Exception:
        _client = None
        logger.exception("PostHog telemetry could not start; continuing without it")


def _setup_logs(settings, root: logging.Logger) -> None:
    global _logger_provider
    try:
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.resources import Resource

        provider = LoggerProvider(
            resource=Resource.create({"service.name": "fiberarticle-api"})
        )
        set_logger_provider(provider)
        provider.add_log_record_processor(
            BatchLogRecordProcessor(
                OTLPLogExporter(
                    endpoint=f"{settings.posthog_host.rstrip('/')}/i/v1/logs",
                    headers={"Authorization": f"Bearer {settings.posthog_api_key}"},
                )
            )
        )
        handler = LoggingHandler(level=logging.INFO, logger_provider=provider)
        handler.addFilter(_not_quiet)
        root.addHandler(handler)
        _logger_provider = provider
    except Exception:
        logger.exception("PostHog Logs could not start; events and errors still work")


def _not_quiet(record: logging.LogRecord) -> bool:
    if record.levelno >= logging.WARNING:
        return True
    return not record.name.startswith(_QUIET_LOGGERS)


class _ExceptionHandler(logging.Handler):
    """Turns logger.exception(...) anywhere in the API into a PostHog error."""

    def __init__(self) -> None:
        super().__init__(level=logging.ERROR)

    def emit(self, record: logging.LogRecord) -> None:
        if _client is None or not record.exc_info or record.exc_info[1] is None:
            return
        try:
            scope = _scope.get() or {}
            kwargs: dict[str, Any] = {
                "properties": {
                    "logger": record.name,
                    "log_message": record.getMessage()[:1000],
                    **_scope_properties(scope),
                }
            }
            if scope.get("user_id"):
                kwargs["distinct_id"] = scope["user_id"]
            _client.capture_exception(record.exc_info[1], **kwargs)
        except Exception:
            pass


def shutdown() -> None:
    """Send whatever is still queued. Called when the API stops."""
    try:
        if _client is not None:
            _client.shutdown()
        if _logger_provider is not None:
            _logger_provider.shutdown()
    except Exception:
        pass


def capture(user_id: str | None, event: str, properties: dict | None = None) -> None:
    """A product event for one user, for funnels and trends."""
    if _client is None or not user_id:
        return
    try:
        _client.capture(event, distinct_id=str(user_id), properties=properties or {})
    except Exception:
        logger.debug("PostHog capture failed for %s", event, exc_info=True)


def bind(
    user_id: str | None,
    name: str,
    trace_id: str | None = None,
    session_id: str | None = None,
) -> None:
    """Name the work the following LLM calls and errors belong to.

    name: what it is, for example "research run" or "assistant chat".
    trace_id: groups the calls of one piece of work (a run id). Without it,
        each call is its own trace.
    session_id: groups traces that belong together, such as the turns of one
        chat or the edits of one article.
    """
    _scope.set(
        {
            "user_id": str(user_id) if user_id else None,
            "name": name,
            "trace_id": str(trace_id) if trace_id else None,
            "session_id": str(session_id) if session_id else None,
        }
    )


def _scope_properties(scope: dict) -> dict:
    props: dict[str, Any] = {}
    if scope.get("name"):
        props["work"] = scope["name"]
    if scope.get("trace_id"):
        props["work_id"] = scope["trace_id"]
    return props


def ai_generation(
    llm: Any,
    messages: list[dict],
    limits: dict,
    started: float,
    response: Any = None,
    error: BaseException | None = None,
) -> None:
    """One $ai_generation event for one LLM call, successful or not.

    llm is the ResolvedLlm that made the call; started is time.monotonic()
    taken just before it. The API key never leaves the ResolvedLlm.
    """
    if _client is None:
        return
    try:
        scope = _scope.get() or {}
        user_id = getattr(llm, "user_id", None) or scope.get("user_id")
        provider, _, model = (llm.model or "").partition("/")
        if not model:
            provider, model = "unknown", llm.model or "unknown"
        props: dict[str, Any] = {
            "$ai_trace_id": scope.get("trace_id") or str(uuid.uuid4()),
            "$ai_session_id": scope.get("session_id"),
            "$ai_span_name": scope.get("name") or "llm call",
            "$ai_model": model,
            "$ai_provider": provider,
            "$ai_base_url": llm.api_base,
            "$ai_input": messages,
            "$ai_latency": round(time.monotonic() - started, 3),
            "$ai_max_tokens": limits.get("max_tokens") or limits.get("max_completion_tokens"),
            "$ai_temperature": limits.get("temperature"),
            "$ai_stream": False,
            "llm_mode": llm.mode,
            "reasoning": bool(llm.reasoning),
        }
        if response is not None:
            choice = response.choices[0]
            usage = getattr(response, "usage", None)
            props.update(
                {
                    "$ai_output_choices": [
                        {"role": "assistant", "content": choice.message.content or ""}
                    ],
                    "$ai_stop_reason": choice.finish_reason,
                    "$ai_http_status": 200,
                    "$ai_input_tokens": getattr(usage, "prompt_tokens", None),
                    "$ai_output_tokens": getattr(usage, "completion_tokens", None),
                }
            )
        if error is not None:
            props.update(
                {
                    "$ai_is_error": True,
                    "$ai_error": f"{type(error).__name__}: {error}"[:2000],
                    "$ai_http_status": getattr(error, "status_code", None),
                }
            )
        kwargs: dict[str, Any] = {"properties": props}
        if user_id:
            kwargs["distinct_id"] = str(user_id)
        # capture_ai takes events up to 8 MB; prompts carrying paper text can
        # pass the 1 MB limit of a normal capture.
        _client.capture_ai("$ai_generation", **kwargs)
    except Exception:
        logger.debug("PostHog AI capture failed", exc_info=True)
