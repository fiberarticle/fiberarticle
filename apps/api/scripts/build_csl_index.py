"""Build csl/index.json from the official CSL styles repository.

Downloads the citation-style-language/styles master zip once, reads every
.csl entry in memory, and writes a compact searchable index:

    [{"id", "title", "format", "dep"(0|1), "parent"(dependents only)}, ...]

Independent styles live at the repo root; dependent styles (journal aliases
that point at an independent parent) live under dependent/. Both are indexed
so users can pick per-journal styles by name, exactly like the big reference
managers.

Run from apps/api:  python scripts/build_csl_index.py
"""

import io
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ZIP_URL = (
    "https://github.com/citation-style-language/styles/archive/refs/heads/master.zip"
)
OUT = Path(__file__).resolve().parent.parent / "csl" / "index.json"

_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.DOTALL)
_FORMAT_RE = re.compile(r'citation-format="([^"]+)"')
_PARENT_RE = re.compile(
    r'rel="independent-parent"\s+href="[^"]*/styles/([^"/]+)"'
)


def _entry(name: str, xml: str) -> dict | None:
    match = _TITLE_RE.search(xml)
    if not match:
        return None
    title = re.sub(r"\s+", " ", match.group(1)).strip()
    # Unescape the handful of entities that appear in titles.
    for entity, char in (
        ("&amp;", "&"),
        ("&apos;", "'"),
        ("&quot;", '"'),
        ("&#38;", "&"),
        ("&#39;", "'"),
    ):
        title = title.replace(entity, char)
    style_id = Path(name).stem
    dep = "/dependent/" in name
    entry: dict = {"id": style_id, "title": title}
    fmt = _FORMAT_RE.search(xml)
    if fmt:
        entry["format"] = fmt.group(1)
    if dep:
        entry["dep"] = 1
        parent = _PARENT_RE.search(xml)
        if parent:
            entry["parent"] = parent.group(1)
    return entry


def main() -> None:
    print("Downloading styles repository zip (about 40 MB)...", flush=True)
    request = urllib.request.Request(ZIP_URL, headers={"User-Agent": "fiberarticle"})
    with urllib.request.urlopen(request, timeout=600) as response:
        data = response.read()
    print(f"Downloaded {len(data) // (1024 * 1024)} MB. Indexing...", flush=True)

    entries: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if not name.endswith(".csl"):
                continue
            # Skip renamed-styles and other metadata folders.
            parts = name.split("/")
            if len(parts) == 2 or (len(parts) == 3 and parts[1] == "dependent"):
                xml = archive.read(name).decode("utf-8", errors="replace")
                entry = _entry(name, xml)
                if entry:
                    entries.append(entry)

    entries.sort(key=lambda e: e["title"].lower())
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(
        json.dumps(entries, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    independent = sum(1 for e in entries if not e.get("dep"))
    print(
        f"Wrote {len(entries)} styles ({independent} independent, "
        f"{len(entries) - independent} dependent) to {OUT}"
    )


if __name__ == "__main__":
    sys.exit(main())
