"""One-off seeding of data/corrections.json from data/augment/suggested_corrections.json
plus the hand-found schema fixes. After seeding, data/corrections.json is edited by hand;
re-running overwrites it (python3 tools/ratings/seed-corrections.py)."""
import json

sug = json.load(open('data/augment/suggested_corrections.json'))['corrections']
out = []
for c in sug:
    k = c['kind']
    if k == 'catch-pct-count':
        out.append({"id": c['id'], "op": "set", "field": "s.c", "old": c['old'], "new": c['new'], "reason": c['reason'], "source": c['source'], "conf": "verified"})
    elif k == 'team-code':
        out.append({"id": c['id'], "op": "set", "field": "t", "old": c['old'], "new": c['new'], "reason": c['reason'], "source": c['source'], "conf": c['conf']})
    elif k in ('exclude-filler-row', 'exclude-duplicate-person'):
        out.append({"id": c['id'], "op": "exclude", "reason": c['reason'], "source": c['source'], "conf": c['conf']})
    elif k == 'exclude-no-stint':
        review = c['conf'] != 'verified'
        out.append({"id": c['id'], "op": "exclude", "reason": ("REVIEW (never on the franchise in nflverse rosters; could be a roster gap): " if review else "Stint never happened: ") + c['reason'].split(' (review')[0], "source": c['source'], "conf": c['conf']})
manual = [
    {"id": "players:carl-garrett:LV:1970s", "op": "delete", "field": "s.p", "old": 10, "reason": "RB row carries WR fields (yards per target) (BRIEF audit 5).", "source": "legacy schema audit (docs/DATA_VALIDATION.md)", "conf": "verified"},
    {"id": "players:carl-garrett:LV:1970s", "op": "delete", "field": "s.c", "old": 54, "reason": "RB row carries a WR catch % (54) in `c`, which the RB schema reads as 54 yards per carry (BRIEF audit 5). No sourced YPC for the stint, so the field is removed and the engine regresses to the position average.", "source": "legacy schema audit (docs/DATA_VALIDATION.md)", "conf": "verified"},
    {"id": "players:ron-howard:DAL:1970s", "op": "delete", "field": "s.p", "old": 12, "reason": "TE row carries WR fields (yards per target) that the TE schema doesn't have.", "source": "legacy schema audit (docs/DATA_VALIDATION.md)", "conf": "verified"},
    {"id": "players:ron-howard:DAL:1970s", "op": "delete", "field": "s.c", "old": 54, "reason": "TE row carries a WR catch % that the TE schema doesn't have (and targets weren't tracked in the 1970s).", "source": "legacy schema audit (docs/DATA_VALIDATION.md)", "conf": "verified"},
    {"id": "players:larry-centers:WAS:1990s", "op": "delete", "field": "s.b", "old": 75, "reason": "RB row carries a TE block grade (BRIEF audit 5). His WAS 1990s stint is 1999, covered by nflverse stats.", "source": "legacy schema audit; nflverse player stats 1999", "conf": "verified"},
    {"id": "players:anthony-miller:DAL:1990s", "op": "delete", "field": "s.b", "old": 80, "reason": "WR row carries a TE block grade (BRIEF audit 5).", "source": "legacy schema audit (docs/DATA_VALIDATION.md)", "conf": "verified"},
    {"id": "defense:ed-budde:KC:1960s", "op": "exclude", "reason": "Ed Budde was a Chiefs guard (OL), not a linebacker; a guard can't be rated as a defender.", "source": "nflverse rosters (KC 1963–1969, G)", "conf": "verified"},
]
# Pre-1999 defender rows holding career or cross-team totals instead of stint
# totals (data/augment/estimated_def_stints_pre1999.json, verdict != stint-ok):
# replace sacks and INTs with the stint estimate.
est = json.load(open('data/augment/estimated_def_stints_pre1999.json'))
for eid, e in est.items():
    if eid.startswith('_') or e.get('verdict') == 'stint-ok':
        continue
    lg = e['legacy']
    span = f"{e['seasons'][0]}–{e['seasons'][1]}"
    for f in ('sk', 'int'):
        if f in e and f in lg and lg[f] != e[f]:
            out.append({"id": eid, "op": "set", "field": f"s.{f}", "old": lg[f], "new": e[f],
                        "reason": f"Legacy holds {e['verdict'].replace('-', ' ')} ({f} {lg[f]}); the {span} stint estimate is {e[f]}. {e.get('note', '')}".strip(),
                        "source": "estimate:knowledge (data/augment/estimated_def_stints_pre1999.json)", "conf": "estimated"})
manual.append({"id": "defense:deion-sanders:ATL:1980s", "op": "set", "field": "s.pb", "old": 1, "new": 0,
               "reason": "The ATL 1980s stint is the 1989 season only; Deion Sanders' first Pro Bowl was the 1991 season.",
               "source": "wikipedia:Deion Sanders (data/augment/accolades.json)", "conf": "reference"})

have = {(c['id'], c.get('field')) for c in out}
for m in manual:
    if (m['id'], m.get('field')) not in have:
        out.append(m)
doc = ("Fixes applied to legacy data at load time (BRIEF 'Never edit legacy values in place'). "
       "op set/delete: `old` must equal the legacy value or the loader refuses the correction. "
       "op exclude: the entry leaves the rating pools and the draft. conf: how well the fix is sourced. "
       "Reasons starting with REVIEW are the user's call.")
json.dump({"version": 1, "_doc": doc, "corrections": out}, open('data/corrections.json', 'w'), indent=1, ensure_ascii=False)
open('data/corrections.json', 'a').write('\n')
from collections import Counter
print(len(out), Counter(c['op'] for c in out))
