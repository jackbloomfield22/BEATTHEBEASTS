# Progress log

## Current status

- **M1 Foundation:** merged (PR #1).
- **M2 Ratings:** merged (PR #2). The follow-up (traits overhaul, Throw Power, consensus check, anchor bands, your round-2 decisions) is PR #3, waiting on your merge.
- **M3 The look:** merged (PR #4). Your M1 Pro re-test: 80-113 fps on Medium at 100%.
- **M4 Characters and animation:** built, on branch `claude/m4-characters`. Screenshots in `docs/screenshots/m4/`, critique below.

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

### M4 Characters and animation (built, PR open)

**What's in**
- **Rig and body, built in code** (`tools/blender`, headless Blender 5.0 via the `bpy` module; no downloaded meshes or motion). One skeleton: 52 deform bones in an A-pose at 1.88 m. The body is lofted from measured cross-sections, fused with a voxel remesh, decimated to three LODs (about 20k / 9k / 3.5k triangles) and cut with clean planar hems. Heat-map weights (limited to 4 influences, no bare vertices; the build asserts it), plus hand-fixed seams at the crotch and collar. Covered skin is culled.
- **Gear:** helmet and facemask, shoulder pads under the jersey, jersey, pants, socks, cleats and gloves, all skinned to the same rig, in one mesh and one draw call per player. A part id in the vertex data selects each part's color and finish.
- **Body variety from the roster:** `heavy`, `lean` and `belly` morph targets plus overall scale, all driven by listed height and weight. A 5'10" 185 lb corner and a 6'3" 335 lb tackle come from the same asset.
- **Uniforms:** the six GDD §12.5 kits come from uniforms. Collar, sleeve bands, pants stripe and helmet stripe are drawn procedurally from the rest pose, so they follow the cloth through every animation. The Beasts' crimson helmet stripe is emissive.
- **Numbers and names:** one SDF atlas for every player. Bungee digits and capitals are rasterized at startup and turned into an exact signed distance field. The shader places back and front numbers (outlined in the kit's outline color) and a nameplate: long names are squeezed, accents dropped, and the name takes whichever number color contrasts more with the jersey. They are sharp at any distance.
- **Skin tone** comes from `data/characterization.json` through `skinHexFor`, the same path as the editor. The file is still empty, so every player has the default tone until you assign tones in the editor.
- **Clips** (`docs/ANIMATION.md`): ten stances (idle, OL 3-point, DL 4-point, WR, LB, DB, RB, QB under center, QB gun, huddle) and five locomotion cycles (walk, jog, run, sprint, backpedal). They are keyed with IK controls, placed by the ball of the foot, and baked to FK. The gait keyer rides planted feet at exactly the clip speed. **All 15 clips pass their gates:**
  - foot slide ≤ 0.5 cm;
  - loops ≤ 1°;
  - ankles and knees ≥ 7 cm apart;
  - every stance keeps its centre of mass over the support polygon of its feet and hands.
- **Runtime** (`src/anim`):
  - Locomotion blends the two clips that bracket the speed on one stride-matched phase. Each clip's phase is warped so both plant and lift each foot on the same frame.
  - Foot lock holds the ball of the foot through stance, with analytic two-bone IK.
  - The body leans into turns and pitches with acceleration.
  - The head and neck track a target, within neck limits.
  - The shoulder pads ride a spring.
- **Animation Lab** (`/#/dev/anim`): single, lineup (every body type), compare two clips, onion skin, and contact sheet. The speed blend has foot lock, turn-rate (lean) and look-at controls, plus kit, skin, number, name and LOD pickers. A readout shows phase, planted feet and the foot-lock correction. `npm run shots` with `BTB_CONTACT=1` writes a contact sheet for every clip.
- **Lineup check** (`?lineup`): 22 players at the line of scrimmage in their stances, the Beasts on defense against an offense in the Royal kit, placed by the front of the helmet or hands so the neutral zone is right. Added to the screenshot matrix from the broadcast camera and at field level, in all five presets.
- **Hands:** walking uses relaxed open hands; jog, run, sprint and backpedal use a loose fist. Open, flat hands at speed read as palms held up in the first contact sheets.

**Bugs found and fixed along the way**
- **Lean compounding.** three's mixer only writes a bone when its mixed value changes. The root's clip value never changes, so the lean was re-applied on top of last frame's lean until the player lay on the ground. The animator now restores the pure clip pose before every mixer update. This also protects look-at, IK and the pads on any held pose.
- **Blend foot lock.** Planted feet were being dragged up to 22 cm in walk/jog and jog/run blends. Two causes:
  - the lock followed the dominant clip's contact windows, and the other clip disagreed;
  - it locked the ankle, which rises with the heel.
  Both clips' phases are now warped so they plant and lift together, and the lock holds the ball of the foot. The worst case in the sweep is 6 cm (see known issues).
- **Late objects missed the shadow cascades.** The cascade rig set up new materials only every 120 frames, about a minute under software GL. Players mounted after startup rendered with wrong shadows and orange rims. New objects are now attached on the next frame.

**Performance** (SwiftShader, 1080p, Medium, Golden Hour; geometry counts, not GPU time)

| View | Draw calls | Triangles |
|---|---|---|
| Broadcast camera, empty field | 81 | 1.27 M |
| Broadcast camera, 22 players | 169 | 1.67 M |
| Field level, empty field | 90 | 1.26 M |
| Field level, 22 players | 178 | 1.93 M |

- Players cast shadows from their Low LOD (a proxy that draws nothing on screen). That halved the field-level cost: it was +1.31 M triangles with full-detail casters.
- Each player is one draw call per pass: the camera, the proxy, and each cascade.
- LODs switch at 22 m and 55 m.
- The animator costs a few dozen bone operations per player per frame on the CPU. A 22-player field hasn't been profiled on real hardware.
- **Please re-test on the M1 Pro** with `?lineup&perf` (broadcast camera: `&cam=-50,14,-13.7,0,0,-11.5,18`).

**Critique** (`docs/screenshots/m4/`: `<preset>-lineup-broadcast`, `<preset>-lineup-field`, `contact-*`)
- **Against ref-02 (broadcast football):**
  - The line reads as football in every preset: two teams, a clean neutral zone, and stances you can name at a glance.
  - Numbers and nameplates are sharp at field level and legible from the broadcast camera. The Beasts' black-and-crimson and the Royal kit separate clearly, even at night and in snow.
  - Gaps, biggest first:
    1. **Silhouette.** The pants are baggy at the hips and seat, which reads as padding in the 3-point stance. ref-02's pants are fitted, with a tight knee and a high sock line. The fix is a slimmer hip shell and a tighter knee in `gear.py`.
    2. **Surface detail.** No fabric normal detail, mesh texture or wrinkles, and the skin is a flat, slightly orange plastic under golden light. ref-02 has sheen on the shells, mesh jerseys and specular skin.
    3. **Proportions:** shoulders and pads are a touch narrow for linemen.
    4. **No ball** yet, so the center's hand rests on nothing (M5).
- **Contact sheets:**
  - The gaits read correctly side on: contact, loading, toe-off and flight get longer from jog to sprint. The arm swing counters the legs, and the backpedal stays low with a flat back.
  - Stances are recognizable on every body type, from the 5'10" corner to the 335 lb tackle. The 4-point stance puts weight on the hands, and the QB gun stance is upright.
  - Weaker spots:
    - Idle arms hang stiffly.
    - In run and sprint at peak knee lift, you can see into the pants hem, which is dark.
    - A small hump at the back of the collar (the pad arch) reads like a hood in profile.
    - Hands are mitten-like up close.
- **Skin tone:** everyone has the default tone because `data/characterization.json` is still empty. Assigning tones in the editor will show up here directly.

**Known issues**
- **Foot-lock residual.**
  - Mid-blend the lock still corrects up to about 6 cm (jog/run at 4.6 m/s). That's the second-order stride mismatch between two clips.
  - A hard lean (20° at 5.8 m/s) needs about 10 cm, because the lean pivots at the feet rather than over the stance foot.
  - Both are hidden by IK, but a knee can straighten.
- Numbers are front and back only; no sleeve (TV) numbers yet.
- The dev-only `?lineup` view is the only in-stadium use until M5 puts players in plays.

**Next:** M5 Core play.


### M3 The look (merged)

**What's in**
- **Night** (your M1 request): the moon is the key light (a dim, cool physical sky with the same shape as day), stars, floodlights carrying the field, and the lit bowl glowing in the haze and on the sea.
- **Crowd:** a procedural person (built here: head, hair, torso, arms, legs; seated, standing, arms-up and clapping poses) rendered at startup into mask and normal atlases from 8 directions; every one of ~40,000 seats gets a camera-facing card with its own palette (weighted to Beasts crimson and black), pose, and real lighting and shadows. One draw call. Reactions (touchdown, turnover, big play, stop, kickoff, groan) drive the crowd's energy through a pure, tested envelope; `__btbCrowd.trigger('touchdown', t)` in dev. Night phone flashes; ponchos and hoods in rain, coats and beanies in snow.
- **Coastline:** a swept cliff-face mesh (the heightfield can't hold a near-vertical wall) with buttresses, columnar joints, bedding ledges and fractured blocks; dark basalt with lichen, algae, seepage streaks and a wet band; faceted boulders; procedural scrub, wind-sculpted cypress groves and ledge plants; surf keyed to distance from the rock (a new shore-distance channel in the seabed texture) with wash lines surging shoreward.
- **Stadium kit:** banded exterior (basalt plinth with lit gates, glazed concourse ribbon, charcoal aluminum fins with a night uplight wash, crimson band with an LED line, the same cladding on the stands' south ends); plaza paving trimmed back from the cliff; plaza lamps with light pools; BEASTS in both end zones and on the video board (GDD §12.4; Blackcliff is only the venue name on the intro title card).
- **Field:** grass shells near low cameras on High and Ultra (turf depth, blades carry the paint, lean with the mowing bands), the field color shared between the surface and the shells.
- **Sky:** a self-shadowed stratus deck under overcast; the sun hides behind cloud.
- **Weather** (all five presets now complete): wet surfaces darken and gloss with puddles on flat ground, snow settles on upward faces (none under the roofs), the field's lines and paint are swept clear in snow, rain streaks and snowflakes around the camera, a darker, rougher sea in rain.
- **Shadows:** cascaded shadow maps (High: 4 × 2048² to 700 m with cascade blending; Medium: 2 × 2048² to 350 m; Low: 2 × 1024² to 250 m), fixed-pattern PCF (the default per-pixel noise needs TAA we don't run).
- **VFX base:** one GPU particle pool (ring buffer, closed-form motion in the vertex shader) with turf kick-up, hit dust, confetti, pyro and breath; bursts are pure and seeded (tested). Dev preview `?vfx=<id>&vfxAge=<s>`.
- **Quality:** tiers now drive crowd density, vegetation, grass shells, weather particles and shadow cascades; dynamic resolution steps the render scale by frame time (probe up, back off; pure, tested); the first launch times the menu scene and moves the GPU-name guess one tier when the evidence is clear.
- **Tools:** `?fly` free camera (P logs a `?cam=` pose), `?cam=`, `?crowd=`, `?noshadow`; the screenshot harness now advances shader time a fixed 1/60 s per frame, so captures are reproducible. The matrix gained field, crowd, cliff and exterior shots.

**Critique against the references** (honest; `docs/screenshots/m3/`)
- **ref-01 (golden-hour ocean):** the closest match. The flyover-sea frame has the warm gradient, the glitter path and headlands layering into haze. Gap: the swell is short-period chop; ref-01's long, slow swell lines aren't there. Next pass on the ocean.
- **ref-02 (broadcast football):** the bowl now reads as a packed, noisy crowd from every broadcast angle, the turf has stripes and depth at field level, and the lighting presets hold together. Gaps: no players yet (M4); up close the spectators are clearly low-poly (faceted limbs, flat shirts, no faces), fine at broadcast distance but not in a tight crowd shot; the roof underside and light banks are still simple boxes; no depth-of-field softness on the stands.
- **ref-03 (open-world coast):** the cliffs finally read as rock with structure, the rim has scrub and cypress, and the surf hugs the rock. Gaps, biggest first: (1) the rock reads warm brown under the golden sun instead of dark basalt, and it's smooth and painterly up close where ref-03 is crisp; (2) no turquoise shallows, because Blackcliff's walls plunge into deep water (a design choice, but a cove or reef shelf somewhere in the flyover would buy that color); (3) the vegetation is blobby at close range; (4) the headland grass has no blade detail (only the field does).
- **Presets:** Night is the strongest frame after Golden; Overcast reads as a real stratus day; Rain reads (streaks, darker pitch and sea) but the wet sheen on the turf is subtle; Snow reads well (swept lines, patchy cover, flurries). Night's moon disc is a little too large and bright.

**Performance pass** (your M1 Pro report: Medium, Golden Hour, 28-60 fps with dynamic resolution at 60%)

What made it slow, biggest first:
1. **Render size.** "100%" meant the display's own pixel density. A 1920×1080 window at DPR 2 renders 3840×2160: four times the pixels of 1080p. Every per-pixel cost (lighting, shadows, AO, bloom, the crowd) scaled with it, and 60% of that is still 1.4× 1080p. Each tier now has a pixel budget: Medium renders at most 1920×1080 worth of pixels, High 2560×1440, Ultra the display's own density (DPR capped at 2). The HTML menus stay at full density. The perf screen's "Canvas / internal res" line shows the actual render size.
2. **Why the field-level views (Practice Field, How to Play) cost about twice the bowl view:** they look straight into the stands at close range. Crowd cards were full 1.1 × 2.2 m quads, alpha-tested, overlapping many rows deep, and every covered pixel ran the full lit shader (the alpha test turns off early depth rejection). Grass shells added 8 more alpha-tested layers over the turf in the bottom half of the frame. The bowl view sees both from far away and small. Fixes: each card now shrinks to its atlas cell's person (bounds computed from the same geometry the atlas is baked from; a seated fan fills about a third of the old card), and grass shells are High/Ultra only.
3. **Lights.** Every light in the scene is a pass through the per-pixel light loop, even at zero intensity. The six floodlights now exist only when lit (every other bank at double power on Low/Medium), and the plain sun is hidden while the cascade rig carries it.
4. **Shadows.** Medium drops from 3 cascades to 2 (2048², out to 350 m, no blend band), and the crowd no longer casts (it was the costliest caster in every cascade; the seating steps already cast the row shadows).
5. **Geometry.** Vegetation and boulders are split into 180 m chunks, so the camera and each cascade draw only what they can see. Scrub switches to an 80-triangle LOD (from 220) past 50 m, and boulders cast only on High. Crowd density on Medium went from 80% to 60% of seats (High 100% → 85%), and precipitation and vegetation are budgeted per tier.
6. **Startup spike (1.8 s).** It was almost certainly a first-use shader compile: anything hidden at the first frame, such as effects that appear later or the far vegetation LOD, compiled mid-frame on first sight. The whole scene, hidden meshes included, now compiles with `compileAsync` before the menu shows.
7. **Dynamic resolution never made the effects cheaper.** The post-processing chain (AO, bloom, color, SMAA) resized its buffers only when the window size changed, not the pixel ratio. When dynamic resolution stepped down, every effect pass kept running at the old resolution. After a preset switch they ran at the wrong size (a soft image). The chain now resizes whenever the pixel ratio changes.
8. **Dynamic resolution** no longer goes below 75% (it was 60%, which you saw as blurry and washed out). With the budget, Medium should rarely need it.

Measured here (SwiftShader, 1080p; this measures geometry, not GPU time):

| Medium, Golden Hour | Draw calls | Triangles (before → now) |
|---|---|---|
| Menu (bowl) | 90 | 4.55 M (your report) → 1.22 M |
| Practice Field | 118 | → 1.39 M |
| How to Play | 134 | → 1.51 M |

Frame times can't be measured here (software rendering), so the 60 fps at 100% target on your M1 Pro is still unconfirmed. **Re-test:** open the PR #4 preview with `?perf`, and set Medium (or reset to auto). For each of the three menu views, send fps / average / p99, the dynamic resolution %, and the "Canvas / internal res" line.

**Preview fixes** (your M3 feedback)
- **How to Play → The Draft went black and dead.** Root cause (found after your re-test still showed the error screen):
  - `HowToScreen` reset the page's scroll with `useEffect(() => scroller.current?.scrollTo({ top: 0 }), [page])`. That arrow returns whatever `scrollTo` returns.
  - Current Chrome implements the updated CSSOM View spec, where `scrollTo` returns a Promise. React kept that Promise as the effect's cleanup and called it on the first page change, and it isn't a function. So the click on The Draft threw.
  - My tests passed because the test browser's older Chromium returns `undefined` from `scrollTo`.
  - Fixed with a block body. An ESLint rule now rejects any concise-arrow effect in the codebase; it found four more, all harmless.
  - `e2e/howto.spec.ts` now emulates current Chrome's Promise-returning scroll methods. It checks that each page's own content is visible and that no error screen is up. It fails on the old code.
  - The crash-recovery work from the first report stays:
    - the 3D stage remounts after an error or a lost WebGL context;
    - repeated failures step the preset down one tier;
    - anything else shows an error screen with the message and a Reload button, never a black page.
- **Preset switch glitches.** Root cause found: the shadow rig's `dispose()` left each material flagged as attached, so the next rig (after the switch) skipped every material. They rendered with the old rig's cascade defines and no working shadows. The rig now records the materials it patched and restores them exactly. Browser tests (`e2e/presets.spec.ts`):
  - walk all 12 directed transitions between Low, Medium, High and Ultra;
  - after each switch, check the cascade count, that no material carries another rig's cascades, and that the plain sun is hidden;
  - compare a thumbnail of the frame to a fresh load at that preset;
  - repeat your exact path (Settings → Graphics → Quality preset, High → Medium → High).
  With the old `shadows.ts` restored, the Settings test fails exactly as you saw it. The walk also found four more switch bugs, now fixed:
  - three reused a rebuilt rig's cached program with the old rig's uniforms, because the program cache key didn't change;
  - CSM's own `dispose()` deleted every material's shader hook, so switched materials lost their look;
  - the post-processing buffers stayed at the old resolution (item 7 above);
  - boulder count and terrain resolution were fixed at load, so a switch didn't apply them.
- **Fullscreen** is a Display setting, off by default (existing saves are migrated to off), toggled with F11 or Alt+Enter. The title keypress enters fullscreen only if the setting is on. Shortcut capture (Tab, F1-F3, arrows, Backspace) works the same in a window.
- **Branding:** BEASTS in both end zones and on the video board; the studio is Comfortable Cave Interactive on the intro, in the page metadata, `package.json` and `CREDITS.md`.
- **CLAUDE.md rule 9:** stability and frame rate beat visual fidelity.

**Known issues**
- Rock color and close-up crispness (above). Moon size. Scrub and cypress up close. Ocean swell period.
- Soft-particle depth fades wait for a depth prepass (M5); hit dust stays small until then.
- The crowd atlas bakes at startup (~30 ms on a real GPU).
- Medium is now plainer at field level (no grass shells, 60% crowd, 2 cascades). If your re-test shows headroom, grass shells are the first thing to bring back.

**Next:** M4 Characters and animation.

### M2 Ratings (merged)

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
