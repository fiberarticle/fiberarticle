import httpx

from config import get_settings


async def find_oa_pdf(doi: str) -> str | None:
    """Look up an open-access PDF for a DOI via Unpaywall. Never circumvents paywalls."""
    params = {"email": get_settings().contact_email}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(
                f"https://api.unpaywall.org/v2/{doi}", params=params
            )
            if res.status_code != 200:
                return None
            data = res.json()
    except httpx.HTTPError:
        return None
    location = data.get("best_oa_location") or {}
    return location.get("url_for_pdf")
