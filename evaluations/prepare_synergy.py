"""Build screening CSVs from the SYNERGY collection.

SYNERGY (github.com/asreview/synergy-dataset, CC0) publishes the study
selection decisions for real systematic reviews as OpenAlex identifiers with a
gold inclusion label. It does not redistribute the titles and abstracts, so we
fetch those from OpenAlex, which is one of the four indexes the system already
searches.

    apps\\api\\venv\\Scripts\\python.exe evaluations/prepare_synergy.py

Writes evaluations/data/screening/<review>.csv in the format run_eval.py expects.
"""

from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "screening"
RAW = "https://raw.githubusercontent.com/asreview/synergy-dataset/master/datasets"
MAILTO = "abdulateeb5932@gmail.com"

# Six reviews, chosen as the smallest in the collection so that a full
# screening pass finishes in a sensible time on a free tier endpoint. Keeping
# them small also keeps the OpenAlex fetch polite.
REVIEWS = [
    ("Cohen_2006", "Cohen_2006_Antihistamines_ids.csv", "antihistamines"),
    ("Cohen_2006", "Cohen_2006_UrinaryIncontinence_ids.csv", "urinary incontinence"),
    ("Cohen_2006", "Cohen_2006_NSAIDS_ids.csv", "nonsteroidal anti inflammatory drugs"),
    ("Cohen_2006", "Cohen_2006_OralHypoglycemics_ids.csv", "oral hypoglycemics"),
    ("Cohen_2006", "Cohen_2006_Triptans_ids.csv", "triptans"),
    ("Cohen_2006", "Nelson_2002_ids.csv", "postmenopausal hormone therapy"),
]

BATCH = 50          # OpenAlex allows a piped id filter of this size


def reconstruct(inv: dict | None) -> str:
    if not inv:
        return ""
    pos: dict[int, str] = {}
    for word, idxs in inv.items():
        for i in idxs:
            pos[i] = word
    return " ".join(pos[i] for i in sorted(pos))


def fetch_records(client: httpx.Client, ids: list[str]) -> dict[str, dict]:
    """Title and abstract for a batch of OpenAlex work ids."""
    out: dict[str, dict] = {}
    short = [i.rsplit("/", 1)[-1] for i in ids]
    r = client.get(
        "https://api.openalex.org/works",
        params={"filter": "openalex_id:" + "|".join(short),
                "per-page": len(short), "mailto": MAILTO},
    )
    if r.status_code != 200:
        return out
    for w in r.json().get("results", []):
        key = (w.get("id") or "").rsplit("/", 1)[-1]
        out[key] = {
            "title": w.get("display_name") or "",
            "abstract": reconstruct(w.get("abstract_inverted_index")),
        }
    return out


def build_one(client: httpx.Client, folder: str, filename: str,
              topic: str) -> tuple[str, int, int]:
    url = f"{RAW}/{folder}/{filename}"
    text = client.get(url).text
    rows = list(csv.DictReader(text.splitlines()))
    labels = {}
    for r in rows:
        oid = (r.get("openalex_id") or "").strip()
        if oid:
            labels[oid.rsplit("/", 1)[-1]] = int(r.get("label_included") or 0)

    ids = list(labels)
    meta: dict[str, dict] = {}
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        meta.update(fetch_records(client, chunk))
        print(f"    fetched {min(i + BATCH, len(ids))}/{len(ids)}", flush=True)
        time.sleep(0.25)

    name = filename.replace("_ids.csv", "")
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{name}.csv"
    kept = 0
    with target.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "title", "abstract", "label"])
        for oid, label in labels.items():
            m = meta.get(oid)
            if not m or not m["title"]:
                continue          # no metadata available, cannot be screened
            w.writerow([oid, m["title"], m["abstract"], label])
            kept += 1

    # SYNERGY does not redistribute the original inclusion and exclusion
    # criteria, so screening runs on the topic alone. Recording the topic
    # keeps the run reproducible.
    (OUT / f"{name}.topic.txt").write_text(topic, encoding="utf-8")
    return name, kept, sum(labels.values())


def main() -> None:
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        summary = []
        for folder, filename, topic in REVIEWS:
            print(f"  {filename}", flush=True)
            try:
                summary.append(build_one(client, folder, filename, topic))
            except Exception as exc:
                print(f"    failed: {exc}", flush=True)
        print("\nreview                                  records  relevant")
        for name, kept, rel in summary:
            print(f"{name:40s}{kept:>8d}{rel:>10d}")


if __name__ == "__main__":
    sys.exit(main())
