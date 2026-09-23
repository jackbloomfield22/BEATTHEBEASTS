"""Build data/augment/era_baselines_pre1999.json (league-wide averages, 1960-1998).

    python3 tools/reference/build_era_baselines.py

PROVENANCE: every number in the tables below is an ESTIMATE written from
knowledge of published league-average tables (e.g. Pro-Football-Reference's
"NFL League Averages" per team-game table), not retrieved from a source. They
are conf "estimated" and must be verified before anyone treats them as fact.
Nothing here was scraped.

Design so the output stays internally consistent:
  - Only the *inputs* below are hand-set per season: pass attempts per team-game,
    completion %, gross yards per attempt, TD %, INT %, sack % (sacks / dropbacks),
    rush attempts per team-game, yards per carry, rush TD per team-game, points per
    team-game.
  - Every count (completions, yards, TDs, INTs, sacks, rush yards) and the
    league passer rating are DERIVED from those inputs with the NFL formula, so
    rating always agrees with comp%/YPA/TD%/INT%.
  - The series are smooth season to season except where the game really changed:
    the 1970s dead-ball era (bottoming out in 1977), the 1978 pass-rule changes
    (Mel Blount rule, offensive-line hand use), the 1994 two-point / kickoff /
    blocking changes, and 1990s INT-rate decline.

1960-1969: the top-level fields are NFL only. The AFL (1960-69) is given in an
`afl` block, and `combined` weights NFL and AFL by team-games played that season.
From 1970 the merged NFL is one league.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import AUGMENT_DIR, now_iso, write_json  # noqa: E402

NOTE = ("estimated from knowledge of published league averages (e.g. PFR league year-by-year "
        "averages); verify")

# season: (passAtt/tg, comp%, gross YPA, TD%, INT%, sack% of dropbacks,
#          rushAtt/tg, YPC, rushTD/tg, points/tg)
NFL = {
    1960: (27.0, 50.9, 7.20, 5.8, 6.4, 8.8, 33.5, 4.15, 1.00, 22.0),
    1961: (28.0, 50.8, 7.25, 5.9, 6.3, 8.8, 33.2, 4.20, 0.98, 22.6),
    1962: (28.0, 51.9, 7.35, 6.0, 6.0, 8.8, 33.0, 4.35, 1.00, 23.2),
    1963: (28.3, 51.5, 7.20, 5.6, 6.2, 8.9, 32.4, 4.20, 0.95, 22.0),
    1964: (28.2, 51.9, 7.10, 5.6, 5.8, 8.9, 32.2, 4.20, 0.95, 22.3),
    1965: (28.6, 51.0, 7.40, 5.9, 5.7, 9.0, 31.3, 4.15, 0.98, 23.2),
    1966: (28.4, 51.7, 7.10, 5.5, 5.5, 9.0, 30.8, 4.10, 0.90, 21.8),
    1967: (28.6, 51.9, 7.10, 5.3, 5.5, 9.1, 31.5, 4.00, 0.90, 21.8),
    1968: (27.8, 51.6, 7.05, 5.0, 5.6, 9.1, 31.7, 4.00, 0.85, 20.8),
    1969: (27.8, 52.3, 6.95, 4.9, 5.5, 9.0, 32.5, 4.00, 0.85, 20.5),
    1970: (27.5, 51.3, 6.85, 4.8, 5.6, 8.7, 33.6, 3.95, 0.85, 19.4),
    1971: (26.8, 51.8, 6.75, 4.5, 5.9, 8.6, 35.2, 4.00, 0.85, 18.7),
    1972: (26.0, 52.2, 6.80, 4.8, 5.4, 8.4, 36.4, 4.15, 0.92, 19.8),
    1973: (25.3, 52.5, 6.55, 4.5, 5.6, 8.8, 37.3, 4.05, 0.90, 19.3),
    1974: (26.1, 52.4, 6.45, 4.1, 5.9, 8.5, 36.6, 3.95, 0.78, 18.3),
    1975: (26.2, 52.6, 6.70, 4.5, 5.5, 8.4, 36.8, 4.00, 0.86, 19.9),
    1976: (25.2, 52.8, 6.60, 4.3, 5.3, 8.7, 37.2, 3.95, 0.84, 19.1),
    1977: (24.7, 51.6, 6.30, 4.1, 5.8, 9.0, 37.9, 3.90, 0.78, 17.2),
    1978: (27.2, 52.4, 6.55, 4.2, 5.5, 8.3, 36.5, 3.95, 0.80, 18.6),
    1979: (30.3, 54.2, 6.75, 4.5, 5.0, 7.8, 35.1, 4.00, 0.82, 20.4),
    1980: (32.0, 55.6, 6.90, 4.5, 4.8, 7.4, 32.5, 3.95, 0.78, 20.6),
    1981: (32.0, 54.8, 6.95, 4.5, 4.9, 7.5, 32.4, 4.00, 0.78, 20.6),
    1982: (31.5, 56.4, 6.80, 4.2, 4.8, 8.4, 31.8, 3.95, 0.72, 20.0),
    1983: (31.9, 56.2, 6.95, 4.6, 4.6, 8.3, 31.5, 4.05, 0.82, 21.8),
    1984: (32.2, 56.2, 7.05, 4.6, 4.4, 8.6, 30.6, 3.95, 0.76, 21.2),
    1985: (32.5, 55.2, 6.85, 4.2, 4.7, 8.3, 30.8, 3.95, 0.75, 20.9),
    1986: (32.4, 55.0, 6.90, 4.2, 4.5, 8.2, 30.6, 3.95, 0.76, 20.1),
    1987: (31.5, 55.3, 6.95, 4.6, 4.6, 7.9, 30.3, 4.00, 0.78, 21.0),
    1988: (31.6, 54.8, 6.95, 4.1, 4.3, 7.2, 30.3, 3.95, 0.80, 20.3),
    1989: (32.2, 56.2, 7.00, 4.2, 4.2, 7.3, 29.9, 3.95, 0.77, 20.4),
    1990: (30.8, 56.8, 7.00, 4.3, 3.9, 7.3, 29.2, 4.00, 0.74, 20.1),
    1991: (31.7, 56.9, 6.70, 3.8, 3.9, 7.2, 29.1, 3.85, 0.68, 18.6),
    1992: (31.3, 56.8, 6.60, 3.6, 3.8, 7.8, 28.8, 3.90, 0.68, 18.7),
    1993: (32.1, 57.6, 6.65, 3.8, 3.5, 7.3, 28.1, 3.80, 0.64, 18.7),
    1994: (34.6, 58.4, 6.60, 4.0, 3.2, 6.3, 27.3, 3.70, 0.63, 20.3),
    1995: (34.8, 57.8, 6.75, 4.2, 3.3, 6.3, 27.4, 3.80, 0.72, 21.5),
    1996: (33.6, 56.9, 6.55, 3.9, 3.4, 7.0, 27.9, 3.75, 0.68, 20.4),
    1997: (33.2, 56.9, 6.65, 3.9, 3.1, 7.4, 28.0, 3.90, 0.69, 20.4),
    1998: (32.5, 56.7, 6.80, 4.1, 3.3, 6.9, 28.2, 3.95, 0.73, 21.3),
}

# AFL 1960-69: pass-heavier, lower completion %, much higher INT %.
AFL = {
    1960: (33.5, 48.0, 7.00, 5.3, 6.8, 9.0, 31.0, 4.35, 0.95, 23.6),
    1961: (33.5, 47.8, 7.35, 5.7, 7.2, 9.0, 30.2, 4.25, 0.95, 24.4),
    1962: (32.8, 48.2, 7.25, 5.4, 7.0, 9.0, 30.2, 4.30, 0.95, 23.0),
    1963: (31.3, 49.0, 7.30, 5.7, 6.5, 9.0, 29.9, 4.20, 0.95, 22.9),
    1964: (32.0, 48.5, 7.10, 5.4, 6.6, 9.0, 30.0, 4.00, 0.90, 22.5),
    1965: (31.7, 48.0, 6.95, 5.0, 6.4, 9.0, 30.7, 3.90, 0.85, 20.8),
    1966: (31.0, 49.5, 7.20, 5.2, 6.1, 9.0, 30.5, 4.05, 0.90, 22.7),
    1967: (31.5, 49.0, 7.15, 5.1, 6.2, 9.0, 30.5, 3.95, 0.85, 22.5),
    1968: (31.0, 50.5, 7.15, 5.0, 5.8, 9.0, 31.0, 4.00, 0.85, 22.5),
    1969: (30.8, 50.0, 7.10, 4.8, 5.8, 9.0, 31.5, 4.00, 0.85, 21.6),
}

# Teams and regular-season games per team (these are well-documented facts, but
# still typed from knowledge, so they share the season's conf).
NFL_TEAMS = {1960: 13, **{y: 14 for y in range(1961, 1966)}, 1966: 15, 1967: 16, 1968: 16, 1969: 16,
             **{y: 26 for y in range(1970, 1976)}, **{y: 28 for y in range(1976, 1995)},
             **{y: 30 for y in range(1995, 1999)}}
AFL_TEAMS = {**{y: 8 for y in range(1960, 1966)}, 1966: 9, 1967: 9, 1968: 10, 1969: 10}


def nfl_games(y: int) -> int:
    if y == 1960:
        return 12
    if y <= 1977:
        return 14
    if y == 1982:
        return 9
    if y == 1987:
        return 15
    return 16


SEASON_NOTES = {
    1960: "NFL 12-game schedule (AFL's first season, 14 games).",
    1961: "NFL moves to 14 games.",
    1966: "Falcons join NFL; Dolphins join AFL.",
    1967: "Saints join NFL.",
    1968: "Bengals join AFL.",
    1970: "AFL-NFL merger: one league, 26 teams.",
    1972: "Hashmarks moved in (23y 1ft 9in from the sidelines) -> rushing up.",
    1974: "Goalposts to end line, one-chuck rule on receivers; passing still depressed.",
    1976: "Seahawks and Buccaneers join (28 teams).",
    1977: "Dead-ball low point: lowest scoring and passer rating of the Super Bowl era. Head slap banned.",
    1978: "16 games. Pass-rule changes (contact beyond 5 yards banned, OL may extend hands): passing jumps.",
    1979: "Full first season under the 1978 rules settles in: passing volume up sharply.",
    1982: "Players' strike: 9 games per team. First season with official individual sacks.",
    1987: "Strike: 15 games per team, 3 of them (weeks 4-6) played by replacement players; one week cancelled.",
    1990: "",
    1994: "Two-point conversion, kickoff from the 30, tighter chuck enforcement: passing volume jumps.",
    1995: "Panthers and Jaguars join (30 teams).",
}


def rating(cmp_pct: float, ypa: float, td_pct: float, int_pct: float) -> float:
    """NFL passer rating from league rates (each component clamped to 0..2.375)."""
    def clamp(v: float) -> float:
        return max(0.0, min(2.375, v))
    a = clamp((cmp_pct - 30) * 0.05)
    b = clamp((ypa - 3) * 0.25)
    c = clamp(td_pct * 0.2)
    d = clamp(2.375 - int_pct * 0.25)
    return (a + b + c + d) / 6 * 100


def block(row: tuple, teams: int, games: int) -> dict:
    att, cmp_pct, ypa, td_pct, int_pct, sk_pct, r_att, ypc, r_td, pts = row
    sacks = sk_pct / 100 * att / (1 - sk_pct / 100)
    return {
        "teams": teams,
        "gamesPerTeam": games,
        "compPct": round(cmp_pct, 1),
        "ypa": round(ypa, 2),
        "tdPct": round(td_pct, 1),
        "intPct": round(int_pct, 1),
        "sackPct": round(sk_pct, 1),
        "passerRating": round(rating(cmp_pct, ypa, td_pct, int_pct), 1),
        "ypc": round(ypc, 2),
        "pointsPerTeamGame": round(pts, 1),
        "passAttPerTeamGame": round(att, 1),
        "passCmpPerTeamGame": round(att * cmp_pct / 100, 2),
        "passYdsPerTeamGame": round(att * ypa, 1),
        "passTdPerTeamGame": round(att * td_pct / 100, 3),
        "intPerTeamGame": round(att * int_pct / 100, 3),
        "sacksPerTeamGame": round(sacks, 2),
        "rushAttPerTeamGame": round(r_att, 1),
        "rushYdsPerTeamGame": round(r_att * ypc, 1),
        "rushTdPerTeamGame": round(r_td, 3),
        "yardsPerReception": round(ypa / (cmp_pct / 100), 2),
    }


def combine(n: tuple, a: tuple, wn: int, wa: int) -> tuple:
    """Team-game-weighted mix of two leagues' per-team-game volumes, rates rederived."""
    def per_tg(r: tuple) -> dict:
        att, cmp_pct, ypa, td_pct, int_pct, sk_pct, r_att, ypc, r_td, pts = r
        return dict(att=att, cmp=att * cmp_pct / 100, yds=att * ypa, td=att * td_pct / 100,
                    int=att * int_pct / 100, sk=sk_pct / 100 * att / (1 - sk_pct / 100),
                    ratt=r_att, ryds=r_att * ypc, rtd=r_td, pts=pts)
    x, y = per_tg(n), per_tg(a)
    w = wn + wa
    m = {k: (x[k] * wn + y[k] * wa) / w for k in x}
    return (m["att"], 100 * m["cmp"] / m["att"], m["yds"] / m["att"], 100 * m["td"] / m["att"],
            100 * m["int"] / m["att"], 100 * m["sk"] / (m["att"] + m["sk"]), m["ratt"],
            m["ryds"] / m["ratt"], m["rtd"], m["pts"])


