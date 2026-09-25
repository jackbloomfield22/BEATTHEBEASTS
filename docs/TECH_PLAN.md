# Beat the Beasts 3D: Technical Plan

Status: **approved 2026-09-22**, with the user's notes folded in (animation condition in §17 T8, skin-tone storage in §15). This document covers architecture, stack, asset plan, performance budgets and the milestone breakdown. Design decisions (rules, controls, modes, AI behavior, presentation) are in `docs/GDD.md`. Issues found in the brief, with proposed fixes, are in §17. Things only you can do are in §18.

---

## 1. Decisions at a glance

| Area | Decision | Changed from the brief? |
|---|---|---|
| App | Vite + React 19 + TypeScript (strict), static SPA | No |
| 3D | three.js through React Three Fiber v9 and drei | No |
| Renderer | **WebGL2 (`WebGLRenderer`)** with a thin renderer seam. WebGPU was evaluated and not chosen for launch (§5.1) | Resolves the brief's open question |
| Post | `postprocessing` (pmndrs) + N8AO + SMAA, and a few custom effects (LUT per preset, replay motion blur) | No |
| Physics | Rapier (`@dimforge/rapier3d-compat`) **for cosmetic physics only**: ragdolls, pile-ups, debris. Ball flight and every outcome-bearing collision live in the pure sim | **Yes**: the brief puts ball flight in Rapier. See §17 T3 |
| Simulation | Pure TS, fixed 60 Hz, seeded RNG streams, deterministic math library, no DOM or three imports | Adds deterministic math (§4.4) |
| State | Zustand for UI and meta state. The sim owns game state; React reads snapshots | No |
| Tests | Vitest (engine, sim, ratings, data), Playwright (browser flows, screenshot matrix, contact sheets) | No |
| DCC | **Blender 5.0 as a Python module (`bpy` from PyPI)**, headless. Verified available for this environment's Python 3.11 | Resolves how to run Blender here |
| Asset compression | gltf-transform (meshopt geometry, KTX2/Basis textures, per-tier resize) | No |
| Hosting | Vercel Git integration (you connect it once). Large assets on Vercel Blob if the budget in §11 is exceeded | You connect it, because the Vercel CLI can't be run from here (§18) |
| Offline/cache | Service worker via `vite-plugin-pwa` (Workbox), cache-first for hashed assets | No |
| Fonts | Bungee plus a UI text face, self-hosted via `@fontsource` (no Google Fonts CDN at runtime) | No |

---

## 2. Environment facts

1. **Network egress.** At planning time only npm and PyPI were reachable. **Since approval, the network policy was widened**: nflverse release downloads (via github.com redirects), Poly Haven (API and files), ambientCG, Quaternius, Freesound and vercel.com all respond. The workarounds in §8 and §9 (procedural sky and IBL, bpy-baked textures, a scripted base mesh) remain the default where they're simply better. Downloaded CC0 assets are now an option where they raise quality, logged in `CREDITS.md`.
2. **Blender works headless via PyPI.** `bpy` 5.0.1 wheels exist for Python 3.11, the version installed here: the full Blender Python API (modeling, rigging, baking, glTF export) without downloading Blender itself.
3. **No `gh` or Vercel CLI.** GitHub operations go through the GitHub integration. Vercel is connected to the repo through Git (production = `main`, previews on every branch).
4. **Vercel limits (checked 2026-09-22 at vercel.com/docs/limits).** The 100 MB (Hobby) / 1 GB (Pro) source-upload cap and the 15,000-file cap apply to **CLI** deployments. Git deployments have no stated source-size limit, and output file count is unlimited apart from the 45-minute build cap. Large binaries still shouldn't bloat the Git repo, so anything over ~50 MB total per asset family goes to Vercel Blob (§11).
5. **Branches.** One PR to `main` per milestone from `claude/trusting-ptolemy-m2i78d`; the user reviews and merges.
6. **Skin-tone data.** No legacy assignments exist. Everyone starts at the legacy default tone (`#b07a4a`). The editor (Settings → Gameplay → Skin-tone editor) saves to `data/characterization.json` **in the repo**, not browser storage (§15).

## 3. Repository layout

The brief's layout, with small additions:

```
/src
  /engine          pure TS, no DOM, no three
    /data          typed loaders over /data, corrections applier, ids
    /legacy        faithful port: deriveProfile, rateOffense, rateDefenders, rateBeasts,
                   buildMatchups, simulateBeatdown, daily (seed, sequence, perfect team)
    /ratings       one function per attribute, OVR, traits, contributions, confidence
    /rules         downs, scoring, clock, OT, grades, draft rules
    /rng           mulberry32 (legacy-identical), stream splitting
    /math          deterministic math (sin, cos, atan2, exp, pow, sqrt wrappers)
  /sim             real-time simulation (pure TS, depends on /engine only)
    /world         agents, ball, field geometry, contact
    /ai            offense teammates, Beasts DC, coverage, rush, run fits, pursuit
    /plays         playbook data, routes, blocking schemes, defensive calls
    attributeEffects.ts
  /render          R3F: stadium, field, sky, ocean, crowd, characters, VFX, cameras, post
  /anim            runtime animation: blend spaces, IK, look-at, lean, ragdoll bridge
  /ui              React overlays: shell, menus, draft, play call, HUD, results, settings
  /input           action maps, contexts, rebinding, gamepad, keyboard lock
  /audio           Web Audio graph, buses, crowd director, spatial emitters
  /assets          manifests, loaders, streaming, quality-tier selection
  /app             boot sequence, routing between game states, dev flag
  /dev             Ratings Explorer, Animation Lab, perf overlay, AI visualizers (dev only)
/data              ported legacy data (generated TS), corrections.json, augment/, era_baselines.json
/public/assets     compressed runtime assets (output of the pipeline)
/tools
  /extract         legacy -> /data extraction script
  /blender         bpy scripts: rig, body, gear, poses, clips, stadium kit, crowd VAT
  /pipeline        gltf-transform, texture encode, manifest generation
  /harness         headless balance harness, sensitivity checks
  /reports         RATINGS_REPORT.md generator, BALANCE.md generator
  /shots           Playwright screenshot matrix, contact sheets
/docs              BRIEF, GDD, TECH_PLAN, PROGRESS, ANIMATION, RATINGS_REPORT, BALANCE, reference/
/legacy            beat-the-beasts.jsx (untouched)
CLAUDE.md, CREDITS.md, ASSETS_NEEDED.md
```

**Enforced boundaries.** ESLint `no-restricted-imports` rules make `engine/` and `sim/` unable to import React, three, DOM globals, `Math.random` or `Date.now`. A unit test also greps the built sim bundle for those symbols. Purity is checked by tooling, not left to convention.

---

## 4. Architecture

### 4.1 Layers and data flow

```
 input (keyboard/mouse/pad) ──► InputFrame (per 60 Hz tick, recorded)
                                      │
                                      ▼
 engine (data, ratings, rules) ◄── sim.step(state, inputFrame)  ── fixed 60 Hz, seeded
                                      │ emits: snapshot + events (catch, hit, whistle…)
                     ┌────────────────┼──────────────────┐
                     ▼                ▼                  ▼
              render (R3F)       audio director     UI store (Zustand, ≤10 Hz)
      interpolates between     reacts to events      HUD/score bug/play clock
      the last two snapshots
```

