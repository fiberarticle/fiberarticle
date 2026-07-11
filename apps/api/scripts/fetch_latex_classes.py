"""Vendor journal LaTeX class/style files for offline-complete export zips.

Everything vendored here is freely redistributable (LPPL or conference
style files distributed for author use). Classes that are enormous
dependency trees (acmart) or already ship with every TeX distribution are
not vendored; the export README notes they are preinstalled on Overleaf.

Run from apps/api:  python scripts/fetch_latex_classes.py
"""

import sys
import urllib.request
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "latex" / "vendor"

# elsarticle/acmart/sn-jnl ship with TeX Live and Overleaf, so they are not
# vendored; CTAN only carries elsarticle as a .dtx anyway. neurips.cc blocks
# non-browser fetches, so the style comes from a public mirror repository.
FILES: dict[str, list[tuple[str, str]]] = {
    "ieee": [
        (
            "IEEEtran.cls",
            "https://mirrors.ctan.org/macros/latex/contrib/IEEEtran/IEEEtran.cls",
        ),
    ],
    "neurips": [
        (
            "neurips_2024.sty",
            "https://raw.githubusercontent.com/OpenRaiser/NanoResearch/main/"
            "nanoresearch/templates/neurips/neurips_2024.sty",
        ),
    ],
}


def main() -> None:
    ok, failed = 0, []
    for template, files in FILES.items():
        target_dir = VENDOR / template
        target_dir.mkdir(parents=True, exist_ok=True)
        for name, url in files:
            target = target_dir / name
            if target.exists() and target.stat().st_size > 1000:
                ok += 1
                continue
            try:
                request = urllib.request.Request(
                    url, headers={"User-Agent": "fiberarticle"}
                )
                with urllib.request.urlopen(request, timeout=120) as response:
                    target.write_bytes(response.read())
                ok += 1
                print(f"Fetched {template}/{name}")
            except Exception as exc:
                failed.append(f"{template}/{name}: {exc}")
    print(f"Vendored {ok} files into {VENDOR}")
    if failed:
        print("Failed:")
        for item in failed:
            print(" ", item)


if __name__ == "__main__":
    sys.exit(main())
