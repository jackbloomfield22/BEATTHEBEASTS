# Credits and licenses

Beat the Beasts 3D is made by **Comfortable Cave Interactive**.

Every third-party asset, dataset, font and bundled resource used by the game, with its license. Code libraries are listed separately in `package.json`; notable ones that ship runtime assets are listed here too.

## Fonts

| Asset | Source | License |
|---|---|---|
| Bungee | Google Fonts, via the `@fontsource/bungee` npm package | SIL Open Font License 1.1 (also rasterized at runtime into the jersey number and name atlas, `src/render/players/glyphAtlas.ts`) |
| Inter (variable) | rsms/inter, via `@fontsource-variable/inter` | SIL Open Font License 1.1 |

## Runtime libraries

| Library | License |
|---|---|
| three.js | MIT |
| @react-three/fiber, @react-three/drei, @react-three/postprocessing, postprocessing | MIT |
| N8AO | CC0 1.0 |
| React, Zustand, Motion | MIT |

## Data

| Dataset | Source | License | Used for |
|---|---|---|---|
| Legacy player, defense and unit data | `legacy/beat-the-beasts.jsx` (the project's own earlier game) | Project-owned | All ported data |
| nflverse rosters 1960–2025 (`rosters/roster_<year>.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/rosters) | CC-BY-4.0 | Seasons per stint, height, weight, birth date, OL linemen per unit, person matching (`data/augment/`); jersey numbers per stint (`data/augment/jerseys.json`, M6) |
| nflverse players (`players/players.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/players) | CC-BY-4.0 | Person ids (GSIS/PFR), body data fallback |
| nflverse weekly player stats 1999–2025 (`stats_player/stats_player_week_<year>.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/stats_player) | CC-BY-4.0 | Games per stint, offensive and defensive regular-season totals, league era baselines 1999+; passing air yards 2006+ per QB stint and per season (`data/augment/arm_strength.json`, `tools/augment/arm.ts`) |
| nflverse combine (`combine/combine.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/combine) | CC-BY-4.0 | 40-yard dash, bench, vertical, broad jump, cone, shuttle (2000+) |
| nflverse schedules (`schedules/games.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/schedules) | CC-BY-4.0 | League points per team-game 1999+ |
| Wikipedia player biographies (infobox honors, teams, draft; "Pre-draft measurables" tables) | English Wikipedia through the MediaWiki Action API, by `tools/reference/build_accolades.py` and `build_physical.py`; page title, URL and retrieval time stored per person in `data/augment/accolades.json` and `estimated_physical.json` | CC BY-SA 4.0 (text); only facts are extracted, attributed by page URL. Requests identified with a User-Agent, serial, ≤ 1 req/s, `maxlag=5`, cached | Per-season Pro Bowl / All-Pro / MVP / OPOY / DPOY honors, team spans for matching, pre-draft measurables; infobox jersey numbers (`data/augment/jerseys_wiki.json`, M6) for seasons nflverse has none; first-team All-Pro counts for the locker stickers (`data/augment/honors.json`, M6, derived from `accolades.json`) |
| Wikipedia article text and reference lists (quarterback arm descriptions) | English Wikipedia through the MediaWiki Action API, by `tools/augment/arm.ts` / `tools/augment/wiki.ts` (User-Agent, serial, one request per 1.5 s, `maxlag=5`, Retry-After honoured, cached); page URL, revision permalink and retrieval date stored per quote in `data/augment/arm_strength.json` | CC BY-SA 4.0 (text); only short attributed quotes (≤ 20 words), which stay CC BY-SA 4.0. Headlines of newspaper/magazine articles cited by Wikipedia are recorded with their URL; the articles themselves were not fetched | Sourced arm-strength grades (`bigArm`, `conf: "estimated"`) for QB Throw Power |
| Pro Football Hall of Fame player pages (Jim Kelly, Troy Aikman, Terry Bradshaw) | [profootballhof.com/players](https://www.profootballhof.com/players/) (allowed by its robots.txt; 19 Hall of Fame QB pages read once, 2 s apart, 3 cited and cached) | All rights reserved by the Hall of Fame; only short attributed quotations with the page URL | Arm-strength quotes in `data/augment/arm_strength.json` |
| Wikipedia list articles for the consensus check (NFL 100th Anniversary All-Time Team; The Top 100: NFL's Greatest Players; AP NFL Defensive Player of the Year; Patrick Mahomes) | English Wikipedia, read once each with `action=raw` (User-Agent, serial, with pauses) on 2026-09-23; page URL, revision permalink and retrieval date stored in `data/consensus.json`. NFL.com articles are cited as those pages cite them, not fetched | CC BY-SA 4.0 (text); only facts (who is on which team, award counts) and short attributed quotes | Consensus sets and the Rice / Lawrence Taylor OVR anchors for the ratings report's consensus check (never an input to a rating) |
| Wikipedia article text (quoted 40-yard times) and "Pre-draft measurables" tables; the career statistics tables of Reggie White, Deion Sanders, Randy Moss, Terrell Owens and Charles Woodson | English Wikipedia through the MediaWiki Action API, by `tools/augment/forty.ts` and `tools/augment/added-stints.ts` (`tools/augment/wiki.ts`: User-Agent, serial, one request per 1.5 s, `maxlag=5`, Retry-After honoured, cached); page URL, revision permalink and retrieval date stored per record in `data/augment/forty_times.json` and `data/augment/added_stints.json` | CC BY-SA 4.0 (text); only facts and short attributed quotes (≤ 30 words) | Cited 40 times for players with no measured time; the added stints (Reggie White PHI 1990s; Deion Sanders ATL and SF 1990s; Randy Moss MIN 2000s; Terrell Owens SF 2000s; Charles Woodson LV 1990s and 2000s): seasons, games and season lines (1999+ lines checked against nflverse) |
| Fantasy Index, "Fumbles have almost become a non-issue in the NFL" (2020-06-23), table "FUMBLE RATES, LAST 50 YEARS" | [fantasyindex.com](https://fantasyindex.com/2020/06/23/factoid/running-back-fumbles), read once and cached by `tools/augment/fumbles.ts` | All rights reserved by the publisher; only the per-season totals (facts) are used, attributed by URL in `data/augment/league_fumbles.json` | League RB fumble rate per season 1970–1998 (Ball Security era baseline); 1999–2019 used as a cross-check against nflverse |
| Pre-1999 league averages (`data/augment/era_baselines_pre1999.json`) | Written from knowledge of published league-average tables; no source retrieved | n/a (project-authored estimates, `conf: "estimated"`) | Era baselines 1960–1998 |
| Pre-1999 stint stats and defender stint totals (`estimated_stats_pre1999.json`, `estimated_def_stints_pre1999.json`), commonly cited 40 times | Written from knowledge; no source retrieved | n/a (project-authored estimates, `conf: "estimated"`) | Rate stats, games and stint totals for pre-1999 stints; speed inputs for pre-combine players |

Attribution: data from the nflverse project (https://github.com/nflverse), licensed CC-BY-4.0. Exact files, download dates and SHA-256 hashes are in `data/augment/sources.json`; derived files are built by `tools/augment/build.ts`. Honors and pre-draft measurables are facts taken from English Wikipedia articles (CC BY-SA 4.0), attributed per person by page URL in the data files.

## 3D, textures, HDRIs, audio

Nothing third-party yet. The sky, ocean, terrain, stadium, crowd and field are procedural and written in this repo. The player body, rig, gear and every animation clip (`public/assets/characters/`) are generated by the project's own scripts in `tools/blender`: no downloaded meshes, mocap or third-party motion.

## Tools (not shipped)

| Tool | License | Used for |
|---|---|---|
| Blender, as the `bpy` Python module 5.0.1 (PyPI) | GPL-2.0-or-later (the program); files it outputs belong to their author | Running `tools/blender` headless to build `player.glb` and `anims.glb` |
| Playwright + Chromium | Apache-2.0 / BSD-3-Clause | Browser tests, screenshot matrix, contact sheets |
| FFmpeg 7.0.2 static build, via the `imageio-ffmpeg` Python package (PyPI) | FFmpeg: GPL-3.0 build (the program); `imageio-ffmpeg`: BSD-2-Clause. The videos it encodes are the project's own renders | Encoding the feel videos in `docs/screenshots/m5.5/` (`tools/shots/video.spec.ts`); any ffmpeg on the PATH works too |
