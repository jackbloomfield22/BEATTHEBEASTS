"""Build data/augment/estimated_physical.json (40-yard dash times).

    python3 tools/reference/build_physical.py            # network allowed (cached)
    python3 tools/reference/build_physical.py --offline  # cache only

Two sources, never mixed up:

1. conf "reference": the "Pre-draft measurables" table ({{NFL predraft}}) on the
   player's Wikipedia page, when it lists a 40 time. Read through the official
   API for the pages already matched in data/augment/accolades.json (non-OL).
   The table's own note says whether the time is from the Combine or a pro day.
2. conf "estimated": KNOWN below, typed from knowledge of commonly cited times
   for players who predate the nflverse combine data (2000+) or never ran at the
   combine. Note "commonly cited" = a specific time that is widely repeated
   (often hand-timed or from a pro day / team workout); "estimate" = no documented
   time, value inferred from documented sprint results or reputation. Players
   with no basis at all are omitted: the ratings engine falls back to position
   priors.

When both exist for a person, the reference value wins and the estimate is kept
under `alsoEstimated` for review.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import AUGMENT_DIR, CACHE_DIR, WikiClient, load_legacy, now_iso, page_url, write_json  # noqa: E402
import wikiparse as wp  # noqa: E402

FULL_CACHE = CACHE_DIR / "fullpages"

# name: (forty, basis, note). basis: "commonly cited" | "estimate".
# Optional 4th element: legacy entry-id substring to pin a homonym.
KNOWN: dict[str, tuple] = {
    # --- the brief's anchors
    "Bo Jackson": (4.12, "commonly cited", "1986 pre-draft workout at Auburn, hand-timed; figures 4.12-4.18 are repeated and disputed"),
    "Bob Hayes": (4.30, "estimate", "no recorded 40; 1964 Olympic 100 m champion (10.0 s), world-class sprinter speed"),
    "Deion Sanders": (4.27, "commonly cited", "1989 NFL Combine, hand-timed (4.19-4.29 versions circulate)"),
    "Darrell Green": (4.25, "estimate", "world-class sprinter; hand times in the 4.1-4.3 range are cited from 1983, none official"),
    "Eric Dickerson": (4.35, "estimate", "consistently described as a 4.3-speed back at 220 lb; no electronic combine time (1983)"),
    "Michael Vick": (4.33, "commonly cited", "2001 pre-draft workout (did not run at the Combine)"),
    "Randy Moss": (4.25, "commonly cited", "1998 Marshall pro day"),
    "Barry Sanders": (4.37, "commonly cited", "1989 pre-draft (4.27 hand-timed version also circulates)"),
    "Jerry Rice": (4.65, "commonly cited", "1985 pre-draft; times of 4.6-4.7 are the ones repeated"),
    "Tyreek Hill": (4.29, "commonly cited", "2016 West Alabama pro day (4.24-4.29 reported); did not attend the Combine"),
    "Lamar Jackson": (4.34, "estimate", "never timed at the 2018 Combine or a pro day; 4.34 is the self-reported figure"),
    "Jim Brown": (4.50, "estimate", "no documented 40; contemporaries' accounts of a 230-lb back with sprinter speed"),
    # --- RB
    "Marshall Faulk": (4.29, "commonly cited", "1994 pre-draft (4.28-4.35 cited)"),
    "Emmitt Smith": (4.55, "commonly cited", "1990 pre-draft, famously 'slow' time (4.55-4.7 cited)"),
    "O.J. Simpson": (4.40, "estimate", "no recorded 40; member of USC's 1967 world-record 4x110 yd relay"),
    "Herschel Walker": (4.35, "estimate", "no NFL combine time (USFL, 1983); 10.2 s 100 m sprinter"),
    # --- WR / TE
    "Joey Galloway": (4.18, "commonly cited", "1995 pre-draft (hand-timed)"),
    "Cliff Branch": (4.30, "estimate", "no recorded 40; NCAA-level sprinter (10.0 s 100 m) at Colorado"),
    "Willie Gault": (4.25, "estimate", "no recorded 40 widely documented; world-class hurdler/sprinter"),
    "Rocket Ismail": (4.28, "commonly cited", "1991 pre-draft (went to the CFL)"),
    "Larry Fitzgerald": (4.48, "commonly cited", "2004 Pitt pro day (did not run at the Combine)"),
    "Ja'Marr Chase": (4.38, "commonly cited", "2021 LSU pro day (no Combine held in 2021)"),
    "Kyle Pitts": (4.44, "commonly cited", "2021 Florida pro day (no Combine held in 2021)"),
    # --- DB
    "Rod Woodson": (4.29, "commonly cited", "1987 pre-draft; world-class hurdler"),
    "Champ Bailey": (4.28, "commonly cited", "1999 NFL Combine"),
    "Micah Parsons": (4.39, "commonly cited", "2021 Penn State pro day (no Combine held in 2021)"),
    # --- pass rushers
    "Jevon Kearse": (4.43, "commonly cited", "1999 NFL Combine at 6-4, 262 lb"),
}


def _fkey(title: str) -> Path:
    return FULL_CACHE / (hashlib.sha1(title.encode("utf-8")).hexdigest() + ".json")


def fetch_full(client: WikiClient, titles: list[str]) -> dict[str, dict]:
    FULL_CACHE.mkdir(parents=True, exist_ok=True)
    out, todo = {}, []
    for t in dict.fromkeys(titles):
        p = _fkey(t)
        if p.exists():
            out[t] = json.loads(p.read_text("utf-8"))
        elif not client.offline:
            todo.append(t)
    for i in range(0, len(todo), 15):
        batch = todo[i:i + 15]
        data, retrieved = client.get({
            "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
            "titles": "|".join(batch),
        })
        pages = {p["title"]: p for p in data.get("query", {}).get("pages", [])}
        norm = {n["from"]: n["to"] for n in data.get("query", {}).get("normalized", [])}
        for t in batch:
            pg = pages.get(norm.get(t, t))
            content = pg["revisions"][0]["slots"]["main"]["content"] if pg and pg.get("revisions") else ""
            rec = {"title": t, "retrieved": retrieved, "content": content}
            _fkey(t).write_text(json.dumps(rec, ensure_ascii=False), "utf-8")
            out[t] = rec
        print(f"  full pages {min(i + 15, len(todo))}/{len(todo)}", file=sys.stderr, flush=True)
    return out


PREDRAFT_RE = re.compile(r"\{\{\s*NFL[ _]predraft", re.I)

# output field -> (template params, plausible range). Units: seconds, inches, reps.
MEASURES = {
    "forty": (("dash", "forty", "40"), (4.1, 5.9)),
    "tenSplit": (("ten split",), (1.3, 2.0)),
    "vertical": (("vertical",), (15.0, 48.0)),
    "broad": ((), (70.0, 150.0)),  # from "broad ft" + "broad in"
    "shuttle": (("shuttle", "twenty ss", "short shuttle"), (3.7, 5.5)),
    "cone": (("cone drill", "three cone", "cone"), (6.2, 9.0)),
    "bench": (("bench",), (0.0, 50.0)),
}


def num(raw: str) -> float | None:
    """'40.5', '40 1/2', '9 3/4', '47.0' -> float; None if absent."""
    t = wp.flatten(raw).replace("½", " 1/2").replace("¼", " 1/4").replace("¾", " 3/4")
    m = re.match(r"\s*(\d+(?:\.\d+)?)(?:\s+(\d+)/(\d+))?", t)
    if not m:
        return None
    v = float(m.group(1))
    if m.group(2):
        v += int(m.group(2)) / int(m.group(3))
    return v


def predraft(content: str) -> tuple[dict[str, float], str, list[str]] | None:
    """({field: value}, note, flags) from the first {{NFL predraft}} with any drill result."""
    text = wp.strip_noise(content)
    for m in PREDRAFT_RE.finditer(text):
        end = wp.find_template_end(text, m.start())
        body = text[m.start() + 2:end - 2]
        params: dict[str, str] = {}
        for part in wp.split_top(body)[1:]:
            if "=" in part:
                k, v = part.split("=", 1)
                params[re.sub(r"\s+", " ", k.strip().lower())] = v.strip()
        vals: dict[str, float] = {}
        flags: list[str] = []
        for field, (keys, (lo, hi)) in MEASURES.items():
            raw = next((params[k] for k in keys if params.get(k)), "")
            v = None
            if field == "broad":
                ft, inch = num(params.get("broad ft", "")), num(params.get("broad in", "") or "0")
                if ft is not None:
                    v = ft * 12 + (inch or 0)
                    raw = params.get("broad ft", "") + params.get("broad in", "")
            elif raw:
                v = num(raw)
            if v is None:
                continue
            if not lo <= v <= hi:
                flags.append(f"{field} {v} out of range, dropped")
                continue
            vals[field] = round(v, 2)
            if re.search(r"\{\{\s*(cn|citation needed|fact)\b", raw, re.I):
                flags.append(f"{field}: marked 'citation needed' on the page")
        if not vals:
            continue
        note = wp.flatten(params.get("note") or params.get("notes") or "")
        return vals, re.sub(r"\s+", " ", note).strip(), flags
    return None


def timing_of(note: str) -> str:
    combine = bool(re.search(r"combine", note, re.I))
    proday = bool(re.search(r"pro day|workout", note, re.I))
    return "combine+pro day" if combine and proday else "combine" if combine else "pro day" if proday else "unstated"


def main() -> None:
    offline = "--offline" in sys.argv
    client = WikiClient(offline=offline)
    leg = load_legacy()
    acc = json.loads((AUGMENT_DIR / "accolades.json").read_text("utf-8"))["people"]

    # entries per name among skill players and defenders (for KNOWN rows)
    entries_by_name: dict[str, list[str]] = {}
    for p in leg["players"] + leg["defense"]:
        entries_by_name.setdefault(p["n"], []).append(p["id"])

    people: dict[str, dict] = {}

    # 1. reference values from Wikipedia pre-draft tables (non-OL people with a page)
    cands = {k: v for k, v in acc.items() if v.get("conf") == "reference" and "|OL|" not in k and v.get("page")}
    full = fetch_full(client, sorted({v["page"] for v in cands.values()}))
    for key, rec in sorted(cands.items()):
        f = full.get(rec["page"])
        if not f or not f.get("content"):
            continue
        got = predraft(f["content"])
        if not got:
            continue
        vals, note, flags = got
        timing = timing_of(note)
        rec_out = {
            "name": rec["name"], "entries": rec["entries"], **vals,
            "src": "wikipedia:" + rec["page"] + "#Pre-draft measurables", "url": page_url(rec["page"]),
            "retrieved": f["retrieved"], "conf": "reference",
            "note": "Wikipedia pre-draft measurables table" + (f": {note[:160]}" if note else " (source not stated)"),
            "timing": timing,
        }
        if flags:
            rec_out["flags"] = flags
        people[key] = rec_out

    # 2. estimates from knowledge
    by_name_key: dict[str, list[str]] = {}
    for k, v in acc.items():
        by_name_key.setdefault(v["name"], []).append(k)
    unmatched = []
    for name, row in KNOWN.items():
        forty, basis, why = row[:3]
        pin = row[3] if len(row) > 3 else None
        keys = [k for k in by_name_key.get(name, []) if "|OL|" not in k and (not pin or any(pin in e for e in acc[k]["entries"]))]
        est = {"forty": forty, "src": "estimated:knowledge", "conf": "estimated", "note": f"{basis}: {why}", "basis": basis}
        if len(keys) == 1:
            key = keys[0]
            if key in people:
                if "forty" in people[key]:
                    people[key]["alsoEstimated"] = est
                else:  # table without a 40: add the estimated 40, with its own provenance
                    people[key]["forty"] = forty
                    people[key]["fieldConf"] = {"forty": {k: v for k, v in est.items() if k != "forty"}}
                continue
            people[key] = {"name": name, "entries": acc[key]["entries"], **est}
        elif name in entries_by_name:
            ids = [e for e in entries_by_name[name] if not pin or pin in e]
            people[f"{name}|?|legacy"] = {"name": name, "entries": ids, **est}
        else:
            unmatched.append(name)

    out = {
        "_meta": {
            "description": "40-yard dash times for players predating the nflverse combine data (2000+) or who never ran it. "
                           "Keyed like accolades.json (name|group|firstDecade). A missing player means no basis: use position priors.",
            "generatedBy": "tools/reference/build_physical.py",
            "generated": now_iso(),
            "conf": {"reference": "Wikipedia pre-draft measurables table (url, retrieved)",
                     "estimated": "typed from knowledge: 'commonly cited' = a widely repeated specific time (often hand-timed or pro day); "
                                  "'estimate' = no documented time, inferred from sprint results or reputation"},
            "counts": {
                "reference": sum(1 for p in people.values() if p["conf"] == "reference"),
                "estimated": sum(1 for p in people.values() if p["conf"] == "estimated"),
                "fields": {
                    f: {
                        "reference": sum(1 for p in people.values() if f in p and p["conf"] == "reference"
                                         and f not in p.get("fieldConf", {})),
                        "estimated": sum(1 for p in people.values() if f in p and (p["conf"] == "estimated"
                                                                                   or f in p.get("fieldConf", {}))),
                    } for f in MEASURES
                },
                "timing": {t: sum(1 for p in people.values() if p.get("timing") == t)
                           for t in ("combine", "pro day", "combine+pro day", "unstated")},
            },
            "notInLegacy": unmatched,
        },
        "people": dict(sorted(people.items())),
    }
    write_json(AUGMENT_DIR / "estimated_physical.json", out)
    print(json.dumps(out["_meta"]["counts"]), "unmatched:", unmatched, file=sys.stderr)


if __name__ == "__main__":
    main()
