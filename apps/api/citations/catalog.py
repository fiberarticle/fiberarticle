"""Searchable catalog of every CSL citation style.

csl/index.json is built once by scripts/build_csl_index.py from the official
citation-style-language/styles repository: 10,000+ styles covering the
standard guides (APA, MLA, Chicago, IEEE, Vancouver, ...) and per-journal
styles. Dependent styles (journal aliases) carry a "parent" pointing at the
independent style that actually defines the formatting.
"""

import json
from functools import lru_cache
from pathlib import Path

CSL_DIR = Path(__file__).resolve().parent.parent / "csl"

# Shown first in the picker when the search box is empty, in this order.
POPULAR_IDS: list[str] = [
    "apa",
    "apa-6th-edition",
    "modern-language-association",
    "chicago-author-date",
    "chicago-notes-bibliography",
    "ieee",
    "vancouver-nlm",
    "harvard-cite-them-right",
    "american-medical-association",
    "american-chemical-society",
    "cse-name-year",
    "nature",
    "science",
    "acm-sig-proceedings",
    "elsevier-harvard",
    "springer-basic-author-date",
    "oscola",
    "turabian-author-date",
]


@lru_cache
def _index() -> list[dict]:
    path = CSL_DIR / "index.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache
def _by_id() -> dict[str, dict]:
    return {entry["id"]: entry for entry in _index()}


def entry(style_id: str) -> dict | None:
    return _by_id().get(style_id)


def style_title(style_id: str) -> str | None:
    found = entry(style_id)
    return found["title"] if found else None


def style_format(style_id: str) -> str | None:
    """Citation format: numeric, author-date, author, note, or label.

    Dependent styles usually declare their own format; fall back to the
    parent's when absent.
    """
    found = entry(style_id)
    if found is None:
        return None
    if found.get("format"):
        return found["format"]
    parent = found.get("parent")
    if parent:
        parent_entry = entry(parent)
        if parent_entry:
            return parent_entry.get("format")
    return None


def popular() -> list[dict]:
    by_id = _by_id()
    return [by_id[sid] for sid in POPULAR_IDS if sid in by_id]


def search(query: str, limit: int = 50) -> list[dict]:
    """Rank: exact title, title prefix, word prefix, substring, id substring."""
    q = query.strip().lower()
    if not q:
        return popular()[:limit]
    scored: list[tuple[int, int, dict]] = []
    for item in _index():
        title = item["title"].lower()
        if title == q:
            rank = 0
        elif title.startswith(q):
            rank = 1
        elif any(word.startswith(q) for word in title.split()):
            rank = 2
        elif q in title:
            rank = 3
        elif q in item["id"]:
            rank = 4
        else:
            continue
        scored.append((rank, len(title), item))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [item for _, _, item in scored[:limit]]
