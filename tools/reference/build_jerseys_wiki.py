"""Jersey numbers from the cached Wikipedia infoboxes (M6), offline.

    python3 tools/reference/build_jerseys_wiki.py

nflverse rosters carry almost no jersey numbers before 1990 (0-2% of rows in
the 1960s-80s), so the draft room's nameplates and jerseys fall back to the
`number` field of each player's Wikipedia infobox (NFL biography). The field
lists the numbers a player wore over his career ("16, 19"); when the list
matches his franchises one-to-one in order it is mapped per franchise,
otherwise a single number is used everywhere and a longer list is kept for the
game to resolve (first number for the first franchise, last for the last).

Reads only tools/reference/cache/ (responses cached by build_accolades.py; no
network) and data/augment/accolades.json (the page title per person). Writes
data/augment/jerseys_wiki.json: page -> {numbers, byFranchise}. Facts only, from
CC BY-SA 4.0 text, attributed by page URL in accolades.json.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from wikiparse import flatten, infobox, past_teams

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "reference" / "cache"


def pages_from_cache() -> dict[str, str]:
    """title -> wikitext, from every cached query response."""
    out: dict[str, str] = {}
    for f in sorted(CACHE.glob("*.json")):
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        resp = d.get("response") or d.get("data") or d
        pages = (resp.get("query") or {}).get("pages") if isinstance(resp, dict) else None
        if not pages:
            continue
        items = pages.values() if isinstance(pages, dict) else pages
        for p in items:
            revs = p.get("revisions") or []
            if not revs:
                continue
            r = revs[0]
            text = (r.get("slots", {}).get("main", {}) or {}).get("content") or r.get("*") or r.get("content")
            if text:
                out[p["title"]] = text
    return out


def numbers_of(raw: str) -> list[int]:
    s = flatten(raw)
    return [int(n) for n in re.findall(r"(?<!\d)(\d{1,2})(?!\d)", s)]


def main() -> None:
    acc = json.loads((ROOT / "data" / "augment" / "accolades.json").read_text())["people"]
    wanted = {v["page"] for v in acc.values() if v.get("page")}
    texts = pages_from_cache()
    out: dict[str, dict] = {}
    for title in sorted(wanted):
        text = texts.get(title)
        if not text:
            continue
        box = infobox(text)
        if not box:
            continue
        params = box[1]
        nums = numbers_of(params.get("number", ""))
        if not nums:
            continue
        franchises: list[str] = []
        for t in past_teams(params):
            if t["franchise"] and t["franchise"] not in franchises:
                franchises.append(t["franchise"])
        by = {f: n for f, n in zip(franchises, nums)} if len(nums) == len(franchises) else {}
        out[title] = {"numbers": nums, "franchises": franchises, "byFranchise": by}
    (ROOT / "data" / "augment" / "jerseys_wiki.json").write_text(
        json.dumps({"_meta": {"generatedBy": "tools/reference/build_jerseys_wiki.py", "license": "facts from Wikipedia (CC BY-SA 4.0), attributed by page URL in accolades.json"}, "pages": out}, sort_keys=True) + "\n"
    )
    print(f"jerseys_wiki: {len(out)} pages with numbers of {len(wanted)} wanted ({len(texts)} cached pages)")


if __name__ == "__main__":
    main()