- **The sim is the only authority.** Render, audio and UI are listeners. None of them can change outcomes.
- **Fixed timestep.** An accumulator in a single top-priority `useFrame` advances the sim in 1/60 s steps, with at most 5 catch-up steps per frame. Render interpolates between the previous and current snapshot using `alpha = accumulator / dt`. Slow motion scales the rate of sim time only, never `dt`, so outcomes don't change with slow-mo.
- **React never drives per-frame logic.** Per-frame visuals (player transforms, ball, receiver icons, reticle, power ring) are written imperatively from the snapshot into three objects and refs. React re-renders only on UI state changes (menu, play call, down and distance), fed by a throttled store.
- **Headless.** `sim/` and `engine/` run unchanged in Node for the balance harness, determinism tests and CI.

### 4.2 Game-state machine (app level)

`Boot → StudioIntro → Title("Press any key") → MainMenu → {Draft flow | QuickPlay | Practice | Daily | Settings | History | HowTo}`, then `BeastsReveal → Draft → PreGame → Game(loop of: BeastsPossession ⇄ OurDrive) → Results`. This is an explicit finite-state machine in `/app` (a hand-written reducer, no library), with the 3D scene persisting across states. The stadium is never unmounted, so transitions become camera moves rather than loads.

### 4.3 Randomness

- `engine/rng` keeps **mulberry32 exactly as legacy** (`makeRng`), plus `seedFromDate` and `matchupSeed`, so the Daily and the legacy sim reproduce bit-for-bit.
- Each game gets a root seed. Named sub-streams are derived by hashing (`rootSeed ^ hash("beasts-possessions")`, `"play:" + n`, `"ai"`, `"contact"` and so on). Adding a new consumer of randomness doesn't shift every other stream. That keeps the harness stable across code changes.
- All legacy `Math.random` call sites (non-daily Beasts assembly, `simulateSeason`) get an injected RNG in the port. The default in-game Beasts are seeded from a game seed shown in the pause menu, which also makes bug reports reproducible.

### 4.4 Determinism across browsers

JS engines are allowed to differ in the last bits of `Math.sin`, `Math.cos`, `Math.exp`, `Math.pow` and `Math.atan2`. V8 (Chrome) and JavaScriptCore (Safari) do differ. The sim therefore uses `engine/math`: fdlibm-derived pure-TS implementations of the few transcendental functions it needs (sin, cos, atan2, exp, log, pow). `+ - * /` and `Math.sqrt` are IEEE-exact and used directly. This costs little (22 agents) and gives:

- the same input log replays identically on every browser (input-recorded replays, bug repro, and a verifiable leaderboard later);
- the balance harness in Node matching the browser.

The legacy port keeps `Math.pow`, `Math.log` and `Math.cos`, exactly as legacy uses them (for example in `gaussNoise`), so it stays bit-identical to legacy **on the same engine**. The legacy differential test (§6.3) runs in Node/V8.

### 4.5 Replays

- **Instant replay and scrubbing.** A ring buffer of per-tick render snapshots (transforms, animation state, ball, events) covering the last 40 s, about 4 MB. Scrubbing and slow-mo read the buffer, and the free orbit camera renders from it. There is no re-simulation, so scrubbing is instant.
- **Highlight reel.** Auto-captured replays (TDs, turnovers, big hits, long gains) store the snapshot slice for that play (about 200 KB each) for the results screen and the 3D hero render on the share card.
- **Game-level input log.** Per-tick input frames, run-length encoded, plus the seed. That's enough to re-simulate a whole game deterministically, for History and the optional leaderboard's server-side verification.

---

## 5. Rendering

### 5.1 WebGPU vs WebGL2

I evaluated three's `WebGPURenderer` + TSL (which falls back automatically to a WebGL2 backend) against `WebGLRenderer` + pmndrs `postprocessing`.

| Criterion | WebGPURenderer + TSL | WebGLRenderer + postprocessing |
|---|---|---|
| Visual ceiling for this game | Same. Nothing in the target look needs WebGPU-only features | Same |
| Perf on the M1/M2 Air target | Lower CPU draw overhead, but our frame is GPU fill-bound (grass, post, shadows), not draw-call-bound | Draw calls stay ≤ ~450 with instancing (§10), well within WebGL budgets |
| Compute | Real compute (crowd, grass, particles) on WebGPU, but the WebGL2 fallback has no equivalent, so every compute path needs a vertex-shader twin anyway | Vertex-shader crowd VAT, grass and particles work everywhere |
| Ecosystem we need | TSL post nodes exist (bloom, GTAO, SMAA, TRAA, DOF), but N8AO, pmndrs `postprocessing`, three-custom-shader-material and drei helpers are WebGL-first | Mature: N8AO, SMAA, LUT3D, DOF, AgX, CSM, drei |
| Safari/Mac | Safari WebGPU is recent. Two backends means two things to verify on every visual change | One backend, one set of screenshots |
| Risk | Two shading backends. Fallback parity bugs land on exactly the Mac hardware we target | Low |

**Decision: WebGL2 for launch.** WebGPU offers no real visual or performance win for this scene and doubles the verification surface. That fails the brief's own test ("only if it gives a real visual or performance win with a reliable automatic WebGL2 fallback"). The renderer is created in one factory, and custom shaders are kept small and documented, so revisiting WebGPU after launch is a contained change. I'll re-check this at M3 if profiling shows we're CPU-bound on draw submission.

### 5.2 Scene composition (the coastal cliff bowl)

- **Stadium kit:** built by bpy scripts as modular, instanced pieces (seating sections, vomitories, concourse, roof fascia on the three closed sides, light towers, two video boards, tunnel, field wall with padding, benches, goalposts, pylons). The open end zone has a low terrace and a glass rail, then the cliff edge and the ocean.
- **Terrain:** cliff and coastline meshes authored in bpy (displaced, sculpt-style noise, rock strata) with triplanar rock/grass/sand shading, and distant headlands as low-poly silhouettes that dissolve into the aerial perspective.
- **Sun placement:** see GDD §12.2. The sun sets over the ocean about 35° off the field axis, not straight down it, so the broadcast camera gets raking side light instead of shooting into the sun.

### 5.3 Materials and lighting

- `MeshPhysicalMaterial` throughout. Helmets use clearcoat plus environment reflections, with a per-player shell/stripe/facemask color. Jerseys use a fabric normal map, sheen and a fold normal set baked in bpy per body type. Pants, socks and gloves have their own roughness and sheen values.
- **Sky:** a physically based single-scattering sky (Rayleigh + Mie + ozone, Hillaire-style transmittance and sky-view LUTs computed once per lighting preset on the GPU), a raymarched 2D cloud layer with slow wind drift, and sun-disc and moon handling. The sky is rendered to a cubemap on preset change, then PMREM'd for **IBL**. This removes the dependency on downloaded HDRIs and keeps the sky, IBL and fog consistent for every preset. Downloaded HDRIs are optional extras (§8).
- **Sun:** a directional light with **cascaded shadow maps** (three `CSM`: 4 cascades on High, 3 on Medium, 2 on Low), stabilized cascades and per-cascade bias. Player contact shadows come from N8AO plus a cheap blob-shadow decal under each player for Low.
- **Aerial perspective:** height and distance fog whose color is sampled from the sky-view LUT in the sun direction. This produces the ref-03 depth and haze and the ref-01 glowing horizon.
- **Night:** 8 light-tower banks as real spotlights (shadows from 2 key banks, the rest unshadowed), bloom on the fixtures, light haze via fog density, and emissive Beasts helmet stripes.
- **Lighting presets are data** (`render/presets/*.ts`): sun elevation and azimuth, turbidity, cloud cover, exposure, fog, LUT, bloom threshold, crowd flash rate, wetness, precipitation. Golden Hour, Night, Overcast, Rain and Snow are entries, not code paths.

