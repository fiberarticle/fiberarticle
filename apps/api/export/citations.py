"""BibTeX serialization for the LaTeX export (refs.bib). Presentation-quality
citation formatting lives in citations.engine (CSL via citeproc-py).
"""

import re


def _surname(author: str) -> str:
    parts = author.strip().split()
    return parts[-1] if parts else author


def _bibtex_key(paper: dict) -> str:
    authors = paper.get("authors") or []
    surname = _surname(authors[0]) if authors else "anon"
    year = paper.get("year") or "nd"
    word = re.sub(r"[^a-zA-Z]", "", (paper.get("title") or "x").split()[0])[:12]
    return re.sub(r"[^a-zA-Z0-9]", "", f"{surname}{year}{word}").lower()


def _bibtex_escape(text: str) -> str:
    return text.replace("{", "\\{").replace("}", "\\}").replace("&", "\\&")


def to_bibtex(papers: list[dict]) -> str:
    entries = []
    seen_keys: set[str] = set()
    for paper in papers:
        key = _bibtex_key(paper)
        while key in seen_keys:
            key += "x"
        seen_keys.add(key)
        fields = {
            "title": _bibtex_escape(paper.get("title") or "Untitled"),
            "author": " and ".join(paper.get("authors") or []),
            "year": str(paper.get("year") or ""),
            "journal": _bibtex_escape(paper.get("venue") or ""),
            "doi": paper.get("doi") or "",
            "url": paper.get("url") or "",
        }
        body = ",\n".join(
            f"  {name} = {{{value}}}" for name, value in fields.items() if value
        )
        entries.append(f"@article{{{key},\n{body}\n}}")
    return "\n\n".join(entries) + "\n"
