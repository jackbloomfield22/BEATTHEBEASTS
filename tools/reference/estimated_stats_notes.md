# Estimated pre-1999 stint statistics

File: `data/augment/estimated_stats_pre1999.json`. Test: `tests/estimated-stats.test.ts`.

## Why this exists

nflverse has verified per-season stats only from 1999 on. For older stints the ratings engine has only the legacy per-game estimates, which lack several rates the attribute formulas need: QB completion %, yards per attempt, TD %, INT %, sack rate and rush volume; RB carries, receptions and fumbles; WR/TE receptions per game and yards per reception; and games played for every stint. This layer supplies those numbers for the notable pre-1999 stints. Every value is flagged as an estimate.

## Method

- **Source:** the author's (Claude's) own knowledge of the players' season-by-season lines. No dataset was downloaded or scraped. Every entry has `src: "estimate:knowledge"` and `conf: "estimated"`. Under the BRIEF's rules the engine must shrink these values toward the prior, and they never override a `verified` or `reference` value.
- **Totals first, then rates.** For each stint I recalled season totals (attempts, completions, yards, TD, INT; carries and receptions; receptions and yards; games), summed them over the seasons with that franchise inside the decade, and computed the rates from those sums. When a stint is most of a career, I sometimes took career totals and subtracted the seasons outside the stint (the note says so). Rates are rounded to 0.1, and `fumblesPerTouch` to 0.001.
- **Stint = franchise and decade.** `seasons` lists the first and last season with that franchise inside the entry's decade. Montana SF 1980s, for example, is 1980–1989: it leaves out his 1979 rookie season and 1990–92.
- **1990s entries stop at 1998.** The parallel nflverse layer supplies 1999, so each 1990s estimate covers 1990–1998 only. When merging, sum the counting stats and don't double-count. Stints that exist only in 1999 are omitted (see below).
- **Sack rate** is `sacks / (attempts + sacks)`. Sacks became an official individual stat in 1982, so any QB stint that starts before 1982 has `sackPctConf: "low"`. Sack rates for later stints are also recalled less precisely than the passing lines (`sackPctConf: "med"`). Marino's 1983–89 rate (83 sacks in 3,650 attempts, 2.2%) is the one I'm most confident in.
- **RB fumbles** are the weakest field for every back (`fumblesConf: "low"`). Treat them as a rough ball-security ordering, not as counts.
- **Defense entries** carry games and seasons only.
- **`certainty`** (`high`/`med`/`low`) is the author's own confidence in the underlying totals. The engine can use it to set shrinkage strength. `high` means I recall the season lines and the rates should be within about ±1 point. `med` means some seasons were reconstructed. `low` means the totals are rough.
- **Game counts** follow the schedule of the era: 12 NFL games in 1960, then 14 through 1977, and 16 from 1978. The 1982 strike season had 9 games. Most regulars played about 12 games in 1987.

## Coverage

In scope: every `PLAYERS` entry from the 1970s–1990s with `imp ≥ 78` (253 entries; under the 900 cap, so no imp ≥ 80 prioritization was needed), plus every `DEFENSE` entry from the 1960s–1990s (216).

| Group | In scope | Covered | Omitted |
|---|---|---|---|
| QB | 66 | 62 | Trent Green LAR 1990s, Donovan McNabb PHI 1990s, Daunte Culpepper MIN 1990s, Warren Moon KC 1990s |
| RB | 71 | 69 | Edgerrin James IND 1990s, Marshall Faulk LAR 1990s |
| WR | 87 | 86 | Torry Holt LAR 1990s |
| TE | 29 | 29 | none |
| Defense | 216 | 213 | Emlen Tunnell NYG 1960s, Tom Cousineau CLE 1970s, Mike Kenn MIN 1980s |
| **Total** | **469** | **459** | **10** |

Why they were omitted:

- **1999-only stints:** McNabb, Culpepper, Edgerrin James, Faulk LAR, Holt, and Moon KC (his only KC games were in 1999–2000). nflverse covers them.
- **Stints with no games:** Trent Green never played for the Rams in the 1990s (he tore his ACL in the 1999 preseason). Emlen Tunnell's Giants years ended in 1958, and he was with Green Bay from 1959 to 1961. Tom Cousineau went to the CFL in 1979 and didn't join Cleveland until 1982.
- **Not the right player:** Mike Kenn was a Falcons tackle, not a Vikings safety. That row looks like a legacy error.