def main() -> None:
    seasons = {}
    for y, row in NFL.items():
        games = nfl_games(y)
        rec = {
            "season": y,
            "league": "NFL" if y >= 1970 else "NFL (AFL separate, see afl/combined)",
            "src": "estimated:knowledge",
            "conf": "estimated",
            "note": NOTE + (". " + SEASON_NOTES[y] if SEASON_NOTES.get(y) else ""),
            "sacksOfficial": y >= 1982,
            "sackNote": ("official team and individual sacks" if y >= 1982 else
                         "sacks were not an official statistic before 1982; sack % is an estimate of the era's rate"),
            **block(row, NFL_TEAMS[y], games),
        }
        if y in AFL:
            rec["afl"] = {"src": "estimated:knowledge", "conf": "estimated", "note": NOTE + ". AFL only.",
                          **block(AFL[y], AFL_TEAMS[y], 14)}
            wn, wa = NFL_TEAMS[y] * games, AFL_TEAMS[y] * 14
            rec["combined"] = {"src": "derived:nfl+afl", "conf": "estimated",
                               "note": f"team-game-weighted NFL ({wn}) + AFL ({wa}) mix of the two estimated blocks",
                               **block(combine(row, AFL[y], wn, wa), NFL_TEAMS[y] + AFL_TEAMS[y], 0)}
            rec["combined"].pop("gamesPerTeam")
        seasons[str(y)] = rec
    out = {
        "_meta": {
            "description": "League-wide per-season averages 1960-1998. Top level = NFL (1960-69 NFL only; "
                           "AFL in `afl`, team-game-weighted mix in `combined`). 1970+ = merged NFL.",
            "conf": "estimated",
            "src": "estimated:knowledge",
            "note": NOTE,
            "generatedBy": "tools/reference/build_era_baselines.py",
            "generated": now_iso(),
            "definitions": {
                "compPct": "completions / attempts, percent",
                "ypa": "gross passing yards / attempts (sack yardage not subtracted), as in passer rating",
                "tdPct": "passing TD / attempts, percent", "intPct": "INT / attempts, percent",
                "sackPct": "sacks / (attempts + sacks), percent; estimated before 1982",
                "passerRating": "NFL formula applied to compPct, ypa, tdPct, intPct (derived, not separately estimated)",
                "ypc": "rushing yards / rush attempts",
                "pointsPerTeamGame": "points scored per team per game",
                "*PerTeamGame": "league per team-game volumes, derived from the rates (e.g. passYds = att x ypa)",
                "yardsPerReception": "league gross passing yards / completions",
                "gamesPerTeam": "regular-season games per team (1987: 15 incl. 3 replacement games; 1982: 9)",
            },
            "ruleChanges": {str(k): v for k, v in SEASON_NOTES.items() if v},
        },
        "seasons": seasons,
    }
    write_json(AUGMENT_DIR / "era_baselines_pre1999.json", out)
    for y in (1960, 1965, 1970, 1977, 1978, 1979, 1984, 1992, 1998):
        s = seasons[str(y)]
        print(y, s["passerRating"], s["compPct"], s["ypa"], s["passYdsPerTeamGame"], s["sacksPerTeamGame"],
              s["rushYdsPerTeamGame"], s["yardsPerReception"],
              s.get("combined", {}).get("passerRating"), s.get("afl", {}).get("passerRating"))


if __name__ == "__main__":
    main()
