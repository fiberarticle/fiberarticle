"""Render a Fiberarticle document to an Overleaf-ready LaTeX project zip.

main.tex uses the journal template's document class; [n] citation markers
become \\cite{key} calls resolved against refs.bib (generated from the run's
papers); figure/table placeholders become commented TODO stubs the author
fills in. The zip compiles on Overleaf as-is.
"""

import io
import re
import zipfile

from export.citations import _bibtex_key, to_bibtex
from latex.templates import LatexTemplate, template_for, vendored_files

_CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_PLACEHOLDER_RE = re.compile(r"^\[(.*placeholder.*)\]$", re.IGNORECASE)

# Block-level Markdown: list items and blockquotes.
_LIST_BULLET_RE = re.compile(r"^[-*+]\s+(.+)$")
_LIST_NUMBER_RE = re.compile(r"^\d+[.)]\s+(.+)$")
_BLOCKQUOTE_RE = re.compile(r"^>\s?(.*)$")

# Inline Markdown marks, tried in priority order (bold before italic so
# "**x**" is not swallowed by the single-marker italic alternatives).
_INLINE_TOKEN_RE = re.compile(
    r"\*\*(?P<bold>.+?)\*\*"
    r"|__(?P<bold2>.+?)__"
    r"|\*(?P<italic>[^*]+?)\*"
    r"|_(?P<italic2>[^_]+?)_"
    r"|~~(?P<strike>.+?)~~"
    r"|`(?P<code>[^`]+?)`"
)

_MARK_COMMANDS = {
    "bold": r"\textbf{%s}",
    "italic": r"\emph{%s}",
    "strike": r"\sout{%s}",
    "code": r"\texttt{%s}",
}
# Wrap order: innermost first (code/strike), emphasis/bold outermost.
_MARK_ORDER = ("code", "strike", "italic", "bold")

# Order matters: backslash first.
_ESCAPES = [
    ("\\", r"\textbackslash{}"),
    ("&", r"\&"),
    ("%", r"\%"),
    ("$", r"\$"),
    ("#", r"\#"),
    ("_", r"\_"),
    ("{", r"\{"),
    ("}", r"\}"),
    ("~", r"\textasciitilde{}"),
    ("^", r"\textasciicircum{}"),
]


def escape_latex(text: str) -> str:
    for char, replacement in _ESCAPES:
        text = text.replace(char, replacement)
    return text


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
        if m.group("bold") is not None:
            inner, mark = m.group("bold"), "bold"
        elif m.group("bold2") is not None:
            inner, mark = m.group("bold2"), "bold"
        elif m.group("italic") is not None:
            inner, mark = m.group("italic"), "italic"
        elif m.group("italic2") is not None:
            inner, mark = m.group("italic2"), "italic"
        elif m.group("strike") is not None:
            inner, mark = m.group("strike"), "strike"
        else:
            inner, mark = m.group("code"), "code"
        for seg_text, seg_marks in _parse_inline(inner):
            segments.append((seg_text, seg_marks | {mark}))
        pos = m.end()
    if pos < len(text):
        segments.append((text[pos:], frozenset()))
    return segments


def _wrap_marks(text: str, marks: frozenset) -> str:
    for mark in _MARK_ORDER:
        if mark in marks:
            text = _MARK_COMMANDS[mark] % text
    return text


def _bib_keys(papers: list[dict]) -> list[str]:
    """Keys in paper order, deduplicated the same way to_bibtex does."""
    keys: list[str] = []
    seen: set[str] = set()
    for paper in papers:
        key = _bibtex_key(paper)
        while key in seen:
            key += "x"
        seen.add(key)
        keys.append(key)
    return keys


def _convert_inline(text: str, keys: list[str]) -> str:
    """Escape prose, turn [n] markers into \\cite{...}, and apply inline marks."""
    pieces: list[str] = []
    for seg_text, marks in _parse_inline(text):
        if not seg_text:
            continue
        # Protect citation markers from escaping, then restore as \cite.
        tokens: dict[str, str] = {}

        def stash(match: re.Match) -> str:
            numbers = [int(n) for n in match.group(1).replace(" ", "").split(",")]
            valid = [keys[n - 1] for n in numbers if 1 <= n <= len(keys)]
            if not valid:
                return match.group(0)
            token = f"@@CITE{len(tokens)}@@"
            tokens[token] = "\\cite{" + ",".join(valid) + "}"
            return token

        piece = _CITE_RE.sub(stash, seg_text)
        piece = escape_latex(piece)
        for token, cite in tokens.items():
            piece = piece.replace(token, cite)
        pieces.append(_wrap_marks(piece, marks))
    return "".join(pieces)


