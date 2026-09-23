# Reference and estimated data (M2 ratings inputs)

This covers the parts of `data/augment/` that nflverse can't provide: season-level honors, 40 times for players who predate the combine data, and league baselines before 1999. The nflverse layer (rosters, stats 1999+, combine 2000+, baselines 1999+) is documented separately.

Every value carries `src` and `conf`:

- `reference`: parsed from a public source that was actually retrieved. The record has `url` and `retrieved` (UTC time of the API response).
- `estimated`: typed from knowledge. The record has a `note` saying what it's based on. Treat these as priors to verify, never as fact.
- `missing`: nothing could be matched. Honors are unknown, not zero.

The ratings engine must never let an `estimated` value override a `verified` or `reference` one.

## Files

| File | What | Built by |
|---|---|---|
| `data/augment/accolades.json` | Per-person, per-season honors (Pro Bowl, first- and second-team All-Pro, MVP, OPOY, DPOY, AFL equivalents), team spans, college and draft | `tools/reference/build_accolades.py` |
| `data/augment/estimated_physical.json` | 40-yard dash times (Wikipedia pre-draft tables, plus a short hand list) | `tools/reference/build_physical.py` |
| `data/augment/era_baselines_pre1999.json` | League averages per season, 1960–1998 | `tools/reference/build_era_baselines.py` |
| `tools/reference/cache/` (gitignored) | Every Wikipedia API response | written by the builders |

## How to rerun

```sh
python3 tools/reference/build_accolades.py        # Wikipedia pass (cached; add --offline to forbid requests)
python3 tools/reference/build_physical.py         # needs accolades.json (page titles); cached full pages
python3 tools/reference/build_era_baselines.py    # no network
python3 tools/reference/report.py                 # refreshes the generated sections of this file
npx vitest run tests/reference.test.ts
```

Python 3.11 standard library only. The legacy data is read through Node's type stripping (`data/legacy/index.ts`), so the builders see exactly what the game sees. Nothing in `data/legacy/` is touched.

A cold run makes roughly 150 requests. With the shared egress IP getting HTTP 429s every 20 to 40 requests (each honored with its `Retry-After` of about 45–55 s), a cold run takes about 20–30 minutes. A cached rerun makes zero requests and takes a few seconds.

## Accolades: method

**Who is covered.** Every PLAYERS name whose highest `imp` across its entries is 76 or more (then *all* entries with that name are resolved, so homonyms are split correctly), every DEFENSE name, and every person in an OL unit's `key` list. That is 1,468 names and 2,201 legacy entries or OL unit memberships. The key-list token "The Hogs" is skipped. "Jim Covert" (listed next to "Jimbo Covert" in the CHI 1980s key) and "Anthony Munoz" (CIN 1990s, no tilde) are aliases of one person each (`common.OL_ALIASES`).

**Source and etiquette.** English Wikipedia through the official Action API only (`action=query&prop=revisions&rvsection=0`, `list=search`). User-Agent `BeatTheBeasts-DataBuilder/0.1 (https://github.com/jackbloomfield22/BEATTHEBEASTS)`, one request at a time with at least 1.2 s between requests, `maxlag=5`, exponential back-off from 5 s that honors `Retry-After` on 429 and 5xx, and every response cached on disk. Page text is CC BY-SA 4.0; we store extracted facts plus the page URL. No other site was scraped.

**Matching a legacy entry to a page.** A page counts only if it has a football infobox whose `pastteams` shows the entry's franchise in a span that overlaps the entry's decade. Franchises follow the legacy convention (relocated teams under the current franchise: TEN includes the Houston Oilers, LV the Oakland and LA Raiders, IND the Baltimore Colts, LAR the LA and St. Louis Rams, LAC the San Diego Chargers, ARI the St. Louis and Phoenix Cardinals, KC the Dallas Texans, NYJ the Titans of New York, NE the Boston Patriots). In order:

1. The plain title ("Jerry Rice"), batched 40 per request, redirects followed.
2. For entries still unmatched: every title linked from that page (disambiguation lists and hatnotes like `{{for|the American football player|…}}`) plus the usual title patterns: "Name (American football)", "Name (gridiron football)", "Name (wide receiver)", "Name (offensive tackle)" and so on for the entry's position group.
3. Only then a CirrusSearch query `"Name" hastemplate:"Infobox NFL biography"`.
4. When several candidates overlap, the one whose infobox position matches the entry's position group wins. If nothing overlaps exactly, a one-season slack is allowed, then "same franchise at any time, right position, the only candidate". Those two cases are flagged in the person's `notes` and listed below.

