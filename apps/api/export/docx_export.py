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
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt

from export.md import (
    aligned_block,
    decode_data_image,
    html_inline_segments,
    isolate_images,
    span_props,
)

_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_PLACEHOLDER_RE = re.compile(r"^\[.*placeholder.*\]$", re.IGNORECASE)

# Block-level Markdown: list items, blockquotes, subheadings, and tables.
_LIST_BULLET_RE = re.compile(r"^[-*+]\s+(.+)$")
_LIST_NUMBER_RE = re.compile(r"^\d+[.)]\s+(.+)$")
_BLOCKQUOTE_RE = re.compile(r"^>\s?(.*)$")
_SUBHEADING_RE = re.compile(r"^(#{2,6})\s+(.+)$")
_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_TABLE_SEPARATOR_RE = re.compile(r"^\|[\s\-:|]+\|$")
# Thematic break "---": the manual page break.
_PAGE_BREAK_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})\s*$")
_IMAGE_LINE_RE = re.compile(r"^!\[([^\]]*)\]\((\S+?)\)$")

# Inline Markdown marks, tried in priority order (bold before italic so
# "**x**" is not swallowed by the single-marker italic alternatives).
# The editor serializes underline/superscript/subscript as inline HTML tags,
# the only representation Markdown has for them.
_INLINE_TOKEN_RE = re.compile(
    r"\*\*(?P<bold>.+?)\*\*"
    r"|__(?P<bold2>.+?)__"
    r"|\*(?P<italic>[^*]+?)\*"
    r"|_(?P<italic2>[^_]+?)_"
    r"|~~(?P<strike>.+?)~~"
    r"|`(?P<code>[^`]+?)`"
    r"|<u>(?P<underline>.+?)</u>"
    r"|<sup>(?P<superscript>.+?)</sup>"
    r"|<sub>(?P<subscript>.+?)</sub>"
    r'|<span style="(?P<spanstyle>[^"]*)">(?P<span>.+?)</span>'
)


def _surname(author: str) -> str:
    parts = author.strip().split()
    return parts[-1] if parts else author


def _set_two_columns(section) -> None:
    cols = section._sectPr.xpath("./w:cols")[0]
    cols.set(qn("w:num"), "2")
    cols.set(qn("w:space"), "360")


def _parse_inline(text: str) -> list[tuple[str, frozenset]]:
    """Tokenize inline Markdown marks into (text, marks) segments.

    Recurses into matched spans so nesting like ``**bold *italic***``
    accumulates marks on the inner segment. Unmatched/unbalanced markers
    (no closing pair found) are left as literal text rather than raising.
    """
    segments: list[tuple[str, frozenset]] = []
    pos = 0
    for m in _INLINE_TOKEN_RE.finditer(text):
        if m.start() < pos:
            continue
        if m.start() > pos:
            segments.append((text[pos : m.start()], frozenset()))
        if m.group("spanstyle") is not None:
            # Font span: the mark carries the style declaration itself.
            inner, mark = m.group("span"), f"style:{m.group('spanstyle')}"
        elif m.group("bold") is not None:
            inner, mark = m.group("bold"), "bold"
        elif m.group("bold2") is not None:
            inner, mark = m.group("bold2"), "bold"
        elif m.group("italic") is not None:
            inner, mark = m.group("italic"), "italic"
        elif m.group("italic2") is not None:
            inner, mark = m.group("italic2"), "italic"
        elif m.group("strike") is not None:
            inner, mark = m.group("strike"), "strike"
        elif m.group("underline") is not None:
            inner, mark = m.group("underline"), "underline"
        elif m.group("superscript") is not None:
            inner, mark = m.group("superscript"), "superscript"
        elif m.group("subscript") is not None:
            inner, mark = m.group("subscript"), "subscript"
        else:
            inner, mark = m.group("code"), "code"
        for seg_text, seg_marks in _parse_inline(inner):
            segments.append((seg_text, seg_marks | {mark}))
        pos = m.end()
    if pos < len(text):
        segments.append((text[pos:], frozenset()))
    return segments


def _apply_marks(run, marks: frozenset, style: dict) -> None:
    run.font.name = "Consolas" if "code" in marks else style["font"]
    run.font.size = style["body_size"]
    # Per-selection font family/size from the editor's font controls.
    family, size = span_props(marks)
    if family and "code" not in marks:
        run.font.name = family
    if size:
        run.font.size = Pt(size)
    if "bold" in marks:
        run.bold = True
    if "italic" in marks:
        run.italic = True
    if "strike" in marks:
        run.font.strike = True
    if "underline" in marks:
        run.underline = True
    if "superscript" in marks:
        run.font.superscript = True
    if "subscript" in marks:
        run.font.subscript = True


