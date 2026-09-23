# Progress log

## Current status

- **M1 Foundation:** merged (PR #1), live on production.
- **M2 Ratings:** built and **stopped for your review** (PR to `main`). Review with `docs/RATINGS_REPORT.md` and the Ratings Explorer at `/#/dev/ratings` on the preview. No balance or attribute-to-gameplay calibration until you sign off.
- **M3 The look:** starting while you review (it doesn't depend on ratings).

## Known legacy issues (do not rebuild)

These are bugs and dead ends found in `legacy/beat-the-beasts.jsx` during planning. The new game must not reproduce them. Line numbers refer to the legacy file.

| # | Legacy issue | Where | What the new game does instead |
|---|---|---|---|
| L1 | **Daily Auto-Draft guarantees a win.** Auto-Draft is shown in the Daily and loads `daily.perfect`, which matches a `topLineups` entry and sets `forceWin`: a one-click guaranteed win. It also silently throws away picks already made, in every mode | `GameScreen` 9193–9233, `handleRunSim` 9150–9184 | No Auto-Draft in the Daily. No `forceWin` in played games. Auto-Draft (Classic, Film Room, Quick Play) keeps picks already made (GDD §6.2, §15 D3/D8) |
| L2 | **Share Results probably crashes.** `RecapModal` portals with `ReactDOM.createPortal`, but `ReactDOM` is never imported (line 1 imports only React). The card also shows the QB's career passer rating as "QB RATING" (a stat leak in Film Room and Daily), uses today's date instead of the Daily's date, and lists only 4 of the 9 players | `RecapModal` 8610–8750 | A share card rebuilt from scratch: this game's QB line, the Daily's date key, the full lineup (GDD §14) |
| L3 | **The skin-tone editor is unreachable.** `HomeScreen` receives `onOpenEditor` but never renders a button, so `CharacterizationEditor` can't be opened, and `skinHexFor` always returns the default `#b07a4a`. It also stored data in a Claude-artifact API (`window.storage`) rather than anywhere durable | `HomeScreen` 5513, `CharacterizationEditor` 9549, `skinHexFor` 6749 | The editor is carried over, reachable from Settings → Gameplay → Skin-tone editor, and saves to `data/characterization.json` in the repo |
| L4 | "New Beasts" (reveal) and "Face New Beasts" (results) both just go to the home menu | 6449, 8320 | Buttons do what they say |
| L5 | Daily: a round with no legal pick (possible through the duplicate-name rule) has no way out, because skips are hidden in the Daily | `spinSlot` 9053 | A deterministic backup pair from the date seed (GDD §6.1 rule 8) |
| L6 | The duplicate-player rule compares names, so homonyms block each other (for example, three different Mike Williamses) | `getAvailablePicks` 4087 | Person ids (GDD §15 D9) |
| L7 | Film Room and Daily leak information: OL unit blurbs, Beast stats with a hidden "*" footnote, post-game career-stat popups | `PickCard` 5740, `BeastChip` 6285 | Explicit Film Room rules (GDD §15 D11) |
| L8 | Captions can print "null" ("Intercepted by null!") when the sim has no named player | `simulateBeatdown` 5196–5216, `captionFor` 8246 | Caption bank with a fallback for every slot |
| L9 | The Beasts' score is sprinkled randomly across the cinematic timeline, and a 1-point remainder is labeled a field goal | 5326–5384 | Per-possession Beasts results (GDD §7.3) |
| L10 | The slot-tile decade label shows "19'" / "20'" instead of "70'" | 9479 | New UI |
| L11 | The key matchup verdict is hardcoded "WR WON / CB WON" even for TE and safety matchups | `ResultScreen` | "REC WON / DEF WON / EVEN" |
| L12 | Dead code: `YearWheelScreen` and `simulateSeason` (season mode), `WindChip`, `ProgressDots`, `ScoreBoard`, `ClockPanel`, `DnDPill`, `TEAM_COLORS` (never called), the whole Odds Lab | various | Not ported. `TEAM_COLORS` is used for draft accents; the drive strip is revived in the HUD |
| L13 | `todayKey` uses the player's local date | 4606 | Kept on purpose (Wordle-style: the daily flips at local midnight) |

## Milestone log

### M2 Ratings (built, stopped for review)

**How to review**
- `docs/RATINGS_REPORT.md`: method, anchor pass/fail with my flags, era parity, legacy comparison with the 50 biggest risers and fallers and why, distribution charts, top 25 per attribute and OVR, every correction, low-confidence ratings among the top 200, and the legacy-sim adapter fit.
- **Ratings Explorer**, `/#/dev/ratings` on any build: search any stint, sort/filter the pool by any attribute, click an attribute for its contribution breakdown, see the real stats, sources and the era baseline behind it, percentiles all-time and within the era, pin a second player to compare, export CSV. It rates live from the assembled inputs, so it shows exactly what the engine produces. The in-game Scouting panel (trimmed card) is previewed on every player.

**What's in**
- **Data, all sourced** (`data/augment/`, credited in `CREDITS.md`):
  - nflverse (CC-BY-4.0): a person id for every entry (homonyms split: three Mike Williamses, both Alex Smiths), seasons and games per stint, height/weight/birth date, combine results, 1999–2025 regular-season stats per stint (mid-season trades split by weekly rows), OL rosters per unit, league baselines 1999+. Match rate 97–99%. `docs/AUGMENT_REPORT.md`.
  - Wikipedia (MediaWiki API, throttled and cached): per-season honors for 99.9% of the targeted players (100% of imp ≥ 85), and pre-draft measurables (40, 10-yard split, vertical, broad, shuttle, cone, bench) for 578 players. `docs/REFERENCE_NOTES.md`.
  - Estimated from knowledge, flagged `estimated`: pre-1999 league baselines, pre-1999 stint rates (completion %, Y/A, sack rate, carries, receptions…) for the notable stints, and pre-1999 defender stint totals (65% of legacy defender rows held career totals). 12 commonly cited 40 times.
- **Corrections** (`data/corrections.json`, 276, the loader refuses any whose `old` doesn't match): the 7 catch-% counts, the 4 schema-broken rows, 3 LA Raiders filed as Rams, 80 exclusions (stints that never happened, filler rows, duplicate spellings; 26 marked REVIEW), and 179 defender sack/INT stint totals.
- **Era baselines** per season 1960–2025 (`data/era_baselines.json`); each stint is compared to the seasons it actually covers, weighted by games.
- **The engine** (`src/engine/ratings/`, pure): 60+ signals (rates vs league, honors per season blended with peak, body, measurables), one declarative formula per attribute for every position, sample-size shrinkage by plays, a per-player 20% cap on `imp`, physicals from measurements with aging across stints, OL units split into five real linemen (key-list names first), OVR per position, 22 traits with documented gameplay effects, confidence on everything, and a pool calibration for the elite defensive pools.
- **Outputs:** `data/ratings/ratings.v1.json` (the snapshot the game ships; the Daily will pin a version), `data/ratings/adapter.v1.json` (legacy-sim adapter, fitted not tuned).
- **Commands:** `npm run ratings` rebuilds everything and the report; `npm run augment` rebuilds the nflverse layer.

**Validation** (automated, `tests/ratings-*.test.ts`)
- **Anchors: 22 of 42 pass; the other 20 are flagged with reasons** (listed in the report). The flags fall into four groups:
  1. **The data can't see it:** Throw Power for Favre/Marino (no box-score trace of arm strength), Payton's stiff arm, Deion's tackling, Campbell's trucking at 232 lb.
  2. **Aging:** Moss at NE and Tyreek at MIA were 30+; their younger stints meet the bands.
  3. **Honors dilution:** Revis's stints include non-peak years.
  4. **Near misses** within 1–2 points, and two I think are wrong: Manning's 97+ belongs on Awareness (99), not Decision Making (INT rate 2.5% vs league 3.0%), and Fitzgerald's "speed below 88" contradicts his measured 4.48.
- **Era parity:** every position within ±3 in every decade except 1990s safeties (−3.1; the defensive pools are 3–15 players per decade, so top-N there is noisy).
- **No pileups** (≤ 5 at 99 anywhere), **monotonicity** (better production never lowers a rating), **cross-stint consistency** exact, **Spearman vs legacy imp 0.80** (target 0.75–0.9), `imp` ≤ 20% of every attribute for every player.

**Decisions for you**
1. The flagged anchors (the report's "Flagged anchors" list). Tell me which bands to change and which formulas to revisit.
2. Throw Power: accept it as data-limited, or add air yards per attempt (nflverse play-by-play, 2006+) plus a sourced "cannon" list for earlier QBs.
3. The 26 exclusions marked REVIEW in the corrections (never on that franchise in nflverse rosters).
4. The pool calibration for the defensive pools (the median Beast is ~90, the best ~98); it's the biggest single modeling choice after the curve.

**Known limits**
- Tackles and passes defensed start in 1999; before that, tackling and coverage lean on honors, body and reputation (low/medium confidence, shown everywhere).
- Pre-1999 stint rates are estimates (flagged); most stints before 1970 have only legacy per-game numbers.
- OL individual ratings separate linemen mainly by honors and body; the unit stats are shared.

**Next:** M3 The look (the Night request is in the backlog: moon and stadium glow on the water, the sea and sky readable at low light).

### M1 Foundation (merged)

**What's in**

- **Project:** Vite 8 + React 19 + TypeScript 6 (strict), ESLint with purity rules (`src/engine` and `src/sim` can't import React, three or DOM, and can't use `Math.random`, `Date` or `performance.now`), Vitest, Playwright, `CLAUDE.md`, `CREDITS.md`.
- **Data:**
  - `npm run extract` parses the legacy file and writes typed modules to `data/legacy/`, byte-identical values, one entry per line.
  - Ids are stable, frozen in `ids.json`.
  - `UNITS` is split into 184 OL units and 71 DEF units.
  - A drift test checks counts, SHA-256 per dataset, and 60 entries field by field.
  - `docs/DATA_VALIDATION.md` reports every schema mismatch, impossible value, duplicate and homonym found (the brief's audit list plus Ron Howard's WR fields and the four defenders duplicated as RB filler rows).
- **Engine:**
  - A line-for-line port of the legacy rating, Beasts, daily and sim functions, the grade functions and the caption and analysis text generators.
  - Proven **deep-equal to the original file** (loaded straight from `legacy/` at test time) over 5,000 seeded rosters and every daily of 2026.
  - Also: seeded RNG streams, fdlibm-derived deterministic math, and the nickel/dime sub package (+1 CB, +1 S) drawn after the legacy base 11 without changing it.
- **The scene (first pass):** Blackcliff at golden hour.
  - A physically based atmosphere (single scattering, ozone) baked into a sky LUT that drives the sky, the aerial perspective on every material, the ocean reflections and the IBL.
  - A Gerstner ocean with a sun glint path, depth-tinted shallows and shoreline foam.
  - Cliff terrain with triplanar fractured rock and boulders; distant headlands in the haze.
  - The stadium bowl at final proportions: two tiers, club glass, roof, light banks, video board, south masts, open end with terrace.
  - The field shader: mowing stripes with view-dependent sheen, analytic lines and hashes, painted numbers, end zones and the midfield claw.
  - Post chain: N8AO, bloom, AgX plus a per-preset grade and vignette, SMAA.
  - Five lighting presets (Golden Hour tuned; Night, Overcast, Rain and Snow as first passes).
  - A 150-second title flyover and per-menu camera shots.
- **Front end:**
  - Studio intro, then "Press any key" (requests fullscreen, unlocks audio), then the main menu with a live Daily preview (today's Beasts and threat level from the ported engine).
  - Settings: Display, Graphics, Controls with per-context keyboard and gamepad rebinding and conflict moves, Audio, Gameplay, Accessibility.
  - How to Play reference pages, and the skin-tone editor (Settings → Gameplay).
  - Toasts for modes that arrive in later milestones, and the phone/tablet gate plus a no-WebGL2 screen.
- **Input:** an action map with contexts (GDD §8 defaults), keyboard, mouse and gamepad (standard mapping, stick repeat), Keyboard Lock in fullscreen on Chromium, and browser shortcuts captured (context menu, Space/arrow scroll, Backspace, Tab, F1–F3, ctrl+wheel zoom).
- **Audio:** a Web Audio graph with master/music/SFX/crowd/UI buses and a compressor. Synthesized UI sounds, a title sting, and a coastal ambience (surf, wind, crowd murmur). Muted when unfocused (setting).
- **Perf tools:**
  - **Settings → Display → FPS counter.**
  - **The hidden perf screen:** press ` (backquote) or open with `?perf`. It shows the frame-time graph, avg/p95/p99/min/max, draw calls, triangles, geometries, textures, shader programs, JS heap (Chromium), canvas and internal resolution, quality tier, lighting, GPU string and browser, plus a "Copy report" button.
- **Quality:** first launch picks Low/Medium/High/Ultra from the GPU name. The in-scene benchmark that refines it comes in milestone 3.
- **Skin tones:** everyone starts at the legacy default tone. The editor saves to `data/characterization.json` in the repo:
  - in `npm run dev`, directly;
  - on a deployment, through `api/characterization.ts`, which commits via the GitHub API once `EDITOR_KEY` and `GITHUB_TOKEN` are set in Vercel.

**Tests:** 63 unit tests (data drift, validation, legacy differential, detmath, RNG, sub package, grades, input map, characterization schema, quality guess) and 5 Playwright browser tests:
- intro → title → menu → settings → FPS counter → perf screen → back;
- locked modes toast instead of opening a stand-in screen;
- rebinding moves a clashing key and persists;
- the skin-tone editor opens from Settings and edits;
- phones get the gate.

**Settings wired now vs. later.** Every setting is stored and survives reloads. These take effect now: fullscreen, resolution scale, frame cap, FOV, FPS counter, quality preset, shadows, AO, anti-aliasing, bloom, vignette, all audio sliders, mute when unfocused, lighting, skip intros, interface scale, reduce flashing (bloom), and every binding. The rest act on systems that don't exist yet and switch on as they land: dynamic resolution, HUD scale and safe area (M3/M6), crowd density and grass detail (M3), replay DOF and motion blur (M7), weather particles (M3), difficulty, game length, camera, auto-replay, colorblind icons, captions, shake, hold-to-toggle (M5–M8).

**Screenshots** (`npm run shots`, 1920×1080, High preset, SwiftShader; curated copies in `docs/screenshots/m1/`)

| | |
|---|---|
| ![Title over the bowl](screenshots/m1/golden-title.jpg) | ![Main menu](screenshots/m1/golden-menu.jpg) |
| ![Flyover: cliff](screenshots/m1/golden-flyover-cliff.jpg) | ![Flyover: over the bowl](screenshots/m1/golden-flyover-bowl.jpg) |
| ![Flyover: sunset over the sea](screenshots/m1/golden-flyover-sea.jpg) | ![Settings](screenshots/m1/golden-settings.jpg) |
| ![Night](screenshots/m1/night-flyover-bowl.jpg) | ![Skin-tone editor](screenshots/m1/skin-tone-editor.jpg) |

**Honest critique against the references**

What holds up:
- **The signature composition works.** Looking down the field from the north deck, the open end frames the sea, the headlands and the low sun. The golden light rakes across the stands, and the west stand's shadow slices diagonally over the field. That is the ref-01 + ref-02 marriage the brief asked for.
- **The sunset-over-sea shot is close to ref-01**: the glint path on the water, the warm horizon glow, haze layering the headlands.
- **The front end looks like a sports-game menu**, not a web page: full-screen, left-aligned, live camera behind, restrained lime accent, device-aware button prompts.

Where it falls short, biggest gap first:
1. **The crowd.** At mid distance the per-seat shader reads as colored pixel noise ("mosaic"), not people. ref-02's crowd has shape, depth and soft focus. This is the biggest gap in every stadium shot. *Fix (M3):* instanced VAT spectators near and impostor cards far, with per-instance color variety and depth-of-field softness in the broadcast lens.
2. **The cliff up close.** It's procedural rock on a heightfield: it reads at flyover distance but is soft and plasticky near the camera, with no overhangs, vegetation or sculpted form. It's nowhere near ref-03's crisp foreground detail. *Fix (M3):* bpy-sculpted cliff meshes plus CC0 scanned rock textures (Poly Haven/ambientCG are now reachable), and scattered vegetation on the plateau and ledges.
3. **Materials are blockout-grade.** The concrete, roof and plaza are flat. The exterior facade and the west end cap are big blank planes, and the terrace paving dominates the foreground of the title shot. *Fix (M3):* modular stadium kit with real facade articulation, signage, railings, props; texture detail on concrete.
4. **Lighting presets beyond Golden Hour are first passes.**
   - Night lights the bowl (floodlights added for M1), but the sky and sea go nearly black and the lights have no light shafts or haze.
   - Overcast, Rain and Snow are visually near-identical, because rain/snow particles, wet-field reflections and snow cover don't exist yet.
   - *Fix (M3):* light-tower banks, volumetric haze, wet and snow material layers, particles, a moonlit sea.
5. **The grass is flat.** Mowing stripes read, but the turf has no blade detail near the camera and the green goes slightly neon under floodlights and overcast grades. *Fix (M3):* instanced near-camera blades, per-preset grass response.
6. **The sky lacks drama.** The atmosphere is physically plausible but the cloud layer is thin and the golden-hour gradient is less saturated than ref-01. *Fix (M3):* richer cloud shapes, a stronger Mie glow, grade tuning.

The biggest gap (the crowd) is milestone 3 work by plan: the M1 scope was a lit, post-processed blockout.


**Next (M2 Ratings, then M3 The look in parallel while you review ratings):** validation → `corrections.json`, nflverse-sourced augmentation (now reachable), era baselines, the attribute set with contributions, OVR, traits, Ratings Explorer, validation suite, `RATINGS_REPORT.md`. Then stop for your ratings review.

**Known issues**

- Performance numbers from this container are meaningless (no GPU; Chromium renders through SwiftShader at a few frames per second). Frame rate on your Mac is the real check.
- The main JS bundle is 618 KB gzipped (three.js, R3F and all player data). Under the 1.5 MB boot budget; code-splitting the editor and dev pages comes later.
- `THREE.Clock` deprecation warnings in the console come from React Three Fiber internals, not our code.