A person is then every entry matched to the same page, keyed `name|group|firstDecade` (group = QB, RB, WR, TE, OL, DL, LB, DB; the most common group among the entries). This gives the planned `data/people.json` (TECH_PLAN "People vs entries") a ready-made, sourced entry→person map.

**Parsing honors.** From the infobox `highlights` field. Each bullet is flattened (links, `{{NFL Year}}`, `{{nfly}}`, `{{nowrap}}`, ranges like 1986–1990) and classified:

- `proBowl`: "Pro Bowl" bullets (never "Pro Bowl MVP"). Links like `[[1987 Pro Bowl|1986]]` are read as the game year minus one, so values are always the **season honored**, whether a page displays season or game years.
- `allPro1` / `allPro2`: "First-team All-Pro" / "Second-team All-Pro" as Wikipedia lists them (AP, or consensus where the page says so). Plain "All-Pro" with no team goes to `allProUnspecified`.
- `mvp`, `opoy`, `dpoy`: only when the bullet *starts* with the award (optionally after "N×", "AP", "NFL"), so conference awards ("ACC Defensive Player of the Year"), UPI or NEA conference awards, rookie and comeback awards, Super Bowl and Pro Bowl MVPs, PFWA MVP and the Bert Bell Award never count.
- AFL 1960–69: `aflAllStar` (the AFL's Pro Bowl), `allAFL1`, `allAFL2`, `allAFLUnspecified`, `aflMvp`. They are kept apart on purpose. The ratings engine should treat `aflAllStar` like `proBowl` and `allAFL1` like `allPro1` when counting honors.
- College, high-school, all-decade and hall-of-fame lines are ignored.

When a bullet says "N×" but lists a different number of seasons, the listed seasons are stored and the mismatch is noted on the person.

`teams` (franchise, first and last season) and `college` / `draftYear` / `draftRound` / `draftPick` come from the same infobox. To count honors inside a stint, intersect the entry's decade with the person's `teams` years for that franchise (or with nflverse's seasons per stint once available) and count honor seasons in that set.

## Accolades: coverage

<!-- BEGIN:auto:coverage -->
**Legacy entries covered, imp >= 85 (PLAYERS and DEFENSE entries whose own imp is 85+):**

| group | total | reference | estimated | missing | reference % |
|---|---|---|---|---|---|
| QB | 60 | 60 | 0 | 0 | 100.0% |
| RB | 47 | 47 | 0 | 0 | 100.0% |
| WR | 53 | 53 | 0 | 0 | 100.0% |
| TE | 17 | 17 | 0 | 0 | 100.0% |
| DL | 72 | 71 | 0 | 1 | 98.6% |
| LB | 47 | 47 | 0 | 0 | 100.0% |
| DB | 61 | 61 | 0 | 0 | 100.0% |
| ALL | 357 | 356 | 0 | 1 | 99.7% |

**All targeted legacy entries (PLAYERS names with max imp >= 76, all DEFENSE, all OL key-list linemen; OL counts are unit memberships):**

| group | total | reference | estimated | missing | reference % |
|---|---|---|---|---|---|
| QB | 313 | 313 | 0 | 0 | 100.0% |
| RB | 343 | 342 | 0 | 1 | 99.7% |
| WR | 434 | 434 | 0 | 0 | 100.0% |
| TE | 174 | 174 | 0 | 0 | 100.0% |
| OL | 551 | 551 | 0 | 0 | 100.0% |
| DL | 153 | 152 | 0 | 1 | 99.3% |
| LB | 107 | 107 | 0 | 0 | 100.0% |
| DB | 126 | 125 | 0 | 1 | 99.2% |
| ALL | 2201 | 2198 | 0 | 3 | 99.9% |

**People whose highest PLAYERS/DEFENSE entry imp is 85+:**

| group | total | reference | estimated | missing | reference % |
|---|---|---|---|---|---|
| QB | 40 | 40 | 0 | 0 | 100.0% |
| RB | 39 | 39 | 0 | 0 | 100.0% |
| WR | 40 | 40 | 0 | 0 | 100.0% |
| TE | 14 | 14 | 0 | 0 | 100.0% |
| DL | 65 | 64 | 0 | 1 | 98.5% |
| LB | 44 | 44 | 0 | 0 | 100.0% |
| DB | 59 | 59 | 0 | 0 | 100.0% |
| ALL | 301 | 300 | 0 | 1 | 99.7% |

**All people (distinct persons):**

| group | total | reference | estimated | missing | reference % |
|---|---|---|---|---|---|
| QB | 143 | 143 | 0 | 0 | 100.0% |
| RB | 195 | 194 | 0 | 1 | 99.5% |
| WR | 233 | 233 | 0 | 0 | 100.0% |
| TE | 96 | 96 | 0 | 0 | 100.0% |
| OL | 449 | 449 | 0 | 0 | 100.0% |
| DL | 139 | 138 | 0 | 1 | 99.3% |
| LB | 101 | 101 | 0 | 0 | 100.0% |
| DB | 121 | 120 | 0 | 1 | 99.2% |
| ALL | 1477 | 1474 | 0 | 3 | 99.8% |

Last build: 2026-09-23T01:02:02Z. Network requests 0, cache hits 34, back-off sleeps 0 s, elapsed 3 s (a cached rerun makes zero requests).
<!-- END:auto:coverage -->

## Disambiguation decisions and matching notes

<!-- BEGIN:auto:matching -->
**Loose matches (25)**: the page is right by name and position, but its team years don't overlap the legacy decade exactly (off by a season, or the legacy decade is wrong).

- `Aaron Brooks|QB|1990s` -> Aaron Brooks (American football): players:aaron-brooks:NO:1990s (search-slack1)
- `Aaron Hernandez|TE|2000s` -> Aaron Hernandez: players:aaron-hernandez:NE:2000s (search-slack1)
- `Adrian Peterson|RB|2000s` -> Adrian Peterson: players:adrian-peterson:WAS:2020s (search-slack1)
- `Charlie Joiner|WR|1970s` -> Charlie Joiner: players:charlie-joiner:CIN:1980s (franchise-only), players:charlie-joiner:LAC:1990s (franchise-only)
- `Curt Warner|RB|1980s` -> Curt Warner: players:curt-warner:LAR:1980s (search-slack1)
- `Eddie Kennison|WR|1990s` -> Eddie Kennison: players:eddie-kennison:NO:2000s (search-slack1)
- `Emlen Tunnell|DB|1960s` -> Emlen Tunnell: defense:emlen-tunnell:NYG:1960s (franchise-only)
- `Eric Green|TE|1980s` -> Eric Green (tight end): players:eric-green:PIT:1980s (search-slack1)
- `Erik Kramer|QB|1980s` -> Erik Kramer: players:erik-kramer:DET:1980s (search-slack1)
- `Frank Wycheck|TE|1990s` -> Frank Wycheck: players:frank-wycheck:BAL:1990s (name-only)
- `James Conner|RB|2020s` -> James Conner: players:james-conner:ATL:2020s (hand-checked)
- `James Wilder|RB|1980s` -> James Wilder Sr.: players:james-wilder:DET:1980s (search-slack1)
- `Jay Schroeder|QB|1980s` -> Jay Schroeder: players:jay-schroeder:LAR:1980s (la-franchise-swap)
- `Jeffery Simmons|DL|2020s` -> Jeffery Simmons: defense:jeffery-simmons:TEN:2020s (search-slack1)
- `Keith Jackson|TE|1980s` -> Keith Jackson (tight end): players:keith-jackson:GB:1980s (franchise-only)
- `Lawrence McCutcheon|RB|1970s` -> Lawrence McCutcheon: players:lawrence-mccutcheon:DEN:1970s (search-slack1)
- `Mike Anderson|RB|1990s` -> Mike Anderson (running back): players:mike-anderson:DEN:1990s (search-slack1)
- `Mike Haynes|DB|1980s` -> Mike Haynes (cornerback): defense:mike-haynes:LAR:1980s (la-franchise-swap)
- `Mike Williams|WR|2000s#2` -> Mike Williams (wide receiver, born 1987): players:mike-williams:TB:2000s (search-slack1)
- `Ozzie Newsome|TE|1970s` -> Ozzie Newsome: players:ozzie-newsome:IND:1980s (hand-checked)
- `Randy Moss|WR|1990s` -> Randy Moss: players:randy-moss:TEN:2000s (search-slack1)
- `Ricky Proehl|WR|1990s` -> Ricky Proehl: players:ricky-proehl:CAR:1990s (hand-checked)
- `Sean Jones|DL|1980s` -> Sean Jones (defensive end): defense:sean-jones:LAR:1980s (la-franchise-swap)
- `Steve Beuerlein|QB|1980s` -> Steve Beuerlein: players:steve-beuerlein:BUF:1980s (name-only)
- `Tom Cousineau|LB|1970s` -> Tom Cousineau: defense:tom-cousineau:CLE:1970s (franchise-only)

**Honor-count mismatches (12)**: the bullet's 'N×' disagrees with the seasons listed. The listed seasons are what is stored.

- `Cameron Jordan|DL|2010s`: proBowl: count 8x but 7 seasons parsed from '8× Pro Bowl (2013, 2015, 2017–2021)'
- `Christian McCaffrey|RB|2010s`: allPro1: count 4x but 3 seasons parsed from '4× First-team All-Pro (2019 , 2023, 2025 )'
- `Derrick Henry|RB|2020s`: allPro2: count 3x but 2 seasons parsed from '3× Second-team All-Pro (2019 , 2024)'
- `Dwight Stephenson|OL|1980s`: proBowl: count 5x but 4 seasons parsed from '5× Pro Bowl (1983–1986)'
- `George Kunz|OL|1970s`: proBowl: count 7x but 6 seasons parsed from '7× Pro Bowl (1969, 1971–1973, 1976–1977)'
- `Harold Carmichael|WR|1970s`: proBowl: count 4x but 3 seasons parsed from '4× Pro Bowl (1973, 1978–1979)'
- `Jim Tyrer|OL|1970s`: allAFL2: count 1x but 2 seasons parsed from 'Second-team All-AFL (1963, 1964)'
- `Jim Tyrer|OL|1970s`: aflAllStar: count 8x but 7 seasons parsed from '8× AFL All-Star (1962–1966, 1968, 1969)'
- `Joe DeLamielleure|OL|1970s`: allPro1: count 3x but 4 seasons parsed from '3× First-team All-Pro (1974–1977)'
- `Khalil Mack|LB|2010s`: allPro1: count 4x but 3 seasons parsed from '4× First-team All-Pro (2015 , 2016, 2018)'
- `Mike Munchak|OL|1980s`: allPro2: count 5x but 4 seasons parsed from '5× Second-team All-Pro (1985, 1990, 1992, 1993)'
- `Wyatt Teller|OL|2020s`: proBowl: count 3x but 4 seasons parsed from '3× Pro Bowl (2020–2023)'

**Unmatched (3)**: conf `missing`, honors unknown.

- `Chris Jones|DL|2020s`: defense:chris-jones:KC:2020s
- `Mike Anderson|RB|1980s`: players:mike-anderson:CHI:1980s
- `Mike Kenn|DB|1980s`: defense:mike-kenn:MIN:1980s

**Pages with no highlights field (51)**: honors stored as empty lists with conf `reference` (the page lists none, which for these role players almost always means none were won).
<!-- END:auto:matching -->

## Legacy DEFENSE `ap` / `pb` / `dpoy` vs Wikipedia, same stint

<!-- BEGIN:auto:disagree -->
Compared 379 DEFENSE entries whose person has a Wikipedia infobox with team spans. Stint seasons = the entry's decade intersected with the page's years at that franchise. Wikipedia AP counts first-team All-Pro plus first-team All-AFL (the unqualified 'All-Pro' count is shown in brackets when it differs); PB counts Pro Bowls plus AFL All-Star games. Score = 1.5|dAP| + |dPB| + 2|dDPOY|; all rows with score >= 3 (45 shown, of 98).

| entry | stint seasons (n) | ap legacy vs wiki | pb legacy vs wiki | dpoy legacy vs wiki | score |
|---|---|---|---|---|---|
| Ted Hendricks LV 1970s | 1975-1979 (5) | 4 vs 0 | 8 vs 0 | 0 vs 0 | 14 |
| Mel Renfro DAL 1960s | 1964-1969 (6) | 5 vs 0 | 10 vs 6 | 0 vs 0 | 11.5 |
| Deion Sanders DAL 1990s | 1995-1999 (5) | 6 vs 3 | 8 vs 4 | 1 vs 0 | 10.5 |
| Jack Lambert PIT 1970s | 1974-1979 (6) | 6 vs 2 | 9 vs 5 | 1 vs 1 | 10 |
| Nolan Cromwell LAR 1970s | 1977-1979 (3) | 4 vs 0 | 4 vs 0 | 0 vs 0 | 10 |
| Ken Houston WAS 1970s | 1973-1979 (7) | 5 vs 2 | 12 vs 7 | 0 vs 0 | 9.5 |
| Merlin Olsen LAR 1960s | 1962-1969 (8) | 6 vs 4 | 14 vs 8 | 0 vs 0 | 9 |
| Willie Lanier KC 1960s | 1967-1969 (3) | 2 vs 0 [2] | 8 vs 2 | 0 vs 0 | 9 |
| Jimmy Johnson SF 1960s | 1961-1969 (9) | 4 vs 1 | 5 vs 1 | 0 vs 0 | 8.5 |
| Patrick Willis SF 2000s | 2007-2009 (3) | 5 vs 2 | 7 vs 3 | 0 vs 0 | 8.5 |
| Yale Lary DET 1960s | 1960-1964 (5) | 3 vs 1 | 9 vs 4 | 0 vs 0 | 8 |
| Willie Brown LV 1970s | 1970-1978 (9) | 4 vs 2 | 9 vs 4 | 0 vs 0 | 8 |
| Harrison Smith MIN 2010s | 2012-2012 (1) | 2 vs 0 | 5 vs 0 | 0 vs 0 | 8 |
| Ron McDole BUF 1960s | 1963-1969 (7) | 0 vs 5 | 0 vs 0 | 0 vs 0 | 7.5 |
| Paul Krause WAS 1960s | 1964-1967 (4) | 3 vs 2 | 8 vs 2 | 0 vs 0 | 7.5 |
| Robert Brazile TEN 1970s | 1975-1979 (5) | 5 vs 2 | 7 vs 4 | 0 vs 0 | 7.5 |
| Dave Wilcox SF 1960s | 1964-1969 (6) | 2 vs 0 | 7 vs 3 | 0 vs 0 | 7 |
| Buck Buchanan KC 1960s | 1963-1969 (7) | 3 vs 6 | 8 vs 6 | 0 vs 0 | 6.5 |
| Deacon Jones LAR 1960s | 1961-1969 (9) | 5 vs 5 | 8 vs 6 | 0 vs 2 | 6 |
| Dick Butkus CHI 1960s | 1965-1969 (5) | 5 vs 3 | 8 vs 5 | 0 vs 0 | 6 |
| Donnie Shell PIT 1970s | 1974-1979 (6) | 3 vs 1 | 5 vs 2 | 0 vs 0 | 6 |
| Jared Allen KC 2000s | 2004-2007 (4) | 3 vs 1 | 4 vs 1 | 0 vs 0 | 6 |
| Charles Woodson GB 2000s | 2006-2009 (4) | 3 vs 1 | 5 vs 2 | 1 vs 1 | 6 |
| Bob Lilly DAL 1960s | 1961-1969 (9) | 7 vs 6 | 11 vs 7 | 0 vs 0 | 5.5 |
| Maxie Baughan PHI 1960s | 1960-1965 (6) | 2 vs 1 | 9 vs 5 | 0 vs 0 | 5.5 |
| Lem Barney DET 1960s | 1967-1969 (3) | 1 vs 2 | 7 vs 3 | 0 vs 0 | 5.5 |
| Fred Dean SF 1980s | 1981-1985 (5) | 2 vs 1 | 4 vs 2 | 1 vs 0 | 5.5 |
| Ty Law NE 1990s | 1995-1999 (5) | 2 vs 1 | 5 vs 1 | 0 vs 0 | 5.5 |
| John Lynch TB 2000s | 2000-2003 (4) | 2 vs 1 | 7 vs 3 | 0 vs 0 | 5.5 |
| Lemar Parrish CIN 1970s | 1970-1977 (8) | 3 vs 1 | 8 vs 6 | 0 vs 0 | 5 |
| Rickey Jackson NO 1980s | 1981-1989 (9) | 2 vs 0 | 6 vs 4 | 0 vs 0 | 5 |
| Harry Carson NYG 1980s | 1980-1988 (9) | 2 vs 0 | 9 vs 7 | 0 vs 0 | 5 |
| Lester Hayes LV 1980s | 1980-1986 (7) | 2 vs 4 | 5 vs 5 | 0 vs 1 | 5 |
| Donnie Shell PIT 1980s | 1980-1987 (8) | 0 vs 2 | 5 vs 3 | 0 vs 0 | 5 |
| Reggie White GB 1990s | 1993-1998 (6) | 4 vs 2 | 8 vs 6 | 1 vs 1 | 5 |
| John Abraham ATL 2000s | 2006-2009 (4) | 1 vs 1 | 5 vs 0 | 0 vs 0 | 5 |
| Henry Jordan GB 1960s | 1960-1969 (10) | 2 vs 5 | 4 vs 4 | 0 vs 0 | 4.5 |
| Bobby Bell KC 1960s | 1963-1969 (7) | 6 vs 5 | 9 vs 6 | 0 vs 0 | 4.5 |
| Alan Page MIN 1970s | 1970-1978 (9) | 6 vs 5 | 9 vs 6 | 1 vs 1 | 4.5 |
| Claude Humphrey ATL 1970s | 1970-1978 (9) | 2 vs 5 | 6 vs 6 | 0 vs 0 | 4.5 |
| Paul Krause MIN 1970s | 1970-1979 (10) | 2 vs 1 | 8 vs 5 | 0 vs 0 | 4.5 |
| Dan Hampton CHI 1980s | 1980-1989 (10) | 4 vs 1 | 4 vs 4 | 0 vs 0 | 4.5 |
| Lee Roy Selmon TB 1980s | 1980-1984 (5) | 3 vs 2 | 6 vs 5 | 1 vs 0 | 4.5 |
| Mike Singletary CHI 1980s | 1981-1989 (9) | 7 vs 6 | 10 vs 7 | 2 vs 2 | 4.5 |
| Dennis Smith DEN 1980s | 1981-1989 (9) | 1 vs 2 | 6 vs 3 | 0 vs 0 | 4.5 |

Agreement: legacy `ap` equals the Wikipedia count for 174/379 entries, `pb` for 186/379, `dpoy` for 364/379. Legacy higher than Wikipedia on `pb`: 168; lower: 25.
<!-- END:auto:disagree -->

## 40-yard dash times

<!-- BEGIN:auto:physical -->
0 reference times (Wikipedia pre-draft tables) and 24 estimates.

**Estimates from knowledge:**

| player | 40 | basis |
|---|---|---|
| Bo Jackson | 4.12 | commonly cited: 1986 pre-draft workout at Auburn, hand-timed; figures 4.12-4.18 are repeated and disputed |
| Joey Galloway | 4.18 | commonly cited: 1995 pre-draft (hand-timed) |
| Darrell Green | 4.25 | estimate: world-class sprinter; hand times in the 4.1-4.3 range are cited from 1983, none official |
| Randy Moss | 4.25 | commonly cited: 1998 Marshall pro day |
| Willie Gault | 4.25 | estimate: no recorded 40 widely documented; world-class hurdler/sprinter |
| Deion Sanders | 4.27 | commonly cited: 1989 NFL Combine, hand-timed (4.19-4.29 versions circulate) |
| Champ Bailey | 4.28 | commonly cited: 1999 NFL Combine |
| Rocket Ismail | 4.28 | commonly cited: 1991 pre-draft (went to the CFL) |
| Marshall Faulk | 4.29 | commonly cited: 1994 pre-draft (4.28-4.35 cited) |
| Rod Woodson | 4.29 | commonly cited: 1987 pre-draft; world-class hurdler |
| Tyreek Hill | 4.29 | commonly cited: 2016 West Alabama pro day (4.24-4.29 reported); did not attend the Combine |
| Cliff Branch | 4.3 | estimate: no recorded 40; NCAA-level sprinter (10.0 s 100 m) at Colorado |
| Michael Vick | 4.33 | commonly cited: 2001 pre-draft workout (did not run at the Combine) |
| Lamar Jackson | 4.34 | estimate: never timed at the 2018 Combine or a pro day; 4.34 is the self-reported figure |
| Eric Dickerson | 4.35 | estimate: consistently described as a 4.3-speed back at 220 lb; no electronic combine time (1983) |
| Herschel Walker | 4.35 | estimate: no NFL combine time (USFL, 1983); 10.2 s 100 m sprinter |
| Barry Sanders | 4.37 | commonly cited: 1989 pre-draft (4.27 hand-timed version also circulates) |
| Ja'Marr Chase | 4.38 | commonly cited: 2021 LSU pro day (no Combine held in 2021) |
| Micah Parsons | 4.39 | commonly cited: 2021 Penn State pro day (no Combine held in 2021) |
| O.J. Simpson | 4.4 | estimate: no recorded 40; member of USC's 1967 world-record 4x110 yd relay |
| Kyle Pitts | 4.44 | commonly cited: 2021 Florida pro day (no Combine held in 2021) |
| Larry Fitzgerald | 4.48 | commonly cited: 2004 Pitt pro day (did not run at the Combine) |
| Emmitt Smith | 4.55 | commonly cited: 1990 pre-draft, famously 'slow' time (4.55-4.7 cited) |
| Jerry Rice | 4.65 | commonly cited: 1985 pre-draft; times of 4.6-4.7 are the ones repeated |

**Where a reference exists, estimates kept for comparison:**

| player | 40 (Wikipedia) | 40 (estimate) | timing |
|---|---|---|---|
<!-- END:auto:physical -->

## Era baselines before 1999

`data/augment/era_baselines_pre1999.json`, one record per season 1960–1998. **All of it is `estimated`**: written from knowledge of published league-average tables (Pro-Football-Reference's league averages per team-game are the kind of table meant), not retrieved. Verify before trusting any single season; the shape across seasons is more reliable than any one number.

- **League.** 1960–69 top-level fields are **NFL only**. The AFL is in an `afl` block, and `combined` mixes the two weighted by team-games that season. From 1970 on it's the merged NFL. An AFL player's baseline should use `afl`.
- **Fields.** Rates: `compPct`, `ypa` (gross yards per attempt, as used in passer rating), `tdPct`, `intPct`, `sackPct` (sacks / (attempts + sacks)), `passerRating`, `ypc`, `pointsPerTeamGame`. Volumes per team-game: `passAttPerTeamGame`, `passCmpPerTeamGame`, `passYdsPerTeamGame`, `passTdPerTeamGame`, `intPerTeamGame`, `sacksPerTeamGame`, `rushAttPerTeamGame`, `rushYdsPerTeamGame`, `rushTdPerTeamGame`, and `yardsPerReception` (league passing yards / completions). The names match the nflverse 1999+ baselines.
- **Consistency by construction.** Only ten inputs per season are hand-set (attempts, comp %, YPA, TD %, INT %, sack %, rush attempts, YPC, rush TDs, points). Every volume and the passer rating are derived from them, so the rating always equals the NFL formula applied to the stored comp %, YPA, TD % and INT % (the test checks it within 0.5).
- **Shape.** Smooth year to year, except where the game really changed: the slide into the dead-ball era (1977 is the low: rating about 61, 17.2 points per team-game), the 1978 rules (5-yard contact limit, offensive-line hands) and the 1979 passing jump, and the 1994 changes (two-point conversion, kickoff from the 30). INT rates fall steadily from about 6% in the 1960s to about 3.2% by the late 1990s.
- **Sacks.** Official from 1982 (`sacksOfficial`). Before that, `sackPct` is an estimate of the era's rate, so sack-based inputs before 1982 deserve lower confidence.
- **Schedules.** `gamesPerTeam`: NFL 12 in 1960 (the AFL played 14), 14 from 1961 to 1977, 16 from 1978, except 9 in 1982 (strike) and 15 in 1987 (strike: one week cancelled, three weeks played by replacement players, which also muddies 1987 per-game rates). `teams` gives league size (26 after the merger, 28 from 1976, 30 from 1995).

## Things to watch

- Wikipedia lists honors as its editors saw them. Where AP and other selectors differ (1960s–70s All-Pro teams especially), a page may list "consensus" or a mix. Pages that only say "All-Pro" are kept in `allProUnspecified` rather than guessed.
- The `teams` spans come from `pastteams`, which include offseason and practice-squad stints on some pages. That can only widen a span, so it can cause a loose match but never a missed honor.
- `conf: reference` means "read from the page", not "checked against a second source". The spot facts pinned in `tests/reference.test.ts` (Rice's 13 Pro Bowls, Taylor's 1986 MVP, White's 1987 and 1998 DPOY, Sanders' 1994 DPOY) are canaries for the parser, not a full audit.