def _write_runs(
    p, text: str, style: dict, base_marks: frozenset = frozenset()
) -> None:
    """Write text into paragraph p as runs, applying inline Markdown marks."""
    for seg_text, seg_marks in _parse_inline(text):
        if not seg_text:
            continue
        run = p.add_run(seg_text)
        _apply_marks(run, base_marks | seg_marks, style)


def _write_segments(
    p,
    segments: list[tuple[str, frozenset]],
    style: dict,
    base_marks: frozenset = frozenset(),
) -> None:
    """Write pre-parsed (text, marks) segments into paragraph p."""
    for seg_text, seg_marks in segments:
        if not seg_text:
            continue
        run = p.add_run(seg_text)
        _apply_marks(run, base_marks | seg_marks, style)


def _add_table(
    doc, lines: list[str], style: dict, intext: dict[str, str] | None
) -> None:
    """Render buffered GFM table lines as a bordered Word table."""
    rows: list[list[str]] = []
    for line in lines:
        if _TABLE_SEPARATOR_RE.match(line):
            continue
        rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    if not rows:
        return
    columns = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=columns)
    table.style = "Table Grid"
    for r, cells in enumerate(rows):
        for c in range(columns):
            cell_text = cells[c] if c < len(cells) else ""
            if intext:
                cell_text = _CITE_RE.sub(
                    lambda m: intext.get(m.group(0), m.group(0)), cell_text
                )
            paragraph = table.rows[r].cells[c].paragraphs[0]
            # GFM's first row is the header row.
            base = frozenset({"bold"}) if r == 0 else frozenset()
            _write_runs(paragraph, cell_text, style, base)
            paragraph.paragraph_format.space_after = Pt(2)
    # Spacer so back-to-back tables do not merge into one in Word.
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(4)


def _add_body_paragraphs(
    doc, text: str, style: dict, intext: dict[str, str] | None
):
    try:
        doc.styles["Intense Quote"]
        quote_style_exists = True
    except KeyError:
        quote_style_exists = False

    table_buffer: list[str] = []
    # Typographic rule: the first paragraph after a heading (the section
    # heading this body follows, or an inline subheading) is not indented;
    # later paragraphs are.
    suppress_indent = True

    def flush_table() -> None:
        nonlocal suppress_indent
        if table_buffer:
            _add_table(doc, list(table_buffer), style, intext)
            table_buffer.clear()
            suppress_indent = False

    for raw in isolate_images(text).split("\n"):
        line = raw.strip()
        if not line:
            flush_table()
            continue
        if _TABLE_ROW_RE.match(line):
            table_buffer.append(line)
            continue
        flush_table()
        if _PAGE_BREAK_RE.match(line):
            p = doc.add_paragraph()
            p.add_run().add_break(WD_BREAK.PAGE)
            continue

        aligned = aligned_block(line)
        if aligned:
            tag, align, inner = aligned
            segments = html_inline_segments(inner)
            if intext:
                segments = [
                    (
                        _CITE_RE.sub(
                            lambda m: intext.get(m.group(0), m.group(0)), text
                        ),
                        marks,
                    )
                    for text, marks in segments
                ]
            heading_like = tag.startswith("h")
            p = doc.add_paragraph()
            p.alignment = {
                "left": WD_ALIGN_PARAGRAPH.LEFT,
                "center": WD_ALIGN_PARAGRAPH.CENTER,
                "right": WD_ALIGN_PARAGRAPH.RIGHT,
                "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
            }.get(align, WD_ALIGN_PARAGRAPH.LEFT)
            run_style = (
                {**style, "body_size": style["heading_size"]}
                if heading_like
                else style
            )
            _write_segments(
                p,
                segments,
                run_style,
                frozenset({"bold"}) if heading_like else frozenset(),
            )
            if style["double_space"]:
                p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
            p.paragraph_format.space_after = style["space_after"]
            suppress_indent = heading_like
            continue

        image_match = _IMAGE_LINE_RE.match(line)
        if image_match:
            decoded = decode_data_image(image_match.group(2))
            if decoded is not None:
                import io as _io

                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                picture = p.add_run().add_picture(_io.BytesIO(decoded[1]))
                max_width = Inches(3.4 if style["two_column"] else 6.2)
                if picture.width > max_width:
                    ratio = max_width / picture.width
                    picture.height = int(picture.height * ratio)
                    picture.width = max_width
                p.paragraph_format.space_after = Pt(6)
                suppress_indent = False
            continue
        if intext:
            line = _CITE_RE.sub(lambda m: intext.get(m.group(0), m.group(0)), line)

        subheading = _SUBHEADING_RE.match(line)
        if subheading:
            p = doc.add_paragraph()
            run = p.add_run(subheading.group(2).strip())
            run.font.name = style["font"]
            run.font.size = style["heading_size"]
            run.bold = True
            if style["double_space"]:
                p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after = Pt(4)
            suppress_indent = True
            continue

        list_style = None
        base_marks: frozenset = frozenset()

        m = _LIST_BULLET_RE.match(line)
        if m:
            list_style, line = "List Bullet", m.group(1)
        else:
            m = _LIST_NUMBER_RE.match(line)
            if m:
                list_style, line = "List Number", m.group(1)
            else:
                m = _BLOCKQUOTE_RE.match(line)
                if m:
                    line = m.group(1)
                    if quote_style_exists:
                        list_style = "Intense Quote"
                    else:
                        base_marks = frozenset({"italic"})

        p = doc.add_paragraph()
        if list_style:
            try:
                p.style = doc.styles[list_style]
            except KeyError:
                pass

        is_placeholder = list_style is None and bool(_PLACEHOLDER_RE.match(line))
        if is_placeholder:
            base_marks = base_marks | {"italic"}

        _write_runs(p, line, style, base_marks)

        if is_placeholder:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif list_style is None:
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.first_line_indent = (
                None if suppress_indent else style["indent"]
            )
        # Any written block (prose, list item, quote, placeholder) ends the
        # after-heading suppression.
        suppress_indent = False
        if style["double_space"]:
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
        p.paragraph_format.space_after = style["space_after"]

    flush_table()


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

