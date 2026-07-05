"""Journal LaTeX template registry.

Every template produces an Overleaf-ready project: main.tex built on the
journal's document class, refs.bib, and any vendored class/style files from
latex/vendor/<id>/. Classes not vendored (acmart, elsarticle, sn-jnl) ship
with TeX Live and Overleaf.
"""

from dataclasses import dataclass, field
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / "vendor"


@dataclass(frozen=True)
class LatexTemplate:
    id: str
    label: str
    description: str
    # \documentclass line and any preamble the class needs.
    documentclass: str
    preamble: str = ""
    # BibTeX style passed to \bibliographystyle.
    bib_style: str = "plain"
    # How the class opens/closes the author block.
    author_command: str = "\\author{{{authors}}}"
    # Section numbering already handled by the class.
    vendored: tuple[str, ...] = field(default_factory=tuple)
    note: str = ""


TEMPLATES: dict[str, LatexTemplate] = {
    "generic": LatexTemplate(
        id="generic",
        label="Generic manuscript",
        description="Clean single-column article class. Safe default for any venue.",
        documentclass="\\documentclass[11pt]{article}",
        preamble=(
            "\\usepackage[margin=1in]{geometry}\n"
            "\\usepackage{authblk}\n"
        ),
        bib_style="unsrt",
        author_command="\\author{{{authors}}}",
    ),
    "ieee": LatexTemplate(
        id="ieee",
        label="IEEE (IEEEtran)",
        description="IEEE journal/conference two-column format with IEEEtran.",
        documentclass="\\documentclass[conference]{IEEEtran}",
        bib_style="IEEEtran",
        vendored=("IEEEtran.cls",),
        note="IEEEtran.cls is included; the IEEEtran BibTeX style ships with TeX.",
    ),
    "acm": LatexTemplate(
        id="acm",
        label="ACM (acmart)",
        description="ACM proceedings and journals format (acmart, sigconf).",
        documentclass="\\documentclass[sigconf]{acmart}",
        bib_style="ACM-Reference-Format",
        note="acmart is preinstalled on Overleaf and in TeX Live.",
    ),
    "elsevier": LatexTemplate(
        id="elsevier",
        label="Elsevier (elsarticle)",
        description="Elsevier journal submission format (elsarticle).",
        documentclass="\\documentclass[review]{elsarticle}",
        bib_style="elsarticle-num",
        note="elsarticle is preinstalled on Overleaf and in TeX Live.",
    ),
    "springer": LatexTemplate(
        id="springer",
        label="Springer Nature (sn-jnl)",
        description="Springer Nature journal format (sn-jnl).",
        documentclass="\\documentclass[pdflatex,sn-mathphys-num]{sn-jnl}",
        bib_style="sn-mathphys-num",
        note="sn-jnl is preinstalled on Overleaf; also available from Springer Nature.",
    ),
    "neurips": LatexTemplate(
        id="neurips",
        label="NeurIPS",
        description="NeurIPS conference format (preprint mode).",
        documentclass="\\documentclass{article}",
        preamble="\\usepackage[preprint]{neurips_2024}\n",
        bib_style="unsrtnat",
        vendored=("neurips_2024.sty",),
        note="neurips_2024.sty is included; preprint option avoids submission numbering.",
    ),
}


def template_for(template_id: str) -> LatexTemplate:
    return TEMPLATES.get(template_id, TEMPLATES["generic"])


def vendored_files(template: LatexTemplate) -> list[tuple[str, bytes]]:
    files: list[tuple[str, bytes]] = []
    directory = VENDOR_DIR / template.id
    for name in template.vendored:
        path = directory / name
        if path.exists():
            files.append((name, path.read_bytes()))
    return files
