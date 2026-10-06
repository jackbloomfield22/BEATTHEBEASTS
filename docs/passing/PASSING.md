# The passing game, end to end

The owner's goal: "making sure the passing feels real all on the QB's end, the ball physics, WR's end". This pass audited the passing game against real football and a AAA football game, then fixed the biggest gaps a fan would notice, sim side and render side. Branch `wip/passing`.

## How it was audited

- **Video, on the frame-true clock.** Eleven passing clips (`PASSING` in `src/game/clips.ts`, found by `tools/sim/findpassing.ts`): a quick slant, a dig, a deep post, a back-shoulder fade, a touch pass over a linebacker, a throw on the run, a throw under pressure, a contested catch, a drop, and the arm pair (the same deep ball from Dan Marino, Throw Power 96, and Joe Montana, 72).
  - Recorded from frozen copies of the tree before and after (`BTB_VIDEO=1 BTB_PASSING=1 BTB_PASSING_TAG=before|after`), Low, 1280 wide, 20 fps. The passing clips stop 1.8 s after the ball is caught or dead.
  - Outputs: `before/`, `after/`, and `compare/` (before on the left, after on the right, the same play).
  - `tools/sim/passclips.ts` prints what each clip does in Node.
- **Numbers.**
  - `tools/sim/ballarc.ts` (new): launch speed and angle, apex, arrival speed and angle, by arm, distance and throw type, plus release time by rating.
  - `tools/sim/outcomes.ts`: the AI pass game.
  - `tools/sim/passidentity.ts` (new): the passing identity pairs.
- **Code.** `src/sim/ball.ts`, `passing.ts`, `play.ts` (the passing parts), `src/render/game/football.ts`, `choreo.ts`, `GameScene.tsx`, and the QB and catch clips.

## What the audit found (before)

### The QB

| | Before | Real football |
|---|---|---|
| Drop | `qb_drop_gun3/5`, `uc3/5` clips timed to a fixed set; the sim backpedals at 55% of top speed whatever the drop | 3/5/7-step rhythm from under center, 1/3 from the gun; a 7-step drop doesn't exist |
| Hitch | 0.3 s of standing still in the sim, no hitch step drawn | a step up into the pocket, the feet reset |
| Release by rating | 0.45 s at 70 Release → 0.30 at 99, but **one throwing motion for everyone**, played faster or slower | scouts time a quick release ~0.35 s and a long windup ~0.5 s+, and you can see the difference: the ball's path behind the head |
| Under pressure | the cone and the miss odds grow (M6.5 #1); **the motion is the same clean, stepping-into-it throw** | he throws off his back foot, arm only, falling away |
| Hit as he throws | a wrap during the windup smothers it, except in the last 0.1 s; **then the ball came out as a normal throw** | the arm doesn't finish: a fluttering duck, short, often picked |
| On the run | upper body of the standing throw over the running legs; cone by Throw on Run | fine for now |
| Eyes | the look-at follows the QB's read (`s.eyes`), then the ball | no look-off of the safety |

### The ball

| | Before | Real football |
|---|---|---|
| Speed (tools/sim/ballarc.ts) | driven 15 yd: 47 mph (75 arm) / 52 (95 arm); 40 yd: 54 / 60 | NFL release speeds ~45–60 mph (Next Gen Stats) |
| Over the arm | **a 75 arm's 55-yd ball left at 58 mph against his 54 max** (drag isn't in the range solve) | the arm is the limit; a weaker arm needs more arc |
| The AI's deep ball | **always driven**: a 40-yd post at 60 mph on a 15° line, 4 m apex, 1.5 s | a deep ball is layered: ~2.2–2.8 s of hang on the broadcast |
| Spin | the sim's `spin` += 12 rad/s (**115 rpm**), drawn about the long axis | a spiral spins ~600 rpm (Brancazio 1985; Rae 2003) |
| Attitude | the nose exactly along the velocity | the gyroscope holds the axis while the path bends: the nose rides a little above the path on the way down |
| A bad throw | spins and points exactly like a good one | a wobble; a duck |
| Off a hand, a helmet, a fumble | **still pointing along its velocity** (no tumble) | end over end |
| Incompletion | **the whistle froze it at z 0.05 yd, half sunk in the turf, nose first like a lawn dart** | it bounces like a football and rolls onto its side |
| Loose ball on turf (sim) | one low straight-on skid with a little scatter, every time | oblong: a skid off its belly, a high kick off its point, at an angle |
| Readability | true size; the catch call ("Space RUN") sat at 58% of the screen height, **across the ball's flight from the QB to his receivers**, and hid it | the ball in the air is the moment |

