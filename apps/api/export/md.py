"""Shared parser for the constrained Markdown dialect documents use.

The HTML and PDF exporters consume this block/segment model; the docx and
LaTeX exporters keep their own equivalent parsing (same regexes) because
their output is built run-by-run rather than from a tree.

Inline: **bold** __bold__ *italic* _italic_ ~~strike~~ `code` and the
HTML-only marks <u> <sup> <sub> the editor serializes. Blocks: paragraphs,
bullet/numbered lists, blockquotes, ###+ subheadings, [..placeholder..]
lines, and GFM tables.
"""

import html as _html
import re
from dataclasses import dataclass, field

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

_LIST_BULLET_RE = re.compile(r"^[-*+]\s+(.+)$")
_LIST_NUMBER_RE = re.compile(r"^\d+[.)]\s+(.+)$")
_BLOCKQUOTE_RE = re.compile(r"^>\s?(.*)$")
_SUBHEADING_RE = re.compile(r"^(#{2,6})\s+(.+)$")
_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_TABLE_SEPARATOR_RE = re.compile(r"^\|[\s\-:|]+\|$")
_PLACEHOLDER_RE = re.compile(r"^\[(.*placeholder.*)\]$", re.IGNORECASE)
# Thematic break "---": the manual page break in every export.
_PAGE_BREAK_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})\s*$")
# Block-level image: the editor inserts figures as their own paragraph,
# with the bitmap embedded as a data URI.
_IMAGE_RE = re.compile(r"^!\[([^\]]*)\]\((\S+?)\)$")

_DATA_URI_RE = re.compile(r"^data:image/(png|jpeg|jpg|webp|gif);base64,(.+)$", re.DOTALL)


_IMAGE_TOKEN_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")

# Explicitly aligned block: the editor stores it as one single-line HTML
# block because Markdown has no alignment syntax.
_ALIGNED_BLOCK_RE = re.compile(
    r'^<(p|h[1-6]) style="text-align: ?(left|center|right|justify);?">(.*)</\1>$'
)

# Inline HTML inside aligned blocks (the serializer emits HTML there).
_HTML_TOKEN_RE = re.compile(
    r"<(?P<tag>strong|b|em|i|u|s|strike|del|code|sup|sub)>(?P<inner>.*?)</(?P=tag)>"
    r'|<span style="(?P<hspanstyle>[^"]*)">(?P<hspan>.*?)</span>',
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_MARK = {
    "strong": "bold",
    "b": "bold",
    "em": "italic",
    "i": "italic",
    "u": "underline",
    "s": "strike",
    "strike": "strike",
    "del": "strike",
    "code": "code",
    "sup": "superscript",
    "sub": "subscript",
}
_STRIP_TAG_RE = re.compile(r"<[^>]+>")


def _html_text(text: str) -> str:
    """Plain text from an HTML slice: tags stripped, entities unescaped."""
    return _html.unescape(_STRIP_TAG_RE.sub(" ", text))


def html_inline_segments(markup: str) -> list["Segment"]:
    """(text, marks) segments from serialized inline HTML, mirroring
    parse_inline for the Markdown side."""
    segments: list[Segment] = []
    pos = 0
    for m in _HTML_TOKEN_RE.finditer(markup):
        if m.start() < pos:
            continue
        if m.start() > pos:
            text = _html_text(markup[pos : m.start()])
            if text:
                segments.append((text, frozenset()))
        if m.group("hspanstyle") is not None:
            mark = f"style:{m.group('hspanstyle')}"
            inner = m.group("hspan")
        else:
            mark = _HTML_TAG_MARK[m.group("tag").lower()]
            inner = m.group("inner")
        for seg_text, seg_marks in html_inline_segments(inner):
            segments.append((seg_text, seg_marks | {mark}))
        pos = m.end()
    if pos < len(markup):
        text = _html_text(markup[pos:])
        if text:
            segments.append((text, frozenset()))
    return segments


def aligned_block(line: str) -> tuple[str, str, str] | None:
    """(tag, alignment, inner HTML) when the line is an aligned block."""
    m = _ALIGNED_BLOCK_RE.match(line)
    if not m:
        return None
    return m.group(1).lower(), m.group(2), m.group(3)


def isolate_images(content: str) -> str:
    """Put every image token on its own line.

    The editor's Markdown serializer can glue an image and the following
    paragraph onto one line; block-level parsing in every exporter assumes
    images stand alone, so normalize first."""
    return _IMAGE_TOKEN_RE.sub(lambda m: f"\n{m.group(0)}\n", content)


def decode_data_image(src: str) -> tuple[str, bytes] | None:
    """(extension, raw bytes) from a data-URI image src, or None."""
    import base64

    m = _DATA_URI_RE.match(src)
    if not m:
        return None
    extension = {"jpeg": "jpg"}.get(m.group(1), m.group(1))
    try:
        return extension, base64.b64decode(m.group(2))
    except Exception:
        return None

_STYLE_FAMILY_RE = re.compile(r"font-family:\s*([^;]+)", re.IGNORECASE)
_STYLE_SIZE_RE = re.compile(r"font-size:\s*([\d.]+)\s*pt", re.IGNORECASE)


def parse_style_decl(style: str) -> tuple[str | None, float | None]:
    """(font family, size in pt) from an inline span style declaration.

    Only these two properties are honored; everything else in the style
    string is ignored, which doubles as sanitization for the HTML export.
    """
    family = None
    m = _STYLE_FAMILY_RE.search(style)
    if m:
        family = (
            m.group(1).split(",")[0].replace("&quot;", "").strip().strip("'\"")
            or None
        )
    size = None
    m = _STYLE_SIZE_RE.search(style)
    if m:
        try:
            size = float(m.group(1))
        except ValueError:
            size = None
    return family, size


def span_props(marks: frozenset) -> tuple[str | None, float | None]:
    """Effective (family, size) from any style: marks in a segment."""
    family = size = None
    for mark in marks:
        if isinstance(mark, str) and mark.startswith("style:"):
            f, s = parse_style_decl(mark[6:])
            family = f or family
            size = s or size
    return family, size

Segment = tuple[str, frozenset]


@dataclass
class Block:
    kind: str  # para | bullet | number | quote | heading | placeholder | table | pagebreak | image
    text: str = ""
    items: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)  # header first
    src: str = ""  # image blocks: the (data URI) source; text holds alt
    align: str = ""  # explicit alignment (left/center/right/justify) or ""
    # Pre-parsed segments for aligned blocks (their inline content is HTML).
    segments: list[Segment] | None = None