## Legacy anomalies found along the way (for `data/corrections.json` review)

- `players:trent-green:LAR:1990s`, `defense:emlen-tunnell:NYG:1960s`, `defense:tom-cousineau:CLE:1970s`: the player has no games in that stint.
- `defense:mike-kenn:MIN:1980s`: this doesn't match any real Vikings safety.
- `defense:ed-budde:KC:1960s`: Budde was a guard, not a linebacker. His games are still included.
- `defense:mike-haynes:LAR:1980s` and `defense:sean-jones:LAR:1980s`: both played for the Los Angeles **Raiders**, not the Rams. The games given are for their Raiders stints.
- `players:dan-fouts:LAC:1970s`: legacy has 270 pass yds/g, but 1973–79 works out to about 184 yds/g (14,739 yards in 80 games). The 270 figure matches his 1979–82 peak.
- `players:stephen-davis:WAS:1990s`: the legacy line (95 yds/g) reflects 1999. His 1996–98 seasons were as a backup and fullback, 4.7 carries per game.
- `defense:coy-bacon:CIN:1970s`: the legacy stat line is effectively his career total, but the CIN stint was only 1976–77. The same pattern of career totals on single stints recurs in the legacy defense data (for example `defense:deion-sanders:DAL:1990s`, where int 45 is roughly his whole 1990s total across ATL, SF and DAL). Anyone deriving rates from legacy defense totals should divide by career games, not by the stint games given here.

## The 20 entries I'm least sure of

1. `players:mel-gray:ARI:1970s`: receptions and yards are approximated from his career line (low).
2. `players:riley-odoms:DEN:1970s`: season-by-season totals not recalled (low).
3. `players:billy-joe-dupree:DAL:1970s`: yardage approximate (low).
4. `players:bob-tucker:NYG:1970s`: stint totals approximate (low).
5. `players:rich-caster:NYJ:1970s`: yards per reception is right in shape (deep-threat TE, about 18) but the totals are rough (low).
6. `players:doug-cosbie:DAL:1980s`: totals and games approximate (low).
7. `players:charlie-sanders:DET:1970s`: derived as career minus 1968–69 (med).
8. `players:raymond-chester:LV:1970s`: split across two Raiders stints (med).
9. `players:randall-cunningham:PHI:1980s` sackPct 12.5: the 1986–87 sack counts were extreme, but the exact split is uncertain.
10. `players:roger-staubach:DAL:1970s` sackPct 9.0: pre-1982, unofficial.
11. `players:bert-jones:IND:1970s`: sack rate and games in injury-shortened 1978–79.
12. `players:ken-o-brien:NYJ:1980s` sackPct 9.0.
13. `players:neil-lomax:ARI:1980s` sackPct 8.5.
14. `players:dave-krieg:SEA:1980s`: derived by subtracting 1990–91 from his SEA totals.
15. `players:ron-jaworski:PHI:1980s`: derived by subtracting 1977–79 from his PHI totals.
16. `players:danny-white:DAL:1980s`: his 1976–79 backup lines were estimated before subtracting.
17. `players:james-wilder:TB:1980s`: games and early-career receptions.
18. `players:steve-watson:DEN:1980s`: 1980 and 1987 lines approximate.
19. Every RB `fumbles` / `fumblesPerTouch` value, the worst being `players:franco-harris:PIT:1970s` and `players:eric-dickerson:LAR:1980s`.
20. Defense games marked `low`: E.J. Junior ARI, Dennis Smith DEN, Albert Lewis KC, Hanford Dixon CLE, Frank Minnifield CLE, Wes Hopkins PHI, Vann McElroy LV, Gary Fencik CHI, Mark Haynes NYG and Jim Collins LAR, all 1980s. The seasons are right, but the games could be off by 5 to 10.

## Upgrading

When a cited public source (`reference`) or open dataset (`verified`) is available for any of these stints, it should replace the value here. This file should then drop the entry rather than keep a second, conflicting number.
