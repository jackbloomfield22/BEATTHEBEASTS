# Estimated pre-1999 defensive stint totals

File: `data/augment/estimated_def_stints_pre1999.json`. Test: `tests/estimated-def.test.ts`.

## Why this exists

Legacy `DEFENSE` entries are one player + franchise + decade, and their counting stats (`sk`, `int`, `ff`, `fr`, `td`) and honors (`ap`, `pb`, `dpoy`) should be totals for that stint. Many aren't. They hold the player's career total, his total for the decade across several teams, or some other span. BRIEF "What is wrong with the legacy ratings" item 6 describes the effect. The ratings engine divides these totals by the stint's games, so a career total on a short stint inflates the rate. Examples: Deion Sanders DAL 1990s shows 45 INT against 11 in 1995–98, and Coy Bacon CIN 1970s shows 130 sacks against about 25.5 in 1976–77.

This layer gives an estimate of the true stint total for every 1960s–1990s defender I could place. Each estimate carries a verdict on what the legacy numbers actually are.

## Method

- **Source:** the author's (Claude's) own knowledge of the players' season-by-season records. No dataset was downloaded or scraped. Every entry has `src: "estimate:knowledge"` and `conf: "estimated"`. Under the BRIEF's rules the engine shrinks these values toward the prior, and they never override `verified` or `reference` values.
- **Stint span:** `seasons` is copied from `estimated_stats_pre1999.json` (games per stint live there). An entry counts only the seasons with that franchise inside the decade. 1990s entries stop at 1998 because nflverse supplies 1999, so merge the two without double-counting.
- **Sacks:** official from 1982. Before 1982 I used the commonly cited researched figures (John Turney / Pro Football Researchers, as shown on Pro-Football-Reference), usually as a career total minus the seasons outside the stint. `skUnofficial` is true when `sk` includes any season before 1982. `skOfficial` gives the official (1982+) part for stints that straddle 1982, where I could recall it.
  - **Lawrence Taylor 1981:** it's included. NYG 1980s `sk` = 113.5, which is 104 official (1982–89: 7.5, 9, 11.5, 13, 20.5, 12, 15.5, 15) plus the researched 9.5 of 1981. The entry is flagged `skUnofficial: true` with `skOfficial: 104`. A consumer that wants official sacks only can use `skOfficial`.
  - Pre-1982 linebacker sacks are rough shares of the career figure. I gave them only when the INT evidence already showed a career total, and left them out elsewhere.
