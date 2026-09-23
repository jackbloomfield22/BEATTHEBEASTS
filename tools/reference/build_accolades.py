"""Build data/augment/accolades.json from Wikipedia infoboxes.

    python3 tools/reference/build_accolades.py            # network allowed (cached)
    python3 tools/reference/build_accolades.py --offline  # cache only, no requests

Who is covered (see docs/REFERENCE_NOTES.md):
  - every PLAYERS name whose max `imp` over its entries is >= 76 (all entries of
    that name are then resolved, so homonyms get split correctly),
  - every DEFENSE name,
  - every person in an OL_UNITS `key` list (non-person tokens and aliases handled
    via common.NON_PERSON_TOKENS / common.OL_ALIASES).

How a legacy entry is matched to a page: the page must carry a football infobox
whose `pastteams` lists the entry's franchise in a span that overlaps the entry's
decade. Direct title first, then disambiguation-page links and a CirrusSearch
query restricted to pages using {{Infobox NFL biography}}.

Honors are per season (the season a Pro Bowl honors, not the game's calendar
year). Hand-filled values from tools/reference/accolades_overrides.json are
applied last and are always conf "estimated" with a note.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    AUGMENT_DIR, CACHE_DIR, NON_PERSON_TOKENS, OL_ALIASES, POS_GROUP, ROOT,
    WikiClient, load_legacy, now_iso, page_url, write_json,
)
import wikiparse as wp  # noqa: E402

OVERRIDES = Path(__file__).resolve().parent / "accolades_overrides.json"
PAGE_CACHE = CACHE_DIR / "pages"
IMP_THRESHOLD = 76  # brief: PLAYERS names whose max imp >= 76
CORE = ("proBowl", "allPro1", "allPro2", "mvp", "opoy", "dpoy")


# ----------------------------------------------------------------- targets

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace(".", "").replace("'", "").replace("’", "")
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return " ".join(re.sub(r"[^a-z ]+", " ", s).split())


def build_targets(leg: dict) -> dict[str, list[dict]]:
    """name -> list of entries {id, pos, group, team, decade, kind, imp}."""
    max_imp: dict[str, int] = defaultdict(int)
    for p in leg["players"]:
        max_imp[p["n"]] = max(max_imp[p["n"]], p["imp"])
    targets: dict[str, list[dict]] = defaultdict(list)

    def alias(n: str) -> str | None:
        return n if n in OL_ALIASES else None

    for p in leg["players"]:
        if max_imp[p["n"]] >= IMP_THRESHOLD:
            targets[OL_ALIASES.get(p["n"], p["n"])].append(dict(
                id=p["id"], pos=p["p"], group=POS_GROUP[p["p"]], team=p["t"], decade=p["d"], kind="players",
                imp=p["imp"], alias=alias(p["n"])))
    for d in leg["defense"]:
        targets[OL_ALIASES.get(d["n"], d["n"])].append(dict(
            id=d["id"], pos=d["p"], group=POS_GROUP[d["p"]], team=d["t"], decade=d["d"], kind="defense",
            imp=d["imp"], alias=alias(d["n"])))
    for u in leg["ol"]:
        for tok in u["key"].split(" · "):
            tok = tok.strip()
            if not tok or tok in NON_PERSON_TOKENS:
                continue
            name = OL_ALIASES.get(tok, tok)
            if any(e["id"] == u["id"] for e in targets[name]):
                continue  # alias pair in the same key list
            targets[name].append(dict(id=u["id"], pos="OL", group="OL", team=u["t"], decade=u["d"],
                                      kind="ol", imp=u["imp"], alias=tok if tok != name else None))
    return dict(targets)


# ----------------------------------------------------------------- page fetching

def _pkey(title: str, full: bool = False) -> Path:
    return PAGE_CACHE / (hashlib.sha1((("full:" if full else "") + title).encode("utf-8")).hexdigest() + ".json")


def fetch_pages(client: WikiClient, titles: list[str], full: bool = False) -> dict[str, dict | None]:
    """title -> {requested, title, content, retrieved, missing}, per-title cache.

    Section 0 (lead + infobox) by default; `full` fetches whole pages (used only
    for disambiguation pages whose lists sit in later sections)."""
    PAGE_CACHE.mkdir(parents=True, exist_ok=True)
    out: dict[str, dict | None] = {}
    todo = []
    for t in dict.fromkeys(titles):
        p = _pkey(t, full)
        if p.exists():
            out[t] = json.loads(p.read_text("utf-8"))
        else:
            todo.append(t)
    if client.offline:
        for t in todo:
            out[t] = None
        return out
    step = 10 if full else 40
    for i in range(0, len(todo), step):
        batch = todo[i:i + step]
        params = {"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                  "redirects": "1", "titles": "|".join(batch)}
        if not full:
            params["rvsection"] = "0"
        data, retrieved = client.get(params)
        q = data.get("query", {})
        mapping = {t: t for t in batch}
        for n in q.get("normalized", []):
            for k, v in list(mapping.items()):
                if v == n["from"]:
                    mapping[k] = n["to"]
        for r in q.get("redirects", []):
            for k, v in list(mapping.items()):
                if v == r["from"]:
                    mapping[k] = r["to"]
        pages = {p["title"]: p for p in q.get("pages", [])}
        for t in batch:
            pg = pages.get(mapping[t])
            rec = {"requested": t, "title": mapping[t], "retrieved": retrieved, "missing": True, "content": ""}
            if pg and not pg.get("missing") and pg.get("revisions"):
                rec["missing"] = False
                rec["content"] = pg["revisions"][0]["slots"]["main"]["content"]
            _pkey(t, full).write_text(json.dumps(rec, ensure_ascii=False), "utf-8")
            out[t] = rec
        print(f"  fetched {min(i + step, len(todo))}/{len(todo)} pages", file=sys.stderr, flush=True)
    return out


def search_titles(client: WikiClient, name: str) -> list[str] | None:
    data, _ = client.get({
        "action": "query", "list": "search", "srlimit": "20", "srprop": "",
        "srsearch": f'"{name}" hastemplate:"Infobox NFL biography"',
    })
    if data is None:
        return None
    return [x["title"] for x in data.get("query", {}).get("search", [])]


# ----------------------------------------------------------------- matching

def base_title(t: str) -> str:
    return re.sub(r"\s*\(.*\)\s*$", "", t)


def name_compatible(name: str, title: str) -> bool:
    a, b = norm(name).split(), norm(base_title(title)).split()
    if not a or not b:
        return False
    if a == b:
        return True
    # same surname; first names equal or one a prefix of the other (Jim/Jimbo, Joe/Joseph, ...)
    return a[-1] == b[-1] and (a[0].startswith(b[0][:3]) or b[0].startswith(a[0][:3]))


def analyse(rec: dict | None) -> dict | None:
    if not rec or rec.get("missing") or not rec.get("content"):
        return None
    ib = wp.infobox(rec["content"])
    if not ib:
        return {"rec": rec, "football": False, "disambig": wp.is_disambiguation(rec["content"]), "teams": [], "params": {}}
    name, params = ib
    teams = wp.past_teams(params)
    # NFL/AFL/gridiron infoboxes, or any infobox (e.g. a college coach's) whose
    # playing career includes an NFL franchise
    football = (bool(re.search(r"NFL|AFL|gridiron|American football", name, re.I)) and not re.search(r"Canadian", name)) \
        or any(t["franchise"] for t in teams)
    return {"rec": rec, "football": football, "disambig": wp.is_disambiguation(rec["content"]), "ibname": name,
            "params": params, "teams": teams}


LA_SWAP = {"LAR": "LV", "LV": "LAR"}

# Hand-checked page for entries the automatic matching can't place. Each is a
# disambiguation decision, recorded in docs/REFERENCE_NOTES.md.
PAGE_HINTS = {
    # page title carries a birth year the title patterns don't try; search ranks it below 20 other Chris Joneses
    "defense:chris-jones:KC:2020s": "Chris Jones (defensive tackle, born 1994)",
    # legacy team is wrong (Newsome played only for CLE); the person is not in doubt
    "players:ozzie-newsome:IND:1980s": "Ozzie Newsome",
    # legacy decade is wrong (Proehl was with CAR in 2002-03 and 2006); person not in doubt
    "players:ricky-proehl:CAR:1990s": "Ricky Proehl",
    # legacy team is wrong (Conner: PIT 2017-20, ARI 2021-); person not in doubt
    "players:james-conner:ATL:2020s": "James Conner (American football)",
}

TITLE_WORDS = {
    "QB": ["quarterback"], "RB": ["running back", "fullback", "halfback"], "WR": ["wide receiver"],
    "TE": ["tight end"],
    "OL": ["offensive tackle", "offensive lineman", "American football guard", "guard", "American football center",
           "center", "offensive guard"],
    "DL": ["defensive end", "defensive tackle", "defensive lineman"],
    "LB": ["linebacker", "American football linebacker"],
    "DB": ["cornerback", "safety", "American football safety", "defensive back"],
}


def page_links(content: str, name: str) -> list[str]:
    """Titles on a page (wiki links and template arguments) that could be this person."""
    out = []
    for m in re.finditer(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]", content):
        out.append(m.group(1).strip())
    for m in re.finditer(r"\{\{\s*(?:for|about|redirect|other people|other uses|distinguish|see also)[^{}]*\}\}", content, re.I):
        out += [a.strip() for a in m.group(0).strip("{}").split("|")[1:]]
    return [t for t in dict.fromkeys(out) if t != name and name_compatible(name, t)]


POS_WORDS = {
    "QB": r"quarterback", "RB": r"running back|halfback|fullback", "WR": r"wide receiver|end|flanker|split end",
    "TE": r"tight end", "OL": r"tackle|guard|center|offensive line",
    "DL": r"defensive end|defensive tackle|defensive line|nose tackle|end", "LB": r"linebacker",
    "DB": r"cornerback|safety|defensive back|halfback",
}


def pos_ok(an: dict, group: str) -> bool:
    pos = wp.flatten(an["params"].get("position", "")).lower()
    return bool(re.search(POS_WORDS[group], pos)) if pos else True


def best_match(entry: dict, cands: list[dict], slack: int = 0) -> tuple[dict | None, int]:
    scored = []
    for an in cands:
        ov = wp.stint_overlap(an["teams"], entry["team"], entry["decade"], slack)
        if ov > 0:
            scored.append((ov + (5 if pos_ok(an, entry["group"]) else 0), an))
    if not scored:
        return None, 0
    scored.sort(key=lambda x: -x[0])
    return scored[0][1], scored[0][0]


# ----------------------------------------------------------------- main

def main() -> None:
    offline = "--offline" in sys.argv
    t0 = time.monotonic()
    client = WikiClient(offline=offline)
    leg = load_legacy()
    targets = build_targets(leg)
    names = sorted(targets)
    print(f"{len(names)} names, {sum(len(v) for v in targets.values())} entries", file=sys.stderr)

    # Phase A: direct titles
    direct = fetch_pages(client, names)
    assign: dict[str, tuple[dict, str]] = {}  # entry id -> (analysis, how)
    unresolved: dict[str, list[dict]] = {}
    extra_titles: dict[str, list[str]] = {}
    for n in names:
        an = analyse(direct.get(n))
        cands = [an] if an and an["football"] else []
        left = []
        for e in targets[n]:
            m, _ = best_match(e, cands)
            if m:
                assign[e["id"] + "|" + n] = (m, "direct")
            else:
                left.append(e)
        if left:
            unresolved[n] = left
            extra_titles[n] = []

    # Phase B1: links on the direct page (disambiguation entries, hatnotes such as
    # {{for|the American football player|X (American football)}}) plus the usual
    # parenthetical title patterns, fetched in batches.
    def still_open(n: str, pool: dict[str, dict | None]) -> list[dict]:
        cands = [a for a in (analyse(pool.get(t)) for t in extra_titles[n]) if a and a["football"]]
        return [e for e in unresolved[n] if not best_match(e, cands, slack=1)[0]]

    for n, left in unresolved.items():
        rec = direct.get(n)
        links = page_links(rec["content"], n) if rec and rec.get("content") else []
        groups = {e["group"] for e in left}
        gen = [f"{n} (American football)", f"{n} (gridiron football)"]
        for g in sorted(groups):
            gen += [f"{n} ({w})" for w in TITLE_WORDS[g]]
        hints = [PAGE_HINTS[e["id"]] for e in left if e["id"] in PAGE_HINTS]
        extra_titles[n] = list(dict.fromkeys(extra_titles[n] + links + gen + hints))
    pages = fetch_pages(client, sorted({t for ts in extra_titles.values() for t in ts}))

    # Phase B2: CirrusSearch only for names still unmatched after B1
    need_search = [n for n in unresolved if still_open(n, pages)]
    print(f"phase B: {len(unresolved)} names unresolved by title, {len(need_search)} need search", file=sys.stderr, flush=True)
    for n in need_search:
        s = search_titles(client, n)
        if s:
            extra_titles[n] += [t for t in s if name_compatible(n, t)]
        extra_titles[n] = list(dict.fromkeys(t for t in extra_titles[n] if t != n))
    pages.update(fetch_pages(client, sorted({t for n in need_search for t in extra_titles[n]})))

    # Phase B3: disambiguation pages whose lists sit below section 0 (e.g. "Christopher
    # Jones"): fetch those whole pages, follow their links.
    open_names = [n for n in unresolved if still_open(n, pages)]
    dab_titles = {}
    for n in open_names:
        for t in [n] + extra_titles[n]:
            rec = pages.get(t) if t != n else direct.get(n)
            if rec and not rec.get("missing") and wp.is_disambiguation(rec.get("content", "")):
                dab_titles.setdefault(rec["title"], set()).add(n)
    full = fetch_pages(client, sorted(dab_titles), full=True)
    more: set[str] = set()
    for t, ns in dab_titles.items():
        rec = full.get(t)
        for n in ns:
            links = page_links(rec["content"], n) if rec and rec.get("content") else []
            extra_titles[n] = list(dict.fromkeys(extra_titles[n] + links))
            more.update(links)
    pages.update(fetch_pages(client, sorted(more - set(pages))))

    loose_notes: dict[str, str] = {}
    missing_entries: dict[str, dict] = {}
    for n, left in unresolved.items():
        cands = [a for a in (analyse(pages.get(t)) for t in extra_titles[n]) if a and a["football"]]
        d_an = analyse(direct.get(n))
        if d_an and d_an["football"]:
            cands.append(d_an)
        cands = list({a["rec"]["title"]: a for a in cands}.values())
        for e in left:
            m, _ = best_match(e, cands)
            how = "search"
            if not m:
                m, _ = best_match(e, cands, slack=1)
                how = "search-slack1"
            if not m and e["team"] in LA_SWAP and e["decade"] in ("1980s", "1990s"):
                # legacy files some LA Raiders (1982-94) under LAR and vice versa
                m, _ = best_match(dict(e, team=LA_SWAP[e["team"]]), cands)
                how = "la-franchise-swap"
            if not m:
                # One football page with a compatible name and matching position, franchise
                # present at any time: accept, flagged (legacy decade may be off).
                fr = [a for a in cands if any(t["franchise"] == e["team"] for t in a["teams"]) and pos_ok(a, e["group"])]
                if len(fr) == 1:
                    m, how = fr[0], "franchise-only"
            if not m and d_an and d_an["football"] and not d_an["disambig"] and pos_ok(d_an, e["group"]) \
                    and len([a for a in cands if pos_ok(a, e["group"])]) == 1:
                # the exact-title page is the only football candidate at this position:
                # the legacy team/decade is wrong, the person is not in doubt
                m, how = d_an, "name-only"
            if not m and e["id"] in PAGE_HINTS:
                h = analyse(pages.get(PAGE_HINTS[e["id"]]))
                if h and h["football"]:
                    m, how = h, "hand-checked"
            if m:
                assign[e["id"] + "|" + n] = (m, how)
                if how != "search":
                    loose_notes[e["id"]] = how
            else:
                missing_entries[e["id"] + "|" + n] = e

    # ------------------------------------------------------------ people
    by_page: dict[str, dict] = {}
    entry_lookup = {e["id"] + "|" + n: (n, e) for n in names for e in targets[n]}
    for k, (an, how) in assign.items():
        n, e = entry_lookup[k]
        title = an["rec"]["title"]
        p = by_page.setdefault(title, {"an": an, "names": set(), "entries": [], "hows": set()})
        p["names"].add(n)
        p["entries"].append(e)
        p["hows"].add(how)

    people: dict[str, dict] = {}

    def person_key(name: str, entries: list[dict]) -> str:
        groups = [e["group"] for e in sorted(entries, key=lambda e: e["decade"])]
        grp = max(set(groups), key=lambda g: (groups.count(g), -groups.index(g)))
        first = min(e["decade"] for e in entries)
        k = f"{name}|{grp}|{first}"
        i = 2
        while k in people:
            k = f"{name}|{grp}|{first}#{i}"
            i += 1
        return k

    for title, p in sorted(by_page.items()):
        an = p["an"]
        honors, notes = wp.parse_honors(an["params"])
        name = sorted(p["names"], key=lambda x: (-sum(1 for e in p["entries"] if targets[x] and e in targets[x]), x))[0]
        key = person_key(name, p["entries"])
        rec = {
            "name": name,
            "aliases": sorted((p["names"] - {name}) | {e["alias"] for e in p["entries"] if e.get("alias")}),
            "entries": sorted({e["id"] for e in p["entries"]}),
            "page": title,
            "src": "wikipedia:" + title,
            "url": page_url(title),
            "retrieved": an["rec"]["retrieved"],
            "conf": "reference",
            "match": sorted(p["hows"]),
        }
        for f in wp.HONOR_FIELDS:
            if f in CORE or honors[f]:
                rec[f] = honors[f]
        rec["teams"] = [{"franchise": t["franchise"], "from": t["from"], "to": t["to"]} for t in an["teams"] if t["franchise"]]
        rec.update(wp.draft_info(an["params"]))
        if not any(honors.values()) and not an["params"].get("highlights"):
            notes.append("infobox lists no highlights (no honors on the page)")
        loose = sorted({loose_notes[e["id"]] for e in p["entries"] if e["id"] in loose_notes})
        if loose:
            notes.append("team/decade matched loosely: " + ", ".join(
                f"{e['id']} ({loose_notes[e['id']]})" for e in p["entries"] if e["id"] in loose_notes))
        if notes:
            rec["notes"] = notes
        people[key] = rec

    # entries that never matched: group by name+group+first decade
    miss_groups: dict[tuple, list[dict]] = defaultdict(list)
    for k, e in missing_entries.items():
        n = k.split("|", 1)[1]
        miss_groups[(n, e["group"])].append(e)
    for (n, g), es in sorted(miss_groups.items()):
        key = person_key(n, es)
        people[key] = {
            "name": n, "aliases": sorted({e["alias"] for e in es if e.get("alias")}),
            "entries": sorted({e["id"] for e in es}),
            "src": "none", "conf": "missing",
            "note": "no Wikipedia page with a matching team/decade found; candidates tried: "
                    + ", ".join(extra_titles.get(n, [])[:8] or ["(direct title only)"]),
            **{f: [] for f in CORE},
        }

    # ------------------------------------------------------------ overrides
    # {"people": {key: {"honors": {field: [seasons]}, "note": "..."}}}: fields listed
    # replace the parsed ones and the whole person becomes conf "estimated".
    if OVERRIDES.exists():
        for key, patch in json.loads(OVERRIDES.read_text("utf-8")).get("people", {}).items():
            cur = people.get(key)
            if cur is None:
                print(f"override for unknown person key {key}", file=sys.stderr)
                continue
            for f, v in patch.get("honors", {}).items():
                cur[f] = sorted(set(v))
            if cur["conf"] == "reference":
                cur["pageConsulted"] = cur.pop("src")
            cur.update(conf="estimated", src="estimated:knowledge", note=patch["note"])

    # ------------------------------------------------------------ coverage
    entry_conf = {eid: rec["conf"] for rec in people.values() for eid in rec["entries"]}
    entry_imp = {e["id"]: e["imp"] for es in targets.values() for e in es if e["kind"] != "ol"}

    def tally(items) -> dict:
        t: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for group, conf in items:
            t[group][conf] += 1
            t["ALL"][conf] += 1
        return {g: dict(v) for g, v in sorted(t.items())}

    all_entries = [e for n in names for e in targets[n]]
    coverage = {
        "entries_all": tally((e["group"], entry_conf.get(e["id"], "missing")) for e in all_entries),
        "entries_imp85": tally((e["group"], entry_conf.get(e["id"], "missing"))
                               for e in all_entries if e["kind"] != "ol" and e["imp"] >= 85),
        "people": tally((k.split("|")[1], rec["conf"]) for k, rec in people.items()),
        "people_imp85": tally((k.split("|")[1], rec["conf"]) for k, rec in people.items()
                              if max((entry_imp.get(e, 0) for e in rec["entries"]), default=0) >= 85),
    }

    elapsed = time.monotonic() - t0
    out = {
        "_meta": {
            "description": "Season-level NFL/AFL honors per person, from Wikipedia infobox 'highlights'. "
                           "Seasons are the season honored (a Pro Bowl played in Jan 1988 honors the 1987 season). "
                           "Keyed by name|position-group|firstDecade; `entries` lists the legacy entry ids covered.",
            "source": "Wikipedia (en) via the MediaWiki Action API, CC BY-SA 4.0; section 0 wikitext of each page",
            "api": "https://en.wikipedia.org/w/api.php",
            "generatedBy": "tools/reference/build_accolades.py",
            "generated": now_iso(),
            "fields": {
                "proBowl": "seasons with a Pro Bowl selection",
                "allPro1": "seasons first-team All-Pro (as listed by Wikipedia: AP or consensus)",
                "allPro2": "seasons second-team All-Pro",
                "allProUnspecified": "seasons listed as 'All-Pro' without first/second team",
                "mvp": "NFL MVP (AP unless the page says otherwise)", "opoy": "Offensive Player of the Year",
                "dpoy": "Defensive Player of the Year", "aflAllStar": "AFL All-Star (AFL's Pro Bowl, 1960-69)",
                "allAFL1": "first-team All-AFL", "allAFL2": "second-team All-AFL",
                "allAFLUnspecified": "All-AFL without team", "aflMvp": "AFL MVP / Player of the Year",
                "teams": "pastteams from the infobox, franchise = legacy abbreviation",
            },
            "conf": {"reference": "parsed from the cited page (url, retrieved)",
                     "estimated": "filled or corrected from knowledge; see note",
                     "missing": "no page matched; honors unknown (not zero)"},
            "coverage": coverage,
            "wikipediaPass": {"networkRequests": client.network_requests, "cacheHits": client.cache_hits,
                              "backoffSeconds": round(client.wait_s), "elapsedSeconds": round(elapsed)},
        },
        "people": dict(sorted(people.items())),
    }
    write_json(AUGMENT_DIR / "accolades.json", out)
    print(json.dumps(out["_meta"]["coverage"], indent=1), file=sys.stderr)
    print(json.dumps(out["_meta"]["wikipediaPass"]), file=sys.stderr)


if __name__ == "__main__":
    main()
