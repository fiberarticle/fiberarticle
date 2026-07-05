"""Reference-list interchange: BibTeX and RIS serialization plus a forgiving
BibTeX parser. Presentation-quality citation formatting lives in
citations.engine (CSL via citeproc-py); this module only handles data formats
for Zotero, Mendeley, and LaTeX workflows.
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


def to_ris(papers: list[dict]) -> str:
    entries = []
    for paper in papers:
        lines = ["TY  - JOUR"]
        for author in paper.get("authors") or []:
            lines.append(f"AU  - {author}")
        lines.append(f"TI  - {paper.get('title') or 'Untitled'}")
        if paper.get("year"):
            lines.append(f"PY  - {paper['year']}")
        if paper.get("venue"):
            lines.append(f"JO  - {paper['venue']}")
        if paper.get("doi"):
            lines.append(f"DO  - {paper['doi']}")
        if paper.get("url"):
            lines.append(f"UR  - {paper['url']}")
        if paper.get("abstract"):
            lines.append(f"AB  - {paper['abstract']}")
        lines.append("ER  - ")
        entries.append("\n".join(lines))
    return "\n".join(entries) + "\n"


_BIB_ENTRY_RE = re.compile(r"@\w+\s*\{\s*([^,]+),(.*?)\n\}", re.DOTALL)
_BIB_FIELD_RE = re.compile(r"(\w+)\s*=\s*[{\"](.*?)[}\"]\s*,?\s*\n", re.DOTALL)


def parse_bibtex(text: str) -> list[dict]:
    """Small forgiving BibTeX parser covering the common single-brace form."""
    papers: list[dict] = []
    for match in _BIB_ENTRY_RE.finditer(text + "\n"):
        raw_fields = match.group(2) + "\n"
        fields = {
            k.lower(): re.sub(r"\s+", " ", v).strip().strip("{}").strip()
            for k, v in _BIB_FIELD_RE.findall(raw_fields)
        }
        title = fields.get("title")
        if not title:
            continue
        authors = [
            a.strip()
            for a in re.split(r"\s+and\s+", fields.get("author", ""))
            if a.strip()
        ]
        # "Surname, Given" -> "Given Surname"
        authors = [
            f"{p[1].strip()} {p[0].strip()}" if len(p := a.split(",", 1)) == 2 else a
            for a in authors
        ]
        year_text = re.sub(r"\D", "", fields.get("year", ""))[:4]
        papers.append(
            {
                "title": title,
                "authors": authors,
                "year": int(year_text) if year_text else None,
                "venue": fields.get("journal") or fields.get("booktitle"),
                "doi": (fields.get("doi") or "").lower() or None,
                "url": fields.get("url"),
                "abstract": fields.get("abstract"),
            }
        )
    return papers
