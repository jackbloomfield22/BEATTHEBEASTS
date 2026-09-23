"""Minimal wikitext helpers for NFL biography infoboxes (stdlib only).

Only what the accolades builder needs: find the infobox, split its parameters,
read `pastteams` into (franchise, first season, last season) stints, and turn
`highlights` bullets into per-season honor lists.
"""

from __future__ import annotations

import re

CURRENT_SEASON = 2026  # "present" in a pastteams line (pages retrieved Sept 2026)

# Franchise abbreviation (as used by the legacy data, which files relocated teams
# under the current franchise) -> regexes matched against a pastteams line.
FRANCHISE = {
    "ARI": [r"(Chicago|St\. Louis|Phoenix|Arizona) Cardinals"],
    "ATL": [r"Atlanta Falcons"],
    "BAL": [r"Baltimore Ravens"],
    "BUF": [r"Buffalo Bills"],
    "CAR": [r"Carolina Panthers"],
    "CHI": [r"Chicago Bears"],
    "CIN": [r"Cincinnati Bengals"],
    "CLE": [r"Cleveland Browns"],
    "DAL": [r"Dallas Cowboys"],
    "DEN": [r"Denver Broncos"],
    "DET": [r"Detroit Lions"],
    "GB": [r"Green Bay Packers"],
    "HOU": [r"Houston Texans"],
    "IND": [r"(Baltimore|Indianapolis) Colts"],
    "JAX": [r"Jacksonville Jaguars"],
    "KC": [r"Kansas City Chiefs", r"Dallas Texans"],
    "LAC": [r"(Los Angeles|San Diego) Chargers"],
    "LAR": [r"(Los Angeles|St\. Louis|Cleveland) Rams"],
    "LV": [r"(Oakland|Los Angeles|Las Vegas) Raiders"],
    "MIA": [r"Miami Dolphins"],
    "MIN": [r"Minnesota Vikings"],
    "NE": [r"(Boston|New England) Patriots"],
    "NO": [r"New Orleans Saints"],
    "NYG": [r"New York Giants"],
    "NYJ": [r"New York (Jets|Titans)"],
    "PHI": [r"Philadelphia Eagles"],
    "PIT": [r"Pittsburgh Steelers"],
    "SEA": [r"Seattle Seahawks"],
    "SF": [r"San Francisco 49ers"],
    "TB": [r"Tampa Bay Buccaneers"],
    "TEN": [r"(Houston|Tennessee) Oilers", r"Tennessee Titans"],
    "WAS": [r"Washington (Redskins|Football Team|Commanders)"],
}
FRANCHISE_RE = {k: re.compile("|".join(v)) for k, v in FRANCHISE.items()}


def strip_noise(s: str) -> str:
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s, flags=re.S | re.I)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S | re.I)
    return s


