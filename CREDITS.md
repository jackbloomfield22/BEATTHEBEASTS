# Credits and licenses

Beat the Beasts 3D is made by **Comfortable Cave Interactive**.

Every third-party asset, dataset, font and bundled resource used by the game, with its license. Code libraries are listed separately in `package.json`; notable ones that ship runtime assets are listed here too.

## Fonts

| Asset | Source | License |
|---|---|---|
| Bungee | Google Fonts, via the `@fontsource/bungee` npm package | SIL Open Font License 1.1 |
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
| nflverse rosters 1960–2025 (`rosters/roster_<year>.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/rosters) | CC-BY-4.0 | Seasons per stint, height, weight, birth date, OL linemen per unit, person matching (`data/augment/`) |
| nflverse players (`players/players.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/players) | CC-BY-4.0 | Person ids (GSIS/PFR), body data fallback |
| nflverse weekly player stats 1999–2025 (`stats_player/stats_player_week_<year>.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/stats_player) | CC-BY-4.0 | Games per stint, offensive and defensive regular-season totals, league era baselines 1999+ |
| nflverse combine (`combine/combine.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/combine) | CC-BY-4.0 | 40-yard dash, bench, vertical, broad jump, cone, shuttle (2000+) |
| nflverse schedules (`schedules/games.csv`) | [nflverse-data releases](https://github.com/nflverse/nflverse-data/releases/tag/schedules) | CC-BY-4.0 | League points per team-game 1999+ |
| Wikipedia player biographies (infobox honors, teams, draft; "Pre-draft measurables" tables) | English Wikipedia through the MediaWiki Action API, by `tools/reference/build_accolades.py` and `build_physical.py`; page title, URL and retrieval time stored per person in `data/augment/accolades.json` and `estimated_physical.json` | CC BY-SA 4.0 (text); only facts are extracted, attributed by page URL. Requests identified with a User-Agent, serial, ≤ 1 req/s, `maxlag=5`, cached | Per-season Pro Bowl / All-Pro / MVP / OPOY / DPOY honors, team spans for matching, pre-draft measurables |
| Pre-1999 league averages (`data/augment/era_baselines_pre1999.json`) | Written from knowledge of published league-average tables; no source retrieved | n/a (project-authored estimates, `conf: "estimated"`) | Era baselines 1960–1998 |
| Pre-1999 stint stats and defender stint totals (`estimated_stats_pre1999.json`, `estimated_def_stints_pre1999.json`), commonly cited 40 times | Written from knowledge; no source retrieved | n/a (project-authored estimates, `conf: "estimated"`) | Rate stats, games and stint totals for pre-1999 stints; speed inputs for pre-combine players |

Attribution: data from the nflverse project (https://github.com/nflverse), licensed CC-BY-4.0. Exact files, download dates and SHA-256 hashes are in `data/augment/sources.json`; derived files are built by `tools/augment/build.ts`. Honors and pre-draft measurables are facts taken from English Wikipedia articles (CC BY-SA 4.0), attributed per person by page URL in the data files.

## 3D, textures, HDRIs, audio

Nothing third-party yet. Everything visible in milestone 1 (sky, ocean, terrain, stadium blockout) is procedural and written in this repo.
