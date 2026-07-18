"""Render a Fiberarticle document to a standalone styled HTML file.

Mirrors the .docx layouts (generic / ieee / apa families) so the HTML looks
like the exported document: same fonts, sizes, margins, heading treatment,
and reference formatting. The same renderer also backs the legacy Word .doc
export (Word opens HTML documents natively); `word=True` swaps the parts
Word's HTML importer handles poorly (CSS columns) for safe equivalents.
"""

import html as html_lib
import re

from export.md import Block, Segment, parse_blocks, parse_inline, span_props

_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")

# Layout family per journal template, mirroring docx_export.
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
        "font": "Calibri, 'Segoe UI', sans-serif",
        "body_pt": 11,
        "title_pt": 18,
        "heading_pt": 13,
        "leading": 1.35,
        "indent_in": 0.0,
        "space_after_pt": 8,
        "numbered": True,
        "upper": False,
        "two_column": False,
    },
    "ieee": {
        "font": "'Times New Roman', Times, serif",
        "body_pt": 10,
        "title_pt": 24,
        "heading_pt": 10,
        "leading": 1.3,
        "indent_in": 0.17,
        "space_after_pt": 4,
        "numbered": True,
        "upper": True,
        "two_column": True,
    },
    "apa": {
        "font": "'Times New Roman', Times, serif",
        "body_pt": 12,
        "title_pt": 12,
        "heading_pt": 12,
        "leading": 2.0,
        "indent_in": 0.5,
        "space_after_pt": 0,
        "numbered": False,
        "upper": False,
        "two_column": False,
    },
}

_ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]

_MARK_TAGS = {
    "bold": "strong",
    "italic": "em",
    "strike": "s",
    "code": "code",
    "underline": "u",
    "superscript": "sup",
    "subscript": "sub",
}


def _segments_html(segments: list[Segment]) -> str:
    parts: list[str] = []
    for text, marks in segments:
        if not text:
            continue
        piece = html_lib.escape(text)
        for mark in ("code", "subscript", "superscript", "underline", "strike", "italic", "bold"):
            if mark in marks:
                tag = _MARK_TAGS[mark]
                piece = f"<{tag}>{piece}</{tag}>"
        # Editor font spans: rebuild the style from the two whitelisted
        # properties only (sanitizes anything else in the declaration).
        family, size = span_props(marks)
        if family or size:
            declarations = []
            if family:
                declarations.append(
                    f"font-family: '{html_lib.escape(family)}'"
                )
            if size:
                declarations.append(f"font-size: {size:g}pt")
            piece = f'<span style="{"; ".join(declarations)}">{piece}</span>'
        parts.append(piece)
    return "".join(parts)


def _inline_html(text: str, intext: dict[str, str] | None) -> str:
    if intext:
        text = _CITE_RE.sub(lambda m: intext.get(m.group(0), m.group(0)), text)
    return _segments_html(parse_inline(text))


def _segments_with_intext(
    segments: list[Segment], intext: dict[str, str] | None
) -> list[Segment]:
    if not intext:
        return segments
    return [
        (_CITE_RE.sub(lambda m: intext.get(m.group(0), m.group(0)), text), marks)
        for text, marks in segments
    ]


def _block_html(block: Block, intext: dict[str, str] | None) -> str:
    if block.kind == "pagebreak":
        return '<div class="pagebreak"></div>'
    if block.segments is not None and block.align:
        # Explicitly aligned block from the editor.
        inner = _segments_html(_segments_with_intext(block.segments, intext))
        tag = "h3" if block.kind == "heading" else "p"
        return (
            f'<{tag} style="text-align: {block.align}; text-indent: 0">'
            f"{inner}</{tag}>"
        )
    if block.kind == "image":
        # Only data-URI images are embedded; anything else is dropped
        # rather than fetched from an external host.
        if not block.src.startswith("data:image/"):
            return ""
        alt = html_lib.escape(block.text)
        return (
            f'<img src="{block.src}" alt="{alt}" '
            'style="display:block;max-width:100%;height:auto;margin:8pt auto;">'
        )
    if block.kind == "heading":
        return f"<h3>{_inline_html(block.text, intext)}</h3>"
    if block.kind == "placeholder":
        return f'<p class="placeholder">{html_lib.escape(block.text)}</p>'
    if block.kind in ("bullet", "number"):
        tag = "ul" if block.kind == "bullet" else "ol"
        items = "".join(
            f"<li>{_inline_html(item, intext)}</li>" for item in block.items
        )
        return f"<{tag}>{items}</{tag}>"
    if block.kind == "quote":
        inner = "<br>".join(
            _inline_html(line, intext) for line in block.text.split("\n")
        )
        return f"<blockquote>{inner}</blockquote>"
    if block.kind == "table":
        rows_html: list[str] = []
        for i, row in enumerate(block.rows):
            cell_tag = "th" if i == 0 else "td"
            cells = "".join(
                f"<{cell_tag}>{_inline_html(cell, intext)}</{cell_tag}>"
                for cell in row
            )
            rows_html.append(f"<tr>{cells}</tr>")
        return "<table>" + "".join(rows_html) + "</table>"
    return f"<p>{_inline_html(block.text, intext)}</p>"