### The receiver

| | Before | Real football |
|---|---|---|
| Tracking | runs to the meant spot until he finds the ball (0.2–0.45 s by Catching), then to the real one | good |
| Hands up | the catch clip's secure frame on the arrival, chosen by catchLook | good |
| Catch type by ball | dive, one-hand, high point, over the shoulder, toe tap, body, hands (M6.5 #5) | good |
| A drop | **the catch clip played on into the tuck with no ball in it**, the ball popping away | the hands spring apart and chase it |
| Catch difficulty | contact, behind him, a fastball from close, a reach | also: **seeing it in late** (the ball on him out of his break before he's looked it in) and **tracking it over the shoulder** on a deep ball; neither cost anything |
| Open balls caught | 88.5% | PFF ~80% (the test's note) |

## What changed

### The QB

- **The throw is the man throwing it.** Three new clips, keyed in-house (`tools/blender/lib/actions_pass.py`; technique in its docstring). Every clip gate passes. `choreo.ts throwClip` picks one:
  - `qb_throw_quick`: the ball carried high, straight to the ear, a short stride, release on frame 8. For a Release time of 0.345 s or less (about 88 Release and up: Marino, Brees, Montana).
  - `qb_throw_long`: the ball dips toward the back hip before it loops up behind the head, a long stride, release on frame 14. For 0.43 s or more (about 74 and under: Winston).
  - `qb_throw_fade`: no step into it, the back foot drops, the trunk leans away, the arm delivers it high. Played standing with the sim's pressure at 0.6 or more (a free rusher within ~2.4 yd).
  - Each clip's release frame lands on the sim's release, at near its natural rate (0.89–1.04×).
- **Hit as he throws** (sim, `planThrow(..., hit)` from `play.ts` when he's wrapped as the ball leaves):
  - he led the receiver for the ball he meant, but it comes out 30% slower (hang × 1.3);
  - the cone is × 1.8, plus 0.3 on the miss odds;
  - its spiral is 0.1, a duck.
  - The pressure clip shows it: Node and the after video agree it's a sailed incompletion.
- **The arm is the limit:** a throw is never launched faster than his arm. A long throw from a weak arm goes up instead (a 75 arm's 55-yd ball: 2.37 s at 27°, 58 mph → 2.78 s at 35°, 54 mph).

### The ball

- **The AI layers the deep ball** (`layer()` in `passing.ts`):
  - past 24 yd of throw it gets touch, a 0.8 hold's worth by 44 yd;
  - the read (`ai.ts openness`) still judges the window on the driven ball. He reads leverage, then layers it, and the safety getting there is the deep ball's real risk.
  - Judging the window on the layered hang held every deep ball too long: sacks went 6.8% → 8.4%. That version was measured and rejected (below).
  - The player's throws are unchanged: a tap drives it, a hold layers it.
- **The spiral, drawn right** (`src/render/game/ballFlight.ts`, render only, deterministic from the play's seed):
  - Spin about the long axis at the throw's rpm. ~600 is the sim's `rpmOf`: 577 for a 72 arm, 651 for a 96, from Brancazio 1985 and Rae 2003. The drawn step is capped at 1 rad a frame so it doesn't strobe backward at a low frame rate.
  - The nose rides up to ~5° above a falling path.
  - A tight spiral precesses ~1.5°. The wobble widens as the throw's `spiral` drops (sim `spiralOf`: accuracy, pressure, platform, the run, the mechanics miss, the hit). A duck wobbles ~28° at 180 rpm.
  - The ball leaves from the hand the clip draws and blends onto the sim's flight over 0.1 s. Before, it popped from the hand to the sim's release point.
- **Off a hand, a helmet or a fumble it tumbles end over end** (2–4 rev/s about an axis across the ball, seeded).
- **The dead ball bounces like a football:** a render-only rigid-body bounce on its oblong shape, sub-stepped at 240 Hz.
  - It lands where the sim put it down.
  - Off a point it kicks up (restitution ~0.4–0.6) and turns up to ±50°; off its belly it skids low (~0.12–0.24) and rolls about its axis.
  - Each bounce's luck is a hash of the play, so the same play bounces the same way. It comes to rest on its side, never sunk in the turf.
- **The loose ball in the sim** (`footballBounce`, `play.ts`): about two bounces in five land on a point (kick up 0.35–0.55, off at up to ±60°, 35% of the pace kept); the rest skid off the belly (0.15–0.25, half the pace).
- **Readability:**
  - The catch call moved from 58% to 79% of the screen height, off the flight path.
  - The ball grows with distance from the camera: true size within 12 m, 1.6× by 45 m.

### The receiver

- **Seeing it in late** ('late' in `resolveCatch`). A ball on him less than 0.3 s after he found it costs up to 0.12 × (1.1 − Catching).
  - A sure-handed man on a quick slant (he finds it at ~0.22 s of a 0.5-s ball) pays almost nothing.
  - A poor-handed one pays 2–3 points.
- **Tracking it over his shoulder** ('tracking'): a deep ball (18+ yd) coming from behind him costs 0.07 × (1.1 − Catching) × (1.1 − 0.4 × Spectacular).
- The result card names both ("Dropped by X, he found it late", "…, over his shoulder").
- **The drop has a reaction:** `catch_drop` (keyed in-house) plays on the drop, or on a ball knocked out of his hands. The hands meet the ball on its secure frame, spring apart, chase it down in front of his knees, and the arms fall away. A full-body catch already under way (a high point, a dive) plays on.

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 15,600 plays):

| | Before | After | NFL |
|---|---|---|---|
| Completion | 68.4% | **65.7%** | ~64–66% |
| Yards per attempt | 8.6 | **8.1** | ~7 |
| INT | 2.0% | 2.4% | ~2.2–2.5% |
| Sacks | 6.8% | 6.8% | ~6.5–7% |
| aDOT | 9.4 | 10.9 | ~8 |
| Completions of 20+ | 17.8% | 16.0% | ~12–14% |
| Completions of 40+ | 4.6% | **6.3%** | ~3% |
| In phase (< 1 yd) targets / caught | 19.9% / 22.8% | 24.2% / 26.0% | |
| 2+ yd open caught | 88.5% | 87.8% | ~80% (the test's note) |
| YAC, short routes | 6.0 | 5.8 | 4–6 |

**Why completion fell (the mechanism, for the owner's pending decision).** No constant was tuned to a number. At 30 a cell:

- With the deep layer off, the catch costs and the hit took completion 68.4 → 68.0% and ypa 8.6 → 8.3. That is a small, real effect: the quick game's late look on poor hands, and deep tracking.
- The layered deep ball did the rest (→ 65.7%). Deep balls now hang ~0.2–0.4 s longer, so more of them are contested in phase (19.9% → 24.2% of targets) and more are picked (2.0% → 2.4%). That is the safety getting there, which is what a deep ball risks.
- The open-catch rate barely moved (88.5 → 87.8%). The owner's open-catch-rate lever is still there, untouched.

**Rejected variants** (30 a cell):

| Variant | Completion | ypa | Sacks |
|---|---|---|---|
| Read on the layered hang, full layer | 65.3% | 7.3 | **8.4%** |
| Read on the layered hang, lighter layer (from 28 yd, 0.6) | 66.6% | 7.9 | **8.2%** |

**The ball** (`tools/sim/ballarc.ts`, after):

| Arm | Throw | Hang | Launch | Apex |
|---|---|---|---|---|
| 95 | driven, 15 yd | 0.59 s | 52 mph at 4° | 2.1 m |
| 95 | driven, 40 yd | 1.49 s | 60 mph at 15° | 4.3 m |
| 95 | full touch, 40 yd | 1.93 s | 49 mph at 25° | 6.1 m |
| 75 | driven, 15 yd | 0.67 s | 47 mph | |
| 75 | driven, 40 yd | 1.74 s | 53 mph at 21° | 5.3 m |
| 75 | driven, 55 yd | 2.78 s | 54 mph at 35° | 11.1 m |

**Passing identity** (`tools/sim/passidentity.ts`, new; 7 of 7 pass; the two spiral checks didn't exist before):

| Pair | Measure | A | B |
|---|---|---|---|
| Marino (96) vs Montana (72) | deep-ball launch speed | 57.6 mph | 52.2 mph |
| | hang per 10 yd | 0.39 s | 0.45 s |
| | spin | 651 rpm | 577 rpm |
| Marino (98 Release) vs Winston (75) | windup | 0.27 s | 0.42 s |
| | throwing motion | quick | long |
| Montana vs Namath | ball off the meant spot | 0.84 yd | 1.55 yd |
| | spiral | 0.95 | 0.89 |
| Harrison (97 Catching) vs Slayton (59, Drops) | open balls dropped | 2.5% | 16.3% |

Slayton's 16% was the same before this pass (the Drops trait plus low Catching), so the late-look cost isn't what separates them.

**Other checks:**

- Identity harness: 19 of 20. Only Gates vs Lewis fails (top speed, waiting on the owner).
- Trait audit: 127 of 127 traits, 25 of 25 combinations.
- Film regenerated. Golden re-pinned (356 of 900 cases).
- The coverage identity clip was re-found: seed 42, Cover 2 man. Deion now picks it; Kam gives up 32 yd.
- The feel and concept clips still do what their ids say.
- `npm run check` passes. Two whole-book files only timed out under load (`sim-m6`, `legacy-diff`) and pass when re-run alone.
- The whole `e2e/practice.spec.ts` passes on this checkout's own port (`BTB_E2E_PORT=5301`, 7 of 7), including the browser reproducing the Node hashes.
- Its seeds were re-found with `tools/sim/e2eseeds.ts`, which now models the Practice Field's QB–receiver chemistry; without it, its seeds weren't the browser's. The seeds are now 2, 307 and 5.
- The catch-call test now reads the one-button prompt.

## Watched: an honest critique

Watched as contact sheets and full-resolution crops of the before and after recordings (`docs/passing/compare/`).

**What reads:**

- **The catch call off the flight path.** Before, "Space RUN" sat across the line of scrimmage and covered the ball on every quick throw. Now the slant's ball is visible all the way from the QB's hand to the receiver.
- **The dead ball.** Before, an incompletion stopped dead, half buried and nose down. Now the ball off the drop and the pressured duck lands, skips, and lies on its side.
- **The pressured throw is a hit-as-he-throws duck.** The ball sails toward the sideline and the camera rides it out. The old version was a normal throw.
- **The drop.** The receiver's hands come apart on the ball and it falls from him end over end; it no longer goes into a tuck with no ball. At the pushed-in catch camera it reads.

**What doesn't read (yet):**

- **The spiral and the wobble are below what these recordings can show.** At 1280 wide and 20 fps the ball is 6–12 px. 600 rpm at 20 fps is capped to 1 rad a frame, and the laces aren't resolvable. On the broadcast the tight spiral and the duck look alike. They should show at 60 fps on a real GPU, and in a replay camera when one exists; that isn't verified.
- **The arm pair is more felt than seen.** Marino's ball gets there ~0.2 s sooner on a 30-yd throw and leaves 5 mph faster. Side by side at broadcast distance the two flights look much the same. A 75 arm needs a lot more arc than a 95 only past ~45 yd (where the arm cap now bites). A starker look would need the weak arm to put more air on everything, which moves the whole pass-game calibration.
- **Montana and Marino both throw the quick motion** (both Release 98+), so the arm pair can't show the motion. The release difference is Marino vs Winston, which wasn't recorded.
- **The ball-size boost rarely shows** on these clips, because the pass camera rides the ball and keeps it within ~12 m. It helps when the camera doesn't follow.
- **40+ completions rose** to 6.3% of completions (NFL ~3%). The layered ball leads the man further (the touch lead), so when a deep ball is caught it's often caught in stride for a long gain. The test band (< 8%) holds, but it's high.

## Still open

- **The QB's drop:**
  - no hitch step is drawn (the sim's 0.3-s hitch is a standstill);
  - the sim's backpedal speed doesn't vary by drop;
  - there's no 7-step drop.
- **Eyes:** no look-off of the safety.
- **The receiver's head and hands before the ball:** he doesn't look back for the ball on a timing route coming out of the break, and the hands come up on the clip's lead, not from a reading of where he is.
- **A bobble and re-catch:** a drop is final for the man who dropped it.
- **The arm gap at broadcast distance** (above). And the 40+ tail.
- **INT at 2.4%:** realistic, but up 0.4 points; the layered deep ball is the cause.
- **Recording:** the spiral needs a 60-fps, closer recording to be judged.
- **The Gates vs Lewis identity pair** still waits on the owner's top-speed decision.