### 5.4 Field and grass

- **Field shader (one draw):** base albedo from layered noise (color variation, wear near the hashes and between the numbers), **mowing stripes** from world-space bands with a view-dependent sheen flip (the real reason stripes read on TV), a detail normal, and **analytically rendered markings**: yard lines, hash marks, sidelines and numbers as SDFs, antialiased with `fwidth`, with a paint-wear noise mask. Markings stay razor-sharp at any distance with no texture memory. The line of scrimmage and first-down line are drawn by the same shader (broadcast style, under the players).
- **Real blades:** an instanced blade field in a camera-following ring (quality-scaled density, about 250k blades on High), wind-animated in the vertex shader, fading into the shader-only field with distance. On Low, blades are replaced by a parallax-offset fuzz layer.
- **Rain and snow:** wetness darkens albedo, lowers roughness and adds puddle-mask specular with sky reflections. Snow accumulates in noise-masked patches, and the lines stay visible where the grounds crew swept them.

### 5.5 Ocean

A Gerstner wave sum (8 to 12 waves) in the vertex shader, two scrolling normal layers for detail, GGX sun glint (the ref-01 glitter path), Fresnel sky reflection from the IBL cube, depth-based color through the shallows near the cliffs (the ref-03 turquoise), and shoreline foam where the waves meet the cliff base. A planar reflection is reserved for Ultra only.

### 5.6 Crowd (30,000+)

- 2 LODs. **Near:** instanced low-poly spectators (~300 triangles) animated with a **vertex animation texture** baked in bpy (idle, clap, stand, jump, wave, arms-up, deflate), one draw per section. **Far:** instanced impostor cards rendered from the same rig into a sprite atlas (8 angles × key frames).
- Per-instance data: seat transform, shirt, skin and hair palette index (weighted toward Beasts crimson and black, with color variation), phase offset, and an excitement response curve. A **crowd director** in `render/` turns sim events into waves of reaction that travel through sections. For example, the stand closest to a TD erupts first, and a Beasts sack gets the home crowd up.
- Around 32k seats total. Budget: ≤ 16 draws for the crowd.

### 5.7 Characters on the field

- One shared base mesh with LODs (High ~22k, Medium ~9k, Low ~3k triangles), one skeleton, and gear meshes (helmet and facemask, shoulder pads, jersey, pants, socks, cleats, gloves) skinned to the same rig.
- **Body variation** comes from bone scaling plus 3 blend shapes (lean, heavy, lineman-belly), driven by each player's height and weight from the ratings data.
- **Uniform shader:** base, trim and number colors per team, set by uniforms. **Numbers and names** are rendered at runtime into an SDF atlas (canvas, one atlas for all players) and sampled in the jersey shader. Names are clean at broadcast distance, with no per-player texture.
- **Skin tone** comes from the characterization data (GDD §12.6) as a shader uniform.
- 22 players + 7 officials + a sideline cast of about 30 low-LOD, loosely animated people. Players are individual `SkinnedMesh`es sharing geometry and materials (≈ 22 × ~6 parts ≈ 130 draws on High; parts merge per player on Medium/Low).

### 5.8 VFX

A GPU particle system (instanced quads, soft particles against depth) for turf kick-up, hit dust, confetti, pyro, breath vapor, rain streaks and splashes, snow and stadium-light haze. Decals for divots are optional.

### 5.9 Cameras

