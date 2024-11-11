"""Render a Fiberarticle document straight to PDF with ReportLab.

Same layout families as the .docx renderer (generic / ieee / apa): fonts,
sizes, spacing, heading treatment, placeholders, and reference formatting
all mirror the Word export, so the PDF matches what the editor page shows.
Calibri is not a licensed ReportLab font, so the generic family renders in
Helvetica (its metric cousin); Times templates use the built-in Times.

The IEEE/ACM families render single-column here: true two-column flow with
a spanning title needs a full frame layout, and the .docx/LaTeX exports
already carry that fidelity. Everything else is layout-identical.
"""

import io
import re
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from export.md import (
    Block,
    Segment,
    decode_data_image,
    parse_blocks,
    parse_inline,
    span_props,
)

# Editor font families mapped to the PDF base-14 faces (closest metrics).
_PDF_FACE = {
    "times new roman": "Times-Roman",
    "georgia": "Times-Roman",
    "garamond": "Times-Roman",
    "cambria": "Times-Roman",
    "calibri": "Helvetica",
    "arial": "Helvetica",
    "helvetica": "Helvetica",
    "courier new": "Courier",
    "consolas": "Courier",
}

_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")

_LAYOUT_FOR_TEMPLATE = {
    "generic": "generic",
    "ieee": "ieee",
    "apa": "apa",
    "acm": "ieee",
    "elsevier": "generic",
    "springer": "generic",
    "neurips": "generic",
}

_STYLES: dict[str, dict] = {
    "generic": {
        "font": "Helvetica",
        "body_pt": 11,
        "title_pt": 18,
        "heading_pt": 13,
        "double_space": False,
        "indent_pt": 0.0,
        "space_after_pt": 8,
        "numbered": True,
        "upper": False,
    },
    "ieee": {
        "font": "Times-Roman",
        "body_pt": 10,
        "title_pt": 24,
        "heading_pt": 10,
        "double_space": False,
        "indent_pt": 0.17 * 72,
        "space_after_pt": 4,
        "numbered": True,
        "upper": True,
    },
    "apa": {
        "font": "Times-Roman",
        "body_pt": 12,
        "title_pt": 12,
        "heading_pt": 12,
        "double_space": True,
        "indent_pt": 0.5 * 72,
        "space_after_pt": 0,
        "numbered": False,
        "upper": False,
    },
}

_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def _segments_markup(segments: list[Segment]) -> str:
    """ReportLab Paragraph mini-markup from parsed inline segments."""
    parts: list[str] = []
    for text, marks in segments:
        if not text:
            continue
        piece = escape(text)
        if "code" in marks:
            piece = f'<font face="Courier">{piece}</font>'
        # Editor font spans: map family to a base-14 face; size passes as-is.
        family, size = span_props(marks)
        face = _PDF_FACE.get((family or "").lower()) if family else None
        if face or size:
            attributes = ""
            if face and "code" not in marks:
                attributes += f' face="{face}"'
            if size:
                attributes += f' size="{size:g}"'
            piece = f"<font{attributes}>{piece}</font>"
        if "subscript" in marks:
            piece = f"<sub>{piece}</sub>"
        if "superscript" in marks:
            piece = f"<super>{piece}</super>"
        if "underline" in marks:
            piece = f"<u>{piece}</u>"
        if "strike" in marks:
            piece = f"<strike>{piece}</strike>"
        if "italic" in marks:
            piece = f"<i>{piece}</i>"
        if "bold" in marks:
            piece = f"<b>{piece}</b>"
        parts.append(piece)
    return "".join(parts)


def _inline_markup(text: str, intext: dict[str, str] | None) -> str:
    if intext:
        text = _CITE_RE.sub(lambda m: intext.get(m.group(0), m.group(0)), text)
    return _segments_markup(parse_inline(text))


def _leading(style: dict, size: float) -> float:
    return size * 2.0 if style["double_space"] else size * 1.25


