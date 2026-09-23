# Progress log

## Current status

- **M1 Foundation:** merged (PR #1).
- **M2 Ratings:** merged (PR #2). The follow-up is PR #3: traits overhaul, Throw Power, consensus check and anchor bands, the four approved fixes (WR/TE physicals cap, TE block-grade cap, Munoz row excluded, sack-rate split) and round 2 (your two calls applied: TE block grade weight-capped only, Marino Release 97+; plus era-adjusted Ball Security, cited 40 times for legends, and the added Reggie White PHI 1990s stint). 37 of 42 anchors pass. Ready for your review.
- **M3 The look:** merged (PR #4). Perf re-test passed on your M1 Pro: Medium at 100% resolution, 80–113 fps in the three menu views.
- **M4 Characters and animation:** in progress on `claude/m4-characters`.

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

### M3 The look (merged, PR #4)

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

### Ratings follow-up (after the M2 review)

The curve and calibration are unchanged. Formula changes, all user-approved: QB Throw Power (below), then four fixes after the consensus review (next paragraph), which also changed the WR/TE OVR weights. Anchors, traits, the Explorer and a consensus check moved too.

**Round 2 (your decisions on PR #3)** (report: "Approved fixes, round 2"; every stint before round 2 frozen in `data/ratings/round2.before.json` by `tools/ratings/round2-before.ts`):
- *TE block grade*: the per-player cap is dropped, the 20% weight cap stays (`PLAYER_CAPPED_SIGNALS` is `imp` only; the test now checks the grade is never per-player capped). Kittle Run Block 77.7 → 93.6, TE 94.6 (#12) → 97.2 (#3); Winslow Run Block 95.7 → 91.5, TE 98.2 (#1) → 97.0 (#4). Winslow's Run Block stays high because round 1 moved the grade's lost weight onto size (0.361) and strength (0.217) and his 251 lb frame reads about 271 today; reported, not changed.
- *Marino*: Release anchor band 97+ (97.9 passes); the anchor stays on Release.
- *Ball Security era-adjusted*: fumbles per touch vs the league RB fumble rate for its seasons (`r_fum`), like every other rate. League rates in `data/augment/league_fumbles.json` (`tools/augment/fumbles.ts`): nflverse 1999+ (verified), the Fantasy Index 1970–2019 season table for 1970–98 (reference, parsed from the cached page and checked row by row; it agrees with nflverse to 0.05 points on 1999–2019), the 1970–72 level held for the 1960s (estimated). Merged into `era_baselines.json` by `merge-baselines.ts`. Payton 1970s Ball Security 32.8 → 62.7, OVR 92.6 (#25) → 94.7 (#12); 1980s 92.5 → 94.2; Dickerson 94.8 → 95.5; Sanders 96.8 → 97.5 (RB #2); Barkley 97.4 → 96.4 (#5).
- *Cited 40 times for legends*: `data/augment/forty_times.json` (`tools/augment/forty.ts`, curated quotes in `tools/augment/forty-sources.ts`, the arm-strength method: each quote checked verbatim against the cached Wikipedia page, a missing quote refuses the build). Targets: top 50 by OVR per position without a measured time (431 people). 22 got a cited time (estimated; Speed confidence 0.55, between the body prior and a table time; hand-time correction by stated timing), 39 a measured one (Wikipedia pre-draft tables, and 698 OL starters from the nflverse combine, which the OL pool never read before), 6 keep an uncited M2 estimate (O.J. Simpson, Dickerson, Herschel Walker, Emmitt Smith, Cliff Branch, Darrell Green: your call), 364 stay on the body prior (listed in AUGMENT_REPORT): Wikipedia almost never gives a pre-combine player's 40. Side effect: Lamar Jackson's reported 4.34 now gets the standard +0.06 correction, Speed 96.5 → 94.5, a hair under his approved 95+ (flagged).
- *Added stints*: `data/augment/added_stints.json` (`tools/augment/added-stints.ts`; loaded and validated by `src/engine/data/addedStints.ts`; legacy untouched). Reggie White PHI 1990s (1990–92: 14, 15, 14 sacks checked against his Wikipedia career table; imp from his PHI 1980s stint): DE #9, 95.8. 47 other honors gaps listed in the report for you (e.g. Deion Sanders ATL/SF 1990–94, Charles Woodson LV, Randy Moss MIN 2000–04, Ted Hendricks IND/GB, Terrell Owens SF 2000–03); none added.
- *Left as is*: the estimated 1970s–80s WR stints ranked 12–21.
- *Anchors*: **37 of 42 pass.** Flagged: Favre (no band proposed), Rice 1990s deep route (unchanged), Tyreek Hill (MIA Acceleration 92.2 vs 93), Revis (NYJ 2000s Press 92.5 vs 93), Lamar Jackson (Speed 94.5 vs 95, above).
- Key stints now: Rice SF 1980s 97.7 (WR #1), Kittle 97.2 (TE #3), Winslow 97.0 (TE #4), Reggie White PHI 1980s 96.8 (DE #5) and PHI 1990s 95.8 (#9), Bruce Smith BUF 1990s 96.6 (#6), Payton CHI 1970s 94.7 (RB #12), Garrett 98.1 (DE #1).

**Approved fixes after the consensus review** (report: "Approved fixes (ratings follow-up)" and "Diagnosis (for review)"; before values frozen in `data/ratings/approved-fixes.before.json` by `tools/ratings/approved-fixes-before.ts`):
- *WR/TE physicals cap* (`ovrWeights.ts`, PHYSICAL_OVR_CAP 0.08): raw physical attributes may carry at most 8% of WR and TE OVR, counted both where they sit in the weights (WR Speed 0.12 + Acceleration 0.06, TE Speed 0.08) and inside the skills whose formulas read them (Run After Catch is half speed and agility; Spectacular Catch, Release and the blocking skills read jumping, agility or strength). That matches how the review counted "~25%" for WR. The physical part of each term is scaled by one factor, the rest goes to the pure skills in proportion; physical attributes are unchanged. WR Speed is now 0.021, Acceleration 0.011; TE Speed 0.006 (most of the TE budget is blocking strength; a one-line change if you'd rather exempt it). Jerry Rice 1980s 94.5 (#15) → 97.7 (#1), 1990s 92.7 → 97.1 (#2).
- *TE block-grade cap* (round 2 dropped the per-player part, above): the legacy hand-set `b` followed the `imp` rule (`CAPPED_SIGNALS` in `attributes/types.ts`): at most 20% of each TE blocking formula (was 40/35/25%, excess to the other inputs, never to reputation) and per player at most a quarter of the same-direction uncapped evidence. Tests extended (weights and every TE's contributions). **Side effect for your review:** TE blocking is now mostly body and strength, so Kittle (grade 92, 18-rep bench) drops to Run Block 78 and OVR 98.4 → 94.6 (#12), while Winslow (grade 70, 251 lb ≈ 271 today) rises to Run Block 96 and TE #1 (94.4 → 98.2). The alternative is the 20% weight cap without the per-player cap.
- *Anthony Munoz TE row excluded* (`data/corrections.json`; he was a tackle; it rated 97.2, TE #4).
- *Sack-rate split*: sack rate is Pocket Presence's stat (0.35 → 0.5), 0.1 of Under Pressure (was 0.3), out of Release (was 0.35). Release now reads completion % 0.4, passing volume 0.2, INT rate 0.1, honors 0.15, `imp` 0.15 (no time-to-throw data: NGS rejected, no license). Eli Manning Release 88.6 → 81.9 (2010s), 81.4 → 71.8 (2000s). Marino's Release 99 anchor now fails (97.9, rank 4): flagged with a proposed band for you.
- *Anchors*: every proposed band applied (old band and reason on each anchor's `approved` note; checks can now target one stint), Moss moved to his MIN stint, Rice's 1990s deep-route flag untouched. **37 of 42 pass.** Still flagged: Marino (Release, new), Favre (no band was proposed), Rice (unchanged), Tyreek Hill (MIA Acceleration 92.2 vs the proposed 93) and Revis (NYJ 2000s Press 92.4 vs the proposed 93).
- *Consensus*: 16 of 36 top-3 players in the set (was 14), 20 disagreements (was 23); the Rice 99 anchor now agrees.
- *Diagnosis, nothing changed*: estimated pre-1999 inputs are never discounted (confidence is a label; shrinkage is by games only), the estimated 1976–77 yardage baselines are 2–4% low (about 1% over a 1970s stint), fumbles per touch was not era-adjusted (median RB Ball Security 52 for 1970s stints vs 77 for 2020s: a modern edge; fixed in round 2), and at DE the top-3 edge over White and Smith is verified measurables against body priors plus Smith's long-stint sack rate. White's 1990–92 Eagles seasons were in no stint (added in round 2).

**Throw Power, with arm inputs** (user-approved: "add air yards per attempt from 2006 on and a sourced big-arm list for earlier QBs, flagged estimated"). Merged `wip/arm-data` (`data/augment/arm_strength.json`, `tools/augment/arm*.ts`, `tests/arm-strength.test.ts`). Two new signals: `q_air`, log of intended air yards per attempt vs the attempt-weighted league (verified, 2006+, standardized in the QB pool, shrunk by attempts; a stint spanning pre-2006 seasons keeps it only if 2006+ is at least 40% of the stint), and `q_arm`, our cited arm grade mapped to a fixed z (cannon +2, strong +1, average −0.5, weak −1.5) times an evidence weight (pro 1, comparison 0.75, pre-pro 0.5), estimated, any era, shown as a new `scouting` contribution kind. Throw Power is now deep share 0.3, air yards 0.2, arm grade 0.2, Y/A 0.1, volume 0.05, `imp` 0.15; missing air yards or grade regress to the average and move part of their weight to the other evidence, as everywhere. Deep Accuracy is unchanged (air yards say where, not how well). Marino 88 → 96 (his anchor now passes: 23 of 42), Bradshaw 91 → 97, Allen 90/75 → 97/95, Elway 89/82 → 94/91, Lamonica 77 → 95, Mahomes 97/87 → 99/91; Favre 79–83 → 83–84 (graded "strong" on comparison evidence only; flag kept, note updated), Pennington 70–72 → 57–59, Alex Smith 71 → 56, Brees 89 → 73 (NO 2000s). Arm traits on QBs: Cannon 26 → 29, Bomb Squad 36 → 34, Laser 40 → 30, Gunslinger 15 → 22, Riverboat Gambler 12 → 14, Noodle Arm 63 → 63; nothing fell under five holders or started riding along with another trait, so no cut. Known limit: air yards reward all-or-nothing deep passers (Tebow 87 → 94). Before/after tables: report "Throw Power (ratings follow-up)"; the M2 values are frozen in `data/ratings/throw-power.m2.json` (`tools/ratings/throw-power-m2.ts`). The Marino, Mahomes and Favre anchor notes were rewritten to describe the new inputs; all 18 flags stay.

**Consensus check** (user-approved; stats stay primary). `data/consensus.json`: per position (OL split into tackle, guard, center), the NFL 100th Anniversary All-Time Team members, plus a deliberately short "modern" tier with a countable record only All-Time Team members share (Mahomes: three Super Bowl MVPs; J. J. Watt and Aaron Donald: three DPOYs), every entry cited (Wikipedia permalinks, NFL.com articles as cited there); consensus OVR anchors Jerry Rice 99 (1980s SF) and Lawrence Taylor 99 (1980s NYG). `tools/ratings/consensus.ts` reads a finished run and never changes a rating; the report's "Consensus check" section lists each position's top 3 distinct players, whether each is in the set, and every disagreement. Now: 14 of 36 in the set, 23 disagreements (e.g. Steve Young and Aaron Rodgers top the QBs, Faulk and Saquon Barkley the RBs, Julio Jones, Calvin Johnson and James Lofton the WRs; Rice's 1980s stint is 94.5, 15th among WRs, gap −4.5); Lawrence Taylor agrees (98.2, first among LBs, within the 99 rule). `tests/ratings-consensus.test.ts` checks the section is current, that no disagreement is dropped, and that the ratings are identical with and without the layer; it never fails because a disagreement exists. Nothing was changed to resolve a disagreement.

**Anchors** (`tools/ratings/anchors.ts`): Manning's 97+ band moved from Decision Making to Awareness (passes, 98); his Scramble check stays and still fails (61, 16th percentile), so his flag stays with an updated note. Fitzgerald's "speed below 88" check is gone (his measured 4.48 stands); Catch in Traffic (94.6, want 97) keeps its flag. Still 22 of 42 anchors passing, with fewer failing checks.

**Traits, rebuilt** (`src/engine/ratings/traits/`, docs in `docs/TRAITS.md`, numbers in the report's new "Traits" section):
- 120 trait definitions: QB 24, RB 25, WR 26, TE 20 (four shared with WR), and 29 defensive ones (DE 9, DT 9, LB 13, CB 12, S 13, many shared); 20 of them negative. Plus 25 combinations, 7 OL unit traits and 14 roster synergies. Each has an icon (in-house SVG set, `src/ui/scouting/traitIcons.tsx`), a one-line gameplay effect and a "why he earned it" line with the player's own numbers ("Speed 97 (top 2% of WRs)").
- Gates are percentiles of the position pool: elite at the top 10%, standard at the top 25%, negatives at the bottom 10–15%. Three kinds of signal: physical (measurables, era-translated body), technical (attributes) and production signatures (share of the team's catches as the target-share proxy, yards per catch, TDs per touch, attempts vs the league, carries per game). No gate reads age, experience or seasons.
- Up to 4 shown per player, at most 2 negatives. Combinations replace their parts. The best trait of each facet (for a QB: arm, pocket and legs, mind, style) is shown first, and the rank adds how rare a trait is among players of similar OVR, so stars read as different kinds of star: Montana is Maestro + Efficiency King + Off-Platform, Marino Air Raid + Bomb Squad + Unflappable + Climber, Mahomes Backyard Ball + Bomb Squad, Brady (NE 2010s) Maestro + Air Raid + Statue.
- 42–46% of every position has no trait. Every kept trait is held by 5+ players and none rides along with another 95%+ of the time (tested in `tests/ratings-traits.test.ts`, 17 tests).
- **Cut:** Touch Passer and Small but Mighty (under five holders), Separator (97% were Route Technicians), Rhythm Passer (95% overlap with Ice in His Veins; Point Guard went with it, Unflappable replaced it), Edge Setter (all holders were Wrecking Balls), Volume Target (same signal as Alpha), Return Man (no return gameplay and return stats only from 1999), and no career-arc traits. Four combinations were redefined while tuning (listed in the report).
- **Synergies** are data with a bounded effect (≤ 5%, 0.15 s or 0.5 yd, for the pair only) and a pure `detectSynergies(roster)`. OL units read the mean of their five linemen and carry unit traits (Road Graders, Pass-Pro Wall, Athletic Line, Smart Line, Ground and Pound, Turnstile, Sack-Prone). The sim applies them from M5; the matchup preview and pre-game will show them in M7.
- The snapshot (`ratings.v1.json`) now carries each trait with its why line, and each OL unit its block aggregates and unit traits.

**UI:** reusable `TraitBadge`/`TraitList`/`SynergyBadge` (`src/ui/scouting/TraitBadge.tsx`). The Scouting panel shows icon, label and why line (Film Room hides the why numbers). The Explorer shows the same on the card, trait icons in the pool table, a trait filter per position (plus "any"/"no traits"), OL unit traits on a lineman's card, and the roster synergies of the two compared players.

**Explorer fix:** the OVR block sat 19–23 px from the right edge of the page, where preview deployments float Vercel's round toolbar button. The detail pane and header now keep a 4rem right-edge gutter (the OVR sits 72 px in) and the OVR block can't shrink. Checked with Playwright at 1920×1080 and 1440×900, single and compare, with three mock 44 px toolbar buttons pinned to the right edge: no overlap (`docs/screenshots/m2-followup/`).

**Honest notes:** why lines for combinations are long (both parts' numbers). Traits inherit the ratings' data limits: e.g. Ed Reed (2000s BAL) shows Arm Tackler because his 3.9 tackles per game are the lowest of the modern safeties and he was 200 lb; that is the Tackle formula reading real data, not a trait bug. Synergies read the traits a player shows, so a trait dropped by the four-trait cap (Barry Sanders' Patient Runner) doesn't trigger one.

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
