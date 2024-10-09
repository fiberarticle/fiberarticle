"""Citation formatting and reference-list export.

Formats a paper's metadata into common citation styles and serializes
libraries to BibTeX and RIS for interoperability with Zotero, Mendeley,
and LaTeX workflows.
"""

import re

STYLES = ["apa", "mla", "chicago", "ieee", "vancouver", "harvard"]


def _surname(author: str) -> str:
    parts = author.strip().split()
    return parts[-1] if parts else author


def _given(author: str) -> list[str]:
    parts = author.strip().split()
    return parts[:-1] if len(parts) > 1 else []


def _initials(author: str, dotted: bool = True) -> str:
    sep = ". " if dotted else " "
    text = sep.join(p[0].upper() for p in _given(author))
    return text + ("." if dotted and text else "")


def format_citation(paper: dict, style: str) -> str:
    authors: list[str] = paper.get("authors") or []
    year = paper.get("year") or "n.d."
    title = (paper.get("title") or "Untitled").rstrip(".")
    venue = paper.get("venue")
    doi = paper.get("doi")
    url = paper.get("url")
    locator = f"https://doi.org/{doi}" if doi else (url or "")

    if style == "apa":
        names = []
        for a in authors[:20]:
            initials = _initials(a)
            names.append(f"{_surname(a)}, {initials}" if initials else _surname(a))
        if not names:
            author_str = ""
        elif len(names) == 1:
            author_str = names[0]
        else:
            author_str = ", ".join(names[:-1]) + f", & {names[-1]}"
        venue_str = f" {venue}." if venue else ""
        head = f"{author_str} " if author_str else ""
        return f"{head}({year}). {title}.{venue_str} {locator}".strip()

    if style == "mla":
        if not authors:
            author_str = ""
        elif len(authors) == 1:
            a = authors[0]
            author_str = f"{_surname(a)}, {' '.join(_given(a))}".rstrip(", ")
        else:
            a = authors[0]
            author_str = f"{_surname(a)}, {' '.join(_given(a))}, et al."
        venue_str = f" {venue}," if venue else ""
        head = f"{author_str} " if author_str else ""
        return f'{head}"{title}."{venue_str} {year}, {locator}'.strip().rstrip(",")

    if style == "chicago":
        author_str = ", ".join(authors[:10])
        venue_str = f" {venue}" if venue else ""
        head = f"{author_str}. " if author_str else ""
        return f'{head}"{title}."{venue_str} ({year}). {locator}'.strip()

    if style == "ieee":
        names = [
            f"{_initials(a)} {_surname(a)}".strip() for a in authors[:6]
        ]
        author_str = ", ".join(n for n in names if n)
        if len(authors) > 6:
            author_str += " et al."
        venue_str = f" {venue}," if venue else ""
        head = f"{author_str}, " if author_str else ""
        return f'{head}"{title},"{venue_str} {year}. {locator}'.strip()

    if style == "vancouver":
        names = [
            f"{_surname(a)} {_initials(a, dotted=False)}".strip() for a in authors[:6]
        ]
        author_str = ", ".join(n for n in names if n)
        if len(authors) > 6:
            author_str += ", et al"
        venue_str = f" {venue}." if venue else ""
        head = f"{author_str}. " if author_str else ""
        return f"{head}{title}.{venue_str} {year}. {locator}".strip()

    # harvard
    names = []
    for a in authors[:10]:
        initials = _initials(a)
        names.append(f"{_surname(a)}, {initials}" if initials else _surname(a))
    author_str = " and ".join([", ".join(names[:-1]), names[-1]]) if len(names) > 1 else (names[0] if names else "")
    venue_str = f" {venue}." if venue else ""
    head = f"{author_str} " if author_str else ""
    return f"{head}({year}) '{title}'.{venue_str} Available at: {locator}".strip()


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