def render_pdf(
    document: dict,
    papers: list[dict],
    references: list[str] | None = None,
    intext: dict[str, str] | None = None,
    numeric: bool = True,
) -> bytes:
    template = document.get("template") or "generic"
    layout = _LAYOUT_FOR_TEMPLATE.get(template, "generic")
    style = _STYLES.get(layout, _STYLES["generic"])
    apa = layout == "apa"
    replacements = intext if not numeric else None

    body_size = style["body_pt"]
    body = ParagraphStyle(
        "body",
        fontName=style["font"],
        fontSize=body_size,
        leading=_leading(style, body_size),
        alignment=TA_JUSTIFY,
        firstLineIndent=style["indent_pt"],
        spaceAfter=max(style["space_after_pt"], 2),
    )
    plain = ParagraphStyle(
        "plain", parent=body, alignment=TA_LEFT, firstLineIndent=0
    )
    # First paragraph after a heading: no first-line indent.
    body_first = ParagraphStyle("bodyFirst", parent=body, firstLineIndent=0)
    title_style = ParagraphStyle(
        "title",
        parent=plain,
        fontSize=style["title_pt"],
        leading=_leading(style, style["title_pt"]),
        alignment=TA_CENTER,
        spaceAfter=10,
    )
    authors_style = ParagraphStyle(
        "authors", parent=plain, alignment=TA_CENTER, spaceAfter=16
    )
    heading_style = ParagraphStyle(
        "heading",
        parent=plain,
        fontSize=style["heading_pt"],
        leading=_leading(style, style["heading_pt"]),
        spaceBefore=10,
        spaceAfter=4,
    )
    heading_centered = ParagraphStyle(
        "headingCentered", parent=heading_style, alignment=TA_CENTER
    )
    placeholder_style = ParagraphStyle(
        "placeholder", parent=plain, alignment=TA_CENTER
    )
    quote_style = ParagraphStyle(
        "quote",
        parent=plain,
        leftIndent=18,
        textColor=colors.Color(0.25, 0.25, 0.25),
        spaceAfter=max(style["space_after_pt"], 4),
    )
    list_style = ParagraphStyle(
        "list", parent=plain, leftIndent=22, bulletIndent=8, spaceAfter=2
    )
    cell_style = ParagraphStyle(
        "cell",
        parent=plain,
        fontSize=max(body_size - 1, 8),
        leading=max(body_size - 1, 8) * 1.2,
        spaceAfter=0,
    )
    ref_style = ParagraphStyle(
        "ref",
        parent=plain,
        spaceAfter=4,
        leftIndent=0 if numeric else 36,
        firstLineIndent=0 if numeric else -36,
    )
    _ALIGN_ENUM = {
        "left": TA_LEFT,
        "center": TA_CENTER,
        "right": TA_RIGHT,
        "justify": TA_JUSTIFY,
    }
    aligned_styles: dict[str, ParagraphStyle] = {}

    def aligned_style(align: str, heading: bool) -> ParagraphStyle:
        key = f"{align}-{heading}"
        if key not in aligned_styles:
            aligned_styles[key] = ParagraphStyle(
                f"aligned-{key}",
                parent=heading_style if heading else body,
                alignment=_ALIGN_ENUM.get(align, TA_JUSTIFY),
                firstLineIndent=0,
            )
        return aligned_styles[key]

    def segments_with_intext(segments):
        if not replacements:
            return segments
        return [
            (
                _CITE_RE.sub(
                    lambda m: replacements.get(m.group(0), m.group(0)), text
                ),
                marks,
            )
            for text, marks in segments
        ]

    margin = 0.75 * inch if layout == "ieee" else 1 * inch
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=1 * inch,
        bottomMargin=1 * inch,
        title=document.get("title") or "Untitled",
        author=", ".join(document.get("authors") or []),
    )
    frame_width = A4[0] - 2 * margin

    story: list = []
    story.append(
        Paragraph(f"<b>{escape(document.get('title') or 'Untitled')}</b>", title_style)
    )
    authors = ", ".join(document.get("authors") or [])
    if authors:
        story.append(Paragraph(escape(authors), authors_style))

    # Typographic rule: no indent on the paragraph right after a heading.
    suppress_indent = True

    def add_block(block: Block) -> None:
        nonlocal suppress_indent
        if block.kind == "pagebreak":
            story.append(PageBreak())
            return
        if block.segments is not None and block.align:
            markup = _segments_markup(segments_with_intext(block.segments))
            if block.kind == "heading":
                markup = f"<b>{markup}</b>"
                suppress_indent = True
            else:
                suppress_indent = False
            story.append(
                Paragraph(markup, aligned_style(block.align, block.kind == "heading"))
            )
            return
        if block.kind == "image":
            decoded = decode_data_image(block.src)
            if decoded is not None:
                try:
                    raw = io.BytesIO(decoded[1])
                    natural_w, natural_h = ImageReader(raw).getSize()
                    # Screen pixels (96dpi) to points, capped at frame width.
                    width = min(frame_width, natural_w * 72.0 / 96.0)
                    height = natural_h * (width / natural_w)
                    raw.seek(0)
                    image = RLImage(raw, width=width, height=height)
                    image.hAlign = "CENTER"
                    story.append(image)
                    story.append(Spacer(1, 6))
                    suppress_indent = False
                except Exception:
                    pass
            return
        if block.kind == "heading":
            story.append(
                Paragraph(f"<b>{_inline_markup(block.text, replacements)}</b>", heading_style)
            )
            suppress_indent = True
            return
        if block.kind == "placeholder":
            story.append(
                Paragraph(f"<i>{escape(block.text)}</i>", placeholder_style)
            )
            suppress_indent = False
            return
        if block.kind in ("bullet", "number"):
            for i, item in enumerate(block.items, 1):
                bullet = "•" if block.kind == "bullet" else f"{i}."
                story.append(
                    Paragraph(
                        _inline_markup(item, replacements),
                        list_style,
                        bulletText=bullet,
                    )
                )
            story.append(Spacer(1, max(style["space_after_pt"], 4)))
            suppress_indent = False
            return
        if block.kind == "quote":
            for line in block.text.split("\n"):
                story.append(Paragraph(_inline_markup(line, replacements), quote_style))
            suppress_indent = False
            return
        if block.kind == "table":
            columns = max(len(r) for r in block.rows)
            data: list[list[Paragraph]] = []
            for r, row in enumerate(block.rows):
                cells: list[Paragraph] = []
                for c in range(columns):
                    text = row[c] if c < len(row) else ""
                    markup = _inline_markup(text, replacements)
                    if r == 0:
                        markup = f"<b>{markup}</b>"
                    cells.append(Paragraph(markup, cell_style))
                data.append(cells)
            table = Table(
                data, colWidths=[frame_width / columns] * columns, repeatRows=1
            )
            table.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.6, colors.Color(0.35, 0.35, 0.35)),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), 3),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ]
                )
            )
            story.append(table)
            story.append(Spacer(1, max(style["space_after_pt"], 6)))
            suppress_indent = False
            return
        story.append(
            Paragraph(
                _inline_markup(block.text, replacements),
                body_first if suppress_indent else body,
            )
        )
        suppress_indent = False

    counter = 0
    for section in document.get("sections") or []:
        heading = (section.get("heading") or "Section").strip()
        is_abstract = heading.lower() == "abstract"
        if style["numbered"] and not is_abstract:
            counter += 1
            if style["upper"]:
                roman = _ROMAN[min(counter - 1, len(_ROMAN) - 1)]
                label = f"{roman}. {heading.upper()}"
            else:
                label = f"{counter}. {heading}"
        else:
            label = heading
        chosen = heading_centered if apa and is_abstract else heading_style
        story.append(Paragraph(f"<b>{escape(label)}</b>", chosen))
        suppress_indent = True
        for block in parse_blocks(section.get("content") or ""):
            add_block(block)

    if references is None:
        references = [
            f"{', '.join((p.get('authors') or [])[:6])} "
            f"({p.get('year') or 'n.d.'}). {p['title']}.".strip()
            for p in papers
        ]
    if references:
        ref_label = "REFERENCES" if layout == "ieee" else "References"
        chosen = heading_centered if apa else heading_style
        story.append(Paragraph(f"<b>{escape(ref_label)}</b>", chosen))
        entries = (
            [f"[{i}] {text}" for i, text in enumerate(references, 1)]
            if numeric
            else sorted(references, key=str.lower)
        )
        for entry in entries:
            story.append(Paragraph(escape(entry), ref_style))

    doc.build(story)
    return buffer.getvalue()