def _heading_label(style: dict, heading: str, counter: int) -> str:
    if style["numbered"]:
        if style["upper"]:
            roman = _ROMAN[min(counter - 1, len(_ROMAN) - 1)]
            return f"{roman}. {heading.upper()}"
        return f"{counter}. {heading}"
    return heading


def _css(style: dict, word: bool) -> str:
    indent = f"{style['indent_in']}in" if style["indent_in"] else "0"
    two_column = style["two_column"] and not word
    columns = (
        ".doc-body { column-count: 2; column-gap: 0.3in; }" if two_column else ""
    )
    return f"""
    @page {{ size: 210mm 297mm; margin: 1in; }}
    html, body {{ margin: 0; padding: 0; background: #fff; color: #111; }}
    body {{
      font-family: {style['font']};
      font-size: {style['body_pt']}pt;
      line-height: {style['leading']};
    }}
    .page {{ max-width: 210mm; margin: 0 auto; padding: 1in; box-sizing: border-box; }}
    h1.doc-title {{
      font-size: {style['title_pt']}pt; font-weight: bold; text-align: center;
      margin: 0 0 10pt; line-height: 1.2;
    }}
    p.doc-authors {{ text-align: center; text-indent: 0; margin: 0 0 18pt; }}
    h2.sec {{
      font-size: {style['heading_pt']}pt; font-weight: bold;
      margin: 12pt 0 4pt; text-indent: 0;
    }}
    h2.sec.centered {{ text-align: center; }}
    h3 {{
      font-size: {style['heading_pt']}pt; font-weight: bold;
      margin: 10pt 0 4pt; text-indent: 0;
    }}
    p {{
      text-align: justify; text-indent: {indent};
      margin: 0 0 {style['space_after_pt']}pt;
    }}
    /* First paragraph after a heading carries no indent. */
    h2.sec + p, h3 + p {{ text-indent: 0; }}
    p.placeholder {{ text-align: center; text-indent: 0; font-style: italic; }}
    ul, ol {{ margin: 0 0 {max(style['space_after_pt'], 4)}pt; padding-left: 0.35in; }}
    li {{ margin: 2pt 0; }}
    blockquote {{
      margin: 0 0 {max(style['space_after_pt'], 4)}pt; padding-left: 0.25in;
      border-left: 2pt solid #999; color: #333;
    }}
    code {{ font-family: Consolas, 'Courier New', monospace; font-size: 0.95em; }}
    table {{
      border-collapse: collapse; width: 100%;
      margin: 6pt 0 {max(style['space_after_pt'], 6)}pt;
    }}
    th, td {{
      border: 1pt solid #555; padding: 3pt 6pt; font-size: {style['body_pt']}pt;
      text-align: left; vertical-align: top;
    }}
    th {{ font-weight: bold; }}
    .refs p {{ text-align: left; text-indent: 0; margin: 0 0 5pt; }}
    .refs.hanging p {{ padding-left: 0.5in; text-indent: -0.5in; }}
    .pagebreak {{ page-break-after: always; break-after: page; }}
    {columns}
    """


def render_html(
    document: dict,
    papers: list[dict],
    references: list[str] | None = None,
    intext: dict[str, str] | None = None,
    numeric: bool = True,
    word: bool = False,
) -> str:
    """Full standalone HTML document. references/intext follow the same
    contract as the .docx renderer."""
    template = document.get("template") or "generic"
    layout = _LAYOUT_FOR_TEMPLATE.get(template, "generic")
    style = _STYLES.get(layout, _STYLES["generic"])

    replacements = intext if not numeric else None

    body_parts: list[str] = []
    counter = 0
    for section in document.get("sections") or []:
        heading = (section.get("heading") or "Section").strip()
        is_abstract = heading.lower() == "abstract"
        if style["numbered"] and not is_abstract:
            counter += 1
            label = _heading_label(style, heading, counter)
        else:
            label = heading
        centered = " centered" if layout == "apa" and is_abstract else ""
        body_parts.append(
            f'<h2 class="sec{centered}">{html_lib.escape(label)}</h2>'
        )
        for block in parse_blocks(section.get("content") or ""):
            body_parts.append(_block_html(block, replacements))

    if references is None:
        references = [
            f"{', '.join((p.get('authors') or [])[:6])} "
            f"({p.get('year') or 'n.d.'}). {p['title']}.".strip()
            for p in papers
        ]
    if numeric:
        entries = [f"[{i}] {text}" for i, text in enumerate(references, 1)]
        refs_class = "refs"
    else:
        entries = sorted(references, key=str.lower)
        refs_class = "refs hanging"
    refs_html = ""
    if entries:
        ref_heading = "REFERENCES" if layout == "ieee" else "References"
        refs_html = (
            f'<h2 class="sec">{ref_heading}</h2><div class="{refs_class}">'
            + "".join(f"<p>{html_lib.escape(e)}</p>" for e in entries)
            + "</div>"
        )

    title = html_lib.escape(document.get("title") or "Untitled")
    authors = ", ".join(document.get("authors") or [])
    authors_html = (
        f'<p class="doc-authors">{html_lib.escape(authors)}</p>' if authors else ""
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{_css(style, word)}</style>
</head>
<body>
<div class="page">
<h1 class="doc-title">{title}</h1>
{authors_html}
<div class="doc-body">
{''.join(body_parts)}
{refs_html}
</div>
</div>
</body>
</html>
"""