- **Interceptions:** season-by-season where I know them, or career minus the other stints. DE/DT interceptions are left out. There are too few to recall reliably, so the engine falls back to legacy for them.
- **Forced fumbles and fumble recoveries:** left out of every entry. FF was not tracked before about 1990, and I can't reliably recall FF or FR totals by stint, so I'd rather not invent them. `td` appears only where I know it (Deion 1989: 0).
- **Honors** are season lists inside the stint:
  - `allPro1Seasons` is AP first-team. For AFL entries it is All-AFL.
  - `proBowlSeasons` is the Pro Bowl, or the AFL All-Star Game.
  - `dpoySeasons` is the AP Defensive Player of the Year, from the full winners list for 1971–1998. It is empty before 1971 and never counts the NEA or UPI awards (for example, Curley Culp's 1975 NEA award is not counted).
  - The All-Pro and Pro Bowl lists always come as a pair. `src/engine/ratings/inputs.ts` treats a missing list as zero once the other list is present. Seven entries have neither list, and the engine then uses the legacy counts: Doug Atkins, Ron McDole, Larry Morris, Johnny Robinson, Dave Grayson, Ed Budde and Wahoo McDaniel.
  - All-Pro lists are my weakest honors field (they often carry `low` certainty).
- **Verdict:** `stint-ok` when legacy `sk` and `int` are both within max(2, 20% of the estimate) of it. Only fields present on both sides are compared. Otherwise I labelled the most likely cause:
  - `career-totals`: legacy is the career total, or the whole franchise career when the stint is only part of it.
  - `decade-totals-across-teams`: legacy sums the decade across franchises (Reggie White GB, Kevin Greene PIT, Chris Doleman MIN, Trace Armstrong CHI).
  - `other-mismatch`: anything else, including undercounts. The test re-derives the stint-ok/not-ok split from the rule.
- **`certainty`:** `high` means I recall the season lines. `med` means some seasons were reconstructed. `low` means a rough apportionment of a career figure, and applies to most pre-1982 sack splits and many 1960s–70s INT splits.

## Coverage

Of the 216 legacy DEFENSE entries from the 1960s–1990s, 213 are covered and 3 are left out because the stint has no seasons:

- `emlen-tunnell:NYG:1960s`: Tunnell played for the Giants 1948–58 and Green Bay 1959–61. He had no Giants season in the 1960s. This looks like a legacy labeling error.
- `tom-cousineau:CLE:1970s`: he went to the CFL after the 1979 draft and played for the Browns 1982–85. He had no NFL season in the 1970s.
- `mike-kenn:MIN:1980s`: I know of no Vikings safety by this name. Mike Kenn was an Atlanta offensive tackle.

Other legacy oddities:

- `ed-budde:KC:1960s` is listed as a LB, but Budde was a Chiefs offensive guard. The entry records sk 0 and int 0, verdict `other-mismatch`.
- `mike-haynes:LAR:1980s` and `sean-jones:LAR:1980s` use the team code `LAR` for the Los Angeles Raiders.

| Verdict | 1960s | 1970s | 1980s | 1990s | Total |
|---|---|---|---|---|---|
| stint-ok | 17 | 14 | 29 | 14 | 74 |
| career-totals | 30 | 38 | 19 | 29 | 116 |
| decade-totals-across-teams | 0 | 0 | 0 | 4 | 4 |
| other-mismatch | 5 | 1 | 6 | 7 | 19 |

So 139 of 213 rows (65%) don't hold stint totals, and 120 of those are career or decade totals. Certainty: 34 high, 63 med, 116 low.

## Entries whose legacy numbers are not stint totals

Each cell is legacy → estimate. `–` means the field is absent. An absent ap/pb estimate means the engine falls back to the legacy count.

| Entry | Stint | Verdict | sk | int | AP 1st | Pro Bowl | Certainty |
|---|---|---|---|---|---|---|---|
| `bob-lilly:DAL:1960s` | 1961–1969 | career-totals | 95.5 → 55 | 1 → 1 | 7 → 6 | 11 → 7 | low |
| `merlin-olsen:LAR:1960s` | 1962–1969 | career-totals | 91 → 56 | 1 → – | 6 → 5 | 14 → 8 | low |
| `buck-buchanan:KC:1960s` | 1963–1969 | career-totals | 63 → 40 | 0 → – | 3 → 2 | 8 → 6 | low |
| `gino-marchetti:IND:1960s` | 1960–1966 | career-totals | 70 → 42 | 0 → – | 4 → 4 | 6 → 5 | low |
| `doug-atkins:CHI:1960s` | 1960–1966 | other-mismatch | 75 → 56 | 0 → – | 1 → – | 6 → – | low |
| `carl-eller:MIN:1960s` | 1964–1969 | other-mismatch | 70 → 58 | 0 → – | 3 → 2 | 4 → 2 | low |
| `ernie-ladd:LAC:1960s` | 1961–1965 | career-totals | 50 → 35 | 0 → – | 2 → 2 | 4 → 4 | low |
| `rosey-grier:LAR:1960s` | 1963–1966 | career-totals | 45 → 20 | 0 → – | 0 → 0 | 2 → 0 | low |
| `dick-butkus:CHI:1960s` | 1965–1969 | career-totals | 11 → 6 | 22 → 13 | 5 → 4 | 8 → 5 | med |
| `ray-nitschke:GB:1960s` | 1960–1969 | career-totals | 20 → 12 | 25 → 20 | 1 → 2 | 1 → 1 | low |
| `bobby-bell:KC:1960s` | 1963–1969 | career-totals | 26 → 15 | 26 → 17 | 6 → 6 | 9 → 6 | low |
| `willie-lanier:KC:1960s` | 1967–1969 | career-totals | 15 → 3 | 27 → 6 | 2 → 2 | 8 → 2 | low |
| `chuck-howley:DAL:1960s` | 1961–1969 | career-totals | 20 → 12 | 24 → 16 | 5 → 4 | 6 → 5 | low |
| `tommy-nobis:ATL:1960s` | 1966–1969 | career-totals | 12 → 5 | 11 → 5 | 2 → 1 | 5 → 3 | low |
| `lee-roy-jordan:DAL:1960s` | 1963–1969 | career-totals | 14 → 8 | 32 → 12 | 1 → 0 | 5 → 3 | low |
| `maxie-baughan:PHI:1960s` | 1960–1965 | career-totals | 15 → 6 | 18 → 9 | 2 → 1 | 9 → 5 | low |
| `joe-fortunato:CHI:1960s` | 1960–1966 | career-totals | 12 → 6 | 16 → 9 | 1 → 3 | 5 → 4 | low |
| `larry-morris:CHI:1960s` | 1960–1965 | other-mismatch | 12 → – | 12 → 8 | 1 → – | 2 → – | low |
| `larry-wilson:ARI:1960s` | 1960–1969 | career-totals | – → – | 52 → 42 | 5 → 5 | 8 → 7 | med |
| `herb-adderley:GB:1960s` | 1961–1969 | career-totals | – → – | 48 → 39 | 5 → 4 | 5 → 5 | med |
| `mel-renfro:DAL:1960s` | 1964–1969 | career-totals | – → – | 52 → 30 | 5 → 2 | 10 → 6 | med |
| `paul-krause:WAS:1960s` | 1964–1967 | career-totals | – → – | 81 → 28 | 3 → 1 | 8 → 2 | med |
| `lem-barney:DET:1960s` | 1967–1969 | career-totals | – → – | 56 → 25 | 1 → 1 | 7 → 3 | med |
| `johnny-robinson:KC:1960s` | 1960–1969 | career-totals | – → – | 57 → 43 | 3 → – | 6 → – | low |
| `jimmy-johnson:SF:1960s` | 1961–1969 | career-totals | – → – | 47 → 26 | 4 → 1 | 5 → 1 | low |
| `dave-grayson:LV:1960s` | 1965–1969 | career-totals | – → – | 48 → 37 | 3 → – | 6 → – | low |
| `yale-lary:DET:1960s` | 1960–1964 | career-totals | – → – | 50 → 16 | 3 → 1 | 9 → 4 | low |
| `cornell-green:DAL:1960s` | 1962–1969 | career-totals | – → – | 34 → 22 | 3 → 2 | 5 → 3 | low |
| `dave-whitsell:NO:1960s` | 1967–1969 | career-totals | – → – | 46 → 14 | 1 → 0 | 1 → 1 | low |
| `bob-brown:GB:1960s` | 1966–1969 | career-totals | 42 → 22 | 0 → – | 1 → 0 | 2 → 0 | low |
| `verlon-biggs:NYJ:1960s` | 1965–1969 | career-totals | 60 → 40 | 0 → – | 0 → 0 | 3 → 3 | low |
| `ed-budde:KC:1960s` | 1963–1969 | other-mismatch | 12 → 0 | 8 → 0 | 1 → – | 5 → – | med |
| `wahoo-mcdaniel:NYJ:1960s` | 1964–1965 | other-mismatch | 10 → – | 6 → 2 | 0 → – | 1 → – | low |
| `dave-wilcox:SF:1960s` | 1964–1969 | career-totals | 16 → 10 | 14 → 8 | 2 → 2 | 7 → 4 | low |
| `dick-lebeau:DET:1960s` | 1960–1969 | career-totals | – → – | 62 → 46 | 0 → 0 | 3 → 3 | med |
| `alan-page:MIN:1970s` | 1970–1978 | career-totals | 148.5 → 81 | 2 → – | 6 → 5 | 9 → 7 | low |
| `jack-youngblood:LAR:1970s` | 1971–1979 | career-totals | 151.5 → 106 | 0 → – | 5 → 5 | 7 → 7 | med |
| `l-c-greenwood:PIT:1970s` | 1970–1979 | career-totals | 78 → 58 | 1 → – | 2 → 2 | 6 → 6 | low |
| `coy-bacon:CIN:1970s` | 1976–1977 | career-totals | 130 → 25.5 | 0 → – | 1 → 0 | 3 → 2 | med |
| `claude-humphrey:ATL:1970s` | 1970–1978 | career-totals | 122 → 74 | 0 → – | 2 → 2 | 6 → 6 | low |
| `elvin-bethea:TEN:1970s` | 1970–1979 | career-totals | 105 → 82 | 0 → – | 1 → 1 | 8 → 7 | low |
| `curley-culp:TEN:1970s` | 1974–1979 | career-totals | 65 → 38 | 0 → – | 1 → 1 | 6 → 4 | low |
| `harvey-martin:DAL:1970s` | 1973–1979 | career-totals | 114 → 85 | 0 → – | 1 → 1 | 4 → 4 | low |
| `lyle-alzado:DEN:1970s` | 1971–1978 | career-totals | 97 → 63 | 0 → – | 1 → 1 | 2 → 2 | low |
| `jack-lambert:PIT:1970s` | 1974–1979 | career-totals | 23.5 → 13 | 28 → 17 | 6 → 2 | 9 → 5 | med |
| `ted-hendricks:LV:1970s` | 1975–1979 | career-totals | 60.5 → 18 | 26 → 5 | 4 → 0 | 8 → 0 | low |
| `robert-brazile:TEN:1970s` | 1975–1979 | career-totals | 48 → 25 | 13 → 7 | 5 → 4 | 7 → 4 | low |
| `isiah-robertson:LAR:1970s` | 1971–1978 | career-totals | 25 → 12 | 25 → 17 | 3 → 1 | 6 → 6 | low |
| `tom-jackson:DEN:1970s` | 1973–1979 | career-totals | 20 → 10 | 20 → 12 | 1 → 1 | 3 → 3 | low |
| `randy-gradishar:DEN:1970s` | 1974–1979 | career-totals | 20 → 10 | 20 → 10 | 2 → 2 | 7 → 4 | low |
| `bill-bergey:PHI:1970s` | 1974–1979 | career-totals | 21 → 12 | 27 → 16 | 4 → 2 | 5 → 4 | low |
| `brad-van-pelt:NYG:1970s` | 1973–1979 | career-totals | 20 → 10 | 20 → 12 | 1 → 0 | 5 → 4 | low |
| `chris-hanburger:WAS:1970s` | 1970–1978 | career-totals | 19 → 10 | 19 → 12 | 4 → 4 | 9 → 5 | low |
| `andy-russell:PIT:1970s` | 1970–1976 | career-totals | 18 → 8 | 18 → 10 | 1 → 0 | 7 → 5 | low |
| `mel-blount:PIT:1970s` | 1970–1979 | career-totals | – → – | 57 → 42 | 2 → 1 | 5 → 4 | med |
| `ken-houston:WAS:1970s` | 1973–1979 | career-totals | – → – | 49 → 22 | 5 → 3 | 12 → 7 | low |
| `roger-wehrli:ARI:1970s` | 1970–1979 | career-totals | – → – | 40 → 31 | 5 → 5 | 7 → 7 | low |
| `willie-brown:LV:1970s` | 1970–1978 | career-totals | – → – | 54 → 25 | 4 → 4 | 9 → 4 | low |
| `jake-scott:MIA:1970s` | 1970–1975 | career-totals | – → – | 49 → 35 | 2 → 2 | 5 → 5 | med |
| `dick-anderson:MIA:1970s` | 1970–1977 | career-totals | – → – | 34 → 23 | 3 → 1 | 3 → 3 | low |
| `louis-wright:DEN:1970s` | 1975–1979 | career-totals | – → – | 26 → 12 | 3 → 3 | 5 → 3 | low |
| `jimmy-johnson:SF:1970s` | 1970–1976 | career-totals | – → – | 47 → 21 | 1 → 3 | 5 → 4 | low |
| `donnie-shell:PIT:1970s` | 1974–1979 | career-totals | – → – | 51 → 12 | 3 → 1 | 5 → 2 | low |
| `paul-krause:MIN:1970s` | 1970–1979 | career-totals | – → – | 81 → 41 | 2 → 1 | 8 → 4 | low |
| `lemar-parrish:CIN:1970s` | 1970–1977 | career-totals | – → – | 47 → 27 | 3 → 1 | 8 → 6 | low |
| `emmitt-thomas:KC:1970s` | 1970–1978 | career-totals | – → – | 58 → 42 | 2 → 1 | 5 → 3 | low |
| `nolan-cromwell:LAR:1970s` | 1977–1979 | career-totals | – → – | 37 → 6 | 4 → 0 | 4 → 0 | low |
| `eddie-lewis:SF:1970s` | 1976–1979 | other-mismatch | – → – | 20 → 5 | 0 → 0 | 1 → 0 | low |
| `carl-hairston:PHI:1970s` | 1976–1979 | career-totals | 55 → 22 | 0 → – | 0 → 0 | 0 → 0 | low |
| `tommy-hart:SF:1970s` | 1970–1977 | career-totals | 96 → 70 | 0 → – | 1 → 0 | 1 → 1 | low |
| `larry-brooks:LAR:1970s` | 1972–1979 | career-totals | 40 → 32 | 0 → – | 1 → 0 | 5 → 4 | low |
| `mike-curtis:IND:1970s` | 1970–1975 | career-totals | 15 → 6 | 21 → 10 | 2 → 1 | 4 → 3 | low |
| `jack-tatum:LV:1970s` | 1971–1979 | career-totals | – → – | 37 → 30 | 1 → 0 | 3 → 3 | med |
| `ken-riley:CIN:1970s` | 1970–1979 | career-totals | – → – | 65 → 40 | 1 → 0 | 0 → 0 | low |
| `lee-roy-selmon:TB:1980s` | 1980–1984 | career-totals | 78.5 → 41 | 0 → – | 3 → 1 | 6 → 5 | low |
| `fred-dean:SF:1980s` | 1981–1985 | other-mismatch | 55 → 35 | 0 → – | 2 → 1 | 4 → 2 | low |
| `william-perry:CHI:1980s` | 1985–1989 | career-totals | 29.5 → 18.5 | 0 → – | 0 → 0 | 0 → 0 | med |
| `ed-jones:DAL:1980s` | 1980–1989 | other-mismatch | 57.5 → 78 | 0 → – | 1 → 1 | 3 → 3 | low |
| `andre-tippett:NE:1980s` | 1982–1988 | career-totals | 100 → 72.5 | 1 → 1 | 2 → 2 | 5 → 5 | high |
| `rickey-jackson:NO:1980s` | 1981–1989 | career-totals | 115 → 80 | 2 → 2 | 2 → 0 | 6 → 4 | low |
| `karl-mecklenburg:DEN:1980s` | 1983–1989 | career-totals | 79 → 45 | 5 → 3 | 3 → 3 | 6 → 4 | med |
| `mike-merriweather:PIT:1980s` | 1982–1987 | other-mismatch | 51 → 38 | 6 → 9 | 1 → 1 | 4 → 3 | low |
| `carl-banks:NYG:1980s` | 1984–1989 | career-totals | 39 → 27 | 3 → 2 | 1 → 1 | 1 → 1 | med |
| `wilber-marshall:CHI:1980s` | 1984–1987 | career-totals | 45 → 16.5 | 5 → 9 | 2 → 1 | 3 → 2 | med |
| `hugh-green:TB:1980s` | 1981–1985 | career-totals | 53 → 22 | 5 → 5 | 2 → 2 | 2 → 2 | low |
| `jack-lambert:PIT:1980s` | 1980–1984 | other-mismatch | 8 → 12 | 5 → 12 | 2 → 4 | 5 → 4 | med |
| `e-j-junior:ARI:1980s` | 1981–1988 | career-totals | 35 → 22 | 5 → 6 | 1 → 0 | 2 → 2 | low |
| `mike-haynes:LAR:1980s` | 1983–1989 | career-totals | – → – | 46 → 18 | 2 → 2 | 9 → 3 | med |
| `lester-hayes:LV:1980s` | 1980–1986 | career-totals | – → – | 39 → 27 | 2 → 1 | 5 → 5 | med |
| `deion-sanders:ATL:1980s` | 1989–1989 | other-mismatch | – → – | 8 → 5 | 0 → 0 | 1 → 0 | high |
| `joey-browner:MIN:1980s` | 1983–1989 | career-totals | – → – | 37 → 25 | 3 → 3 | 6 → 5 | low |
| `dennis-smith:DEN:1980s` | 1981–1989 | career-totals | – → – | 30 → 16 | 1 → 0 | 6 → 3 | low |
| `albert-lewis:KC:1980s` | 1983–1989 | career-totals | – → – | 42 → 26 | 1 → 1 | 4 → 3 | low |
| `frank-minnifield:CLE:1980s` | 1984–1989 | career-totals | – → – | 20 → 11 | 2 → 1 | 4 → 4 | low |
| `wes-hopkins:PHI:1980s` | 1983–1989 | career-totals | – → – | 30 → 20 | 1 → 1 | 1 → 1 | low |
| `gary-fencik:CHI:1980s` | 1980–1987 | career-totals | – → – | 38 → 24 | 1 → 1 | 2 → 2 | low |
| `mark-haynes:NYG:1980s` | 1980–1985 | career-totals | – → – | 18 → 11 | 1 → 1 | 3 → 3 | low |
| `sean-jones:LAR:1980s` | 1984–1987 | other-mismatch | 57 → 36.5 | 0 → – | 0 → 0 | 0 → 0 | low |
| `donnie-shell:PIT:1980s` | 1980–1987 | career-totals | – → – | 51 → 39 | 0 → 3 | 5 → 3 | low |
| `reggie-white:GB:1990s` | 1993–1998 | decade-totals-across-teams | 111.5 → 68.5 | 3 → – | 4 → 3 | 8 → 6 | high |
| `chris-doleman:MIN:1990s` | 1990–1993 | decade-totals-across-teams | 96.5 → 45 | 0 → – | 2 → 1 | 6 → 3 | high |
| `charles-haley:DAL:1990s` | 1992–1996 | other-mismatch | 73 → 34 | 0 → – | 1 → 1 | 3 → 2 | high |
| `warren-sapp:TB:1990s` | 1995–1998 | other-mismatch | 47 → 29.5 | 1 → – | 2 → 0 | 4 → 2 | high |
| `kevin-greene:PIT:1990s` | 1993–1995 | decade-totals-across-teams | 113 → 35.5 | 0 → – | 2 → 1 | 4 → 2 | high |
| `sean-gilbert:LAR:1990s` | 1992–1995 | career-totals | 38 → 24 | 0 → – | 1 → 0 | 1 → 1 | med |
| `leslie-o-neal:LAC:1990s` | 1990–1995 | other-mismatch | 92.5 → 76.5 | 0 → – | 1 → 0 | 6 → 5 | med |
| `clyde-simmons:PHI:1990s` | 1990–1993 | career-totals | 76 → 44.5 | 0 → – | 1 → 2 | 2 → 2 | high |
| `trace-armstrong:CHI:1990s` | 1990–1994 | decade-totals-across-teams | 68 → 37 | 0 → – | 0 → 0 | 1 → 0 | med |
| `la-roi-glover:NO:1990s` | 1997–1998 | career-totals | 50 → 16.5 | 0 → – | 1 → 0 | 2 → 0 | high |
| `simeon-rice:ARI:1990s` | 1996–1998 | career-totals | 51.5 → 27.5 | 0 → – | 1 → 0 | 1 → 0 | high |
| `junior-seau:LAC:1990s` | 1990–1998 | career-totals | 47 → 37.5 | 11 → 10 | 6 → 5 | 10 → 8 | med |
| `cornelius-bennett:BUF:1990s` | 1990–1995 | career-totals | 71.5 → 29 | 7 → 4 | 1 → 1 | 5 → 4 | med |
| `bryce-paup:BUF:1990s` | 1995–1997 | career-totals | 75 → 33 | 6 → 2 | 1 → 1 | 4 → 3 | high |
| `ken-norton-jr:SF:1990s` | 1994–1998 | career-totals | 14 → 5 | 6 → 4 | 1 → 1 | 3 → 2 | low |
| `hardy-nickerson:TB:1990s` | 1993–1998 | career-totals | 20 → 12 | 12 → 9 | 2 → 2 | 5 → 3 | low |
| `bryan-cox:MIA:1990s` | 1991–1995 | career-totals | 51.5 → 31.5 | 5 → 2 | 2 → 1 | 3 → 3 | med |
| `pat-swilling:NO:1990s` | 1990–1992 | career-totals | 107.5 → 38.5 | 1 → 1 | 2 → 1 | 5 → 3 | high |
| `seth-joyner:PHI:1990s` | 1990–1993 | career-totals | 52 → 22.5 | 24 → 9 | 1 → 1 | 1 → 2 | med |
| `chris-spielman:DET:1990s` | 1990–1995 | career-totals | 11 → 6 | 9 → 4 | 2 → 0 | 4 → 3 | low |
| `wilber-marshall:WAS:1990s` | 1990–1992 | other-mismatch | 23 → 16.5 | 6 → 8 | 1 → 1 | 1 → 1 | low |
| `deion-sanders:DAL:1990s` | 1995–1998 | career-totals | – → – | 45 → 11 | 6 → 3 | 8 → 3 | high |
| `rod-woodson:PIT:1990s` | 1990–1996 | career-totals | – → – | 38 → 30 | 5 → 4 | 7 → 6 | med |
| `darrell-green:WAS:1990s` | 1990–1998 | other-mismatch | – → – | 35 → 27 | 2 → 1 | 5 → 4 | med |
| `aeneas-williams:ARI:1990s` | 1991–1998 | career-totals | – → – | 46 → 35 | 3 → 2 | 6 → 5 | med |
| `eric-allen:PHI:1990s` | 1990–1994 | career-totals | – → – | 54 → 21 | 1 → 1 | 6 → 3 | high |
| `carnell-lake:PIT:1990s` | 1990–1998 | career-totals | – → – | 16 → 11 | 1 → 1 | 5 → 4 | low |
| `eugene-robinson:SEA:1990s` | 1990–1995 | career-totals | – → – | 57 → 28 | 1 → 1 | 3 → 2 | med |
| `terrell-buckley:GB:1990s` | 1992–1994 | career-totals | – → – | 50 → 10 | 0 → 0 | 0 → 0 | high |
| `tim-mcdonald:SF:1990s` | 1993–1998 | career-totals | – → – | 40 → 15 | 1 → 0 | 6 → 1 | low |
| `eric-turner:CLE:1990s` | 1991–1995 | career-totals | – → – | 31 → 17 | 2 → 1 | 2 → 1 | med |
| `ray-buchanan:ATL:1990s` | 1997–1998 | career-totals | – → – | 35 → 12 | 1 → 0 | 1 → 1 | med |
| `sean-jones:GB:1990s` | 1994–1996 | other-mismatch | 59.5 → 24.5 | 0 → – | 0 → 0 | 0 → 0 | med |
| `ted-washington:BUF:1990s` | 1995–1998 | career-totals | 29 → 14.5 | 0 → – | 1 → 0 | 3 → 2 | med |
| `hugh-douglas:PHI:1990s` | 1998–1998 | career-totals | 54 → 12.5 | 0 → – | 1 → 0 | 2 → 0 | high |
| `zach-thomas:MIA:1990s` | 1996–1998 | other-mismatch | 9 → 4.5 | 5 → 7 | 2 → 0 | 3 → 0 | med |
| `sam-mills:NO:1990s` | 1990–1994 | career-totals | 20.5 → 10 | 11 → 5 | 1 → 2 | 5 → 2 | low |
| `dexter-coakley:DAL:1990s` | 1997–1998 | career-totals | 11 → 4.5 | 9 → 2 | 1 → 0 | 3 → 0 | med |
| `sam-madison:MIA:1990s` | 1997–1998 | career-totals | – → – | 31 → 9 | 1 → 0 | 2 → 0 | med |
| `ty-law:NE:1990s` | 1995–1998 | career-totals | – → – | 36 → 18 | 2 → 1 | 5 → 1 | high |

## The 20 entries I'm least sure of

These are the rows where the estimate itself, not just the verdict, could be badly off:

1. `alex-karras:DET:1960s`: I don't recall a researched sack total with any confidence (80 is a guess).
2. `doug-atkins:CHI:1960s`: the sack split between the Bears and Saints years is a guess.
3. `gino-marchetti:IND:1960s`: 1960–64 sacks (42) are a guess, and so is the All-Pro list.
4. `ernie-ladd:LAC:1960s`: Chargers-only sacks (35).
5. `roger-brown:DET:1960s`: Lions-only sacks (49).
6. `ron-mcdole:BUF:1960s`: sacks (40) and INT (3) are both rough.
7. `wahoo-mcdaniel:NYJ:1960s`: INT (2). I have no sack figure.
8. `ordell-braase:IND:1960s`: sacks (45).
9. `verlon-biggs:NYJ:1960s`: sacks (40).
10. `bob-brown:GB:1960s`: sacks (22).
11. `buck-buchanan:KC:1960s`: the 1960s sack share (40) and the All-AFL list.
12. `tommy-hart:SF:1970s`: 49ers-only sacks (70).
13. `carl-hairston:PHI:1970s`: 1976–79 sacks (22).
14. `curley-culp:TEN:1970s`: Oilers-only sacks (38).
15. `lyle-alzado:DEN:1970s`: Broncos-only sacks (63).
16. `eddie-lewis:SF:1970s`: INT (5).
17. `mike-merriweather:PIT:1980s`: sacks (38) and INT (9).
18. `hugh-green:TB:1980s`: Buccaneers-only sacks (22).
19. `sean-jones:LAR:1980s`: Raiders season splits (36.5).
20. `johnny-robinson:KC:1960s`: INT (43). He switched from offense in 1962, and the 1970–71 split is uncertain.

Other points of general uncertainty:

- Every pre-1982 decade split for the long-career pass rushers is an apportionment of a researched career figure: Lilly, Olsen, Eller, Marshall, Greene, Bethea and Martin.
- The same goes for every 1960s–70s DB whose INTs straddle decades (Jimmy Johnson, Willie Brown, Emmitt Thomas, Ken Riley, Donnie Shell).

## Note on the Reggie White spot check

The task asked for a test that Reggie White PHI 1980s has sk ≥ 110. That can't be right for a 1980s-only figure. His 1985–89 Eagles seasons were 13, 18, 21, 18 and 11, which is 81, and legacy already holds exactly 81 (`stint-ok`). 110+ only works for his full Eagles span of 1985–92 (124). The 1990–92 part of that (43) belongs to no legacy entry, because the only Reggie White 1990s entry is Green Bay. The test therefore checks 78 ≤ sk ≤ 84.
