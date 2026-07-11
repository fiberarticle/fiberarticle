"""Seed journal_ranks with Scimago Journal Rank (SJR) quartiles.

Scimago's own CSV endpoint sits behind a Cloudflare challenge, so this reads
the maintained sjrdata mirror (github.com/ikashnitsky/sjrdata), which pools
every yearly SJR release as parquet. Only the latest year is loaded: one row
per ISSN with the journal's best quartile, SJR score, H index, and areas.

Run from apps/api:  python scripts/seed_journal_ranks.py
"""

import asyncio
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

sys.path.insert(0, ".")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from db import close_pool, get_pool, open_pool  # noqa: E402

PARQUET_URL = (
    "https://raw.githubusercontent.com/ikashnitsky/sjrdata/master/"
    "data-raw/sjr-journal/sjr_journals-2026.parquet"
)


def norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def load_rows(path: Path) -> list[tuple]:
    import pyarrow.parquet as pq

    table = pq.read_table(
        path,
        columns=[
            "year", "title", "issn", "sjr", "sjr_best_quartile", "h_index", "areas",
        ],
    )
    records = table.to_pylist()
    latest = max(r["year"] for r in records if r["year"])
    print(f"Dataset covers up to {int(latest)}; loading that year.", flush=True)

    rows: dict[str, tuple] = {}
    for record in records:
        if record["year"] != latest:
            continue
        title = (record["title"] or "").strip()
        quartile = (record["sjr_best_quartile"] or "").strip()
        if not title or quartile not in ("Q1", "Q2", "Q3", "Q4"):
            continue
        sjr = float(record["sjr"]) if record["sjr"] is not None else None
        h_index = int(record["h_index"] or 0)
        areas = (record["areas"] or "").strip()[:500]
        for raw_issn in (record["issn"] or "").split(","):
            issn = re.sub(r"[^0-9X]", "", raw_issn.strip().upper())
            if len(issn) == 8:
                rows[issn] = (
                    issn, title[:300], norm_title(title)[:300], sjr, quartile,
                    h_index, areas,
                )
    return list(rows.values())


async def seed(rows: list[tuple]) -> None:
    await open_pool()
    try:
        async with get_pool().connection() as conn:
            async with conn.cursor() as cur:
                await cur.executemany(
                    """
                    INSERT INTO journal_ranks
                        (issn, title, norm_title, sjr, best_quartile, h_index, areas)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (issn) DO UPDATE SET
                        title = EXCLUDED.title,
                        norm_title = EXCLUDED.norm_title,
                        sjr = EXCLUDED.sjr,
                        best_quartile = EXCLUDED.best_quartile,
                        h_index = EXCLUDED.h_index,
                        areas = EXCLUDED.areas
                    """,
                    rows,
                )
    finally:
        await close_pool()


def main() -> None:
    target = Path(tempfile.gettempdir()) / "sjr.parquet"
    if not target.exists() or target.stat().st_size < 1_000_000:
        print("Downloading SJR dataset (about 47 MB)...", flush=True)
        request = urllib.request.Request(
            PARQUET_URL, headers={"User-Agent": "fiberarticle"}
        )
        with urllib.request.urlopen(request, timeout=600) as response:
            target.write_bytes(response.read())
    rows = load_rows(target)
    print(f"Prepared {len(rows)} ISSN rows. Seeding database...", flush=True)
    asyncio.run(seed(rows))
    quartiles: dict[str, int] = {}
    for row in rows:
        quartiles[row[4]] = quartiles.get(row[4], 0) + 1
    print(f"Done. Quartile distribution: {quartiles}")


if __name__ == "__main__":
    main()