# Templates whose real output is LaTeX reuse the closest .docx layout.
_LAYOUT_FOR_TEMPLATE = {
    "generic": "generic",
    "ieee": "ieee",
    "apa": "apa",
    "acm": "ieee",
    "elsevier": "generic",
    "springer": "generic",
    "neurips": "generic",
}


def render_docx(
    document: dict,
    papers: list[dict],
    references: list[str] | None = None,
    intext: dict[str, str] | None = None,
    numeric: bool = True,
) -> bytes:
    """Render the document JSON to .docx.

    references: pre-rendered reference entries (CSL engine), one per paper,
    in paper order. intext: replacement map for bracketed citation markers,
    used by author-date styles; numeric styles keep [n] markers.
    """
    template = document.get("template") or "generic"
    layout = _LAYOUT_FOR_TEMPLATE.get(template, "generic")
    style = _STYLES.get(layout, _STYLES["generic"])
    apa = layout == "apa"

    doc = DocxDocument()
    section = doc.sections[0]
    # A4 paper for every template.
    section.page_width = Mm(210)
    section.page_height = Mm(297)
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
        body_section.page_width = Mm(210)
        body_section.page_height = Mm(297)
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
            if layout == "ieee":
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

        _add_body_paragraphs(doc, content, style, intext if not numeric else None)

    # References
    ref_h = doc.add_paragraph()
    ref_label = "References"
    if layout == "ieee":
        ref_label = "REFERENCES"
    ref_run = ref_h.add_run(ref_label)
    ref_run.font.name = style["font"]
    ref_run.font.size = style["heading_size"]
    ref_run.bold = True
    if apa:
        ref_h.alignment = WD_ALIGN_PARAGRAPH.CENTER
        ref_h.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
    ref_h.paragraph_format.space_before = Pt(10)

    if references is None:
        # Minimal fallback when no engine-rendered entries were provided.
        references = [
            f"{', '.join((p.get('authors') or [])[:6])} "
            f"({p.get('year') or 'n.d.'}). {p['title']}.".strip()
            for p in papers
        ]

    if numeric:
        entries = [f"[{i}] {text}" for i, text in enumerate(references, 1)]
    else:
        # Author-date reference lists are alphabetical.
        entries = sorted(references, key=str.lower)

    for text in entries:
        p = doc.add_paragraph()
        run = p.add_run(text)
        run.font.name = style["font"]
        run.font.size = style["body_size"]
        if not numeric:
            # Hanging indent, the convention for author-date lists.
            p.paragraph_format.first_line_indent = Inches(-0.5)
            p.paragraph_format.left_indent = Inches(0.5)
        if apa:
            p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.DOUBLE
        p.paragraph_format.space_after = Pt(4)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