def parse_inline(text: str) -> list[Segment]:
    """Tokenize inline marks into (text, marks) segments, recursing into
    matched spans so nesting accumulates marks. Unbalanced markers stay
    literal text."""
    segments: list[Segment] = []
    pos = 0
    for m in _INLINE_TOKEN_RE.finditer(text):
        if m.start() < pos:
            continue
        if m.start() > pos:
            segments.append((text[pos : m.start()], frozenset()))
        if m.group("spanstyle") is not None:
            # Font span: the mark carries the style declaration itself.
            mark = f"style:{m.group('spanstyle')}"
            inner = m.group("span")
        else:
            mark = next(
                name
                for name, value in m.groupdict().items()
                if value is not None
            )
            inner = m.group(mark)
            if mark == "bold2":
                mark = "bold"
            elif mark == "italic2":
                mark = "italic"
        for seg_text, seg_marks in parse_inline(inner):
            segments.append((seg_text, seg_marks | {mark}))
        pos = m.end()
    if pos < len(text):
        segments.append((text[pos:], frozenset()))
    return segments


def parse_blocks(content: str) -> list[Block]:
    content = isolate_images(content)
    blocks: list[Block] = []
    table_buffer: list[str] = []

    def flush_table() -> None:
        if not table_buffer:
            return
        rows = [
            [cell.strip() for cell in line.strip().strip("|").split("|")]
            for line in table_buffer
            if not _TABLE_SEPARATOR_RE.match(line)
        ]
        table_buffer.clear()
        if rows:
            blocks.append(Block(kind="table", rows=rows))

    for raw in content.split("\n"):
        line = raw.strip()
        if not line:
            flush_table()
            continue
        if _TABLE_ROW_RE.match(line):
            table_buffer.append(line)
            continue
        flush_table()

        if _PAGE_BREAK_RE.match(line):
            blocks.append(Block(kind="pagebreak"))
            continue
        aligned = aligned_block(line)
        if aligned:
            tag, align, inner = aligned
            blocks.append(
                Block(
                    kind="heading" if tag.startswith("h") else "para",
                    align=align,
                    segments=html_inline_segments(inner),
                    text=_html_text(inner),
                )
            )
            continue
        m = _IMAGE_RE.match(line)
        if m:
            blocks.append(Block(kind="image", text=m.group(1), src=m.group(2)))
            continue
        m = _SUBHEADING_RE.match(line)
        if m:
            blocks.append(Block(kind="heading", text=m.group(2).strip()))
            continue
        m = _PLACEHOLDER_RE.match(line)
        if m:
            blocks.append(Block(kind="placeholder", text=line))
            continue
        m = _LIST_BULLET_RE.match(line)
        if m:
            if blocks and blocks[-1].kind == "bullet":
                blocks[-1].items.append(m.group(1))
            else:
                blocks.append(Block(kind="bullet", items=[m.group(1)]))
            continue
        m = _LIST_NUMBER_RE.match(line)
        if m:
            if blocks and blocks[-1].kind == "number":
                blocks[-1].items.append(m.group(1))
            else:
                blocks.append(Block(kind="number", items=[m.group(1)]))
            continue
        m = _BLOCKQUOTE_RE.match(line)
        if m:
            if blocks and blocks[-1].kind == "quote":
                blocks[-1].text += "\n" + m.group(1)
            else:
                blocks.append(Block(kind="quote", text=m.group(1)))
            continue
        blocks.append(Block(kind="para", text=line))

    flush_table()
    return blocks