Camera rigs are driven from the sim snapshot with critically damped springs: broadcast (behind the QB, matching ref-02's lens and height), pass pull-up, carrier follow with look-ahead, high sideline on long runs, All-22, field level, kick, replay orbit, and cinematic splines for flyovers, the tunnel walkout and celebrations. Camera shake is applied as an additive layer scaled by impact force.

### 5.10 Post chain (per quality preset)

`N8AO → Bloom (mipmap) → [DOF, replay/cinematic only] → [motion blur, replay/cinematic only] → ToneMapping (AgX) → LUT3D (per lighting preset) → Vignette → SMAA`. Sharpening is used only on Ultra with dynamic resolution. MSAA ×4 on the main pass on High/Ultra. Replay motion blur is a custom camera-reprojection effect: we don't need per-object velocity for the replay look.

### 5.11 Quality presets and auto-detection

| Setting | Low | Medium (M1 Air target) | High | Ultra |
|---|---|---|---|---|
| Internal res scale | 0.75 dyn | 0.9 dyn | 1.0 dyn | 1.0 (+SMAA, MSAA) |
| Shadows | 2 cascades, 1024 | 3 × 1536 | 4 × 2048 | 4 × 3072 + night towers |
| AO | blob decals | N8AO half-res | N8AO full | N8AO full, high quality |
| Grass blades | none (fuzz layer) | ~90k | ~250k | ~450k |
| Crowd near LOD | 2k | 5k | 9k | 14k |
| Post | tone map, LUT, SMAA | + bloom | + MSAA | + planar ocean reflection, sharpen |
| Character LOD | Low | Medium | High | High + cloth wrinkle normals |

**Auto-detect on first launch.** Read `WEBGL_debug_renderer_info` (when available), then run a 2-second in-scene benchmark behind the "Press any key" screen (it renders the flyover anyway) at Medium. Step up or down by one tier, and store the result. **Dynamic resolution scaling** runs during gameplay (frame-time PID, 0.6 to 1.0 range, changes clamped to avoid shimmer).

---

## 6. Data and engine port

### 6.1 Extraction (never by hand)

`tools/extract/extract-legacy.ts` parses `legacy/beat-the-beasts.jsx` with a real JS parser (`@babel/parser`), locates the top-level declarations (`PLAYERS`, `DEFENSE`, `UNITS`, `YEAR_DEFENSES`, `ERA_BASE`, `DEF_ERA_BASE`, `LEAGUE_AVG_PA`, `TEAM_COLORS`, `TEAM_NICKS`, `SKIN_TONES`, `POS_HEX`, `DECADE_HEX`, `C`), evaluates each literal in isolation and emits `data/legacy/*.ts` with explicit types. The generated files carry a header with the legacy file's SHA-256.

- **IDs.** Legacy entries have no ids. `name+team+decade` is unique in `PLAYERS` (3,064/3,064) and `DEFENSE` (386/386), but not in `UNITS` (the TEN 1990s OL appears twice as "Tennessee Titans" and "Tennessee Oilers/Titans", with identical stats). Each entry gets a stable id `<dataset>:<slug(name)>:<team>:<decade>`, and a `~2` suffix where a natural key repeats. Ids are generated once and frozen in a checked-in id map, so later corrections can never renumber anything.
- **People vs entries.** The draft's "no duplicate names" rule and aging across stints both need to know which entries are the *same person*. Names alone get this wrong. "Mike Williams" is 6 entries covering at least 3 people. Alex Smith, Larry Brown and James Jones each cover different people at different positions. The CHI 1980s OL key lists "Jimbo Covert · Jim Covert", one person under two names. A `data/people.json` map (entry id → person id) is built by name match, with explicit splits and merges recorded as corrections.
- **`UNITS` is split** into `OL_UNITS` (p = 'OL') and `DEF_UNITS` (p = 'DEF'), with separate types. Nothing can read an OL field off a defense unit (§17 D-issues).
- **Drift test:** asserts entry counts per dataset and position, the SHA-256 of a canonical JSON serialization of each dataset, and a spot-check of 60 sampled entries field-by-field against a fresh parse of the legacy file. Any drift fails CI.

### 6.2 Corrections layer

`data/corrections.json`: `[{ id, field, old, new, reason, source, conf }]`. The loader applies them after validation. **The loader refuses a correction whose `old` doesn't match the legacy value**, so a correction can't silently apply to the wrong thing. Corrections can also mark an entry `exclude` (for schema-broken duplicates), with a reason. `RATINGS_REPORT.md` lists every applied correction.

### 6.3 Legacy engine port and differential testing

`engine/legacy/*` ports `deriveProfile`, `calculateOffensivePF`, `rateOffense`, `rateDefenders`, `rateBeasts`, `assembleBeastsSeeded`, `buildMatchups`, `simulateBeatdown`, `computePerfectTeam`, `computeTopLineups`, `buildDailySequence`, `getDailyChallenge`, `scoreToGrade` and the caption and analysis text generators, typed and otherwise line-for-line.

**Differential test:** the test harness also loads the *original* functions straight from `legacy/beat-the-beasts.jsx`. esbuild transforms the JSX, stubs `react` and `lucide-react`, and reads the declarations out of the module scope. Across 5,000 seeded rosters, 365 daily dates and the anchor rosters, it then asserts the port's outputs are **deep-equal** to legacy's (scores, box scores, events, grades, perfect teams, sequences). This is the strongest possible guarantee of "port faithfully", and it keeps the legacy file untouched.

Not ported: the Odds Lab (`LAB_*`, `runLabBatch`, `labMargin` and so on), all SVG scenes and sprites, and legacy UI components. `YEAR_DEFENSES` and `LEAGUE_AVG_PA` are ported as data (so the count and hash tests cover every legacy table), but `simulateSeason` is not ported: its only UI (`YearWheelScreen`) is dead code in legacy.

### 6.4 The adapter from new ratings to the legacy sim

The legacy sim reads `{arm, acc, care, explos, legs}`, `{power, vol, recv, score}`, `{sep, big, hands, score, block}`, `{pass, run}` and defender `{rush, cover, runD, tackle}`. `engine/legacy/adapter.ts` maps the new attributes onto those names (for example, `acc ← f(ShortAcc, MidAcc, DecisionMaking)`), with coefficients fitted in M2/M8 so the adapter reproduces the legacy calibration targets (~21 / ~36 / ~14 PPG, and the legacy win-rate bands). Quick Sim and the Beasts' between-drive scoring model use the adapted sim, so ratings stay the single source of truth.

---

## 7. Ratings system (M2)

- `engine/ratings/attributes/<position>/<attribute>.ts`: one pure function per attribute. `(player, ctx) → { value, conf, contributions: [{label, delta, input, baseline}] }`. Values are clamped to 0 to 99 by a documented soft cap (a logistic squash above 90) rather than a hard clamp, so there is no pileup at the cap.
- `ctx` holds era baselines for the player's actual seasons (from augmentation), the position-and-era prior (for shrinkage), and the player's other stints (for physical consistency and aging).
- **Shrinkage:** `value = prior + (raw − prior) × n / (n + k_attr)`, where n is games in the stint and `k_attr` is chosen per attribute (stable stats get a small k, noisy stats a large one). Missing games → `estimated` n with a larger k.
- **Reputation (`imp`) cap:** every attribute's contribution list includes at most one `imp`-derived term, and a unit test asserts it is ≤ 20% of the attribute's variance-weighted total for every player.
- **Physical attributes** are absolute (one scale, feeding physics directly). Skill attributes are position-referenced (99 = best ever at that position and skill). See §17 R2.
- **OVR weights** live in one file, `engine/ratings/ovrWeights.ts`. **Traits** live in `engine/ratings/traits.ts`: thresholds, stat signatures, and a pointer to their gameplay effect in `sim/attributeEffects.ts`.
- **Validation tests** (anchors, era parity, monotonicity, cap pileups, cross-stint consistency, legacy Spearman) run in Vitest. `tools/reports/ratings-report.ts` regenerates `docs/RATINGS_REPORT.md`, with charts rendered to SVG.
- **Ratings Explorer:** a dev route `/#/dev/ratings` (virtualized table, filters, compare, contribution waterfall per attribute, CSV export). The in-game Scouting panel reuses the same contribution view, trimmed.
- **Versioning:** the ratings output is snapshotted into a versioned, generated `ratings.vN.json` shipped with the build. The Daily pins a ratings version per date (§17 D4).

### Preliminary check of the brief's audit (done during planning)

I checked the brief's 11 audit points against the file during planning. M2 re-runs these checks as automated validation.

| # | Brief claim | Finding |
|---|---|---|
| 1 | `imp` does the work, 60–99, ~60% even, clusters, r=0.95 WR / 0.89 RB | **Confirmed**, with details. Offensive `imp` tops out at 97 (Barry Sanders); the 99s are defenders only. 59.6% even, rising to 79% above 76. Clusters confirmed, plus 71/75/76. r = 0.953 (WR yds/g), 0.892 (RB), 0.945 (TE) |
| 2 | `ea` barely adjusts | **Confirmed, and stronger than stated.** `ea − imp` is a fixed offset per position and decade (QB/WR/TE: +4 for the 1970s down to −1 for the 2020s; RB: 0 to +2). The code **never reads `ea`** |
| 3 | Stats are coarse, with no sample size | **Confirmed.** 982/992 WR yds/g are multiples of 5 (QB 639/649, RB 830/844, TE 536/579). No games or seasons fields anywhere |
| 4 | Pre-1992 targets estimated | **Confirmed**: 279 1970s/80s WRs carry yds/target and catch % |
| 5 | Schema errors | **Confirmed**: the 7 2020s WRs with `c` 86–129 (every other WR ≤ 75); Carl Garrett (LV 1970s RB with WR fields → 54 YPC); Larry Centers (WAS 1990s) and Anthony Miller (DAL 1990s) with TE fields. **New:** Ron Howard (DAL 1970s TE) carries WR fields. `UNITS` = 184 OL + 71 DEF units (the DEF units are never read) |
| 6 | Defense uses decade totals | **Confirmed**: 2020s DEs average 47.3 sacks vs 71.6 for the 2010s; the same partial-decade penalty shows in 2020s CB INTs (10.1 vs 21.8). Deion's ATL entry is 1980s (1989 only), `int:8`, imp 82 |
| 7 | Coverage is INTs only | **Confirmed.** Gardner 4 INT, Surtain 8. `ap`, `pb`, `dpoy` are present on every defender but **never read** by the engine |
| 8 | Run D and tackling have no stat input | **Confirmed** (`imp` + role bonus only) |
| 9 | OL is 4 numbers | **Confirmed.** `pb` range 72–96, `pbl` 0–6 |
| 10 | No physical data | **Confirmed** |
| 11 | Inconsistent caps | **Confirmed**: offense 97, coverage 90, rush 92, OL 96 |

Other data issues found for the corrections pass: `DEFENSE` has 386 entries (the brief says ~330). Four defenders also appear as offensive RB filler rows (Kenny Easley, Greg Lloyd, Andy Russell, Wally Chambers) with an identical placeholder stat line. There are questionable stints (Randy Moss TEN in both the 2000s and the 2010s; he played there only in 2010). There is no 1960s offense at all: the 1960s exist only for Beasts. `YEAR_DEFENSES` 1970–2007 values look synthetic (a few values repeat over 100 times) and use historical team codes that don't match the franchise codes used everywhere else. It isn't used by the new game.

### Augmentation data plan

| Field group | 1999 onward | Before 1999 |
|---|---|---|
| Games and seasons per stint, height, weight, birth year | nflverse rosters and player stats (CC-BY-4.0, **network access needed**) → `verified` | `estimated` from my knowledge, flagged, larger shrinkage k |
| 40-yard time | nflverse combine (2000 on) → `verified` | `estimated` only where a documented time exists; otherwise the archetype prior |
| QB comp%, Y/A, sack rate; RB receptions, fumbles; WR/TE rec/g, Y/R, targets (1992 on) | nflverse → `verified` | `reference` where I can cite a public source, else `estimated` |
| Defense: games, PD (1999 on), tackles, FF, official sacks flag (1982 on) | nflverse → `verified` | `reference`/`estimated`; sacks before 1982 flagged unofficial |
| OL individual linemen, All-Pro/Pro Bowl counts | `reference` (public honors lists) | `reference` |
| Era baselines by season | computed from nflverse where possible → `verified` | hand-entered league averages from cited public sources, `reference` (manual transcription, not scraping) |

Pro-Football-Reference's terms restrict automated access, so it won't be scraped. Citing it for hand-entered facts at `reference` confidence is the fallback. `CREDITS.md` records every dataset and its license.

---

## 8. Asset pipeline

```
tools/blender/*.py (bpy 5.0, headless)
   ├─ rig.py            custom football rig (FK/IK controls, CoM control) → bake FK
   ├─ body.py           base body from CC0 source or scripted, UVs, blend shapes
   ├─ gear/*.py         helmet, facemask, pads, jersey (with fold bakes), pants, cleats, gloves
   ├─ poses/*.py        pose library (named key poses as control transforms)
   ├─ clips/*.py        clip definitions: keys + timing + custom F-curve easing
   ├─ stadium/*.py      modular bowl kit, towers, boards, tunnel, cliffs, terrain
   └─ crowd_vat.py      spectator mesh + baked vertex-animation textures + impostor atlas
        │  export .glb
        ▼
tools/pipeline (Node)
   gltf-transform: dedup, weld, prune, reorder, meshopt compression, texture resize per tier,
   KTX2/Basis (UASTC for normals, ETC1S for albedo) via the Basis Universal encoder
        │
        ▼
public/assets/<tier>/*.glb|ktx2 + manifest.json (hashes, sizes, tier map)
```

- **Character base mesh:** the brief suggests a CC0 rigged humanoid (Quaternius or similar). Those hosts are blocked here. Options, in order: (a) you widen the network policy and I pull a CC0 base; (b) I script the base body in bpy (box-modeled, subdivided, retopologized for deformation). Most of the silhouette is gear anyway: helmet, pads, jersey, pants. I'll start on (b) in M4 whichever way it goes, because the rig and gear must be built around our own skeleton regardless.
- **PBR textures:** without ambientCG and Poly Haven, textures are generated procedurally in bpy (noise-based rock, concrete, metal, fabric weave normals, turf detail) and baked. That is fully owned, with no license questions. Downloaded CC0 textures would be used where they're clearly better.
- **KTX2 encoder:** the Basis Universal encoder is available as a WebAssembly build on npm. Verifying it is an M1 pipeline task. If it falls short, WebP textures are the fallback.
- **Budgets per tier (compressed, over the wire):** boot bundle ≤ 1.5 MB JS gzipped; menu-ready scene ≤ 12 MB; full gameplay set ≤ 60 MB (Medium), ≤ 110 MB (Ultra). Streaming: the menu scene loads first, then characters and animations load behind the Beasts reveal and draft, with a real byte-based progress bar.

---

## 9. Animation system

### 9.1 Authoring (bpy, fully in-house)

- **Rig:** 58 deform bones (spine ×4, neck ×2, head, clavicles, arms, forearm twist, hands with thumb + 2 finger groups for ball grips, hips, legs, feet, toes), IK controls for hands and feet, pole targets, and a CoM control. Everything is baked to FK on export.
- **Pose library:** Python dicts of named key poses (control transforms), for example `qb_set`, `qb_windup_deep`, `rb_press`, `dl_3pt`, `db_backpedal_contact`.
- **Clip definitions:** each clip is a script listing key poses, frame timings, per-channel easing (custom Bézier handles), overlap offsets for the arms and torso, and contact markers (foot plant frames and hand-ball frames). Contact markers are exported as glTF extras and drive runtime IK and sounds.
- **Automated quality gates** (in the bpy export step, recorded to `docs/ANIMATION.md`): foot-slide measurement on marked plant frames (threshold 0.5 cm), limb-body interpenetration check against capsules, CoM-over-support-polygon check, loop-point continuity (pose and velocity), and ball-hand distance on marked frames. Playwright contact sheets (8 to 12 frames, side and broadcast angles) cover the technique review, which I do by eye.

### 9.2 Runtime (`src/anim`)

- **Locomotion:** 2D blend spaces (speed × direction) per stance family. Strides are matched by computing playback rate from the ground speed / stride length of each clip, and stride warping handles speeds between samples. This is what keeps feet from sliding.
- **Foot IK:** analytic two-bone IK to plant feet on marked contact frames (a flat field, so this is mainly slide cleanup and cut plants). **Hand IK** puts hands on the actual ball for carries, catches, handoffs and throws, using the sim's ball position.
- **Look-at** for the head and eyes, with clamped angles and spring smoothing. **Procedural lean** comes from acceleration and turn rate. **Secondary motion** uses small springs on the chest, pads and jersey hem.
- **Contact:** paired clips (tackle, block engage) are aligned by the sim's contact frame. Big hits and pile-ups blend into an **active ragdoll**: Rapier rigid bodies per major bone with motorized joints tracking the animation pose, with motor strength dropped on impact and then a blend to a scripted get-up. **Ragdoll is cosmetic.** The sim has already decided the tackle, the spot and any fumble.

### 9.3 Animation Lab

`/#/dev/anim`: load any clip onto a fully geared player, then scrub, loop, slow down, orbit, onion-skin, compare two clips side by side, show foot-contact markers, and read foot slide in real time. Playwright drives it to render contact sheets.

---

## 10. Simulation design (`src/sim`)

- **World:** field in yards (x: goal line to goal line, z: sideline to sideline), agents as kinematic bodies (position, velocity, heading, stance), a capsule radius from body size, and mass from weight.
- **Movement:** acceleration-limited steering with top speed, acceleration, turn rate and the speed cost of cuts from `attributeEffects`. The player-controlled agent maps input to a desired velocity (camera-relative) through the same limits, so a slow player *feels* slow.
- **Ball:** analytic 3D projectile with quadratic drag and a small spiral lift term, integrated at 60 Hz with deterministic math. It includes throw error cones, catch windows, tips and overthrows, and a deterministic bounce model for fumbles and deflections (restitution plus a tumble randomizer from the seeded stream). Outcome-bearing ball physics never touch Rapier.
- **Contact resolution:** agents separate via circle-vs-circle pushes. **Blocks** are engagement constraints between a blocker and a rusher with a leverage state that evolves per tick from the pass-rush and blocking attributes. That is what makes the pocket collapse visibly and differently by matchup. **Tackles** are resolved events: an approach geometry (angle, closing speed, mass) plus attributes gives form, arm, dive or miss, and break-tackle, truck or stiff-arm counters. They also emit fumble checks and a contact impulse for the ragdoll and camera.
- **AI:** role behaviors (route runner, blocker, pass rusher, man and zone defender, run fitter, pursuer, spy) as small state machines reading a shared per-play blackboard (QB eyes vector, ball state, threats). The Beasts' DC is a separate module that picks the call before the snap from situation plus a tendency model (GDD §9).
- **Plays as data:** `sim/plays/*.ts` define formation alignments, per-player assignments (route tree nodes with depth and timing tied to the QB's drop, blocking schemes, protection rules), play art for the UI, and tags used by the tendency model and the Suggested tab.
- **Events** (`snap`, `throw`, `catch`, `drop`, `hit`, `tackle`, `fumble`, `td`, `whistle` …) carry everything render, audio, commentary and the replay director need, so no layer reaches into sim internals.

---

## 11. Performance budget

**Frame budget (Medium, M1 Air, 1080p @ 60 fps = 16.6 ms):** sim ≤ 1.0 ms, JS render prep ≤ 2.0 ms, GPU ≤ 12 ms (shadows 2.0, opaque 4.5, grass 1.5, crowd 1.0, ocean and sky 1.0, AO 1.2, post 0.8).

**Draw-call budget (High):**

| Group | Draws |
|---|---|
| Stadium kit (instanced by module) | ≤ 90 |
| Terrain, cliffs, ocean, sky, clouds | ≤ 12 |
| Field + grass rings | ≤ 6 |
| Crowd (near VAT + far impostors per section group) | ≤ 16 |
| Players (22 × ~6 parts) | ≤ 140 |
| Officials + sideline | ≤ 40 |
| VFX, decals, HUD-in-world (icons, lines) | ≤ 30 |
| Shadow passes (casters culled per cascade) | ≤ 110 |
| **Total** | **≤ ~450** (Medium target ≤ 300 via per-player part merging) |

Other rules: frustum culling everywhere, LODs for players and crowd, one texture atlas per stadium material family, no per-frame allocations in the sim or render loop (pooled vectors, checked by a dev-mode allocation counter), and GPU timer queries (`EXT_disjoint_timer_query_webgl2`, where available) in the perf overlay.

**Vercel limits:** I couldn't read Vercel's current limits from here (vercel.com is blocked by the network policy). The pipeline keeps the full asset set within the budgets in §8, assets are content-hashed and tiered, and the manifest can point at Vercel Blob instead of `/public` with a one-line config change if the deployment limits require it. I'll verify the numbers as soon as the network allows, before any large assets are committed (M3).

---

## 12. UI technology

- React DOM overlays above the canvas: custom components only, with no native `<input>`, `<select>` or `<button>` styling visible. They are still semantic elements for accessibility, restyled completely.
- **Scale:** a root font size tied to viewport height (1080p reference), so the UI scales with 1440p, 4K and ultrawide. Ultrawide gets safe-area insets so the HUD stays in the central 16:9.
- **Navigation:** a spatial focus manager (a custom one, or `@noriginmedia/norigin-spatial-navigation`), driven by mouse, arrows/Tab/Enter/Esc and the gamepad, with animated focus rings and hover and select sounds. Transitions use Motion (formerly Framer Motion).
- No page scroll anywhere (`overflow: hidden` at the root, and long lists are internal virtualized panes with wheel, keyboard and stick scrolling).
- **Desktop gate:** `pointer: coarse` plus a touch-only heuristic plus a narrow-viewport check. A single styled screen, with a manual override for touch laptops.

## 13. Input

- **Action maps** per context (Menu, PlayCall, PreSnap, Pocket, BallInAir, Carrier, Kick, Replay, Paused) with defaults for keyboard/mouse and gamepad (GDD §8). Rebinding stores `action → [bindings]` in settings, with conflict detection per context.
- The sim consumes an `InputFrame` per tick (actions pressed/held/released, analog move vector, aim offset, charge time), and that frame is what gets recorded.
- **Capturing browser shortcuts** during gameplay: `preventDefault` on contextmenu, Space, arrows, Tab, Backspace and the function keys we bind. There's a `beforeunload` guard mid-game. In fullscreen on Chromium, the **Keyboard Lock API** captures Esc so it can pause (see §17 T5 for Safari).
- **Gamepad:** the standard-mapping Gamepad API is polled once per frame. Rumble uses `vibrationActuator` where supported.

## 14. Audio

- A Web Audio graph: master → {music, sfx, crowd, ui} buses, a sidechain-style duck of crowd and music on big impacts (the "audio compression" beat), and HRTF `PannerNode`s for on-field emitters (pads, cleats, whistle, cadence) positioned from the sim.
- **Crowd director:** 5 to 6 layered loops (murmur, anticipation, roar, groan, chant, boo) plus one-shots, mixed by a smoothed excitement value driven by sim events (a deep ball in flight swells, a drop groans, a TD roars).
- **Sources:** CC0 or properly licensed only. Freesound (CC0 filter) and similar hosts are blocked here too (§18). What can be synthesized cleanly (UI ticks, whooshes, whistle, the stadium horn) will be built in-house with Web Audio or offline DSP. Crowd beds and pad impacts need recorded sources. `CREDITS.md` logs everything.

## 15. Persistence

- **Per-device preferences** go through a `storage.ts` wrapper over `localStorage` (try/catch, versioned keys): settings, keybinds, detected quality tier, tutorial progress, history (games and dailies, capped), Daily completion per date, and small highlight thumbnails.
- **Skin tones are game data, not preferences.** They live in `data/characterization.json`, bundled into every build. The editor saves back to that file in two ways:
  - Under `npm run dev`, a Vite dev-server endpoint (`tools/dev/characterization-api.ts`) writes the file directly.
  - On a deployment, the Vercel Function `api/characterization.ts` commits the file through the GitHub contents API. That needs two environment variables set in Vercel: `EDITOR_KEY` (a passphrase the editor asks for once) and `GITHUB_TOKEN` (a fine-grained token with Contents read/write on this repo). It commits to the deployment's own branch unless `CHARACTERIZATION_BRANCH` says otherwise. Without them, the editor still works and offers Export/Import of the JSON.

## 16. Testing and verification

| Layer | What | Where |
|---|---|---|
| Data | counts, hashes, spot checks vs legacy; correction `old` matching; schema validation report | Vitest |
| Legacy port | deep-equal differential vs the original functions loaded from `legacy/` | Vitest |
| Ratings | anchors, era parity, monotonicity, cap pileups, cross-stint consistency, Spearman vs `imp`, ≤20% `imp` share | Vitest + report |
| Sim | determinism (same seed and inputs → identical hash over 10k ticks, Node vs the Chromium/WebKit Playwright runners), rules (downs, scoring, OT, clock), scripted plays | Vitest + Playwright |
| Gameplay | headless auto-play of full games; browser input scripts: snap, throw, catch, tackle, score, drive ends, game ends | Vitest + Playwright |
| Visual | screenshot matrix: {menu, draft, pre-snap, mid-pass, tackle, TD, results} × {Golden, Night, Overcast, Rain, Snow} at fixed camera seeds, plus a critique against the references in `PROGRESS.md` | Playwright (headless Chromium with GPU flags; SwiftShader fallback noted) |
| Animation | bpy gates + contact sheets | bpy + Playwright |
| Perf | scripted flythrough and scripted play, frame-time percentiles, draw calls, triangles | Playwright + perf overlay |

**A note on GPU screenshots here.** This environment has no GPU. Headless Chromium falls back to SwiftShader (software WebGL), which renders correctly but slowly, so screenshots and the visual critique work, and performance numbers from here don't mean anything. The 60 fps Mac target has to be checked on real hardware (§18).

---

## 17. Issues in the brief, with proposed fixes

### Process and tooling

- **T1. Branch per milestone vs this session's branch rule.** I can only push to `claude/trusting-ptolemy-m2i78d` unless you allow more. **Proposal:** work on this branch and open one PR to `main` per milestone. You merge (or tell me to), and Vercel previews come from the PR. If you'd rather have `milestone/*` branches, say so and I'll use them.
- **T2. Repo creation and `gh` instructions.** Moot: you told me to use this repo. `gh` isn't available here, and I use the GitHub integration instead.
- **T3. Rapier for ball flight.** Physics that decides outcomes must be deterministic, cheap, headless-runnable and identical across browsers. Rapier's WASM float path is deterministic only within the same build and platform settings, and adds a WASM dependency to the harness. **Fix:** an analytic ball with a deterministic bounce model inside the sim; Rapier only for cosmetic ragdolls and debris that never feed back into the sim.
- **T4. Cross-browser determinism** isn't guaranteed by "seeded RNG" alone, because `Math.sin`/`Math.exp` differ across engines. **Fix:** the deterministic math module (§4.4).
- **T5. `Esc` to pause vs fullscreen.** Browsers reserve Esc to exit fullscreen, and the page never sees the keypress. Safari has no Keyboard Lock API. **Fix:** on Chromium, use Keyboard Lock in fullscreen, so Esc pauses and holding Esc exits (the browser's own behavior with lock). Everywhere, `fullscreenchange` auto-pauses the game. On Safari, Esc therefore still ends up paused, just out of fullscreen, and the pause menu's Resume re-enters fullscreen (Resume is a user gesture). `P`/`Backspace` stay on replay as the brief specifies.
- **T6. Vercel CLI and limits.** The Vercel CLI and docs are unreachable from here. **Fix:** you connect the repo in the Vercel dashboard once (§18). Deploys then happen on push, and I check preview URLs through GitHub deployment statuses.
- **T7. Asset and data hosts blocked** (nflverse, Poly Haven, ambientCG, Quaternius, Freesound). **Fix:** please widen the network policy (§18). Until then: procedural sky and IBL, bpy-baked procedural textures, a scripted base mesh, and `estimated` data at low confidence with the `verified` fields filled in once access exists.
- **T8. "Every animation authored by you" at the brief's library size** is the biggest schedule risk in the project (well over 150 clips, with variants). **Approved with a condition:** nothing is downloaded or generated from third-party motion, and every base clip is keyed in-house. When cutting for quality, variants and celebration/official extras go first; position-specific technique clips (drops, route breaks, kick-slide, pass-rush moves, backpedal and hip flip, form tackles) are never cut. **Fix, without lowering the bar:** (1) keyframe only what the broadcast camera reads as technique (stances, drops, throws, catches, cuts, blocks, tackles, celebrations); (2) generate variants procedurally from authored bases (mirroring, speed warping, additive layers for pressure, fatigue and lean) instead of hand-keying every left/right/speed variant; (3) let the runtime layer (IK, look-at, lean, springs) do what mocap would otherwise give for free. The clip list in `docs/ANIMATION.md` tracks each base clip and its derived variants.
- **T9. TAA** on WebGL with pmndrs has no production-ready option. **Fix:** SMAA everywhere, plus MSAA on High/Ultra. TAA would only come back with a later WebGPU move (TRAA node).

### Ratings

- **R1. The anchor list mixes absolute and position-relative bands.** The brief says anchor bands are position-relative, but physical attributes must be absolute because they drive physics (Speed 97 = 22.3 mph for anyone). **Fix:** physical attributes (Speed, Acceleration, Agility, Strength, Stamina, Jumping) are absolute. Their anchors are read as absolute and they hold up (Vick, Lamar, Hill, Deion and Moss at 97+ are all plausibly 4.3-class). Skill anchors are position-relative. "Bottom 10% of QBs" stays a percentile check.
- **R2. OVR replacing `imp` changes the Daily.** The seeded Beasts weights and the perfect team would change the day the new ratings ship, and again every time a correction lands. **Fix:** "same for everyone" means everyone on the same date and ratings version. Ratings changes activate at the next UTC midnight, and each date pins the version it was generated with. The draft-sequence universe (team+decade pairs) is frozen from legacy data order, so corrections can't reshuffle sequences.
- **R3. Beasts' "88+" bar** is on the `imp`-based `rateBeasts` scale. When `rateBeasts` moves to new OVR, the bar gets recalibrated (to whatever threshold reproduces the legacy distribution of Beasts strength), not kept at the literal 88.
- **R4. Pre-1999 augmentation is mostly `estimated`.** For 1970s to 1990s players, that's my knowledge, flagged. It's honest, but it means pre-1999 physicals shrink harder toward priors. Era parity tests will tell us whether that biases decades, and if so the fix goes in the shrinkage, not in the data.

### Game rules and design (full detail in GDD §15)

GDD §15 lists D1–D19 (Beasts' per-possession scoring, possession order, the Daily's forced win, grade scaling, overtime, Esc/fullscreen, nickel/dime personnel, the Daily Auto-Draft exploit, name-based duplicate checks, drive start spots, Film Room leaks, missing skin-tone data, kickers, and more), each with a proposed fix.

---

## 18. What I need from you

Resolved at approval: branch policy (one PR per milestone), Vercel connected, network widened, no legacy skin-tone data (start at the default tone). Still open:

1. **Skin-tone saving on the deployed site (optional).** To save from the live game, add `EDITOR_KEY` and `GITHUB_TOKEN` in Vercel → Project → Settings → Environment Variables (§15). Without them, save from `npm run dev` or use Export.
2. **Real-hardware checks** at each visual milestone: turn on Settings → Display → FPS counter, or press ` for the perf screen, and send a screenshot.

## 19. Milestones

Every milestone ends with: tests passing, the screenshot matrix captured and critiqued in `PROGRESS.md`, a Vercel preview URL, and `PROGRESS.md` updated. Parallel subagents are used where work is independent (listed per milestone).

### M1 Foundation
- Scaffold (Vite/React/TS strict, ESLint boundaries, Vitest, Playwright, CI script), `CLAUDE.md`, `CREDITS.md`, `PROGRESS.md`.
- Legacy extraction → typed `data/`, drift test, id scheme, `UNITS` split, validation report (schema mismatches, impossible values, missing fields, duplicates).
- `engine/` legacy port + **differential tests** + seeded RNG + deterministic math.
- Boot: studio intro → "Press any key" over a live 3D scene (first pass of sky, ocean and a blockout of the cliff bowl at golden hour, already lit and post-processed) → main menu and full settings menu (every setting wired to the store; the graphics ones take effect as systems arrive) → fullscreen and audio unlock → desktop-only gate.
- Input action-map core, spatial navigation, Keyboard Lock and fullscreen-pause handling.
- Deploy on Vercel (after you connect it).
- *Parallel:* data extraction + tests | engine port + differential tests | shell UI + 3D title scene.
- **Exit:** differential tests deep-equal on 5,000 rosters and 365 dailies; boot flow has no 2D stand-ins; screenshots of the intro, title and menus.

### M2 Ratings (stop for your review)
- Validation pass and `corrections.json` (all 11 audited issues plus anything new), augmentation layer, era baselines, the full attribute set, OVR, traits, contributions, confidence, the Ratings Explorer, the automated validation suite, `RATINGS_REPORT.md`, and the legacy-sim adapter (fit, not yet tuned).
- **Stop for review.** M3 continues meanwhile. No balance or attribute-to-gameplay calibration until you sign off.
- *Parallel:* per-position attribute modules (QB | RB | WR/TE | OL | DEF) after the shared framework lands.

### M3 The look
- The final stadium kit, cliffs and coastline, field shader + grass, sky + clouds + IBL, ocean, all 5 lighting presets with LUTs, CSM, N8AO, bloom, crowd with VAT and reactions (test-triggered), VFX base, quality presets + auto-detect + dynamic resolution, and a free flythrough camera.
- Screenshot critique against ref-01/02/03 each iteration, fixing the biggest gap first.
- *Parallel:* stadium/terrain | field/grass | sky/ocean/presets | crowd.
- **Exit:** the screenshots hold up next to the references; the perf capture meets the budget on the software renderer's relative scale, with a real-hardware check requested from you.

### M4 Characters and animation system
- bpy rig, base body, gear, body-type variation from height and weight, runtime uniforms, numbers and names atlas, skin tone, Beasts identity with emissive stripes, the bpy authoring pipeline + quality gates, the Animation Lab, the runtime layer (blend spaces, stride matching, foot and hand IK, look-at, lean, springs), and the first authored set: all stances, locomotion, huddle, line-up.
- **Exit:** every M4 clip passes its gates; contact sheets are reviewed; 22 players lined up in the broadcast camera look right in all presets.

### M5 Core play
- Sim world, attribute mapping module, one play snap to whistle: passing with selection, placement, touch and bullet; ball in air + catch types; running with moves; basic man and zone; pass rush vs OL engagement; tackling + ragdoll blend; Practice Field.
- Clips: QB, RB, WR/TE, tackling, ball events.
- **Exit:** scripted browser tests (snap, throw, catch, tackle, score); the determinism hash matches Node and the browser.

### M5.5 Game feel (added after the M5 play test)
- On-screen prompts in every phase (binding- and device-aware), open/covered receiver icons, a landing reticle, a first-play tutorial, a slowed first catch.
- More pocket time (median no-throw sack ~4.5 s at Pro), carrier plant/buffer/cut weight, blended transitions, latency measured under 100 ms.
- Field boundaries as hard rules; touchdowns only in bounds.
- Route preview (hold Tab / RT) and **hot routes** (pulled forward from M6).
- A video recorder for scripted plays (the owner judges feel between play sessions).

### M6 Full game (the draft room first)
- **Starts with the draft room** (pulled forward from M7 at the owner's request), rebuilt as the Contenders' locker room (GDD §6.2). The room is its own `THREE.Scene` in the one canvas: the composer's render pass draws it instead of the stadium while it's up (`src/render/view.ts`), so the post chain and every compiled program stay as they are and the stadium stays built for the walk-out. Its lights are 27 analytic stall lights run through three's physical BRDF inside the room's materials (`src/render/locker/lockerLights.ts`), not three.js lights. The draft rules are the legacy port (`src/game/draft.ts`); the game layer is `src/game/match.ts` (pure) over the Practice Field's play engine (`src/game/game.ts`).
- Then: downs, drives, scoring, PAT and 2-point, FG kick mechanic, punts, turnovers, pick-six and scoop-and-score, the two-minute drill, OT, the playbook (≥ 30 plays, ≥ 6 formations) + play-call UI + Suggested tab + audibles, motion and flip (hot routes landed in M5.5), the full Beasts AI (all coverages, blitzes, disguise, tendencies, difficulty), Beasts possessions ("Meanwhile" cuts), the results screen.
- Clips: OL/DL line play, LB, DB, kicking.
- **Exit:** headless auto-play of 1,000 full games with no stuck states; browser end-to-end play of a full game.

### M7 Presentation
- Tunnel reveal, pick materialization, pre-game cinematics, broadcast overlay, replays + slow-mo, celebrations, officials, commentary, full audio. The animation library is complete, with every clip gated. (The draft room and Scouting panel moved to the start of M6.)

### M8 Polish and ship
- Balance harness + tuning + sensitivity checks (`BALANCE.md`), performance pass, accessibility, gamepad polish, tutorial, Daily Challenge, share card with the 3D hero render, history, optional leaderboard.
- **Exit:** the Definition of Done in the brief, item by item, in `PROGRESS.md`.

### Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Animation volume and quality (T8) | High | Base clips + procedural variants; runtime layer; start the rig in M1's final week as a spike |
| Character look without a purchased or downloaded base | High | Gear-dominant silhouette, strong materials; `ASSETS_NEEDED.md` lists paid options with expected gain |
| No GPU here for perf numbers | Medium | Budgets by construction (draw calls, triangles, passes) + your hardware checks |
| Data confidence before 1999 | Medium | Shrinkage + confidence flags + anchor tests; the network ask |
| AI that feels smart | High | DC module + tendency model built early in M6; harness metrics for coverage breaks and sack time |
| Scope | High | "Trade scope before quality": GDD §16 lists cut candidates in order |
