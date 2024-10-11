import xml.etree.ElementTree as ET

from sources.base import PaperRecord
from util.retry import get_with_retry

_NS = {"atom": "http://www.w3.org/2005/Atom"}


async def search(query: str, limit: int = 15) -> list[PaperRecord]:
    params = {
        "search_query": f"all:{query}",
        "start": 0,
        "max_results": limit,
        "sortBy": "relevance",
    }
    res = await get_with_retry(
        "https://export.arxiv.org/api/query", params=params, base_delay=3.0
    )
    res.raise_for_status()

    root = ET.fromstring(res.text)
    papers: list[PaperRecord] = []
    for entry in root.findall("atom:entry", _NS):
        arxiv_id = (entry.findtext("atom:id", "", _NS) or "").rsplit("/", 1)[-1]
        title = " ".join((entry.findtext("atom:title", "", _NS) or "").split())
        if not title:
            continue
        abstract = " ".join((entry.findtext("atom:summary", "", _NS) or "").split())
        published = entry.findtext("atom:published", "", _NS) or ""
        year = int(published[:4]) if published[:4].isdigit() else None
        authors = [
            a.findtext("atom:name", "", _NS) or ""
            for a in entry.findall("atom:author", _NS)
        ]
        pdf_url = None
        page_url = None
        for link in entry.findall("atom:link", _NS):
            if link.get("title") == "pdf":
                pdf_url = link.get("href")
            elif link.get("rel") == "alternate":
                page_url = link.get("href")
        papers.append(
            PaperRecord(
                source="arxiv",
                external_id=arxiv_id,
                title=title,
                authors=[a for a in authors if a],
                year=year,
                venue="arXiv",
                doi=None,
                url=page_url or f"https://arxiv.org/abs/{arxiv_id}",
                abstract=abstract or None,
                is_open_access=True,
                oa_pdf_url=pdf_url or f"https://arxiv.org/pdf/{arxiv_id}",
                cited_by_count=0,
            )
        )
    return papers