def find_template_end(text: str, start: int) -> int:
    """Index just past the '}}' closing the template opening at `start`."""
    depth = 0
    i = start
    n = len(text)
    while i < n - 1:
        two = text[i:i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
            continue
        i += 1
    return n


def split_top(body: str, sep: str = "|") -> list[str]:
    """Split on `sep` outside [[...]] and {{...}}."""
    parts, cur, dl, db, i = [], [], 0, 0, 0
    while i < len(body):
        two = body[i:i + 2]
        if two == "{{":
            db += 1; cur.append(two); i += 2; continue
        if two == "}}":
            db -= 1; cur.append(two); i += 2; continue
        if two == "[[":
            dl += 1; cur.append(two); i += 2; continue
        if two == "]]":
            dl -= 1; cur.append(two); i += 2; continue
        c = body[i]
        if c == sep and dl <= 0 and db <= 0:
            parts.append("".join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    parts.append("".join(cur))
    return parts


INFOBOX_RE = re.compile(r"\{\{\s*Infobox[ _]([^|\n}]*)", re.I)


def infobox(wikitext: str) -> tuple[str, dict[str, str]] | None:
    """Return (infobox name, params) for the first football infobox, else the first infobox."""
    text = strip_noise(wikitext)
    found = []
    for m in INFOBOX_RE.finditer(text):
        name = m.group(1).strip()
        end = find_template_end(text, m.start())
        body = text[m.start() + 2:end - 2]
        parts = split_top(body)
        params: dict[str, str] = {}
        for p in parts[1:]:
            if "=" in p:
                k, v = p.split("=", 1)
                params[k.strip().lower()] = v.strip()
        found.append((name, params))
    for name, params in found:
        if re.search(r"NFL|football|gridiron|AFL", name, re.I):
            return name, params
    return found[0] if found else None


def is_disambiguation(wikitext: str) -> bool:
    return bool(re.search(r"\{\{\s*(disambiguation|dab|disambig|hndis|human name disambiguation|set index)", wikitext, re.I))


# ---------------------------------------------------------------- text flattening

def _link_repl(m: re.Match) -> str:
    target = m.group(1)
    disp = m.group(2)
    tm = re.match(r"\s*(\d{4})\s+(Pro Bowl|AFL All-Star Game|AFL All-Star game)\b", target)
    if tm:
        # Pro Bowl / AFL All-Star games are played in the January after the season:
        # the linked game year minus one is the season, whatever the display says.
        return str(int(tm.group(1)) - 1)
    return disp if disp is not None else target


def flatten(s: str) -> str:
    """Wikitext -> plain-ish text with season years preserved."""
    s = strip_noise(s)
    # innermost templates first, repeatedly
    for _ in range(6):
        s2 = re.sub(r"\{\{([^{}]*)\}\}", _template_repl, s)
        if s2 == s:
            break
        s = s2
    for _ in range(3):
        s = re.sub(r"\[\[([^\[\]|]*)(?:\|([^\[\]]*))?\]\]", _link_repl, s)
    s = re.sub(r"'''?", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&ndash;", "–").replace("&mdash;", "—").replace("&nbsp;", " ")
    return s


def _template_repl(m: re.Match) -> str:
    parts = [p.strip() for p in m.group(1).split("|")]
    name = parts[0].lower().replace("_", " ").strip()
    args = [p for p in parts[1:] if "=" not in p]
    if re.match(r"(efn|refn|notetag|note tag|sfn|ref label|#tag:ref)", name) or name in ("r", "cn", "citation needed", "fact"):
        # footnotes: dropped, except "selected as a (punt|kick) returner" which marks
        # a special-teams All-Pro so it can be kept apart
        return " §RET " if re.search(r"return", " ".join(parts[1:]), re.I) else " "
    if name in ("ndash", "–", "snd", "spaced ndash"):
        return "–"
    if name in ("mdash",):
        return "—"
    if re.fullmatch(r"(nfl|afl|nfc|afc)?\s*y(ear)?|nfly|afly|nfl season|afl season|nfl year|afl year|cfl year|year|nfl draft", name) or name.endswith(" year"):
        yrs = [a for a in args if re.fullmatch(r"\d{4}", a) or a.lower() == "present"]
        if yrs and yrs[0] != "present":
            return "–".join(yrs[:2])
        return " ".join(args)
    if name in ("nowrap", "nobr", "avoid wrap", "small", "nbsp", "plainlist", "flatlist", "ubl", "unbulleted list", "hlist"):
        return "\n".join(args) if name in ("plainlist", "flatlist", "ubl", "unbulleted list", "hlist") else " ".join(args)
    if name in ("pro bowl", "probowl"):
        # {{Pro Bowl|YYYY}} style (rare): arguments are seasons
        return "Pro Bowl (" + ", ".join(args) + ")"
    if name in ("sup", "sub", "abbr", "tooltip"):
        return args[0] if args else ""
    # unknown template: keep its positional args, which usually carry the text
    return " ".join(args)


YEAR_RANGE_RE = re.compile(r"\b(19[2-9]\d|20[0-3]\d)\s*(?:–|-|—|−|to)\s*(19[2-9]\d|20[0-3]\d|\d{2}\b|present)")
YEAR_RE = re.compile(r"\b(19[2-9]\d|20[0-3]\d)\b")


def years_in(text: str) -> list[int]:
    out: list[int] = []
    consumed = []
    for m in YEAR_RANGE_RE.finditer(text):
        a = int(m.group(1))
        b_raw = m.group(2)
        if b_raw == "present":
            b = CURRENT_SEASON
        elif len(b_raw) == 2:
            b = (a // 100) * 100 + int(b_raw)
            if b < a:
                b += 100
        else:
            b = int(b_raw)
        if b < a or b - a > 25:
            continue
        out.extend(range(a, b + 1))
        consumed.append((m.start(), m.end()))
    for m in YEAR_RE.finditer(text):
        if any(s <= m.start() < e for s, e in consumed):
            continue
        out.append(int(m.group(1)))
    return sorted(set(out))


# ---------------------------------------------------------------- pastteams

def past_teams(params: dict[str, str]) -> list[dict]:
    """Team spans from `pastteams` (NFL biography) or numbered team/years pairs
    (college coach: player_teamN/player_yearsN; gridiron football person and CFL
    biography: playing_teamN/playing_yearsN)."""
    raw = ""
    for k in ("pastteams", "past_teams", "playing_teams", "player_teams", "teams"):
        if params.get(k):
            raw = params[k]
            break
    lines: list[str] = []
    if raw:
        lines = re.split(r"\n|<br\s*/?>|\*", flatten(raw))
    else:
        for team_k, years_k in (("player_team", "player_years"), ("playing_team", "playing_years")):
            for i in range(1, 30):
                t = params.get(f"{team_k}{i}")
                if t:
                    lines.append(flatten(t) + " (" + flatten(params.get(f"{years_k}{i}", "")) + ")")
    out = []
    for seg in lines:
        seg = seg.strip()
        if not seg:
            continue
        abbr = None
        for k, rx in FRANCHISE_RE.items():
            if rx.search(seg):
                abbr = k
                break
        yrs = years_in(seg)
        if not yrs:
            continue
        # one span per run of consecutive seasons ("2014–2023, 2026–present" is two spans)
        start = prev = yrs[0]
        for y in yrs[1:] + [None]:
            if y is not None and y == prev + 1:
                prev = y
                continue
            out.append({"franchise": abbr, "text": seg[:80], "from": start, "to": prev})
            if y is not None:
                start = prev = y
    return out


def stint_overlap(teams: list[dict], abbr: str, decade: str, slack: int = 0) -> int:
    """Seasons of overlap between the page's stints with `abbr` and the legacy decade."""
    d0 = int(decade[:4])
    lo, hi = d0 - slack, d0 + 9 + slack
    best = 0
    for t in teams:
        if t["franchise"] != abbr:
            continue
        ov = min(hi, t["to"]) - max(lo, t["from"]) + 1
        best = max(best, ov)
    return best


# ---------------------------------------------------------------- highlights

HONOR_FIELDS = (
    "proBowl", "allPro1", "allPro2", "allProUnspecified",
    "mvp", "opoy", "dpoy",
    "aflAllStar", "allAFL1", "allAFL2", "allAFLUnspecified", "aflMvp",
    "allProReturner",
)


PREFIX = r"^\s*(?:\d+\s*[×x]\s*)?"
EXCLUDE = re.compile(
    r"super bowl|pro bowl (?:mvp|most valuable)|rookie|comeback|college|all-america|high school|"
    r"all-decade|all-time|anniversary|hall of fame|usfl|\bcfl\b|world league|nfl europe|\bxfl\b|\bufl\b|"
    r"all-(?:sec|acc|big|pac|mw|mac|wac|swc|southwest|ivy|conference|state|district|region)",
    re.I,
)


def classify(item: str) -> str | None:
    """Map one highlights bullet to an honor field, or None.

    Awards (MVP, OPOY, DPOY) must start the bullet, optionally after 'N×', 'AP' or
    'NFL', so conference awards ('ACC Defensive Player of the Year'), UPI/NEA
    conference awards and rookie awards never count.
    """
    low = item.lower().strip()
    if EXCLUDE.search(low):
        return None
    if "afl all-star" in low:
        return "aflAllStar"
    if re.search(PREFIX + r"(?:ap\s+|nfl\s+)?pro bowl", low):
        return "proBowl"
    if re.search(r"first[- ]team all-afl|all-afl first[- ]team", low):
        return "allAFL1"
    if re.search(r"second[- ]team all-afl|all-afl second[- ]team", low):
        return "allAFL2"
    if re.search(PREFIX + r"all-afl", low):
        return "allAFLUnspecified"
    if re.search(r"first[- ]team (?:ap )?all-pro|all-pro first[- ]team|consensus first[- ]team all-pro", low):
        return "allPro1"
    if re.search(r"second[- ]team (?:ap )?all-pro|all-pro second[- ]team", low):
        return "allPro2"
    if re.search(PREFIX + r"(?:ap\s+|consensus\s+)?all-pro", low):
        return "allProUnspecified"
    if re.search(PREFIX + r"(?:ap\s+)?(?:nfl\s+|ap nfl\s+)?defensive player of the year", low):
        return "dpoy"
    if re.search(PREFIX + r"(?:ap\s+)?(?:nfl\s+|ap nfl\s+)?offensive player of the year", low):
        return "opoy"
    if re.search(PREFIX + r"(?:ap\s+)?afl\s+(?:mvp|most valuable player|player of the year)", low):
        return "aflMvp"
    if re.search(PREFIX + r"(?:ap\s+)?(?:nfl\s+|national football league\s+)?(?:mvp|most valuable player)\b", low):
        return "mvp"
    return None


def highlight_items(params: dict[str, str]) -> list[str]:
    raw = (params.get("highlights") or params.get("career_highlights") or params.get("player_awards")
           or params.get("awards") or params.get("highlights_and_awards") or "")
    if not raw:
        return []
    # cut the ';NFL records' style sub-lists
    raw = re.split(r"\n\s*;", raw)[0]
    text = flatten(raw)
    items = [s.strip() for s in re.split(r"\n\s*\*+|^\s*\*+|\n", text) if s.strip()]
    return items


def parse_honors(params: dict[str, str]) -> tuple[dict[str, list[int]], list[str]]:
    honors: dict[str, list[int]] = {k: [] for k in HONOR_FIELDS}
    notes: list[str] = []
    for item in highlight_items(params):
        kind = classify(item)
        if not kind:
            continue
        yrs = years_in(item)
        cm = re.match(r"\s*(\d+)\s*[×x]", item)
        claimed = int(cm.group(1)) if cm else 1
        if not yrs:
            notes.append(f"{kind}: no seasons listed in '{item[:60]}'")
            continue
        if len(yrs) != claimed:
            notes.append(f"{kind}: count {claimed}x but {len(yrs)} seasons parsed from '{item[:70]}'")
        if kind in ("allPro1", "allPro2", "allProUnspecified"):
            ret = {int(y) for y in re.findall(r"(\d{4})\s*§RET", item)}
            if ret:
                honors["allProReturner"] = sorted(set(honors["allProReturner"]) | ret)
                yrs = [y for y in yrs if y not in ret]
        honors[kind] = sorted(set(honors[kind]) | set(yrs))
    return honors, notes


def draft_info(params: dict[str, str]) -> dict:
    out = {}
    c = params.get("college")
    if c:
        out["college"] = re.sub(r"\s+", " ", re.sub(r"\(.*?\)", "", flatten(c))).strip()[:60]
    for k_out, k_in in (("draftYear", "draftyear"), ("draftRound", "draftround"), ("draftPick", "draftpick")):
        v = params.get(k_in, "").strip()
        m = re.search(r"\d+", flatten(v)) if v else None
        if m:
            out[k_out] = int(m.group(0))
    return out
