"""Render a Fiberarticle document to .docx in journal-style templates.

Templates:
- generic: single column, Calibri, numbered headings, numeric [n] citations.
- ieee: Times New Roman 10pt body, two-column layout, IEEE-style headings and
  numeric reference list.
- apa: Times New Roman 12pt, double spacing, APA 7 manuscript conventions,
  author-date in-text citations (converted from [n] markers) and a hanging
  indent reference list.

The document JSON remains the source of truth; the .docx is only a render.
"""

import io
import re

from docx import Document as DocxDocument
from docx.enum.section import WD_SECTION_START
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Inches, Pt

_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_PLACEHOLDER_RE = re.compile(r"^\[.*placeholder.*\]$", re.IGNORECASE)


def _surname(author: str) -> str:
    parts = author.strip().split()
    return parts[-1] if parts else author


def _apa_in_text(match: re.Match, papers: list[dict]) -> str:
    cites = []
    for num in [int(n) for n in match.group(1).replace(" ", "").split(",")]:
        if 1 <= num <= len(papers):
            paper = papers[num - 1]
            authors = paper.get("authors") or []
            year = paper.get("year") or "n.d."
            if not authors:
                cites.append(f"{paper['title'][:24]}..., {year}")
            elif len(authors) == 1:
                cites.append(f"{_surname(authors[0])}, {year}")
            elif len(authors) == 2:
                cites.append(
                    f"{_surname(authors[0])} & {_surname(authors[1])}, {year}"
                )
            else:
                cites.append(f"{_surname(authors[0])} et al., {year}")
        else:
            cites.append(match.group(0))
    return f"({'; '.join(cites)})"


def _format_reference(paper: dict, style: str, index: int) -> str:
    authors = paper.get("authors") or []
    year = paper.get("year") or "n.d."
    title = paper["title"].rstrip(".")
    venue = paper.get("venue")
    doi = paper.get("doi")
    url = paper.get("url")
    locator = f"https://doi.org/{doi}" if doi else (url or "")

    if style == "apa":
        if authors:
            names = []
            for a in authors[:20]:
                parts = a.strip().split()
                if len(parts) >= 2:
                    initials = " ".join(f"{p[0]}." for p in parts[:-1])
                    names.append(f"{parts[-1]}, {initials}")
                else:
                    names.append(a)
            if len(names) == 1:
                author_str = names[0]
            elif len(names) == 2:
                author_str = f"{names[0]}, & {names[1]}"
            else:
                author_str = ", ".join(names[:-1]) + f", & {names[-1]}"
        else:
            author_str = title
        venue_str = f" {venue}." if venue else ""
        return f"{author_str} ({year}). {title}.{venue_str} {locator}".strip()

    if style == "ieee":
        if authors:
            names = []
            for a in authors[:6]:
                parts = a.strip().split()
                if len(parts) >= 2:
                    initials = ". ".join(p[0] for p in parts[:-1])
                    names.append(f"{initials}. {parts[-1]}")
                else:
                    names.append(a)
            author_str = ", ".join(names)
            if len(authors) > 6:
                author_str += " et al."
        else:
            author_str = ""
        venue_str = f" {venue}," if venue else ""
        prefix = f"{author_str}, " if author_str else ""
        return f'{prefix}"{title},"{venue_str} {year}. {locator}'.strip()

    # generic
    author_str = ", ".join(authors[:6]) + (" et al." if len(authors) > 6 else "")
    venue_str = f" {venue}." if venue else ""
    prefix = f"{author_str} " if author_str else ""
    return f"[{index}] {prefix}({year}). {title}.{venue_str} {locator}".strip()


def _set_two_columns(section) -> None:
    cols = section._sectPr.xpath("./w:cols")[0]
    cols.set(qn("w:num"), "2")
    cols.set(qn("w:space"), "360")


def _add_body_paragraphs(doc, text: str, style: dict, papers: list[dict], apa: bool):
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        if apa:
            line = _CITE_RE.sub(lambda m: _apa_in_text(m, papers), line)
        p = doc.add_paragraph()
        run = p.add_run(line)
        run.font.name = style["font"]
        run.font.size = style["body_size"]
        if _PLACEHOLDER_RE.match(line):
            run.italic = True
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        else:
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.first_line_indent = style["indent"]
        if style["double_space"]:
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
        p.paragraph_format.space_after = style["space_after"]


