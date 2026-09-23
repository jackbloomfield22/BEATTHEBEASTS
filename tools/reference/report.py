"""Regenerate the auto sections of docs/REFERENCE_NOTES.md from data/augment/*.json.

    python3 tools/reference/report.py

Writes between <!-- BEGIN:auto:NAME --> / <!-- END:auto:NAME --> markers:
  coverage     accolades coverage by position group (entries and people)
  disagree     legacy DEFENSE ap/pb vs Wikipedia honors inside the same team+decade stint
  matching     loose team/decade matches and unparsed count mismatches worth a look
  physical     40-time counts
Offline: reads only committed JSON plus the legacy modules.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import AUGMENT_DIR, ROOT, load_legacy  # noqa: E402

DOC = ROOT / "docs" / "REFERENCE_NOTES.md"


def stint_seasons(person: dict, team: str, decade: str) -> list[int]:
    d0 = int(decade[:4])
    out = set()
    for t in person.get("teams", []):
        if t["franchise"] != team:
            continue
        for y in range(max(d0, t["from"]), min(d0 + 9, t["to"]) + 1):
            out.add(y)
    return sorted(out)


def count_in(person: dict, fields: tuple, seasons: list[int]) -> int:
    s = set(seasons)
    yrs = set()
    for f in fields:
        yrs |= {y for y in person.get(f, []) if y in s}
    return len(yrs)


def table(rows: list[list], head: list[str]) -> str:
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def main() -> None:
    acc = json.loads((AUGMENT_DIR / "accolades.json").read_text("utf-8"))
    phys = json.loads((AUGMENT_DIR / "estimated_physical.json").read_text("utf-8"))
    leg = load_legacy()
    people = acc["people"]
    by_entry = {e: p for p in people.values() for e in p["entries"]}

    sections: dict[str, str] = {}

    # ---------------------------------------------------------------- coverage
    cov = acc["_meta"]["coverage"]
    groups = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "ALL"]

    def cov_rows(block: dict) -> list[list]:
        rows = []
        for g in groups:
            c = block.get(g)
            if not c:
                continue
            tot = sum(c.values())
            ref = c.get("reference", 0)
            rows.append([g, tot, ref, c.get("estimated", 0), c.get("missing", 0), f"{100 * ref / tot:.1f}%"])
        return rows

    head = ["group", "total", "reference", "estimated", "missing", "reference %"]
    wp = acc["_meta"]["wikipediaPass"]
    sections["coverage"] = "\n\n".join([
        "**Legacy entries covered, imp >= 85 (PLAYERS and DEFENSE entries whose own imp is 85+):**",
        table(cov_rows(cov["entries_imp85"]), head),
        "**All targeted legacy entries (PLAYERS names with max imp >= 76, all DEFENSE, all OL key-list linemen; "
        "OL counts are unit memberships):**",
        table(cov_rows(cov["entries_all"]), head),
        "**People whose highest PLAYERS/DEFENSE entry imp is 85+:**",
        table(cov_rows(cov["people_imp85"]), head),
        "**All people (distinct persons):**",
        table(cov_rows(cov["people"]), head),
        f"Last build: {acc['_meta']['generated']}. Network requests {wp['networkRequests']}, cache hits "
        f"{wp['cacheHits']}, back-off sleeps {wp['backoffSeconds']} s, elapsed {wp['elapsedSeconds']} s "
        "(a cached rerun makes zero requests).",
    ])

    # ---------------------------------------------------------------- disagreements
    rows = []
    for d in leg["defense"]:
        p = by_entry.get(d["id"])
        if not p or p["conf"] == "missing":
            continue
        seasons = stint_seasons(p, d["t"], d["d"])
        if not seasons:
            continue
        ap = count_in(p, ("allPro1", "allAFL1"), seasons)
        ap_loose = count_in(p, ("allPro1", "allAFL1", "allProUnspecified", "allAFLUnspecified"), seasons)
        pb = count_in(p, ("proBowl", "aflAllStar"), seasons)
        dpoy = count_in(p, ("dpoy",), seasons)
        l_ap, l_pb, l_dp = d["s"]["ap"], d["s"]["pb"], d["s"].get("dpoy", 0)
        dap = l_ap - (ap if l_ap <= ap_loose and l_ap >= ap else ap)
        score = abs(l_ap - ap) * 1.5 + abs(l_pb - pb) + abs(l_dp - dpoy) * 2
        rows.append((score, d, seasons, ap, ap_loose, pb, dpoy, l_ap, l_pb, l_dp))
    rows.sort(key=lambda r: -r[0])
    top = [r for r in rows if r[0] >= 3][:45]
    sections["disagree"] = "\n\n".join([
        f"Compared {len(rows)} DEFENSE entries whose person has a Wikipedia infobox with team spans. "
        "Stint seasons = the entry's decade intersected with the page's years at that franchise. "
        "Wikipedia AP counts first-team All-Pro plus first-team All-AFL (the unqualified 'All-Pro' count is shown in brackets "
        "when it differs); PB counts Pro Bowls plus AFL All-Star games. Score = 1.5|dAP| + |dPB| + 2|dDPOY|; all rows with score >= 3 "
        f"({len(top)} shown, of {sum(1 for r in rows if r[0] >= 3)}).",
        table([[
            f"{d['n']} {d['t']} {d['d']}", f"{seasons[0]}-{seasons[-1]} ({len(seasons)})",
            f"{l_ap} vs {ap}" + (f" [{ap_loose}]" if ap_loose != ap else ""), f"{l_pb} vs {pb}", f"{l_dp} vs {dp}",
            f"{s:g}",
        ] for s, d, seasons, ap, ap_loose, pb, dp, l_ap, l_pb, l_dp in top],
            ["entry", "stint seasons (n)", "ap legacy vs wiki", "pb legacy vs wiki", "dpoy legacy vs wiki", "score"]),
        f"Agreement: legacy `ap` equals the Wikipedia count for {sum(1 for r in rows if r[7] == r[3])}/{len(rows)} entries, "
        f"`pb` for {sum(1 for r in rows if r[8] == r[5])}/{len(rows)}, `dpoy` for {sum(1 for r in rows if r[9] == r[6])}/{len(rows)}. "
        f"Legacy higher than Wikipedia on `pb`: {sum(1 for r in rows if r[8] > r[5])}; lower: {sum(1 for r in rows if r[8] < r[5])}.",
    ])

    # ---------------------------------------------------------------- matching notes
    loose, counts, nohl = [], [], []
    for k, p in sorted(people.items()):
        for n in p.get("notes", []):
            if n.startswith("team/decade matched loosely"):
                loose.append(f"- `{k}` -> {p.get('page')}: {n.split(': ', 1)[1]}")
            elif "count" in n and "parsed" in n:
                counts.append(f"- `{k}`: {n}")
            elif n.startswith("infobox has no highlights"):
                nohl.append(k)
    missing = [f"- `{k}`: {', '.join(p['entries'])}" for k, p in sorted(people.items()) if p["conf"] == "missing"]
    sections["matching"] = "\n\n".join([
        f"**Loose matches ({len(loose)})**: the page is right by name and position, but its team years don't overlap the "
        "legacy decade exactly (off by a season, or the legacy decade is wrong).",
        "\n".join(loose) or "(none)",
        f"**Honor-count mismatches ({len(counts)})**: the bullet's 'N×' disagrees with the seasons listed. The listed seasons are "
        "what is stored.",
        "\n".join(counts) or "(none)",
        f"**Unmatched ({len(missing)})**: conf `missing`, honors unknown.",
        "\n".join(missing) or "(none)",
        f"**Pages with no highlights field ({len(nohl)})**: honors stored as empty lists with conf `reference` "
        "(the page lists none, which for these role players almost always means none were won).",
    ])

    # ---------------------------------------------------------------- physical
    pc = phys["_meta"]["counts"]
    ref_rows = sorted((p for p in phys["people"].values() if p["conf"] == "reference"), key=lambda p: p["forty"])
    est_rows = sorted((p for p in phys["people"].values() if p["conf"] == "estimated"), key=lambda p: p["forty"])
    sections["physical"] = "\n\n".join([
        f"{pc['reference']} reference times (Wikipedia pre-draft tables) and {pc['estimated']} estimates.",
        "**Estimates from knowledge:**",
        table([[p["name"], p["forty"], p["note"]] for p in est_rows], ["player", "40", "basis"]),
        "**Where a reference exists, estimates kept for comparison:**",
        table([[p["name"], p["forty"], p["alsoEstimated"]["forty"], p["timing"]] for p in ref_rows if p.get("alsoEstimated")],
              ["player", "40 (Wikipedia)", "40 (estimate)", "timing"]),
    ])

    text = DOC.read_text("utf-8")
    for name, body in sections.items():
        pat = re.compile(rf"(<!-- BEGIN:auto:{name} -->).*?(<!-- END:auto:{name} -->)", re.S)
        if not pat.search(text):
            print(f"marker for {name} missing in {DOC}", file=sys.stderr)
            continue
        text = pat.sub(lambda m: m.group(1) + "\n" + body + "\n" + m.group(2), text)
    DOC.write_text(text, "utf-8")
    print("updated", DOC.relative_to(ROOT))


if __name__ == "__main__":
    main()
