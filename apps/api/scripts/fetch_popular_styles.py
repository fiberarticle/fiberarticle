"""Bundle the most-used CSL styles offline into csl/.

Everything else is lazily fetched from the jsDelivr CDN on first use and
cached to csl/cache/. Run from apps/api: python scripts/fetch_popular_styles.py
"""

import sys
import urllib.request
from pathlib import Path

CDN = "https://cdn.jsdelivr.net/gh/citation-style-language/styles@master"
CSL_DIR = Path(__file__).resolve().parent.parent / "csl"

# Curated: the standard academic styles plus flagship journals/publishers.
POPULAR: list[str] = [
    "apa",  # APA 7th
    "apa-6th-edition",
    "modern-language-association",  # MLA 9th
    "modern-language-association-notes",
    "chicago-author-date",
    "chicago-notes-bibliography",
    "ieee",
    "vancouver-nlm",
    "vancouver-ama",
    "harvard-cite-them-right",
    "american-medical-association",  # AMA 11th
    "american-chemical-society",
    "cse-name-year",
    "cse-citation-sequence",
    "american-sociological-association",
    "american-political-science-association",
    "american-institute-of-physics",
    "american-society-of-civil-engineers",
    "american-society-for-microbiology",
    "acm-sig-proceedings",
    "association-for-computing-machinery",
    "nature",
    "science",
    "cell",
    "the-lancet",
    "the-new-england-journal-of-medicine",
    "bmj",
    "plos",
    "pnas",
    "elsevier-harvard",
    "elsevier-with-titles",
    "elsevier-vancouver",
    "springer-basic-author-date",
    "springer-basic-brackets",
    "springer-vancouver-brackets",
    "taylor-and-francis-chicago-author-date",
    "sage-harvard",
    "new-harts-rules-notes",
    "cambridge-university-press-author-date",
    "turabian-author-date",
    "mcgill-en",
    "oscola",
    "bluebook-law-review",
    "annual-reviews",
    "royal-society-of-chemistry",
    "institute-of-physics-numeric",
    "frontiers",
    "multidisciplinary-digital-publishing-institute",
    "peerj",
    "f1000research",
    "biomed-central",
    "emerald-harvard",
    "wiley-vch-books",
    "din-1505-2",
    "gost-r-7-0-5-2008-numeric",
    "china-national-standard-gb-t-7714-2015-numeric",
    "iso690-author-date-en",
    "iso690-numeric-en",
]


def main() -> None:
    CSL_DIR.mkdir(exist_ok=True)
    ok, failed = 0, []
    for style_id in POPULAR:
        target = CSL_DIR / f"{style_id}.csl"
        if target.exists():
            ok += 1
            continue
        for path in (f"{style_id}.csl", f"dependent/{style_id}.csl"):
            try:
                request = urllib.request.Request(
                    f"{CDN}/{path}", headers={"User-Agent": "fiberarticle"}
                )
                with urllib.request.urlopen(request, timeout=60) as response:
                    target.write_bytes(response.read())
                ok += 1
                break
            except Exception:
                continue
        else:
            failed.append(style_id)
    print(f"Bundled {ok}/{len(POPULAR)} styles into {CSL_DIR}")
    if failed:
        print("Failed:", ", ".join(failed))


if __name__ == "__main__":
    sys.exit(main())