def _convert_body(content: str, keys: list[str]) -> str:
    """Escape prose, turn [n] markers into \\cite{...} calls, and render
    Markdown block structure (lists, blockquotes) and inline marks."""
    blocks: list[str] = []
    list_buffer: list[str] = []
    list_env: str | None = None
    quote_buffer: list[str] = []

    def flush_list() -> None:
        nonlocal list_env
        if list_buffer:
            items = "\n".join(f"  \\item {item}" for item in list_buffer)
            blocks.append(f"\\begin{{{list_env}}}\n{items}\n\\end{{{list_env}}}")
            list_buffer.clear()
        list_env = None

    def flush_quote() -> None:
        if quote_buffer:
            body = "\n".join(quote_buffer)
            blocks.append(f"\\begin{{quote}}\n{body}\n\\end{{quote}}")
            quote_buffer.clear()

    for raw in content.split("\n"):
        line = raw.strip()
        if not line:
            continue
        placeholder = _PLACEHOLDER_RE.match(line)
        if placeholder:
            flush_list()
            flush_quote()
            inner = escape_latex(placeholder.group(1))
            blocks.append(
                "% TODO: " + inner + "\n"
                "\\begin{figure}[htbp]\n"
                "  \\centering\n"
                "  % \\includegraphics[width=\\linewidth]{placeholder}\n"
                f"  \\caption{{{inner}}}\n"
                "\\end{figure}"
            )
            continue

        m = _LIST_BULLET_RE.match(line)
        if m:
            flush_quote()
            if list_env not in (None, "itemize"):
                flush_list()
            list_env = "itemize"
            list_buffer.append(_convert_inline(m.group(1), keys))
            continue

        m = _LIST_NUMBER_RE.match(line)
        if m:
            flush_quote()
            if list_env not in (None, "enumerate"):
                flush_list()
            list_env = "enumerate"
            list_buffer.append(_convert_inline(m.group(1), keys))
            continue

        m = _BLOCKQUOTE_RE.match(line)
        if m:
            flush_list()
            quote_buffer.append(_convert_inline(m.group(1), keys))
            continue

        flush_list()
        flush_quote()
        blocks.append(_convert_inline(line, keys))

    flush_list()
    flush_quote()
    return "\n\n".join(blocks)


def render_main_tex(document: dict, papers: list[dict]) -> str:
    template: LatexTemplate = template_for(document.get("template") or "generic")
    keys = _bib_keys(papers)
    title = escape_latex(document.get("title") or "Untitled")
    authors = document.get("authors") or []
    author_text = (
        " \\and ".join(escape_latex(a) for a in authors)
        if authors
        else "Author Name"
    )

    lines: list[str] = [
        "% Generated by Fiberarticle. Compiles on Overleaf as-is.",
        template.documentclass,
    ]
    if template.preamble:
        lines.append(template.preamble.rstrip())
    lines.extend(
        [
            "\\usepackage[utf8]{inputenc}",
            "\\usepackage{graphicx}",
            "\\usepackage[normalem]{ulem}",
            "",
            f"\\title{{{title}}}",
            template.author_command.format(authors=author_text),
            "",
            "\\begin{document}",
            "\\maketitle",
            "",
        ]
    )

    for section in document.get("sections") or []:
        heading = (section.get("heading") or "Section").strip()
        content = section.get("content") or ""
        if heading.lower() == "abstract":
            lines.append("\\begin{abstract}")
            lines.append(_convert_body(content, keys))
            lines.append("\\end{abstract}")
        else:
            lines.append(f"\\section{{{escape_latex(heading)}}}")
            lines.append(_convert_body(content, keys))
        lines.append("")

    lines.extend(
        [
            f"\\bibliographystyle{{{template.bib_style}}}",
            "\\bibliography{refs}",
            "",
            "\\end{document}",
            "",
        ]
    )
    return "\n".join(lines)


def render_project_zip(document: dict, papers: list[dict]) -> bytes:
    template = template_for(document.get("template") or "generic")
    main_tex = render_main_tex(document, papers)
    refs_bib = to_bibtex(papers) if papers else "% no references\n"

    readme = (
        "Fiberarticle LaTeX export\n"
        "=========================\n\n"
        f"Template: {template.label}\n\n"
        "To compile: upload this zip to Overleaf (New Project > Upload Project)\n"
        "or run pdflatex + bibtex locally.\n\n"
        "Files:\n"
        "  main.tex  - the manuscript\n"
        "  refs.bib  - references generated from your run's papers\n"
    )
    if template.vendored:
        readme += "".join(
            f"  {name}  - journal class/style, included\n" for name in template.vendored
        )
    if template.note:
        readme += f"\nNote: {template.note}\n"
    readme += (
        "\nFigure and table placeholders are marked with % TODO comments.\n"
        "Search main.tex for TODO to fill them in.\n"
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("main.tex", main_tex)
        archive.writestr("refs.bib", refs_bib)
        archive.writestr("README.txt", readme)
        for name, data in vendored_files(template):
            archive.writestr(name, data)
    return buffer.getvalue()
