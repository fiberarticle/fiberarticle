"""HTTP retry with exponential backoff and jitter for flaky scholarly APIs.

arXiv rate-limits aggressively (429) and OpenAlex intermittently returns 503;
both deserve a couple of patient retries instead of failing the whole search.
"""

import asyncio
import random

import httpx

_RETRYABLE = {429, 500, 502, 503, 504}


async def get_with_retry(
    url: str,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = 20,
    attempts: int = 3,
    base_delay: float = 1.5,
) -> httpx.Response:
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for attempt in range(attempts):
            try:
                res = await client.get(url, params=params, headers=headers)
                if res.status_code in _RETRYABLE and attempt < attempts - 1:
                    retry_after = res.headers.get("Retry-After")
                    if retry_after and retry_after.isdigit():
                        delay = min(float(retry_after), 15.0)
                    else:
                        delay = base_delay * (2**attempt) + random.uniform(0, 0.5)
                    await asyncio.sleep(delay)
                    continue
                return res
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt < attempts - 1:
                    await asyncio.sleep(base_delay * (2**attempt) + random.uniform(0, 0.5))
                    continue
                raise
    raise last_exc if last_exc else RuntimeError("unreachable")