_STYLES = {
    "generic": {
        "font": "Calibri",
        "body_size": Pt(11),
        "title_size": Pt(18),
        "heading_size": Pt(13),
        "double_space": False,
        "indent": None,
        "space_after": Pt(8),
        "numbered_headings": True,
        "two_column": False,
    },
    "ieee": {
        "font": "Times New Roman",
        "body_size": Pt(10),
        "title_size": Pt(24),
        "heading_size": Pt(10),
        "double_space": False,
        "indent": Inches(0.17),
        "space_after": Pt(4),
        "numbered_headings": True,
        "two_column": True,
    },
    "apa": {
        "font": "Times New Roman",
        "body_size": Pt(12),
        "title_size": Pt(12),
        "heading_size": Pt(12),
        "double_space": True,
        "indent": Inches(0.5),
        "space_after": Pt(0),
        "numbered_headings": False,
        "two_column": False,
    },
}

_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def render_docx(document: dict, papers: list[dict]) -> bytes:
    template = document.get("template") or "generic"
    style = _STYLES.get(template, _STYLES["generic"])
    apa = template == "apa"

    doc = DocxDocument()
    section = doc.sections[0]
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1 if not style["two_column"] else 0.75)
    section.right_margin = Inches(1 if not style["two_column"] else 0.75)

    normal = doc.styles["Normal"]
    normal.font.name = style["font"]
    normal.font.size = style["body_size"]
    # East Asian font fallback so Word does not substitute.
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), style["font"])

    # Title block (single column, before any column break)
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_run = title_p.add_run(document["title"])
    title_run.font.name = style["font"]
    title_run.font.size = style["title_size"]
    title_run.bold = True
    if style["double_space"]:
        title_p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE

    authors = document.get("authors") or []
    if authors:
        author_p = doc.add_paragraph()
        author_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        author_run = author_p.add_run(", ".join(authors))
        author_run.font.name = style["font"]
        author_run.font.size = style["body_size"]

    if style["two_column"]:
        # IEEE-style: title spans the page, body flows in two columns.
        body_section = doc.add_section(WD_SECTION_START.CONTINUOUS)
        body_section.left_margin = Inches(0.75)
        body_section.right_margin = Inches(0.75)
        _set_two_columns(body_section)

    heading_counter = 0
    for sec in document.get("sections") or []:
        heading = sec.get("heading") or "Section"
        content = sec.get("content") or ""

        is_abstract = heading.strip().lower() == "abstract"
        h = doc.add_paragraph()
        if style["numbered_headings"] and not is_abstract:
            heading_counter += 1
            if template == "ieee":
                label = f"{_ROMAN[min(heading_counter - 1, len(_ROMAN) - 1)]}. {heading.upper()}"
            else:
                label = f"{heading_counter}. {heading}"
        else:
            label = heading
        h_run = h.add_run(label)
        h_run.font.name = style["font"]
        h_run.font.size = style["heading_size"]
        h_run.bold = True
        if apa:
            h.alignment = WD_ALIGN_PARAGRAPH.CENTER if is_abstract else WD_ALIGN_PARAGRAPH.LEFT
            h.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
        h.paragraph_format.space_before = Pt(10)
        h.paragraph_format.space_after = Pt(4)

        _add_body_paragraphs(doc, content, style, papers, apa)

    # References
    ref_h = doc.add_paragraph()
    ref_label = "References"
    if template == "ieee":
        ref_label = "REFERENCES"
    ref_run = ref_h.add_run(ref_label)
    ref_run.font.name = style["font"]
    ref_run.font.size = style["heading_size"]
    ref_run.bold = True
    if apa:
        ref_h.alignment = WD_ALIGN_PARAGRAPH.CENTER
        ref_h.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    ref_h.paragraph_format.space_before = Pt(10)

    if apa:
        sorted_papers = sorted(
            papers,
            key=lambda p: (_surname((p.get("authors") or ["zzz"])[0]).lower()),
        )
    else:
        sorted_papers = papers

    for i, paper in enumerate(sorted_papers, 1):
        text = _format_reference(paper, template, i)
        if template == "ieee":
            text = f"[{i}] {text}"
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.font.name = style["font"]
        run.font.size = style["body_size"]
        if apa:
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
            p.paragraph_format.first_line_indent = Inches(-0.5)
            p.paragraph_format.left_indent = Inches(0.5)
        p.paragraph_format.space_after = Pt(4)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
