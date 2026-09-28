# M6.6 data audit and the 2020s trait diagnosis

From `docs/PLAYTEST-1.md` decision 6 ("Check 2020s completeness through the 2025 season (Diggs, AJ Brown, Davante Adams GB 2020s were missing) and skim every other decade for notable missing stints. Add through the sourced added-stints path, no rewrites, and list every addition in the report") and `docs/PLAYTEST-2.md` ("Derrick Henry is missing from TEN 2010s", and the NYJ traits: "Diagnose before changing anything").

**In short**

- **The four named stints were never in the legacy list.** No pool rule, threshold or correction dropped them; the hand-built legacy file simply has no Diggs NE 2020s, A.J. Brown TEN 2020s, Davante Adams GB 2020s or Derrick Henry TEN 2010s. All four are added through the sourced added-stints path, plus the six stints the audit found at QB/RB/WR/TE (1970s on) with a first-team All-Pro season in them: **ten additions**, each with a pinned Wikipedia revision and the nflverse checks.
- **Added stints don't reach the game.** The draft offers only the legacy `PLAYERS` list (`src/game/draft.ts`) and the Beasts only legacy `DEFENSE` (`src/game/beasts.ts`). Added stints, these ten and the seven from M2 and M4.5 (Moss MIN 2000s, Owens SF 2000s, White PHI 1990s…), are in the ratings, the Explorer and the reports, but **not in the draft**. Wiring them in is a `src/game` change with a Daily question (below); not done here.
- **2024 and 2025 are complete in the repo's data** (nflverse rosters and weekly stats, 18 weeks and 272 games each, checksums as in `data/augment/sources.json`). Nothing had to be fetched from nflverse. Wikipedia was reachable for the new stints' tables.
- **One source defect fixed**: nflverse credits every Jaguars player's 2001–02 home-game row to the visitor. 512 rows re-assigned (details below).
- **Traits: the cause is two things, not one.** Short-stint math is real (production gates ranked the attributes' shrunk values, so a short stint lands mid-table whatever it produced): that is Davante Adams's case, and it is fixed. It is not the 2020s pool size (pools are all decades; the 2020s have the most traits of any decade) and not the gates' levels. Garrett Wilson and Aaron Rodgers read correctly from their Jets numbers: Wilson misses Alpha and Burner by 1–3 percentile points with bottom-quartile efficiency behind the league's least accurate passing, and Rodgers's one Jets season at 40 is league-average on every passing rate. Allen Lazard's traits all come from body and measurables, which are never shrunk.

## 1. Completeness

### Data through 2025

| Dataset | 2024 | 2025 | Source |
|---|---|---|---|
| nflverse rosters | present | present | `tools/augment/cache/rosters/roster_{2024,2025}.csv`, sha256 as in `data/augment/sources.json` (fetched 2026-09-23) |
| nflverse weekly stats (REG) | weeks 1–18, 272 games | weeks 1–18, 272 games | `stats_player_week_{2024,2025}.csv`; the schedule has 272 regular-season games each year |
| Wikipedia honors (`accolades.json`) | present | present | retrieved 2026-09-23 |

The 2026 season is in progress (the Wikipedia tables already list two or three 2026 games); `LAST_SEASON` stays 2025.

**Source gaps found, not fixable from nflverse.** Three regular-season games have no rows in nflverse's weekly stats: 1999_01_BAL_STL, 2000_03_SD_KC and 2000_06_BUF_MIA. Every stint that includes those teams' seasons is a game short (Kurt Warner's 1999 MVP season reads 15 games in nflverse: 297/455, 4,044 yards, 38 TD, against 325/499, 4,353, 41 in the record). Filling them needs another source for those three box scores (e.g. Pro Football Reference game logs, which the pipeline does not use and whose terms would need checking); not done.

### Why the named stints were missing

| Stint | Legacy list has | Cause |
|---|---|---|
| Stefon Diggs NE 2020s (2025) | MIN 2010s, BUF 2020s, HOU 2020s | not in the legacy file |
| A.J. Brown TEN 2020s (2020–21) | TEN 2010s (2019), PHI 2020s | not in the legacy file |
| Davante Adams GB 2020s (2020–21) | GB 2010s, LV 2020s, NYJ 2020s | not in the legacy file |
| Derrick Henry TEN 2010s (2016–19) | TEN 2020s, BAL 2020s | not in the legacy file |

Checked: no entry in `data/corrections.json` excludes them, the people matching (`data/augment/people.json`) has the person for every one of their legacy stints, and the ratings pools take every stint that exists. The legacy file lists one stint per franchise and decade for the players its author chose; these four were never chosen. The M2 "gaps" list didn't catch them because it only flagged honors seasons (two first-team All-Pros or the equivalent) outside every stint.

### The audit

`tools/augment/stint-audit.ts` (new) takes every person with a rated stint, walks the nflverse rosters (1960–2025) and weekly stats (1999–2025) for every franchise and decade he played in, and lists the franchise-decades with no stint where he earned a cited honor or passed a production mark (a 1,000-yard rushing or receiving season, 800 for a tight end, 4,000 passing yards, 10 sacks, 6 interceptions, or about two such seasons). Before 1999 only honors can flag a gap. The full table is at the end of this file: **392 gaps** after the additions (1960s 40, 1970s 34, 1980s 41, 1990s 54, 2000s 65, 2010s 98, 2020s 60).

**Rule for adding** (the user asked for notable stints, sourced, no rewrites): the four named, plus every audit stint at a draftable position (QB, RB, WR, TE) in the game's offensive decades (the legacy offense starts in the 1970s) with a **first-team All-Pro season** in it. That is an objective bar a fan would agree is notable, and it kept the additions to stints whose Wikipedia tables could be checked line by line.

### Additions

All through `tools/augment/added-stints.ts` → `data/augment/added_stints.json`, validated by `src/engine/data/addedStints.ts`. Legacy data is untouched. Each stint: season lines from the player's Wikipedia career table (revision pinned below), the table checked against its own Career row, the nflverse roster seasons (the whole stint, exactly), and for 1999+ seasons the nflverse per-season stats (which the ratings then read, as for every legacy stint). `imp` comes from the same player's legacy stint (same franchise in the adjacent decade, else nearest in time), capped at 20% as always.

| Player | Team | Decade | Seasons | Line (cited table) | imp from | OVR (rank) | Traits (after the fix) | Source |
|---|---|---|---|---|---|---|---|---|
| Stefon Diggs | NE | 2020s | 2025 | 17 G, 85 rec, 1,013 yds, 4 TD | HOU 2020s (nearest in time) | 81.3 (WR #203) | Chain Mover, Glue Hands | [Wikipedia, rev 1376102933](https://en.wikipedia.org/w/index.php?title=Stefon_Diggs&oldid=1376102933) |
| A.J. Brown | TEN | 2020s | 2020–21 | 27 G, 133 rec, 1,944 yds, 16 TD | TEN 2010s | 82.5 (WR #179) | Blocking WR, Big Body | [rev 1376173969](https://en.wikipedia.org/w/index.php?title=A._J._Brown&oldid=1376173969) |
| Davante Adams | GB | 2020s | 2020–21 | 30 G, 238 rec, 2,927 yds, 29 TD | GB 2010s | 96.8 (WR #3) | Go-To Guy, Contested Catch King, Blocking WR, Release Artist | [rev 1376177109](https://en.wikipedia.org/w/index.php?title=Davante_Adams&oldid=1376177109) |
| Derrick Henry | TEN | 2010s | 2016–19 | 62 G, 804 car, 3,833 yds, 38 TD; 57 rec, 578 yds | TEN 2020s | 82.2 (RB #154) | Battering Ram, Stiff Arm King, Hurdler, Big-Play Back | [rev 1376374937](https://en.wikipedia.org/w/index.php?title=Derrick_Henry&oldid=1376374937) |
| Dan Fouts | LAC | 1980s | 1980–87 | 101 G, 2,156/3,599, 28,301 yds, 172 TD, 141 INT | LAC 1970s | 92.4 (QB #22) | Maestro, Bomb Squad, Volume Passer, Climber | [rev 1373586464](https://en.wikipedia.org/w/index.php?title=Dan_Fouts&oldid=1373586464) |
| Barry Sanders | DET | 1980s | 1989 | 15 G, 280 car, 1,470 yds, 14 TD; 24 rec, 282 yds | DET 1990s | 92.0 (RB #31) | Swiss Army Knife, Human Joystick, Lightning in a Bottle, Low Center of Gravity | [rev 1370825212](https://en.wikipedia.org/w/index.php?title=Barry_Sanders&oldid=1370825212) |
| John Jefferson | LAC | 1980s | 1980 | 16 G, 82 rec, 1,340 yds, 13 TD | LAC 1970s | 94.8 (WR #11) | Go-To Guy, Highlight Reel, Contested Catch King, Release Artist | [rev 1366171982](https://en.wikipedia.org/w/index.php?title=John_Jefferson_(American_football)&oldid=1366171982) |
| Joe Montana | SF | 1990s | 1990–92 | 16 G, 336/541, 4,070 yds, 28 TD, 16 INT (1991 lost to injury) | SF 1980s | 90.3 (QB #40) | Maestro, Unflappable, Pre-Snap Wizard, Volume Passer | [rev 1375761933](https://en.wikipedia.org/w/index.php?title=Joe_Montana&oldid=1375761933) |
| Kurt Warner | LAR | 1990s | 1998–99 | 17 G, 329/510, 4,392 yds, 41 TD, 13 INT | LAR 2000s | 95.3 (QB #7) | Bomb Squad, Maestro, Red Zone Sniper, Climber | [rev 1374362149](https://en.wikipedia.org/w/index.php?title=Kurt_Warner&oldid=1374362149) |
| Tyreek Hill | KC | 2020s | 2020–21 | 32 G, 198 rec, 2,515 yds, 24 TD | KC 2010s | 91.8 (WR #37) | Open-Field Menace, Human Highlight, Head Fake, Mismatch | [rev 1374897101](https://en.wikipedia.org/w/index.php?title=Tyreek_Hill&oldid=1374897101) |

Notes on the checks (all in `data/augment/added_stints.json` per stint and in `docs/AUGMENT_REPORT.md`):

- **Every 1999+ season equals nflverse** on the fields compared (receptions, yards and TDs; carries and rushing for Henry), except Warner's 1999, where nflverse lacks the Rams' week-1 game (above): recorded as a source gap and read from nflverse like every legacy 1999 stint.
- **Two typos in the articles' own tables, outside the stints**, recorded exactly (any other difference still refuses the build): Montana's season rows sum to 450 rushes against a Career row of 457, and Warner's to 4,060 attempts against 4,070. The stints' own seasons are unaffected (Montana 1990 and 1992, Warner 1998 and 1999; Warner's 1999 attempts equal nflverse's plus the missing game).
- **Derrick Henry TEN 2010s at 82** is his real line read correctly: 2016–17 as DeMarco Murray's backup (110 and 176 carries) pull his carries per game to 13.2 over the stint. His traits are the ones a fan would name.
- The tool now reads rushing and passing tables (a grid parser that finds each column by its group and label, for the `{{abbr}}` headers, multi-line rows and spans of current articles). The seven earlier records are byte-identical (their pages pinned to the same revisions).

**Not added, and why**

- **Tim Brown LV 1980s and J.T. Smith KC 1980s** pass the All-Pro bar only on return honors: Tim Brown's article says he "was voted to the Pro Bowl nine times, in 1988 and 1991 as a kick returner"; J.T. Smith's lists him as a wide receiver and return specialist among the NFL's punt-return-yards leaders. Returns aren't rated (the Return Man trait was cut in M2).
- **1960s offense** (John Mackey IND, Charley Taylor WAS, Roman Gabriel LAR and five more): the legacy offense has no 1960s, so there is no decade in the draft for them.
- **Defensive stints** (about 75 with a first-team All-Pro season, e.g. Jared Allen MIN 2000s, DeMarcus Ware DAL 2010s, Troy Polamalu PIT 2010s, Micah Parsons GB 2025): listed in the table below for your call. The defensive pools are small (54–105 stints) and every Beast's rating is standardized in them, so each addition re-rates the whole defense, and the Beasts don't read added stints anyway.
- Everything else in the audit (Pro Bowl or production only): listed below, not added.

### Source fix: Jaguars home games, 2001–02

The audit's first pass listed Jimmy Smith (JAX) with one-game "stints" on eight other franchises in 2001–02. The cause is in nflverse's `stats_player_week`: in 2001 and 2002 every Jacksonville player's row from a Jacksonville home game carries the visitor's code as `team` (Jimmy Smith, week 1 of 2001, game 2001_01_PIT_JAX: team PIT). No other team or season shows the pattern: rows credited to a team that is the player's opponent that week, against his main team that season, number 1–8 a season elsewhere, all real mid-season trades, and 212–216 for Jacksonville in 2001 and 2002.

`tools/augment/load.ts` (`SWAPPED_HOME_ROWS`) re-assigns such a row to the home team only when the player is on the home team's roster that season and not the visitor's: **512 rows, 76 players**. League totals are unchanged. Effect on rated stints: Fred Taylor JAX 2000s 105 → 115 games of stats, Kyle Brady JAX 2000s 84 → 99 (OVR 81 → 83), David Garrard JAX 2000s 2002 games 2 → 4, and Mark Brunell WAS 2000s loses the 2002 Jaguars home game credited to Washington. Jimmy Smith's JAX 2000s stint (5,557 → 6,613 yards on the corrected rows) is itself missing from the legacy list: it is in the audit table (two Pro Bowls, five 1,000-yard seasons).

### Other findings (reported, not changed)

- **Added stints aren't in the game** (above). To offer them in the draft, `src/game/draft.ts` would read `data/augment/added_stints.json` through `applyAddedStints` next to `PLAYERS`. The question for you: the Daily's perfect team (`src/engine/legacy/daily.ts`, a port) is computed from the legacy list, so an added player drafted in the Daily would score against a perfect team that can't contain him.
- **Two per-play TD rates count their sample in games, not plays**: `w_tdrate` (TDs per catch) and the trait signal `t_tdtouch` (TDs per touch). A backup's 12 catches over 17 games count as 17 games of evidence. Changing it moves Catch in Traffic for low-volume receivers; left as is and kept out of the trait fix below.
- **Cited pre-1999 lines of added stints are labelled "estimated"** in the contributions (`estimatedPart` in `src/engine/ratings/inputs.ts` sets the confidence for everything in that slot), though they are `reference`. Understates them; pre-existing for White, Sanders and Woodson too.

## 2. The trait diagnosis

**Question** (PLAYTEST-2): Garrett Wilson, Davante Adams and Aaron Rodgers (NYJ 2020s) show no traits, Allen Lazard (NYJ 2020s) shows four. Short-stint per-game math, the 2020s pool size, the percentile gates, or something else?

**How a trait is earned** (`src/engine/ratings/traits/`): each condition is a percentile gate in the position pool, all decades together (980 WRs, 637 QBs): elite traits at the top 10%, standard at the top 25%, negatives at the bottom 10–15%. Three kinds of metric: attributes, body and measurables (height, weight, speed from a 40), and production signatures (the stat signals the attributes read, as sample-shrunk z-scores: a signal from n games counts n/(n+k), the rest regresses to the position average). New read-only diagnostics list every gate for a stint: `RatingRun.traitGates(id)` and `node tools/run-ts.mjs tools/ratings/traitDiagnosis.ts [id…]`. All numbers below are from them (before the fix, after the additions).

### The four players

**Garrett Wilson, WR NYJ 2022–25** (58 games; OVR 67.6; no traits)

| Input (nflverse) | Value | League / context |
|---|---|---|
| Catches, yards, TDs | 315, 3,644, 18 | |
| Catches per game | 5.4 | 25% of a league team's completions |
| Catch rate | 59.7% | league 67.6%; the Jets completed 56.9%, 59.2%, 63.4%, 60.3% of their passes in 2022–25 (league 64.2–65.3%) |
| Yards per catch / per target | 11.6 / 6.9 | league 10.9 / 7.4 |
| Fumbles per touch | 2.15% (6) | league 0.79% |
| Honors, experience | none in 4 seasons; 1.7 years at the stint midpoint | |

| Nearest gates | His value | Percentile | Gate |
|---|---|---|---|
| Alpha: share of the team's catches | z 0.83 | **87th** | top 10% (miss) |
| Alpha: receiving yards per game | z 0.60 | 76th | top 25% (pass) |
| Burner: Speed (4.38 forty) | 95.2 | **89th** | top 10% (miss) |
| Twitch: Acceleration / Agility | 92.1 / 84.3 | 83rd / 56th | top 15% both (miss) |
| Deep Threat: Deep Route / Speed | 65.7 / 95.2 | 27th / 89th | top 25% both |
| Route Technician: Short / Deep Route | 73.6 / 65.7 | 58th / 27th | top 25% both |
| Release Artist: Release | 78.7 | 75th | top 10% |

Every skill attribute sits near the pool median: catch rate, yards per target and yards per catch are all bottom-quartile, no honors (−1.3 to −2.8 on each skill) and his youth (Awareness −4.5, Ball Security −8.7) pull the rest down. He is 58 games, longer than the median WR stint (48), so shrinkage costs him little (his catches-per-game percentile is 87th raw, 87th shrunk). **Cause: his Jets numbers, read correctly, plus two near misses at sharp gates.** The efficiency inputs aren't adjusted for his quarterbacks; that is the one thing the data can't separate, and it's a modeling decision (see "Considered and not done").

**Davante Adams, WR NYJ 2024** (11 games; OVR 77.3; no traits)

67 catches, 854 yards, 7 TDs: 6.1 catches per game (28.5% of a league team's completions), 77.6 yards per game, catch rate 58.8% (league 68.3%), age 31.8 (Speed 83.1, 7th percentile after the aging curve's −4.2).

| Gate | Before | After |
|---|---|---|
| Alpha: share of the team's catches (top 10%) | z 0.74, **83rd** (95th on his numbers) | z 1.00, 94th: pass |
| Alpha: receiving yards per game (top 25%) | z 0.70, 83rd | z 0.97, 94th: pass |
| Release Artist: Release (top 10%) | 79.1, 76th | unchanged (an attribute) |
| Route Technician: Short / Deep Route (top 25%) | 74.6 / 72.8: 62nd / 53rd | unchanged |

His LV 2020s stint (37 games, 6.0 catches per game) earns Alpha at the 93rd percentile. The 11-game sample is shrunk by 11/17 (k = 6), which takes a 95th-percentile rate to the 83rd; and the top 10% of that table is held by long stints: **the WR catches-per-game table's top 10% has a median of 77 games against a pool median of 48.** One season without honors also costs every skill 1.4–3.1 points (the honors signal is never shrunk). **Cause: short-stint math.**

**Aaron Rodgers, QB NYJ 2023–24** (18 games; OVR 74.1; no traits)

368/585, 3,897 yards, 28 TD, 11 INT, 41 sacks. 2023 is one game (the Achilles tear on his fourth snap); nflverse counts it, so his passing yards per game read 216.5 over 18 games against 229.2 over 17 in 2024.

| Rate | His | League |
|---|---|---|
| Completion % | 62.9 | 65.2 |
| Yards per attempt | 6.66 | 7.13 |
| Passer rating | 90.4 | 92.1 |
| Sack rate | 6.5% | 6.9% |
| Intended air yards per attempt | 6.90 | 7.65 |

| Nearest gates | Value | Percentile | Gate |
|---|---|---|---|
| Field General: Awareness | 80.6 | 81st | top 10% |
| Pre-Snap Wizard: Awareness / sack avoidance | 80.6 / z 0.05 | 81st / 53rd | top 25% both |
| Statue (negative): Scramble / Speed | 63.6 / 67.8 | 20th / 11th | bottom 10% / 15% |
| Efficiency King: passer rating | z 0.03 | 47th | top 10% |
| Volume Passer: yards per game / attempts | z 0.29 / 0.43 | 59th / 74th | top 10% / 25% |

Every passing rate is league-average and he is 40 (Speed −12.7 from aging). On his raw numbers, unshrunk, the rates rank between the 32nd (completion %) and 66th (TD %) percentile, so no shrinkage or per-game rule reaches a gate; counting his one-play 2023 game only moves passing volume (59th → about 63rd). **Cause: none in the engine; his Jets season was average.** Fans remember the Packers Rodgers: GB 2010s is QB #2 of all time (97) and GB 2020s #6 (96), with Maestro, Red Zone Sniper, Deep Ball Artist and Off-Platform.

**Allen Lazard, WR NYJ 2023–25** (35 games; OVR 62.9; Blocking WR, Skyscraper, Body Catcher, One-Speed)

2.0 catches and 26 yards per game, catch rate 55.1%. Every trait he shows comes from body and measurables, which are never shrunk: Blocking WR (Run Block 74.4, 95th: weight 227 lb +14.3, strength +8.8), Skyscraper (6'5", 97th, with Jumping 77th), Body Catcher (Catching 7th with Catch in Traffic 84th, lifted by height +9.2), One-Speed (Acceleration and Agility from his combine drills, bottom 10% and 15%). Two of the four are negatives. **Cause: correct; he is a big blocking receiver with poor hands and little burst.** The asymmetry the playtest saw is real, though: body gates never shrink, production gates did, so a role player with an unusual body kept his traits while a star's short stint lost his.

### The hypotheses

| Hypothesis | Verdict | Evidence |
|---|---|---|
| 2020s pool size | **No** | Pools are per position across all decades (980 WRs, 637 QBs), not per decade. The 2020s have the lowest no-trait share of any decade: 27% of 2020s stints show no trait, against 62% (1970s), 57% (1980s), 53% (1990s), 29% (2000s), 30% (2010s). |
| Percentile gates | **Not the cause** | The gates are the same for everyone and sharp by design (top 10% / 25%). Wilson misses two at the 87th and 89th percentiles; Rodgers has nothing within reach. |
| Short-stint per-game math | **Yes, for Adams** | Production gates ranked the attributes' sample-shrunk values. Among multi-stint stars (best stint 88+), stints of 12 games or fewer showed no trait 42% of the time, 13–24 games 32%, 25–48 games 19%, 49+ games 5%. Part of that is real (short stints are often late-career), but the table itself favours length: its top 10% is held by stints of about 75 games. For Rodgers, the one-play 2023 game costs a few percentile points of volume, nowhere near a gate. |
| Something else | **Wilson, Rodgers, Lazard** | Wilson: receiver efficiency isn't adjusted for quarterback play (the Jets' completion rate was 4–7 points under the league's). Rodgers: an average season at 40. Lazard: body traits, correctly earned. |

### The fix

**Production gates place a short stint as a typical one** (`gateSample` in `src/engine/ratings/traits/metrics.ts`, used by `src/engine/ratings/engine.ts` and `traits/derive.ts`):

- The percentile tables stay exactly as they were: each stint's stat signals shrunk by n/(n+k), as the attributes read them.
- At QB, RB, WR and TE, a stint with **at least k games** of sample on a signal (k is the signal's own shrinkage constant in `signals.ts`: from there on his numbers outweigh the position average) is **placed in that table as if it had at least the position's median sample** for the signal (taken from the pool itself, e.g. 48 games for WR catches per game).
- Unchanged: stints at or above the median (their placement is identical), stints under k (too few games to count), the two per-play TD rates whose sample is counted in games (`GAME_SAMPLED_RATES`), and the defensive pools (`GATE_FLOOR_POSITIONS`: the curated Beasts, 54–105 stints, whose tables are held to the rule that at least 40% of every position shows no trait; with the floor, safeties would drop to 36%).
- Attributes and OVR don't change. It restores a rule the trait docs already state: traits describe a stint, never a career, and no gate reads a count of seasons; the shrinkage had made every production gate read stint length.

Traceability: nothing new enters any rating, the why line still quotes the stint's own numbers (Adams NYJ: "6.1 catches per game (29% of a league team's completions) (top 7% of WRs)"), and `traitGates(id)` shows the value placed and the table it was placed in.

Tests (`tests/ratings-traits.test.ts`, "production gates and short stints (M6.6)"): the placement rule's cases; Adams NYJ's catches-per-game gate value equals his raw z times the median-sample shrinkage and earns Alpha; Wilson's (58 games) equals the attributes' own shrunk value; every gate check reports a pool and the checks pass exactly the earned traits. `tests/ratings-round2.test.ts` covers the new added stints (line shapes by position, Barry Sanders's 1989 line, Fouts's cited passing rates, Warner's missing 1999 game, a QB record without its passing line refused).

### Considered and not done

| Option | Why not |
|---|---|
| Rank production gates on raw rates among stints with at least k games (a leaderboard) | Moves the tables for everyone: 342 stints' trait lists changed, including legends (Brady NE 2010s loses Air Raid, Rice SF 1980s loses Go-To Guy and Release Artist from what he shows). |
| Apply the median floor and rebuild the tables with it | Same churn at the top: 270 stints changed, the same legends. |
| Shrink a short stint toward the player's own other stints instead of the position average | Fixes Adams, but the BRIEF's rule is shrinkage toward the position-and-era average, and it lifts decline years toward the prime: 38% of Rodgers's Jets passer rating would come from his Packers MVP seasons. |
| Alpha on target share instead of catch share (would give Wilson Alpha: 27.5% of a league team's pass attempts, 94th percentile) | Targets are missing before 1992 and in nflverse for 2003–08 (Larry Fitzgerald's ARI 2000s share would rest on one season), and mixing target and catch shares in one table favours the modern era. Worth doing with a clean target source; your call. |
| Adjust receiver efficiency for his quarterbacks | The real fix for Wilson-type cases, but it changes every receiver's attributes and needs team passing baselines before 1999. A modeling decision for you. |

## 3. Before and after

### The four players

| Stint | OVR before → after | Traits before | Traits after |
|---|---|---|---|
| Garrett Wilson (NYJ 2020s) | 68 → 68 | none | none (Alpha 87th and Burner 89th percentile, gates at 90th) |
| Davante Adams (NYJ 2020s) | 77 → 77 | none | **Alpha** |
| Aaron Rodgers (NYJ 2020s) | 74 → 74 | none | none |
| Allen Lazard (NYJ 2020s) | 63 → 63 | Blocking WR, Skyscraper, Body Catcher, One-Speed | unchanged |

### A spread of other stints (the fix alone)

85 stints' shown traits change, all at QB, RB, WR and TE and all stints shorter than their position's median; OVR changes for none. Some:

| Stint | OVR | Lost | Gained |
|---|---|---|---|
| George Pickens (DAL 2020s, 2025) | 92 | Mr. Reliable, YAC Monster | Go-To Guy, Release Artist |
| John Jefferson (LAC 1980s, 1980) | 95 | Mr. Reliable, YAC Monster | Go-To Guy, Release Artist |
| Joe Montana (SF 1990s) | 90 | | Volume Passer |
| Brett Favre (MIN 2000s, 2009) | 91 | Efficiency King | Air Raid |
| Randall Cunningham (MIN 1990s) | 91 | Laser | Efficiency King |
| Drew Brees (NO 2020s, 2020) | 82 | | Efficiency King |
| Calvin Ridley (ATL 2020s) | 82 | | Alpha |
| Brandon Marshall (MIA 2010s) | 83 | | Alpha |
| Terrell Owens (CIN 2010s) | 76 | | Alpha |
| Tyler Warren (IND 2020s), Jonnu Smith (MIA 2020s) | 89 | | Volume TE |
| Fred Taylor (JAX 1990s) | 89 | Freight Train | Big-Play Back |
| Mark Ingram II (BAL 2010s), TreVeyon Henderson (NE 2020s) | 81, 80 | | Big-Play Back |
| Kenny Stills (NO 2010s), Marquez Valdes-Scantling (KC 2020s), DeSean Jackson (TB 2010s) | 74, 62, 67 | | Big Play |
| Cam Newton (CAR 2020s), Tyrod Taylor (NYG 2020s) | 63, 75 | Dual Threat | Run-Pass Nightmare |
| Matt Cassel (NE 2000s), Cam Ward (TEN 2020s) | 77, 65 | | Sack Magnet |

Unchanged, e.g.: every defender; long stints such as Rice SF 1980s, Brady NE 2010s, Barry Sanders DET 1990s, Moss MIN 1990s, Mahomes KC 2010s; Garrett Wilson, Rodgers and Lazard NYJ.

### Trait counts per decade (the fix alone)

Offense and defense, OL excluded (OL units carry unit traits only). Before = after the additions and the JAX fix, before the trait fix.

| Decade | Stints | Traits shown | Negatives | No trait | Stints whose traits changed |
|---|---:|---|---|---|---:|
| 1960s | 51 | 39 → 39 | 0 → 0 | 52.9% → 52.9% | 0 |
| 1970s | 455 | 407 → 407 | 45 → 45 | 62.4% → 62.4% | 1 |
| 1980s | 494 | 504 → 504 | 65 → 65 | 56.9% → 56.9% | 4 |
| 1990s | 599 | 632 → 633 | 89 → 89 | 53.4% → 53.4% | 6 |
| 2000s | 596 | 950 → 957 | 204 → 204 | 28.9% → 28.5% | 19 |
| 2010s | 646 | 1,061 → 1,081 | 217 → 218 | 29.7% → 28.8% | 28 |
| 2020s | 545 | 890 → 907 | 196 → 196 | 27.3% → 27.0% | 27 |
| **All** | 3,386 | **4,483 → 4,528 (+1.0%)** | 816 → 817 | 42.1% → 41.8% | 85 |

| Position | Traits shown | No trait |
|---|---|---|
| QB | 820 → 831 | 40.2% → 40.0% |
| RB | 1,087 → 1,099 | 44.5% → 44.2% |
| WR | 1,386 → 1,406 | 41.5% → 40.9% |
| TE | 792 → 794 | 40.6% → 40.6% |
| DE, DT, LB, CB, S | unchanged (87, 45, 124, 74, 68) | unchanged |

The added traits land where short stints are: modern free agency moves players more, and the 2020s decade is six seasons. Every position stays above the 40% no-trait rule, every kept trait is still held by five or more players and none rides along with another 95% of the time (tests).

### The whole milestone (additions, JAX fix and trait fix together)

Against the ratings at the start of M6.6, over the stints that existed then: traits shown 4,469 → 4,492 (+0.5%), no-trait share 42.0% → 41.9%, 181 stints' shown traits changed. Rounded OVR changed for 284 of 4,296 stints, almost all by one point down (270): the ten added stints are strong, so the offensive pools' means rise a hair, and the defensive pools are re-centered on the offensive honors-to-OVR curve (defenders move about −0.2 on average). Anchors: **38 → 36 of 42** pass. Walter Payton CHI 1980s Break Tackle 92.5 → 92.4 (band 93+) and Darrelle Revis NYJ 2000s Press 92.6 → 92.46 (band 93+) slip a tenth under the rounding; both are flagged for review in `tools/ratings/anchors.ts` with the numbers, not bent. Consensus check: Davante Adams GB 2020s (96.8) is now the #2 distinct WR by best stint, flagged like the others (stats kept). The determinism golden (`tests/golden/sim-hashes.json`) was regenerated for the pool shift of the additions. The same shift turned the scripted RB-screen concept clip (seed 4) into a 2.9-yd loss; `src/game/clips.ts` now uses seed 60 (same play, coverage and throw time: 11.6 yd). **The screen concept video should be re-recorded.**

## 4. Regenerated with the repo's scripts

`npm run augment` (JAX fix), `node --experimental-strip-types tools/augment/added-stints.ts --fetch` (additions; Wikipedia pages cached and pinned), `npm run ratings` (baselines, `ratings.v1.json`, `adapter.v1.json`, `docs/RATINGS_REPORT.md`, `docs/TRAITS.md`), `node --experimental-strip-types tools/augment/stint-audit.ts` (the table below), `BTB_UPDATE_GOLDEN=1 npx vitest run tests/determinism.test.ts`. `npm run extract -- --check`, `npm run validate-data -- --check`, `merge-baselines --check`, `build.ts --check` and `fit-adapter.ts --check` all pass. Nothing under `data/legacy/` or `legacy/` changed; no correction was added.

<!-- BEGIN tools/augment/stint-audit.ts -->
## Completeness audit (generated by `tools/augment/stint-audit.ts`)

Every person with a rated stint, walked through the nflverse rosters (1960–2025) and weekly stats (1999–2025): franchise-decades where he played, has no stint, and did something notable there. Notable = a cited honor in one of those seasons (All-Pro, second-team All-Pro, Pro Bowl; `data/augment/accolades.json`), or 1999+ production over the audit marks (a 1,000-yard rushing or receiving season, 800 for a TE, 4,000 passing yards, 10 sacks (8 for a DT), 6 interceptions (5 for a LB), or about two such seasons over the stint; `MARKS` in the tool). Before 1999 only honors can flag a gap. A stint added in this milestone no longer appears here. People with no stint at all are out of scope (the added-stints path needs an existing stint of the same person for body, honors and `imp`).

**392 gaps** (1960s: 40, 1970s: 34, 1980s: 41, 1990s: 54, 2000s: 65, 2010s: 98, 2020s: 60).

### 1960s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| John Mackey | TE | IND | 1963–1969 | no stats before 1999 | All-Pro 1966, All-Pro 1967, All-Pro 1968, Pro Bowl 1963, Pro Bowl 1965, Pro Bowl 1966, Pro Bowl 1967, Pro Bowl 1968 | honors | IND 1970s |
| Charley Taylor | WR | WAS | 1964–1969 | no stats before 1999 | All-Pro 1967, 2nd-team All-Pro 1964, 2nd-team All-Pro 1966, 2nd-team All-Pro 1968, 2nd-team All-Pro 1969, Pro Bowl 1964, Pro Bowl 1965, Pro Bowl 1966, Pro Bowl 1967 | honors | WAS 1970s |
| Jackie Smith | TE | ARI | 1963–1969 | no stats before 1999 | 2nd-team All-Pro 1966, 2nd-team All-Pro 1967, 2nd-team All-Pro 1968, 2nd-team All-Pro 1969, Pro Bowl 1966, Pro Bowl 1967, Pro Bowl 1968, Pro Bowl 1969 | honors | ARI 1970s |
| Maxie Baughan | LB | LAR | 1966–1969 | no stats before 1999 | 2nd-team All-Pro 1966, 2nd-team All-Pro 1967, 2nd-team All-Pro 1968, 2nd-team All-Pro 1969, Pro Bowl 1966, Pro Bowl 1967, Pro Bowl 1968, Pro Bowl 1969 | honors | PHI 1960s |
| Roman Gabriel | QB | LAR | 1962–1969 | no stats before 1999 | All-Pro 1969, 2nd-team All-Pro 1967, 2nd-team All-Pro 1968, Pro Bowl 1967, Pro Bowl 1968, Pro Bowl 1969 | honors | PHI 1970s |
| Chris Hanburger | LB | WAS | 1965–1969 | no stats before 1999 | All-Pro 1969, Pro Bowl 1966, Pro Bowl 1967, Pro Bowl 1968, Pro Bowl 1969 | honors | WAS 1970s |
| Mike Curtis | LB | IND | 1965–1969 | no stats before 1999 | All-Pro 1968, All-Pro 1969, Pro Bowl 1968 | honors | IND 1970s |
| Jerry Smith | TE | WAS | 1965–1969 | no stats before 1999 | All-Pro 1969, 2nd-team All-Pro 1967, Pro Bowl 1967, Pro Bowl 1969 | honors | WAS 1970s |
| Calvin Hill | RB | DAL | 1969 | no stats before 1999 | All-Pro 1969, 2nd-team All-Pro 1969, Pro Bowl 1969 | honors | DAL 1970s |
| Charlie Sanders | TE | DET | 1968–1969 | no stats before 1999 | All-Pro 1969, Pro Bowl 1968, Pro Bowl 1969 | honors | DET 1970s |
| Ken Houston | S | TEN | 1967–1969 | no stats before 1999 | 2nd-team All-Pro 1968, 2nd-team All-Pro 1969, Pro Bowl 1968, Pro Bowl 1969 | honors | WAS 1970s |
| Alan Page | DT | MIN | 1967–1969 | no stats before 1999 | 2nd-team All-Pro 1969, Pro Bowl 1967, Pro Bowl 1968, Pro Bowl 1969 | honors | MIN 1970s |
| Paul Warfield | WR | CLE | 1964–1969 | no stats before 1999 | 2nd-team All-Pro 1968, Pro Bowl 1964, Pro Bowl 1968, Pro Bowl 1969 | honors | MIA 1970s, CLE 1970s |
| Andy Russell | LB | PIT | 1963–1969 | no stats before 1999 | 2nd-team All-Pro 1967, 2nd-team All-Pro 1968, Pro Bowl 1968 | honors | PIT 1970s |
| Gene Washington | WR | SF | 1969 | no stats before 1999 | All-Pro 1969, Pro Bowl 1969 | honors | SF 1970s |
| Paul Krause | S | MIN | 1968–1969 | no stats before 1999 | 2nd-team All-Pro 1968, 2nd-team All-Pro 1969, Pro Bowl 1969 | honors | WAS 1960s, MIN 1970s |
| Fran Tarkenton | QB | NYG | 1967–1969 | no stats before 1999 | Pro Bowl 1967, Pro Bowl 1968, Pro Bowl 1969 | honors | MIN 1970s |
| Fred Biletnikoff | WR | LV | 1965–1969 | no stats before 1999 | All-Pro 1969, AFL All-Star 1967, AFL All-Star 1969 | honors | LV 1970s |
| Emmitt Thomas | CB | KC | 1966–1969 | no stats before 1999 | 2nd-team All-Pro 1969, Pro Bowl 1968 | honors | KC 1970s |
| Fran Tarkenton | QB | MIN | 1961–1966 | no stats before 1999 | Pro Bowl 1964, Pro Bowl 1965 | honors | MIN 1970s |
| Claude Humphrey | DE | ATL | 1968–1969 | no stats before 1999 | 2nd-team All-Pro 1969 | honors | ATL 1970s |
| Doug Atkins | DE | NO | 1967–1969 | no stats before 1999 | 2nd-team All-Pro 1968 | honors | CHI 1960s |
| Bill Bergey | LB | CIN | 1969 | no stats before 1999 | Pro Bowl 1969 | honors | PHI 1970s |
| Curley Culp | DT | KC | 1968–1969 | no stats before 1999 | Pro Bowl 1969 | honors | TEN 1970s |
| Elvin Bethea | DE | TEN | 1968–1969 | no stats before 1999 | Pro Bowl 1969 | honors | TEN 1970s |
| Harold Jackson | WR | PHI | 1969 | no stats before 1999 | Pro Bowl 1969 | honors | LAR 1970s, NE 1970s, PHI 1970s |
| Joe Greene | DT | PIT | 1969 | no stats before 1999 | Pro Bowl 1969 | honors | PIT 1970s |
| Larry Brown | RB | WAS | 1969 | no stats before 1999 | Pro Bowl 1969 | honors | WAS 1970s |
| Roger Brown | DT | LAR | 1967–1969 | no stats before 1999 | Pro Bowl 1967 | honors | DET 1960s |
| Rosey Grier | DT | NYG | 1960–1962 | no stats before 1999 | Pro Bowl 1960 | honors | LAR 1960s |
| Bob Griese | QB | MIA | 1967–1969 | no stats before 1999 | AFL All-Star 1967, AFL All-Star 1968 | honors | MIA 1970s |
| Bob Trumpy | TE | CIN | 1968–1969 | no stats before 1999 | All-AFL 1969, AFL All-Star 1968, AFL All-Star 1969 | honors | CIN 1970s |
| Dave Grayson | S | KC | 1961–1964 | no stats before 1999 | All-AFL 1964, AFL All-Star 1962, AFL All-Star 1963, AFL All-Star 1964 | honors | LV 1960s |
| Joe Namath | QB | NYJ | 1965–1969 | no stats before 1999 | All-AFL 1968, AFL All-Star 1965, AFL All-Star 1967, AFL All-Star 1968, AFL All-Star 1969 | honors | NYJ 1970s, LAR 1970s |
| John Hadl | QB | LAC | 1962–1969 | no stats before 1999 | AFL All-Star 1964, AFL All-Star 1965, AFL All-Star 1968, AFL All-Star 1969 | honors | LAC 1970s, LAR 1970s |
| Nick Buoniconti | LB | MIA | 1969 | no stats before 1999 | All-AFL 1969, AFL All-Star 1969 | honors | NE 1960s |
| O.J. Simpson | RB | BUF | 1969 | no stats before 1999 | AFL All-Star 1969 | honors | BUF 1970s, SF 1970s |
| Otis Taylor | WR | KC | 1965–1969 | no stats before 1999 | All-AFL 1966, AFL All-Star 1966 | honors | KC 1970s |
| Willie Brown | CB | DEN | 1963–1966 | no stats before 1999 | All-AFL 1964, AFL All-Star 1964, AFL All-Star 1965 | honors | LV 1970s |
| Willie Brown | CB | LV | 1967–1969 | no stats before 1999 | All-AFL 1968, All-AFL 1969, AFL All-Star 1967, AFL All-Star 1968, AFL All-Star 1969 | honors | LV 1970s |

### 1970s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| Dave Wilcox | LB | SF | 1970–1974 | no stats before 1999 | All-Pro 1971, All-Pro 1972, 2nd-team All-Pro 1973, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972, Pro Bowl 1973 | honors | SF 1960s |
| Dick Butkus | LB | CHI | 1970–1973 | no stats before 1999 | All-Pro 1970, All-Pro 1972, 2nd-team All-Pro 1971, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972 | honors | CHI 1960s |
| Bob Lilly | DT | DAL | 1970–1974 | no stats before 1999 | All-Pro 1971, 2nd-team All-Pro 1970, 2nd-team All-Pro 1972, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972, Pro Bowl 1973 | honors | DAL 1960s |
| Mike Haynes | CB | NE | 1976–1979 | no stats before 1999 | 2nd-team All-Pro 1976, 2nd-team All-Pro 1977, 2nd-team All-Pro 1978, 2nd-team All-Pro 1979, Pro Bowl 1976, Pro Bowl 1977, Pro Bowl 1978, Pro Bowl 1979 | honors | LAR 1980s |
| Merlin Olsen | DT | LAR | 1970–1976 | no stats before 1999 | All-Pro 1970, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972, Pro Bowl 1973, Pro Bowl 1974, Pro Bowl 1975 | honors | LAR 1960s |
| Randy White | DT | DAL | 1975–1979 | no stats before 1999 | All-Pro 1978, All-Pro 1979, Pro Bowl 1977, Pro Bowl 1978, Pro Bowl 1979 | honors | DAL 1980s |
| Bobby Bell | LB | KC | 1970–1974 | no stats before 1999 | All-Pro 1970, 2nd-team All-Pro 1971, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972 | honors | KC 1960s |
| Ken Houston | S | TEN | 1970–1972 | no stats before 1999 | 2nd-team All-Pro 1970, 2nd-team All-Pro 1971, 2nd-team All-Pro 1972, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972 | honors | WAS 1970s |
| Ted Hendricks | LB | IND | 1970–1973 | no stats before 1999 | All-Pro 1971, 2nd-team All-Pro 1972, Pro Bowl 1971, Pro Bowl 1972, Pro Bowl 1973 | honors | LV 1970s |
| Chuck Howley | LB | DAL | 1970–1973 | no stats before 1999 | All-Pro 1970, 2nd-team All-Pro 1971, Pro Bowl 1971 | honors | DAL 1960s |
| Lee Roy Selmon | DE | TB | 1976–1979 | no stats before 1999 | All-Pro 1979, 2nd-team All-Pro 1978, Pro Bowl 1979 | honors | TB 1980s |
| Mel Renfro | CB | DAL | 1970–1977 | no stats before 1999 | 2nd-team All-Pro 1972, Pro Bowl 1970, Pro Bowl 1971, Pro Bowl 1972, Pro Bowl 1973 | honors | DAL 1960s |
| Nick Buoniconti | LB | MIA | 1970–1976 | no stats before 1999 | 2nd-team All-Pro 1972, 2nd-team All-Pro 1973, Pro Bowl 1972, Pro Bowl 1973 | honors | NE 1960s |
| Coy Bacon | DE | LAR | 1970–1972 | no stats before 1999 | 2nd-team All-Pro 1971, 2nd-team All-Pro 1972, Pro Bowl 1972 | honors | CIN 1970s |
| Johnny Robinson | S | KC | 1970–1971 | no stats before 1999 | All-Pro 1970, Pro Bowl 1970 | honors | KC 1960s |
| Larry Wilson | S | ARI | 1970–1972 | no stats before 1999 | All-Pro 1970, Pro Bowl 1970 | honors | ARI 1960s |
| Lem Barney | CB | DET | 1970–1977 | no stats before 1999 | Pro Bowl 1972, Pro Bowl 1973, Pro Bowl 1975, Pro Bowl 1976 | honors | DET 1960s |
| Lemar Parrish | CB | WAS | 1978–1979 | no stats before 1999 | All-Pro 1979, Pro Bowl 1979 | honors | CIN 1970s |
| Ted Hendricks | LB | GB | 1974 | no stats before 1999 | All-Pro 1974, Pro Bowl 1974 | honors | LV 1970s |
| Buck Buchanan | DT | KC | 1970–1975 | no stats before 1999 | 2nd-team All-Pro 1971, Pro Bowl 1970, Pro Bowl 1971 | honors | KC 1960s |
| Harry Carson | LB | NYG | 1976–1979 | no stats before 1999 | 2nd-team All-Pro 1978, Pro Bowl 1978, Pro Bowl 1979 | honors | NYG 1980s |
| Lee Roy Jordan | LB | DAL | 1970–1976 | no stats before 1999 | 2nd-team All-Pro 1973, Pro Bowl 1973, Pro Bowl 1974 | honors | DAL 1960s |
| Curley Culp | DT | KC | 1970–1974 | no stats before 1999 | 2nd-team All-Pro 1971, Pro Bowl 1971 | honors | TEN 1970s |
| Deacon Jones | DE | LAR | 1970–1971 | no stats before 1999 | 2nd-team All-Pro 1970, Pro Bowl 1970 | honors | LAR 1960s |
| Deacon Jones | DE | LAC | 1972–1973 | no stats before 1999 | 2nd-team All-Pro 1972, Pro Bowl 1972 | honors | LAR 1960s |
| Gary Johnson | DT | LAC | 1975–1979 | no stats before 1999 | 2nd-team All-Pro 1979, Pro Bowl 1979 | honors | LAC 1980s |
| Wes Chandler | WR | NO | 1978–1979 | no stats before 1999 | 2nd-team All-Pro 1979, Pro Bowl 1979 | honors | LAC 1980s, NO 1980s |
| Willie Wood | S | GB | 1970–1971 | no stats before 1999 | 2nd-team All-Pro 1970, Pro Bowl 1970 | honors | GB 1960s |
| Cornell Green | CB | DAL | 1970–1974 | no stats before 1999 | Pro Bowl 1971, Pro Bowl 1972 | honors | DAL 1960s |
| Tommy Nobis | LB | ATL | 1970–1976 | no stats before 1999 | Pro Bowl 1970, Pro Bowl 1972 | honors | ATL 1960s |
| Dick LeBeau | CB | DET | 1970–1972 | no stats before 1999 | 2nd-team All-Pro 1970 | honors | DET 1960s |
| Bob Brown | DT | GB | 1970–1973 | no stats before 1999 | Pro Bowl 1972 | honors | GB 1960s |
| Fran Tarkenton | QB | NYG | 1970–1971 | no stats before 1999 | Pro Bowl 1970 | honors | MIN 1970s |
| Fred Dean | DE | LAC | 1975–1979 | no stats before 1999 | Pro Bowl 1979 | honors | SF 1980s |

### 1980s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| Nolan Cromwell | S | LAR | 1980–1987 | no stats before 1999 | All-Pro 1980, All-Pro 1981, All-Pro 1982, 2nd-team All-Pro 1983, Pro Bowl 1980, Pro Bowl 1981, Pro Bowl 1982, Pro Bowl 1983 | honors | LAR 1970s |
| Ted Hendricks | LB | LV | 1980–1983 | no stats before 1999 | All-Pro 1980, All-Pro 1982, Pro Bowl 1980, Pro Bowl 1981, Pro Bowl 1982, Pro Bowl 1983 | honors | LV 1970s |
| Chris Doleman | DE | MIN | 1985–1989 | no stats before 1999 | All-Pro 1987, All-Pro 1989, Pro Bowl 1987, Pro Bowl 1988, Pro Bowl 1989 | honors | MIN 1990s |
| Darrell Green | CB | WAS | 1983–1989 | no stats before 1999 | All-Pro 1986, All-Pro 1987, Pro Bowl 1984, Pro Bowl 1986, Pro Bowl 1987 | honors | WAS 1990s |
| Mike Haynes | CB | LV | 1983–1989 | no stats before 1999 | All-Pro 1984, All-Pro 1985, Pro Bowl 1984, Pro Bowl 1985, Pro Bowl 1986 | honors | LAR 1980s |
| Fred Dean | DE | LAC | 1980–1981 | no stats before 1999 | All-Pro 1980, All-Pro 1981, Pro Bowl 1980, Pro Bowl 1981 | honors | SF 1980s |
| Louis Wright | CB | DEN | 1980–1986 | no stats before 1999 | All-Pro 1983, All-Pro 1984, Pro Bowl 1983, Pro Bowl 1985 | honors | DEN 1970s |
| Randy Gradishar | LB | DEN | 1980–1983 | no stats before 1999 | 2nd-team All-Pro 1981, 2nd-team All-Pro 1983, Pro Bowl 1981, Pro Bowl 1982, Pro Bowl 1983 | honors | DEN 1970s |
| Robert Brazile | LB | TEN | 1980–1984 | no stats before 1999 | 2nd-team All-Pro 1980, 2nd-team All-Pro 1981, Pro Bowl 1980, Pro Bowl 1981, Pro Bowl 1982 | honors | TEN 1970s |
| Mike Haynes | CB | NE | 1980–1982 | no stats before 1999 | 2nd-team All-Pro 1980, 2nd-team All-Pro 1982, Pro Bowl 1980, Pro Bowl 1982 | honors | LAR 1980s |
| Cornelius Bennett | LB | BUF | 1987–1989 | no stats before 1999 | All-Pro 1988, Pro Bowl 1988 | honors | BUF 1990s |
| Eric Allen | CB | PHI | 1988–1989 | no stats before 1999 | All-Pro 1989, Pro Bowl 1989 | honors | PHI 1990s |
| J.T. Smith | WR | KC | 1980–1984 | no stats before 1999 | All-Pro 1980, Pro Bowl 1980 | honors | ARI 1990s, ARI 1980s |
| Kevin Greene | DE | LAR | 1985–1989 | no stats before 1999 | All-Pro 1989, Pro Bowl 1989 | honors | PIT 1990s |
| Lemar Parrish | CB | WAS | 1980–1981 | no stats before 1999 | All-Pro 1980, Pro Bowl 1980 | honors | CIN 1970s |
| Mel Blount | CB | PIT | 1980–1983 | no stats before 1999 | All-Pro 1981, Pro Bowl 1981 | honors | PIT 1970s |
| Rod Woodson | CB | PIT | 1987–1989 | no stats before 1999 | All-Pro 1989, Pro Bowl 1989 | honors | PIT 1990s |
| Tim Brown | WR | LV | 1988–1989 | no stats before 1999 | All-Pro 1988, Pro Bowl 1988 | honors | LV 1990s, LV 2000s, TB 2000s |
| Tim McDonald | S | ARI | 1987–1989 | no stats before 1999 | All-Pro 1989, Pro Bowl 1989 | honors | SF 1990s |
| Ken Riley | CB | CIN | 1980–1983 | no stats before 1999 | All-Pro 1983 | honors | CIN 1970s |
| Lyle Alzado | DE | CLE | 1980–1981 | no stats before 1999 | All-Pro 1980 | honors | DEN 1970s |
| Brian Blades | WR | SEA | 1988–1989 | no stats before 1999 | 2nd-team All-Pro 1989, Pro Bowl 1989 | honors | SEA 1990s |
| Jack Ham | LB | PIT | 1980–1982 | no stats before 1999 | 2nd-team All-Pro 1980, Pro Bowl 1980 | honors | PIT 1970s |
| Pat Swilling | LB | NO | 1986–1989 | no stats before 1999 | 2nd-team All-Pro 1989, Pro Bowl 1989 | honors | NO 1990s |
| Thurman Thomas | RB | BUF | 1988–1989 | no stats before 1999 | 2nd-team All-Pro 1989, Pro Bowl 1989 | honors | BUF 1990s |
| Bobby Moore | WR | MIN | 1980–1982 | no stats before 1999 | Pro Bowl 1980, Pro Bowl 1981 | honors | MIN 1970s, BUF 1970s |
| Chuck Muncie | RB | LAC | 1980–1984 | no stats before 1999 | Pro Bowl 1981, Pro Bowl 1982 | honors | NO 1970s |
| Sam Mills | LB | NO | 1986–1989 | no stats before 1999 | Pro Bowl 1987, Pro Bowl 1988 | honors | NO 1990s |
| Harvey Martin | DE | DAL | 1980–1983 | no stats before 1999 | 2nd-team All-Pro 1982 | honors | DAL 1970s |
| Jack Youngblood | DE | LAR | 1980–1984 | no stats before 1999 | 2nd-team All-Pro 1980 | honors | LAR 1970s |
| Brad Van Pelt | LB | NYG | 1980–1983 | no stats before 1999 | Pro Bowl 1980 | honors | NYG 1970s |
| Charles Haley | DE | SF | 1986–1989 | no stats before 1999 | Pro Bowl 1988 | honors | DAL 1990s |
| Chris Spielman | LB | DET | 1988–1989 | no stats before 1999 | Pro Bowl 1989 | honors | DET 1990s |
| Dave Casper | TE | LV | 1980–1984 | no stats before 1999 | Pro Bowl 1980 | honors | LV 1970s |
| Dave Casper | TE | TEN | 1980–1983 | no stats before 1999 | Pro Bowl 1980 | honors | LV 1970s |
| Derrick Thomas | LB | KC | 1989 | no stats before 1999 | Pro Bowl 1989 | honors | KC 1990s |
| Franco Harris | RB | PIT | 1980–1983 | no stats before 1999 | Pro Bowl 1980 | honors | PIT 1970s |
| Greg Pruitt | RB | LV | 1982–1984 | no stats before 1999 | Pro Bowl 1983 | honors | CLE 1970s |
| Larry Brooks | DT | LAR | 1980–1982 | no stats before 1999 | Pro Bowl 1980 | honors | LAR 1970s |
| Larry Brown | TE | PIT | 1980–1984 | no stats before 1999 | Pro Bowl 1982 | honors | PIT 1970s |
| Leslie O'Neal | DE | LAC | 1986–1989 | no stats before 1999 | Pro Bowl 1989 | honors | LAC 1990s |

### 1990s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| Derrick Brooks | LB | TB | 1995–1999 | 1999+ only: 16 G, 2 sk, 4 INT | All-Pro 1999, 2nd-team All-Pro 1997, 2nd-team All-Pro 1998, Pro Bowl 1997, Pro Bowl 1998, Pro Bowl 1999 | honors | TB 2000s |
| Ray Lewis | LB | BAL | 1996–1999 | 1999+ only: 15 G, 2.5 sk, 2 INT | All-Pro 1999, 2nd-team All-Pro 1997, 2nd-team All-Pro 1998, Pro Bowl 1997, Pro Bowl 1998, Pro Bowl 1999 | honors | BAL 2000s |
| Tim McDonald | S | ARI | 1990–1992 | no stats before 1999 | All-Pro 1992, 2nd-team All-Pro 1990, 2nd-team All-Pro 1991, Pro Bowl 1991, Pro Bowl 1992 | honors | SF 1990s |
| Mike Singletary | LB | CHI | 1990–1992 | no stats before 1999 | All-Pro 1991, 2nd-team All-Pro 1990, Pro Bowl 1990, Pro Bowl 1991, Pro Bowl 1992 | honors | CHI 1980s |
| Kevin Greene | DE | CAR | 1996–1999 | 1999+ only: 16 G, 12 sk, 0 INT | All-Pro 1996, Pro Bowl 1996, Pro Bowl 1998 | def sacks ≥ 10 in 1999 | PIT 1990s |
| Charles Haley | DE | SF | 1990–1999 | 1999+ only: 7 G, 3 sk, 0 INT | All-Pro 1990, Pro Bowl 1990, Pro Bowl 1991 | honors | DAL 1990s |
| Greg Townsend | DE | LV | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1990, 2nd-team All-Pro 1991, Pro Bowl 1990, Pro Bowl 1991 | honors | LV 1980s |
| John Lynch | S | TB | 1993–1999 | 1999+ only: 16 G, 0.5 sk, 2 INT | All-Pro 1999, Pro Bowl 1997, Pro Bowl 1999 | honors | TB 2000s |
| Rickey Jackson | LB | NO | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1992, 2nd-team All-Pro 1993, Pro Bowl 1992, Pro Bowl 1993 | honors | NO 1980s |
| Trevor Pryce | DE | DEN | 1997–1999 | 1999+ only: 15 G, 13 sk, 1 INT | All-Pro 1999, Pro Bowl 1999 | def sacks ≥ 10 in 1999 | DEN 2000s |
| Albert Lewis | CB | KC | 1990–1993 | no stats before 1999 | All-Pro 1990, Pro Bowl 1990 | honors | KC 1980s |
| Carnell Lake | S | JAX | 1999 | 16 G, 3.5 sk, 0 INT | All-Pro 1999, Pro Bowl 1999 | honors | PIT 1990s |
| Joey Browner | S | MIN | 1990–1991 | no stats before 1999 | All-Pro 1990, Pro Bowl 1990 | honors | MIN 1980s |
| Ronnie Lott | S | LV | 1991–1992 | no stats before 1999 | All-Pro 1991, Pro Bowl 1991 | honors | SF 1980s |
| Ronnie Lott | S | SF | 1990 | no stats before 1999 | All-Pro 1990, Pro Bowl 1990 | honors | SF 1980s |
| Sam Mills | LB | CAR | 1995–1997 | no stats before 1999 | All-Pro 1996, Pro Bowl 1996 | honors | NO 1990s |
| Curtis Martin | RB | NYJ | 1998–1999 | 1999+ only: 16 G, 1,464 rush yds, 5 TD; 45 rec, 259 yds | 2nd-team All-Pro 1999, Pro Bowl 1998 | rushing yards ≥ 1,000 in 1999 | NE 1990s, NYJ 2000s |
| Neal Anderson | RB | CHI | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1990, Pro Bowl 1990, Pro Bowl 1991 | honors | CHI 1980s |
| Peyton Manning | QB | IND | 1998–1999 | 1999+ only: 16 G, 4,135 pass yds, 26 TD, 15 INT | 2nd-team All-Pro 1999, Pro Bowl 1999 | passing yards ≥ 4,000 in 1999 | IND 2000s, DEN 2010s |
| Richard Dent | DE | CHI | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1990, Pro Bowl 1990, Pro Bowl 1993 | honors | CHI 1980s |
| Dennis Smith | S | DEN | 1990–1994 | no stats before 1999 | Pro Bowl 1990, Pro Bowl 1991, Pro Bowl 1993 | honors | DEN 1980s |
| Charles Mann | DE | WAS | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1991, Pro Bowl 1991 | honors | WAS 1980s |
| Ken Norton Jr. | LB | DAL | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1993, Pro Bowl 1993 | honors | SF 1990s |
| Lawrence Taylor | LB | NYG | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1990, Pro Bowl 1990 | honors | NYG 1980s |
| Neil Smith | DE | DEN | 1997–1999 | 1999+ only: 14 G, 6.5 sk, 0 INT | 2nd-team All-Pro 1997, Pro Bowl 1997 | honors | KC 1990s |
| Rodney Holman | TE | CIN | 1990–1992 | no stats before 1999 | 2nd-team All-Pro 1990, Pro Bowl 1990 | honors | CIN 1980s |
| Brad Johnson | QB | WAS | 1999 | 16 G, 4,005 pass yds, 24 TD, 13 INT | Pro Bowl 1999 | passing yards ≥ 4,000 in 1999 | MIN 1990s, TB 2000s, DAL 2000s |
| Howie Long | DE | LV | 1990–1993 | no stats before 1999 | Pro Bowl 1992, Pro Bowl 1993 | honors | LV 1980s |
| John L. Williams | RB | SEA | 1990–1993 | no stats before 1999 | Pro Bowl 1990, Pro Bowl 1991 | honors | SEA 1980s |
| Karl Mecklenburg | LB | DEN | 1990–1994 | no stats before 1999 | Pro Bowl 1991, Pro Bowl 1993 | honors | DEN 1980s |
| Rod Woodson | CB | BAL | 1998–1999 | 1999+ only: 15 G, 0 sk, 7 INT | Pro Bowl 1999 | def interceptions ≥ 6 in 1999 | PIT 1990s |
| Steve Jordan | TE | MIN | 1990–1994 | no stats before 1999 | Pro Bowl 1990, Pro Bowl 1991 | honors | MIN 1980s |
| Steve McMichael | DT | CHI | 1990–1993 | no stats before 1999 | 2nd-team All-Pro 1991 | honors | CHI 1980s |
| Amani Toomer | WR | NYG | 1996–1999 | 1999+ only: 16 G, 79 rec, 1,183 yds, 6 TD | – | receiving yards ≥ 1,000 in 1999 | NYG 2000s |
| Andre Rison | WR | KC | 1997–1999 | 1999+ only: 15 G, 21 rec, 218 yds, 0 TD | Pro Bowl 1997 | honors | ATL 1990s, CLE 1990s |
| Bo Jackson | RB | LV | 1990 | no stats before 1999 | Pro Bowl 1990 | honors | LV 1980s |
| Brian Dawkins | S | PHI | 1996–1999 | 1999+ only: 16 G, 1.5 sk, 4 INT | Pro Bowl 1999 | honors | PHI 2000s |
| Bryce Paup | LB | GB | 1990–1994 | no stats before 1999 | Pro Bowl 1994 | honors | BUF 1990s |
| Chris Doleman | DE | ATL | 1994–1995 | no stats before 1999 | Pro Bowl 1995 | honors | MIN 1990s |
| Chris Doleman | DE | SF | 1996–1998 | no stats before 1999 | Pro Bowl 1997 | honors | MIN 1990s |
| Eric Allen | CB | NO | 1995–1997 | no stats before 1999 | Pro Bowl 1995 | honors | PHI 1990s |
| Eric Turner | S | BAL | 1996 | no stats before 1999 | Pro Bowl 1996 | honors | CLE 1990s |
| Eugene Robinson | S | ATL | 1998–1999 | 1999+ only: 16 G, 0 sk, 3 INT | Pro Bowl 1998 | honors | SEA 1990s |
| Ferrell Edmunds | TE | MIA | 1990–1992 | no stats before 1999 | Pro Bowl 1990 | honors | MIA 1980s, SEA 1990s |
| James Brooks | RB | CIN | 1990–1991 | no stats before 1999 | Pro Bowl 1990 | honors | CIN 1980s, LAC 1980s |
| James Lofton | WR | BUF | 1990–1992 | no stats before 1999 | Pro Bowl 1991 | honors | GB 1980s, LV 1980s, GB 1970s |
| Ken O'Brien | QB | NYJ | 1990–1992 | no stats before 1999 | Pro Bowl 1991 | honors | NYJ 1980s |
| Mark Clayton | WR | MIA | 1990–1992 | no stats before 1999 | Pro Bowl 1991 | honors | MIA 1980s |
| Pat Swilling | LB | DET | 1993–1994 | no stats before 1999 | Pro Bowl 1993 | honors | NO 1990s |
| Qadry Ismail | WR | BAL | 1999 | 15 G, 64 rec, 1,059 yds, 6 TD | – | receiving yards ≥ 1,000 in 1999 | MIN 1990s |
| Rich Gannon | QB | LV | 1999 | 16 G, 3,840 pass yds, 24 TD, 14 INT | Pro Bowl 1999 | honors | KC 1990s, LV 2000s, MIN 1990s |
| Sean Jones | DE | TEN | 1990–1993 | no stats before 1999 | Pro Bowl 1993 | honors | LAR 1980s, GB 1990s |
| Seth Joyner | LB | ARI | 1994–1996 | no stats before 1999 | Pro Bowl 1994 | honors | PHI 1990s |
| Tony Martin | WR | MIA | 1990–1999 | 1999+ only: 15 G, 67 rec, 1,037 yds, 5 TD | – | receiving yards ≥ 1,000 in 1999 | LAC 1990s, ATL 1990s |

### 2000s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| Jared Allen | DE | MIN | 2008–2009 | 32 G, 29.5 sk, 1 INT | All-Pro 2008, All-Pro 2009, Pro Bowl 2008, Pro Bowl 2009 | def sacks ≥ 10 in 2008, 2009; 29.5 def sacks in the stint | KC 2000s |
| Hugh Douglas | DE | PHI | 2000–2004 | 54 G, 40 sk, 1 INT | All-Pro 2000, 2nd-team All-Pro 2002, Pro Bowl 2000, Pro Bowl 2001, Pro Bowl 2002 | def sacks ≥ 10 in 2000, 2002; 40 def sacks in the stint | PHI 1990s |
| Sam Madison | CB | MIA | 2000–2005 | 90 G, 0 sk, 15 INT | All-Pro 2000, 2nd-team All-Pro 2001, Pro Bowl 2000, Pro Bowl 2001, Pro Bowl 2002 | 15 def interceptions in the stint | MIA 1990s |
| Simeon Rice | DE | TB | 2001–2006 | 84 G, 69.5 sk, 4 INT | All-Pro 2002, 2nd-team All-Pro 2003, Pro Bowl 2002, Pro Bowl 2003 | def sacks ≥ 10 in 2001, 2002, 2003, 2004, 2005; 69.5 def sacks in the stint | ARI 1990s |
| Champ Bailey | CB | WAS | 2000–2003 | 64 G, 0 sk, 13 INT | 2nd-team All-Pro 2000, 2nd-team All-Pro 2003, Pro Bowl 2000, Pro Bowl 2001, Pro Bowl 2002, Pro Bowl 2003 | 13 def interceptions in the stint | DEN 2000s |
| John Abraham | DE | NYJ | 2000–2005 | 72 G, 53.5 sk, 0 INT | All-Pro 2001, Pro Bowl 2001, Pro Bowl 2002, Pro Bowl 2004 | def sacks ≥ 10 in 2001, 2002, 2005; 53.5 def sacks in the stint | ATL 2000s |
| Ty Law | CB | NE | 2000–2004 | 68 G, 2 sk, 16 INT | All-Pro 2003, Pro Bowl 2001, Pro Bowl 2002, Pro Bowl 2003 | def interceptions ≥ 6 in 2003; 16 def interceptions in the stint | NE 1990s |
| La'Roi Glover | DT | NO | 2000–2001 | 31 G, 25 sk, 0 INT | All-Pro 2000, Pro Bowl 2000, Pro Bowl 2001 | def sacks ≥ 8 in 2000, 2001; 25 def sacks in the stint | NO 1990s, DAL 2000s |
| Joey Porter | LB | MIA | 2007–2009 | 44 G, 31.5 sk, 2 INT | All-Pro 2008, Pro Bowl 2008 | def sacks ≥ 10 in 2008; 31.5 def sacks in the stint | PIT 2000s |
| Junior Seau | LB | LAC | 2000–2002 | 44 G, 6 sk, 4 INT | All-Pro 2000, Pro Bowl 2000, Pro Bowl 2001, Pro Bowl 2002 | honors | LAC 1990s |
| Rod Woodson | CB | LV | 2002–2003 | 26 G, 0 sk, 10 INT | All-Pro 2002, Pro Bowl 2002 | def interceptions ≥ 6 in 2002; 10 def interceptions in the stint | PIT 1990s |
| Asante Samuel | CB | PHI | 2008–2009 | 31 G, 0 sk, 13 INT | 2nd-team All-Pro 2009, Pro Bowl 2008, Pro Bowl 2009 | def interceptions ≥ 6 in 2009; 13 def interceptions in the stint | NE 2000s |
| Aeneas Williams | CB | LAR | 2001–2004 | 50 G, 1 sk, 9 INT | All-Pro 2001, Pro Bowl 2001, Pro Bowl 2003 | honors | ARI 1990s |
| Jimmy Smith | WR | JAX | 2000–2005 | 91 G, 481 rec, 6,613 yds, 39 TD | Pro Bowl 2000, Pro Bowl 2001 | receiving yards ≥ 1,000 in 2000, 2001, 2002, 2004, 2005; 6,613 receiving yards in the stint | JAX 1990s |
| John Lynch | S | DEN | 2004–2007 | 60 G, 7 sk, 3 INT | Pro Bowl 2004, Pro Bowl 2005, Pro Bowl 2006, Pro Bowl 2007 | honors | TB 2000s |
| Kris Jenkins | DT | NYJ | 2008–2009 | 21 G, 4 sk, 0 INT | All-Pro 2008, Pro Bowl 2008 | honors | CAR 2000s |
| Ted Washington | DT | CHI | 2001–2002 | 15 G, 1.5 sk, 0 INT | All-Pro 2001, Pro Bowl 2001 | honors | BUF 1990s |
| Ray Rice | RB | BAL | 2008–2009 | 28 G, 1,793 rush yds, 7 TD; 111 rec, 975 yds | 2nd-team All-Pro 2009, Pro Bowl 2009 | rushing yards ≥ 1,000 in 2009 | BAL 2010s |
| Rod Woodson | CB | BAL | 2000–2001 | 32 G, 0 sk, 7 INT | 2nd-team All-Pro 2000, Pro Bowl 2000, Pro Bowl 2001 | honors | PIT 1990s |
| Trace Armstrong | DE | MIA | 2000 | 12 G, 13 sk, 0 INT | 2nd-team All-Pro 2000, Pro Bowl 2000 | def sacks ≥ 10 in 2000 | CHI 1990s |
| Cris Carter | WR | MIN | 2000–2001 | 32 G, 169 rec, 2,145 yds, 15 TD | Pro Bowl 2000 | receiving yards ≥ 1,000 in 2000; 2,145 receiving yards in the stint | PHI 1980s, MIN 1990s, MIA 2000s |
| Garrison Hearst | RB | SF | 2000–2003 | 44 G, 2,946 rush yds, 15 TD; 114 rec, 875 yds | Pro Bowl 2001 | rushing yards ≥ 1,000 in 2001; 2,946 rushing yards in the stint | SF 1990s, ARI 1990s, CIN 1990s |
| John Randle | DT | SEA | 2001–2003 | 34 G, 23.5 sk, 0 INT | Pro Bowl 2001 | def sacks ≥ 8 in 2001; 23.5 def sacks in the stint | MIN 1990s |
| Keyshawn Johnson | WR | TB | 2000–2003 | 57 G, 298 rec, 3,829 yds, 17 TD | Pro Bowl 2001 | receiving yards ≥ 1,000 in 2001, 2002; 3,829 receiving yards in the stint | NYJ 1990s |
| Ty Law | CB | NYJ | 2005–2008 | 22 G, 1 sk, 10 INT | Pro Bowl 2005 | def interceptions ≥ 6 in 2005; 10 def interceptions in the stint | NE 1990s |
| Warrick Dunn | RB | TB | 2000–2008 | 44 G, 2,366 rush yds, 13 TD; 159 rec, 1,309 yds | Pro Bowl 2000 | rushing yards ≥ 1,000 in 2000; 2,366 rushing yards in the stint | TB 1990s, ATL 2000s |
| Willis McGahee | RB | BAL | 2007–2009 | 43 G, 2,422 rush yds, 26 TD; 82 rec, 489 yds | Pro Bowl 2007 | rushing yards ≥ 1,000 in 2007; 2,422 rushing yards in the stint | BUF 2000s, DEN 2010s, CLE 2010s |
| Brian Dawkins | S | DEN | 2009 | 16 G, 0 sk, 2 INT | 2nd-team All-Pro 2009, Pro Bowl 2009 | honors | PHI 2000s |
| Bruce Smith | DE | WAS | 2000–2003 | 60 G, 29 sk, 0 INT | – | def sacks ≥ 10 in 2000; 29 def sacks in the stint | BUF 1980s, BUF 1990s |
| Charlie Garner | RB | SF | 2000 | 16 G, 1,142 rush yds, 7 TD; 68 rec, 647 yds | Pro Bowl 2000 | rushing yards ≥ 1,000 in 2000 | PHI 1990s, SF 1990s, LV 2000s |
| Curtis Conway | WR | LAC | 2000–2002 | 41 G, 179 rec, 2,671 yds, 16 TD | – | receiving yards ≥ 1,000 in 2001; 2,671 receiving yards in the stint | CHI 1990s |
| Dexter Coakley | LB | DAL | 2000–2004 | 79 G, 2.5 sk, 4 INT | Pro Bowl 2001, Pro Bowl 2003 | honors | DAL 1990s |
| Ed McCaffrey | WR | DEN | 2000–2003 | 42 G, 195 rec, 2,509 yds, 12 TD | – | receiving yards ≥ 1,000 in 2000; 2,509 receiving yards in the stint | DEN 1990s |
| Emmitt Smith | RB | DAL | 2000–2002 | 46 G, 3,199 rush yds, 17 TD; 44 rec, 284 yds | – | rushing yards ≥ 1,000 in 2000, 2001; 3,199 rushing yards in the stint | DAL 1990s, ARI 2000s |
| Keenan McCardell | WR | JAX | 2000–2001 | 32 G, 187 rec, 2,317 yds, 11 TD | – | receiving yards ≥ 1,000 in 2000, 2001; 2,317 receiving yards in the stint | JAX 1990s, TB 2000s |
| Lamar Smith | RB | MIA | 2000–2001 | 30 G, 2,045 rush yds, 20 TD; 59 rec, 426 yds | – | rushing yards ≥ 1,000 in 2000; 2,045 rushing yards in the stint | SEA 1990s |
| Matt Forte | RB | CHI | 2008–2009 | 32 G, 2,160 rush yds, 12 TD; 121 rec, 955 yds | – | rushing yards ≥ 1,000 in 2008; 2,160 rushing yards in the stint | CHI 2010s, NYJ 2010s |
| Miles Austin | WR | DAL | 2006–2009 | 51 G, 99 rec, 1,674 yds, 14 TD | Pro Bowl 2009 | receiving yards ≥ 1,000 in 2009 | DAL 2010s |
| Ray Buchanan | CB | ATL | 2000–2003 | 55 G, 0 sk, 14 INT | – | def interceptions ≥ 6 in 2000; 14 def interceptions in the stint | ATL 1990s |
| Ricky Williams | RB | NO | 2000–2001 | 26 G, 2,245 rush yds, 14 TD; 104 rec, 920 yds | – | rushing yards ≥ 1,000 in 2000, 2001; 2,245 rushing yards in the stint | MIA 2000s, NO 1990s, BAL 2010s |
| Trevor Pryce | DE | BAL | 2006–2009 | 51 G, 25.5 sk, 0 INT | – | def sacks ≥ 10 in 2006; 25.5 def sacks in the stint | DEN 2000s |
| Tyrone Wheatley | RB | LV | 2000–2004 | 62 G, 2,746 rush yds, 24 TD; 71 rec, 486 yds | – | rushing yards ≥ 1,000 in 2000; 2,746 rushing yards in the stint | NYG 1990s, LV 1990s |
| Warren Sapp | DT | LV | 2004–2007 | 55 G, 19 sk, 1 INT | – | def sacks ≥ 8 in 2006; 19 def sacks in the stint | TB 1990s, TB 2000s |
| Derrick Alexander | WR | KC | 2000–2001 | 28 G, 101 rec, 1,813 yds, 13 TD | – | receiving yards ≥ 1,000 in 2000 | BAL 1990s, KC 1990s |
| Eric Allen | CB | LV | 2000–2001 | 32 G, 1 sk, 7 INT | – | def interceptions ≥ 6 in 2000 | PHI 1990s |
| Jabar Gaffney | WR | HOU | 2002–2005 | 58 G, 171 rec, 2,009 yds, 7 TD | – | 2,009 receiving yards in the stint | NE 2000s, DEN 2000s |
| Jamaal Charles | RB | KC | 2008–2009 | 31 G, 1,477 rush yds, 7 TD; 67 rec, 569 yds | – | rushing yards ≥ 1,000 in 2009 | KC 2010s, DEN 2010s |
| Jamal Anderson | RB | ATL | 2000–2001 | 19 G, 1,214 rush yds, 7 TD; 45 rec, 493 yds | – | rushing yards ≥ 1,000 in 2000 | ATL 1990s |
| James Allen | RB | CHI | 2000–2001 | 32 G, 1,589 rush yds, 3 TD; 69 rec, 494 yds | – | rushing yards ≥ 1,000 in 2000 | CHI 1990s |
| John Randle | DT | MIN | 2000 | 12 G, 8 sk, 0 INT | – | def sacks ≥ 8 in 2000 | MIN 1990s |
| Johnnie Morton | WR | DET | 2000–2001 | 32 G, 138 rec, 1,942 yds, 7 TD | – | receiving yards ≥ 1,000 in 2001 | DET 1990s |
| Jonathan Vilma | LB | NO | 2008–2009 | 31 G, 3 sk, 4 INT | Pro Bowl 2009 | honors | NYJ 2000s |
| Kellen Winslow II | TE | TB | 2009 | 16 G, 77 rec, 884 yds, 5 TD | – | receiving yards ≥ 800 in 2009 | CLE 2000s |
| Kerry Collins | QB | LV | 2004–2005 | 29 G, 7,254 pass yds, 41 TD, 33 INT | – | 7,254 passing yards in the stint | CAR 1990s, NYG 2000s, TEN 2000s |
| London Fletcher | LB | WAS | 2007–2009 | 48 G, 2.5 sk, 4 INT | Pro Bowl 2009 | honors | BUF 2000s |
| Mark Brunell | QB | JAX | 2000–2003 | 49 G, 10,221 pass yds, 58 TD, 34 INT | – | 10,221 passing yards in the stint | JAX 1990s, GB 1990s, WAS 2000s, NO 2000s |
| Muhsin Muhammad | WR | CHI | 2005–2007 | 46 G, 164 rec, 2,183 yds, 12 TD | – | 2,183 receiving yards in the stint | CAR 2000s, CAR 1990s |
| Qadry Ismail | WR | BAL | 2000–2001 | 31 G, 123 rec, 1,714 yds, 12 TD | – | receiving yards ≥ 1,000 in 2001 | MIN 1990s |
| Reuben Droughns | RB | DEN | 2002–2004 | 43 G, 1,265 rush yds, 7 TD; 46 rec, 381 yds | – | rushing yards ≥ 1,000 in 2004 | CLE 2000s |
| Ricky Watters | RB | SEA | 2000–2001 | 21 G, 1,560 rush yds, 8 TD; 74 rec, 720 yds | – | rushing yards ≥ 1,000 in 2000 | SF 1990s, PHI 1990s, SEA 1990s |
| Ted Washington | DT | BUF | 2000 | 15 G, 2.5 sk, 0 INT | Pro Bowl 2000 | honors | BUF 1990s |
| Terrell Buckley | CB | DEN | 2000 | 15 G, 0 sk, 6 INT | – | def interceptions ≥ 6 in 2000 | GB 1990s |
| Vinny Testaverde | QB | NYJ | 2000–2005 | 50 G, 9,145 pass yds, 47 TD, 50 INT | – | 9,145 passing yards in the stint | TB 1980s, NYJ 1990s, CLE 1990s, TB 1990s, DAL 2000s, BAL 1990s |
| Wayne Chrebet | WR | NYJ | 2000–2005 | 73 G, 249 rec, 3,217 yds, 20 TD | – | 3,217 receiving yards in the stint | NYJ 1990s |
| Willie Jackson | WR | NO | 2000–2001 | 31 G, 118 rec, 1,569 yds, 11 TD | – | receiving yards ≥ 1,000 in 2001 | JAX 1990s |

### 2010s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| Cameron Heyward | DT | PIT | 2011–2019 | 120 G, 54 sk, 0 INT | All-Pro 2017, All-Pro 2019, Pro Bowl 2017, Pro Bowl 2018, Pro Bowl 2019 | def sacks ≥ 8 in 2017, 2018, 2019; 54 def sacks in the stint | PIT 2020s |
| DeMarcus Ware | LB | DAL | 2010–2013 | 61 G, 52.5 sk, 1 INT | All-Pro 2011, 2nd-team All-Pro 2010, 2nd-team All-Pro 2012, Pro Bowl 2010, Pro Bowl 2011, Pro Bowl 2012 | def sacks ≥ 10 in 2010, 2011, 2012; 52.5 def sacks in the stint | DAL 2000s |
| Troy Polamalu | S | PIT | 2010–2014 | 65 G, 5 sk, 12 INT | All-Pro 2010, All-Pro 2011, Pro Bowl 2010, Pro Bowl 2011, Pro Bowl 2013 | def interceptions ≥ 6 in 2010; 12 def interceptions in the stint | PIT 2000s |
| Calais Campbell | DE | JAX | 2017–2019 | 48 G, 31.5 sk, 0 INT | All-Pro 2017, 2nd-team All-Pro 2017, Pro Bowl 2017, Pro Bowl 2018, Pro Bowl 2019 | def sacks ≥ 10 in 2017, 2018; 31.5 def sacks in the stint | ARI 2010s, BAL 2020s |
| Ed Reed | S | BAL | 2010–2012 | 41 G, 1 sk, 15 INT | All-Pro 2010, 2nd-team All-Pro 2011, Pro Bowl 2010, Pro Bowl 2011, Pro Bowl 2012 | def interceptions ≥ 6 in 2010; 15 def interceptions in the stint | BAL 2000s |
| Charles Woodson | CB | GB | 2010–2012 | 38 G, 5.5 sk, 10 INT | All-Pro 2011, 2nd-team All-Pro 2010, Pro Bowl 2010, Pro Bowl 2011 | def interceptions ≥ 6 in 2011; 10 def interceptions in the stint | GB 2000s, LV 1990s, LV 2000s |
| Mario Williams | DE | BUF | 2012–2015 | 59 G, 43 sk, 0 INT | All-Pro 2014, 2nd-team All-Pro 2013, Pro Bowl 2013, Pro Bowl 2014 | def sacks ≥ 10 in 2012, 2013, 2014; 43 def sacks in the stint | HOU 2000s |
| T.J. Watt | DE | PIT | 2017–2019 | 47 G, 34.5 sk, 3 INT | All-Pro 2019, 2nd-team All-Pro 2019, Pro Bowl 2018, Pro Bowl 2019 | def sacks ≥ 10 in 2018, 2019; 34.5 def sacks in the stint | PIT 2020s |
| London Fletcher | LB | WAS | 2010–2013 | 64 G, 9 sk, 8 INT | 2nd-team All-Pro 2011, 2nd-team All-Pro 2012, Pro Bowl 2010, Pro Bowl 2011, Pro Bowl 2012 | def interceptions ≥ 5 in 2012; 8 def interceptions in the stint | BUF 2000s |
| Robert Mathis | DE | IND | 2010–2016 | 85 G, 60 sk, 1 INT | All-Pro 2013, Pro Bowl 2010, Pro Bowl 2012, Pro Bowl 2013 | def sacks ≥ 10 in 2010, 2013; 60 def sacks in the stint | IND 2000s |
| Jared Allen | DE | MIN | 2010–2013 | 63 G, 56.5 sk, 3 INT | All-Pro 2011, Pro Bowl 2011, Pro Bowl 2012 | def sacks ≥ 10 in 2010, 2011, 2012, 2013; 56.5 def sacks in the stint | KC 2000s |
| Khalil Mack | LB | CHI | 2018–2019 | 28 G, 21 sk, 1 INT | All-Pro 2018, Pro Bowl 2018, Pro Bowl 2019 | def sacks ≥ 10 in 2018; 21 def sacks in the stint | LV 2010s |
| Jalen Ramsey | CB | JAX | 2016–2019 | 51 G, 0 sk, 9 INT | All-Pro 2017, Pro Bowl 2017, Pro Bowl 2018, Pro Bowl 2019 | honors | LAR 2020s |
| John Abraham | DE | ATL | 2010–2012 | 46 G, 32.5 sk, 1 INT | All-Pro 2010, Pro Bowl 2010 | def sacks ≥ 10 in 2010, 2012; 32.5 def sacks in the stint | ATL 2000s |
| Danielle Hunter | DE | MIN | 2015–2019 | 77 G, 54.5 sk, 0 INT | 2nd-team All-Pro 2018, Pro Bowl 2018, Pro Bowl 2019 | def sacks ≥ 10 in 2016, 2018, 2019; 54.5 def sacks in the stint | MIN 2020s |
| Derwin James | S | LAC | 2018–2019 | 21 G, 3.5 sk, 3 INT | All-Pro 2018, 2nd-team All-Pro 2018, Pro Bowl 2018 | honors | LAC 2020s |
| Budda Baker | S | ARI | 2017–2019 | 46 G, 3.5 sk, 0 INT | All-Pro 2017, Pro Bowl 2017, Pro Bowl 2019 | honors | ARI 2020s |
| Eric Weddle | S | BAL | 2016–2018 | 48 G, 3 sk, 10 INT | Pro Bowl 2016, Pro Bowl 2017, Pro Bowl 2018 | def interceptions ≥ 6 in 2017; 10 def interceptions in the stint | LAC 2010s |
| Champ Bailey | CB | DEN | 2010–2013 | 47 G, 1 sk, 6 INT | 2nd-team All-Pro 2012, Pro Bowl 2010, Pro Bowl 2011, Pro Bowl 2012 | honors | DEN 2000s |
| Chris Jones | DT | KC | 2016–2019 | 58 G, 33 sk, 2 INT | 2nd-team All-Pro 2018, Pro Bowl 2019 | def sacks ≥ 8 in 2018, 2019; 33 def sacks in the stint | KC 2020s |
| DeForest Buckner | DT | SF | 2016–2019 | 62 G, 28.5 sk, 0 INT | 2nd-team All-Pro 2019, Pro Bowl 2018 | def sacks ≥ 8 in 2018; 28.5 def sacks in the stint | IND 2020s |
| Justin Tuck | DE | NYG | 2010–2013 | 58 G, 31.5 sk, 1 INT | 2nd-team All-Pro 2010, Pro Bowl 2010 | def sacks ≥ 10 in 2010, 2013; 31.5 def sacks in the stint | NYG 2000s |
| Myles Garrett | DE | CLE | 2017–2019 | 37 G, 30.5 sk, 0 INT | 2nd-team All-Pro 2018, Pro Bowl 2018 | def sacks ≥ 10 in 2018, 2019; 30.5 def sacks in the stint | CLE 2020s |
| Tyrann Mathieu | S | KC | 2019 | 16 G, 2 sk, 4 INT | All-Pro 2019, 2nd-team All-Pro 2019 | honors | ARI 2010s |
| Xavien Howard | CB | MIA | 2016–2019 | 40 G, 1 sk, 12 INT | 2nd-team All-Pro 2018, Pro Bowl 2018 | def interceptions ≥ 6 in 2018; 12 def interceptions in the stint | MIA 2020s |
| Darrelle Revis | CB | NE | 2014 | 15 G, 0 sk, 2 INT | All-Pro 2014, Pro Bowl 2014 | honors | NYJ 2000s, NYJ 2010s |
| DeMarcus Ware | LB | DEN | 2014–2016 | 33 G, 21.5 sk, 1 INT | Pro Bowl 2014, Pro Bowl 2015 | def sacks ≥ 10 in 2014; 21.5 def sacks in the stint | DAL 2000s |
| Dwight Freeney | DE | IND | 2010–2012 | 39 G, 23.5 sk, 0 INT | Pro Bowl 2010, Pro Bowl 2011 | def sacks ≥ 10 in 2010; 23.5 def sacks in the stint | IND 2000s |
| Jarvis Landry | WR | CLE | 2018–2019 | 32 G, 164 rec, 2,150 yds, 10 TD | Pro Bowl 2018, Pro Bowl 2019 | receiving yards ≥ 1,000 in 2019; 2,150 receiving yards in the stint | MIA 2010s |
| Marlon Humphrey | CB | BAL | 2017–2019 | 43 G, 0 sk, 7 INT | All-Pro 2019, Pro Bowl 2019 | honors | BAL 2020s |
| Minkah Fitzpatrick | S | PIT | 2019 | 14 G, 0 sk, 5 INT | All-Pro 2019, Pro Bowl 2019 | honors | PIT 2020s |
| Minkah Fitzpatrick | S | MIA | 2018–2019 | 18 G, 0 sk, 2 INT | All-Pro 2019, Pro Bowl 2019 | honors | PIT 2020s |
| Nnamdi Asomugha | CB | LV | 2010 | 11 G, 0 sk, 0 INT | All-Pro 2010, Pro Bowl 2010 | honors | LV 2000s |
| Brandon Lloyd | WR | DEN | 2010–2011 | 20 G, 96 rec, 1,731 yds, 11 TD | 2nd-team All-Pro 2010, Pro Bowl 2010 | receiving yards ≥ 1,000 in 2010 | SF 2000s, WAS 2000s, DEN 2000s |
| Brian Urlacher | LB | CHI | 2010–2012 | 44 G, 3.5 sk, 5 INT | 2nd-team All-Pro 2010, Pro Bowl 2010, Pro Bowl 2011 | honors | CHI 2000s |
| Charles Woodson | CB | LV | 2013–2015 | 48 G, 3 sk, 10 INT | 2nd-team All-Pro 2015, Pro Bowl 2015 | 10 def interceptions in the stint | GB 2000s, LV 1990s, LV 2000s |
| Osi Umenyiora | DE | NYG | 2010–2012 | 40 G, 26.5 sk, 0 INT | 2nd-team All-Pro 2010 | def sacks ≥ 10 in 2010; 26.5 def sacks in the stint | NYG 2000s |
| Ray Lewis | LB | BAL | 2010–2012 | 34 G, 5 sk, 3 INT | 2nd-team All-Pro 2010, Pro Bowl 2010, Pro Bowl 2011 | honors | BAL 2000s |
| Richard Seymour | DE | LV | 2010–2012 | 35 G, 14 sk, 0 INT | 2nd-team All-Pro 2011, Pro Bowl 2010, Pro Bowl 2011 | honors | NE 2000s |
| Shaquil Barrett | LB | TB | 2019 | 16 G, 19.5 sk, 1 INT | 2nd-team All-Pro 2019, Pro Bowl 2019 | def sacks ≥ 10 in 2019 | TB 2020s |
| Asante Samuel | CB | PHI | 2010–2011 | 24 G, 0 sk, 10 INT | Pro Bowl 2010 | def interceptions ≥ 6 in 2010; 10 def interceptions in the stint | NE 2000s |
| Chandler Jones | DE | NE | 2012–2015 | 53 G, 36 sk, 1 INT | Pro Bowl 2015 | def sacks ≥ 10 in 2013, 2015; 36 def sacks in the stint | ARI 2010s |
| Julius Peppers | DE | GB | 2014–2016 | 46 G, 25 sk, 2 INT | Pro Bowl 2015 | def sacks ≥ 10 in 2015; 25 def sacks in the stint | CAR 2000s, CHI 2010s |
| Nick Chubb | RB | CLE | 2018–2019 | 32 G, 2,490 rush yds, 16 TD; 56 rec, 427 yds | Pro Bowl 2019 | rushing yards ≥ 1,000 in 2019; 2,490 rushing yards in the stint | CLE 2020s |
| Aqib Talib | CB | NE | 2012–2013 | 18 G, 0 sk, 5 INT | 2nd-team All-Pro 2013, Pro Bowl 2013 | honors | DEN 2010s |
| Ndamukong Suh | DT | MIA | 2015–2017 | 48 G, 15.5 sk, 0 INT | 2nd-team All-Pro 2016, Pro Bowl 2016 | honors | DET 2010s |
| Richard Sherman | CB | SF | 2018–2019 | 26 G, 1 sk, 3 INT | 2nd-team All-Pro 2019, Pro Bowl 2019 | honors | SEA 2010s |
| Adrian Wilson | S | ARI | 2010–2012 | 46 G, 5 sk, 4 INT | Pro Bowl 2010, Pro Bowl 2011 | honors | ARI 2000s |
| Cedric Benson | RB | CIN | 2010–2011 | 31 G, 2,178 rush yds, 13 TD; 43 rec, 260 yds | – | rushing yards ≥ 1,000 in 2010, 2011; 2,178 rushing yards in the stint | CIN 2000s, CHI 2000s, GB 2010s |
| DJ Chark | WR | JAX | 2018–2019 | 26 G, 87 rec, 1,182 yds, 8 TD | Pro Bowl 2019 | receiving yards ≥ 1,000 in 2019 | JAX 2020s |
| John Abraham | DE | ARI | 2013–2014 | 14 G, 11.5 sk, 0 INT | Pro Bowl 2013 | def sacks ≥ 10 in 2013 | ATL 2000s |
| Josh Allen | DE | JAX | 2019 | 16 G, 10.5 sk, 0 INT | Pro Bowl 2019 | def sacks ≥ 10 in 2019 | JAX 2020s |
| Lance Briggs | LB | CHI | 2010–2014 | 63 G, 6.5 sk, 6 INT | Pro Bowl 2010, Pro Bowl 2011 | honors | CHI 2000s |
| Lance Moore | WR | NO | 2010–2013 | 57 G, 220 rec, 2,888 yds, 24 TD | – | receiving yards ≥ 1,000 in 2012; 2,888 receiving yards in the stint | NO 2000s, PIT 2010s |
| Mark Andrews | TE | BAL | 2018–2019 | 31 G, 98 rec, 1,404 yds, 13 TD | Pro Bowl 2019 | receiving yards ≥ 800 in 2019 | BAL 2020s |
| Matthew Judon | LB | BAL | 2016–2019 | 62 G, 28.5 sk, 0 INT | Pro Bowl 2019 | 28.5 def sacks in the stint | BAL 2020s |
| Peyton Manning | QB | IND | 2010–2011 | 16 G, 4,700 pass yds, 33 TD, 17 INT | Pro Bowl 2010 | passing yards ≥ 4,000 in 2010 | IND 2000s, DEN 2010s |
| Santana Moss | WR | WAS | 2010–2014 | 65 G, 232 rec, 2,840 yds, 20 TD | – | receiving yards ≥ 1,000 in 2010; 2,840 receiving yards in the stint | NYJ 2000s, WAS 2000s |
| Stephon Gilmore | CB | BUF | 2012–2016 | 68 G, 0 sk, 14 INT | Pro Bowl 2016 | 14 def interceptions in the stint | NE 2010s |
| Vincent Jackson | WR | LAC | 2010–2011 | 20 G, 74 rec, 1,354 yds, 12 TD | Pro Bowl 2011 | receiving yards ≥ 1,000 in 2011 | LAC 2000s, TB 2010s |
| Diontae Johnson | WR | PIT | 2019 | 16 G, 59 rec, 680 yds, 5 TD | 2nd-team All-Pro 2019 | honors | PIT 2020s, CAR 2020s |
| Karlos Dansby | LB | ARI | 2013–2017 | 32 G, 7.5 sk, 5 INT | 2nd-team All-Pro 2013 | honors | ARI 2000s |
| Malcolm Jenkins | S | NO | 2010–2013 | 56 G, 4.5 sk, 5 INT | 2nd-team All-Pro 2010 | honors | PHI 2010s |
| Alex Smith | QB | SF | 2010–2012 | 37 G, 7,251 pass yds, 44 TD, 20 INT | – | 7,251 passing yards in the stint | KC 2010s, SF 2000s |
| Alshon Jeffery | WR | PHI | 2017–2019 | 38 G, 165 rec, 2,122 yds, 19 TD | – | 2,122 receiving yards in the stint | CHI 2010s |
| Antoine Winfield | CB | MIN | 2010–2012 | 36 G, 3.5 sk, 6 INT | Pro Bowl 2010 | honors | MIN 2000s |
| Aqib Talib | CB | TB | 2010–2012 | 27 G, 0 sk, 9 INT | – | def interceptions ≥ 6 in 2010 | DEN 2010s |
| Beanie Wells | RB | ARI | 2010–2012 | 35 G, 1,678 rush yds, 17 TD; 16 rec, 150 yds | – | rushing yards ≥ 1,000 in 2011 | ARI 2000s |
| Ben Watson | TE | CLE | 2010–2012 | 45 G, 154 rec, 1,674 yds, 8 TD | – | 1,674 receiving yards in the stint | NE 2000s, NO 2010s, BAL 2010s |
| Brandon LaFell | WR | CAR | 2010–2013 | 57 G, 167 rec, 2,385 yds, 13 TD | – | 2,385 receiving yards in the stint | NE 2010s |
| Brian Dawkins | S | DEN | 2010–2011 | 25 G, 5 sk, 1 INT | Pro Bowl 2011 | honors | PHI 2000s |
| Carlos Hyde | RB | HOU | 2019 | 16 G, 1,070 rush yds, 6 TD; 10 rec, 42 yds | – | rushing yards ≥ 1,000 in 2019 | SF 2010s, CLE 2010s |
| Casey Hayward | CB | GB | 2012–2015 | 48 G, 0 sk, 9 INT | – | def interceptions ≥ 6 in 2012 | LAC 2010s |
| Chris Cooley | TE | WAS | 2010–2012 | 24 G, 86 rec, 922 yds, 3 TD | – | receiving yards ≥ 800 in 2010 | WAS 2000s |
| Courtland Sutton | WR | DEN | 2018–2019 | 32 G, 114 rec, 1,816 yds, 10 TD | – | receiving yards ≥ 1,000 in 2019 | DEN 2020s |
| Darrelle Revis | CB | TB | 2013 | 16 G, 1 sk, 2 INT | Pro Bowl 2013 | honors | NYJ 2000s, NYJ 2010s |
| Darren Waller | TE | LV | 2018–2019 | 20 G, 96 rec, 1,220 yds, 3 TD | – | receiving yards ≥ 800 in 2019 | LV 2020s |
| DeAngelo Williams | RB | CAR | 2010–2014 | 59 G, 2,996 rush yds, 16 TD; 71 rec, 760 yds | – | 2,996 rushing yards in the stint | CAR 2000s, PIT 2010s |
| Earl Thomas | S | BAL | 2019 | 15 G, 2 sk, 2 INT | Pro Bowl 2019 | honors | SEA 2010s |
| Jalen Ramsey | CB | LAR | 2019 | 8 G, 0 sk, 1 INT | Pro Bowl 2019 | honors | LAR 2020s |
| Joe Haden | CB | PIT | 2017–2019 | 41 G, 1 sk, 8 INT | Pro Bowl 2019 | honors | CLE 2010s |
| John Brown | WR | BUF | 2019 | 15 G, 72 rec, 1,060 yds, 6 TD | – | receiving yards ≥ 1,000 in 2019 | ARI 2010s, BAL 2010s |
| Jonathan Vilma | LB | NO | 2010–2013 | 39 G, 5 sk, 2 INT | Pro Bowl 2010 | honors | NYJ 2000s |
| Josh Jacobs | RB | LV | 2019 | 13 G, 1,150 rush yds, 7 TD; 20 rec, 166 yds | – | rushing yards ≥ 1,000 in 2019 | LV 2020s, GB 2020s |
| Julius Peppers | DE | CAR | 2017–2018 | 30 G, 16 sk, 0 INT | – | def sacks ≥ 10 in 2017 | CAR 2000s, CHI 2010s |
| Justin Houston | LB | IND | 2019 | 16 G, 11 sk, 0 INT | – | def sacks ≥ 10 in 2019 | KC 2010s |
| Kevin Williams | DT | MIN | 2010–2013 | 58 G, 11.5 sk, 1 INT | Pro Bowl 2010 | honors | MIN 2000s |
| Maxx Crosby | DE | LV | 2019 | 16 G, 10 sk, 0 INT | – | def sacks ≥ 10 in 2019 | LV 2020s |
| Michael Gallup | WR | DAL | 2018–2019 | 29 G, 99 rec, 1,614 yds, 8 TD | – | receiving yards ≥ 1,000 in 2019 | DAL 2020s |
| Nate Burleson | WR | DET | 2010–2013 | 45 G, 195 rec, 2,097 yds, 12 TD | – | 2,097 receiving yards in the stint | MIN 2000s, SEA 2000s |
| Nick Bosa | DE | SF | 2019 | 16 G, 9 sk, 1 INT | Pro Bowl 2019 | honors | SF 2020s |
| Odell Beckham Jr. | WR | CLE | 2019 | 16 G, 74 rec, 1,035 yds, 4 TD | – | receiving yards ≥ 1,000 in 2019 | NYG 2010s |
| Robert Quinn | DE | DAL | 2019 | 13 G, 11.5 sk, 0 INT | – | def sacks ≥ 10 in 2019 | LAR 2010s |
| Robert Woods | WR | BUF | 2013–2016 | 57 G, 203 rec, 2,451 yds, 12 TD | – | 2,451 receiving yards in the stint | LAR 2010s, TEN 2020s |
| Ronde Barber | CB | TB | 2010–2012 | 48 G, 3 sk, 10 INT | – | 10 def interceptions in the stint | TB 2000s |
| Santonio Holmes | WR | NYJ | 2010–2013 | 42 G, 146 rec, 2,128 yds, 16 TD | – | 2,128 receiving yards in the stint | PIT 2000s |
| Tremaine Edmunds | LB | BUF | 2018–2019 | 31 G, 3.5 sk, 3 INT | Pro Bowl 2019 | honors | BUF 2020s |
| Zach Miller | TE | LV | 2010 | 15 G, 60 rec, 685 yds, 5 TD | Pro Bowl 2010 | honors | SEA 2010s, LV 2000s |

### 2020s

| Player | Pos | Team | Seasons | Line (nflverse, REG) | Honors in the stint | Flagged by | Rated stints |
|---|---|---|---|---|---|---|---|
| Demario Davis | LB | NO | 2020–2025 | 99 G, 22.5 sk, 2 INT | 2nd-team All-Pro 2020, 2nd-team All-Pro 2021, 2nd-team All-Pro 2022, 2nd-team All-Pro 2023, Pro Bowl 2022, Pro Bowl 2023 | 22.5 def sacks in the stint | NO 2010s |
| Roquan Smith | LB | CHI | 2020–2022 | 41 G, 9.5 sk, 5 INT | All-Pro 2022, 2nd-team All-Pro 2020, 2nd-team All-Pro 2021, Pro Bowl 2022 | honors | BAL 2020s |
| Tyrann Mathieu | S | KC | 2020–2021 | 31 G, 1 sk, 9 INT | All-Pro 2020, Pro Bowl 2020, Pro Bowl 2021 | def interceptions ≥ 6 in 2020 | ARI 2010s |
| Dalvin Cook | RB | MIN | 2020–2022 | 44 G, 3,889 rush yds, 30 TD; 117 rec, 880 yds | Pro Bowl 2020, Pro Bowl 2021, Pro Bowl 2022 | rushing yards ≥ 1,000 in 2020, 2021, 2022; 3,889 rushing yards in the stint | MIN 2010s |
| Joey Bosa | DE | LAC | 2020–2024 | 53 G, 32 sk, 0 INT | Pro Bowl 2020, Pro Bowl 2021, Pro Bowl 2024 | def sacks ≥ 10 in 2021; 32 def sacks in the stint | LAC 2010s |
| Khalil Mack | LB | LAC | 2022–2025 | 61 G, 36.5 sk, 0 INT | Pro Bowl 2022, Pro Bowl 2023, Pro Bowl 2024 | def sacks ≥ 10 in 2023; 36.5 def sacks in the stint | LV 2010s |
| Micah Parsons | LB | GB | 2025 | 14 G, 12.5 sk, 0 INT | All-Pro 2025, Pro Bowl 2025 | def sacks ≥ 10 in 2025 | DAL 2020s |
| Brian Burns | DE | NYG | 2024–2025 | 34 G, 25 sk, 0 INT | 2nd-team All-Pro 2025, Pro Bowl 2025 | def sacks ≥ 10 in 2025; 25 def sacks in the stint | CAR 2020s |
| Danielle Hunter | DE | HOU | 2024–2025 | 32 G, 27 sk, 0 INT | 2nd-team All-Pro 2025, Pro Bowl 2024 | def sacks ≥ 10 in 2024, 2025; 27 def sacks in the stint | MIN 2020s |
| Robert Quinn | DE | CHI | 2020–2022 | 36 G, 21.5 sk, 0 INT | 2nd-team All-Pro 2021, Pro Bowl 2021 | def sacks ≥ 10 in 2021; 21.5 def sacks in the stint | LAR 2010s |
| Matthew Judon | LB | NE | 2021–2023 | 36 G, 32 sk, 0 INT | Pro Bowl 2021, Pro Bowl 2022 | def sacks ≥ 10 in 2021, 2022; 32 def sacks in the stint | BAL 2020s |
| Derek Carr | QB | LV | 2020–2022 | 48 G, 12,429 pass yds, 74 TD, 37 INT | Pro Bowl 2022 | passing yards ≥ 4,000 in 2020, 2021; 12,429 passing yards in the stint | LV 2010s, NO 2020s |
| Bobby Wagner | LB | WAS | 2024–2025 | 34 G, 6.5 sk, 2 INT | 2nd-team All-Pro 2024, Pro Bowl 2024 | honors | SEA 2010s, SEA 2020s |
| C.J. Mosley | LB | NYJ | 2020–2024 | 54 G, 3.5 sk, 2 INT | 2nd-team All-Pro 2022, Pro Bowl 2022 | honors | BAL 2010s |
| Jamal Adams | S | SEA | 2020–2023 | 34 G, 9.5 sk, 2 INT | 2nd-team All-Pro 2020, Pro Bowl 2020 | honors | NYJ 2010s |
| Khalil Mack | LB | CHI | 2020–2021 | 22 G, 15 sk, 1 INT | 2nd-team All-Pro 2020, Pro Bowl 2020 | honors | LV 2010s |
| Lavonte David | LB | TB | 2020–2025 | 94 G, 20 sk, 3 INT | 2nd-team All-Pro 2020 | 20 def sacks in the stint | TB 2010s |
| Chandler Jones | DE | ARI | 2020–2021 | 20 G, 11.5 sk, 0 INT | Pro Bowl 2021 | def sacks ≥ 10 in 2021 | ARI 2010s |
| D'Andre Swift | RB | PHI | 2023 | 16 G, 1,049 rush yds, 5 TD; 39 rec, 214 yds | Pro Bowl 2023 | rushing yards ≥ 1,000 in 2023 | DET 2020s, CHI 2020s |
| Dalton Schultz | TE | DAL | 2020–2022 | 48 G, 198 rec, 2,000 yds, 17 TD | – | receiving yards ≥ 800 in 2021; 2,000 receiving yards in the stint | HOU 2020s |
| David Montgomery | RB | CHI | 2020–2022 | 44 G, 2,720 rush yds, 20 TD; 130 rec, 1,055 yds | – | rushing yards ≥ 1,000 in 2020; 2,720 rushing yards in the stint | DET 2020s |
| Deshaun Watson | QB | HOU | 2020–2021 | 16 G, 4,823 pass yds, 33 TD, 7 INT | Pro Bowl 2020 | passing yards ≥ 4,000 in 2020 | HOU 2010s, CLE 2020s |
| DJ Moore | WR | CAR | 2020–2022 | 49 G, 222 rec, 3,238 yds, 15 TD | – | receiving yards ≥ 1,000 in 2020, 2021; 3,238 receiving yards in the stint | CHI 2020s, CAR 2010s |
| Fletcher Cox | DT | PHI | 2020–2023 | 59 G, 22 sk, 0 INT | Pro Bowl 2020 | 22 def sacks in the stint | PHI 2010s |
| George Pickens | WR | PIT | 2022–2024 | 48 G, 174 rec, 2,841 yds, 12 TD | – | receiving yards ≥ 1,000 in 2023; 2,841 receiving yards in the stint | DAL 2020s |
| Harrison Smith | S | MIN | 2020–2025 | 92 G, 8.5 sk, 16 INT | Pro Bowl 2021 | 16 def interceptions in the stint | MIN 2010s |
| Jonathan Greenard | DE | HOU | 2020–2023 | 38 G, 23 sk, 1 INT | – | def sacks ≥ 10 in 2023; 23 def sacks in the stint | MIN 2020s |
| Marshon Lattimore | CB | NO | 2020–2024 | 53 G, 0 sk, 7 INT | Pro Bowl 2020, Pro Bowl 2021 | honors | NO 2010s |
| Montez Sweat | DE | WAS | 2020–2023 | 50 G, 28.5 sk, 1 INT | Pro Bowl 2023 | 28.5 def sacks in the stint | CHI 2020s |
| Sam Darnold | QB | MIN | 2024 | 17 G, 4,319 pass yds, 35 TD, 12 INT | Pro Bowl 2024 | passing yards ≥ 4,000 in 2024 | SEA 2020s, NYJ 2020s |
| Bobby Wagner | LB | LAR | 2022 | 17 G, 6 sk, 2 INT | 2nd-team All-Pro 2022 | honors | SEA 2010s, SEA 2020s |
| Allen Robinson | WR | CHI | 2020–2021 | 28 G, 140 rec, 1,660 yds, 7 TD | – | receiving yards ≥ 1,000 in 2020 | JAX 2010s, CHI 2010s |
| Amari Cooper | WR | DAL | 2020–2021 | 31 G, 160 rec, 1,979 yds, 13 TD | – | receiving yards ≥ 1,000 in 2020 | LV 2010s, DAL 2010s, CLE 2020s |
| Christian McCaffrey | RB | CAR | 2020–2022 | 16 G, 1,060 rush yds, 8 TD; 87 rec, 769 yds | Pro Bowl 2022 | honors | CAR 2010s, SF 2020s |
| Demarcus Lawrence | DE | SEA | 2025 | 16 G, 6 sk, 0 INT | Pro Bowl 2025 | honors | DAL 2010s, DAL 2020s |
| Devin Singletary | RB | BUF | 2020–2022 | 49 G, 2,376 rush yds, 14 TD; 116 rec, 777 yds | – | 2,376 rushing yards in the stint | NYG 2020s, BUF 2010s, HOU 2020s |
| Evan Engram | TE | NYG | 2020–2021 | 31 G, 109 rec, 1,062 yds, 4 TD | Pro Bowl 2020 | honors | JAX 2020s, NYG 2010s |
| Grady Jarrett | DT | ATL | 2020–2024 | 73 G, 15 sk, 0 INT | Pro Bowl 2020 | honors | ATL 2010s |
| Haason Reddick | LB | ARI | 2020 | 16 G, 12.5 sk, 0 INT | – | def sacks ≥ 10 in 2020 | PHI 2020s |
| Haason Reddick | LB | CAR | 2021 | 16 G, 11 sk, 0 INT | – | def sacks ≥ 10 in 2021 | PHI 2020s |
| Hollywood Brown | WR | BAL | 2020–2021 | 32 G, 149 rec, 1,777 yds, 14 TD | – | receiving yards ≥ 1,000 in 2021 | ARI 2020s, KC 2020s |
| J.J. Watt | DE | ARI | 2021–2022 | 23 G, 13.5 sk, 0 INT | – | def sacks ≥ 10 in 2022 | HOU 2010s |
| Jakobi Meyers | WR | NE | 2020–2022 | 42 G, 209 rec, 2,399 yds, 8 TD | – | 2,399 receiving yards in the stint | LV 2020s |
| Jalen Ramsey | CB | PIT | 2025 | 17 G, 3 sk, 1 INT | Pro Bowl 2025 | honors | LAR 2020s |
| Jalen Ramsey | CB | MIA | 2023–2024 | 27 G, 1 sk, 5 INT | Pro Bowl 2023 | honors | LAR 2020s |
| Jamaal Williams | RB | DET | 2021–2022 | 30 G, 1,667 rush yds, 20 TD; 38 rec, 230 yds | – | rushing yards ≥ 1,000 in 2022 | GB 2010s, NO 2020s |
| Javonte Williams | RB | DAL | 2025 | 16 G, 1,201 rush yds, 11 TD; 35 rec, 137 yds | – | rushing yards ≥ 1,000 in 2025 | DEN 2020s |
| Joe Flacco | QB | CIN | 2025 | 9 G, 1,664 pass yds, 13 TD, 4 INT | Pro Bowl 2025 | honors | BAL 2010s, CLE 2020s, DEN 2010s |
| Matthew Stafford | QB | DET | 2020 | 16 G, 4,084 pass yds, 26 TD, 10 INT | – | passing yards ≥ 4,000 in 2020 | LAR 2020s, DET 2010s |
| Melvin Gordon | RB | DEN | 2020–2022 | 41 G, 2,222 rush yds, 19 TD; 85 rec, 594 yds | – | 2,222 rushing yards in the stint | LAC 2010s |
| Mike Gesicki | TE | MIA | 2020–2022 | 49 G, 158 rec, 1,845 yds, 13 TD | – | 1,845 receiving yards in the stint | CIN 2020s, MIA 2010s, NE 2020s |
| Philip Rivers | QB | IND | 2020–2025 | 19 G, 4,713 pass yds, 28 TD, 14 INT | – | passing yards ≥ 4,000 in 2020 | LAC 2010s, LAC 2000s |
| Quinnen Williams | DT | DAL | 2025 | 7 G, 1.5 sk, 1 INT | Pro Bowl 2025 | honors | NYJ 2020s |
| Robby Anderson | WR | CAR | 2020–2022 | 38 G, 161 rec, 1,821 yds, 9 TD | – | receiving yards ≥ 1,000 in 2020 | NYJ 2010s |
| Stephon Gilmore | CB | NE | 2020 | 11 G, 0 sk, 1 INT | Pro Bowl 2020 | honors | NE 2010s |
| Stephon Gilmore | CB | CAR | 2021 | 7 G, 0 sk, 2 INT | Pro Bowl 2021 | honors | NE 2010s |
| Tremaine Edmunds | LB | CHI | 2023–2025 | 45 G, 2 sk, 9 INT | – | 9 def interceptions in the stint | BUF 2020s |
| Trey Hendrickson | DE | NO | 2020 | 14 G, 13.5 sk, 0 INT | – | def sacks ≥ 10 in 2020 | CIN 2020s |
| Tyrann Mathieu | S | NO | 2022–2024 | 51 G, 1 sk, 10 INT | – | 10 def interceptions in the stint | ARI 2010s |
| Yannick Ngakoue | DE | LV | 2021 | 14 G, 10 sk, 0 INT | – | def sacks ≥ 10 in 2021 | JAX 2010s |

<!-- END tools/augment/stint-audit.ts -->
