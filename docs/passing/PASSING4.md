# The passing game, round 4: when to throw, the late out, the deep ball, the catch

The owner's standing complaint: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right." Round 3 (`PASSING3.md`) fixed the receivers giving up on their routes, the windup on the key, the settle routes and the hands to the ball, and left five things open. This round took them in the order the lead set. Branch `wip/passing4`, from `68dd2a4` (the tip of `claude/m66-polish`).

## How it was diagnosed

- **The player's throws, pressed on the cue** (`tools/sim/cuecheck.ts`, `cuetick.ts`): the key pressed the first tick the new throw-timing cue lights, on eight routes, four coverages and four seeds, for three QBs (Joe Montana, Dan Marino's quick release, Jameis Winston's long one); the ball's release against the man's real break.
- **The late out** (`tools/sim/lateout.ts`): the out (hot-routed on Doubles Curls, and the Quick Outs' quick out) thrown a third and two-thirds of a second after the break, and where the man was and which way he was going on his last tick before the ball got to him.
- **The deep ball** (`tools/sim/deepball.ts`): the go (two receivers), the post, the seam and the fade thrown by the player on the cue, a tap and a held touch, four coverages and eight seeds, for Joe Montana and for a weak arm (Chad Pennington: Throw Power 59, range 42 yd, Deep Accuracy 75): where the ball came down against where the man would be, the defender nearest him, and what happened.
- **The player's throws in numbers** (`tools/sim/passing3.ts`, unchanged from round 3) and **tick traces** (`tools/sim/p3trace.ts`).
- **Video**, the same scripted keys on the tree before this round (a frozen copy of `68dd2a4`) and on this branch, recorded on the frame-true clock (`tools/shots/video.spec.ts`, `BTB_PASSING4=1`; `src/game/clips.ts` `PASSING4`) and read as contact sheets and full-resolution crops.

## What was wrong, and what changed

### 1. A throw-timing cue on the receiver icon

**What was wrong.** Nothing on screen told the player when to throw. A ball comes out of the hand a release's length after the key goes down (`passing.ts` `releaseOf`: 0.26 s for a quick release, 0.45 s for a long one, `effects.ts:151`), and a key pressed on the drop waits for the plant (`play.ts:494` in the base, `qbThrow` `start`). The player had to anticipate both by feel; round 3 measured that a key pressed as the man breaks is a late ball by 0.3–0.45 s, and its "late" rows (`passing3.ts`) complete 10–40 points less than the on-time ones. The icon (`PracticeScreen.tsx:406`, `GameScene.tsx:569 placeHud`) only showed open or covered.

**What changed.**
- `src/sim/cue.ts` (new, read-only, pure): `throwCue(s, rec)` says when the ball should be out for this man (`ballOut`, sim time) and his QB's release. The break is found by running his route forward on a copy of him, on the movement model he really runs on (the same roll-forward `leadRun` leads him with: the stem, the braking into the break, a jam), to the route point the ball is timed to (`BREAK_AT`: the stem's top on every breaking route; the crosser's climb, the wheel's turn up, the angle's break back inside). A vertical (go, seam, fade) has no break: it's timed off the top of the drop and the hitch (`play.ts HITCH`), as the AI throws it. The ball can't come out before the plant (a key on the drop throws on it), so `ballOut` is the later of the two. Screens, the swing and the checkdown get no cue.
- `src/render/game/cueRing.ts` (new) draws it on the icon, as its own thin ring outside the icon's (`PracticeScreen.tsx`, `game.css`): the ring stands for the last 1.2 s before the ball should be out. **The gold segment at its end is this QB's release** (Marino's 0.27 s is a short arc, Winston's 0.42 s half as long again), **the white fill sweeps toward it, and when the fill reaches the gold the whole ring lights gold** ("now": press). After the break it drains away over half a second: a ball thrown then is late. A dark track under it keeps it readable on grass and on white jerseys. It is a time, not a key, so it reads the same on keyboard, pad or mouse. The football is untouched.
- The first version drew the cue inside the icon's own ring; on the recording the open glow's thick lime stroke and pulse swallowed it (`stills/cue-fill-dig.jpg` is the second version). It now has its own SVG outside the icon, which the open pulse doesn't scale.
- How to Play explains it.

**Is it true?** Pressing on the cue, the ball's release against the man's real break (`tools/sim/cuecheck.ts`, 4 coverages × 4 seeds each):

| Route | Montana (0.30 s) press → ball − break | Marino (0.27) | Winston (0.42) |
|---|---|---|---|
| Out | 1.39 s → +0.02 s | 1.44 → +0.03 | 1.27 → +0.03 |
| Quick out | 0.76 → +0.03 | 0.81 → +0.03 | 0.64 → +0.03 |
| Dig | 1.62 → +0.03 | 1.67 → +0.03 | 1.50 → +0.03 |
| Curl | 1.69 → +0.02 | 1.74 → +0.03 | 1.57 → +0.03 |
| Post | 1.53 → +0.02 | 1.58 → +0.03 | 1.41 → +0.03 |
| Crosser | 2.05 → +0.02 | 2.10 → +0.03 | 1.90 → +0.03 |
| Comeback | 2.01 → +0.02 | 2.06 → +0.03 | 1.90 → +0.03 |
| Slant (gun) | 0.35 → +0.09 | 0.35 → +0.05 | 0.35 → +0.22 |

The ball is out within two ticks of the break on every timed route, and the press moves with the arm: Winston's key goes down 0.17 s before Marino's for the same ball. The slant off the gun breaks at 0.58 s, before any arm can get the ball out (the arm can't start until 0.35 s after the snap): the cue lights at once and the ball is as early as that QB can make it; a long release is still 0.2 s late there, which is Winston's slant.

### 2. The late out drifted to the boundary

**What was wrong.** `ai.ts routePoints` (base line 74) turned an out that runs out of field into an out-and-up: a point 12 yd up the sideline, 1.5 yd inside it; an out from the slot that ended short of the sideline ran on toward it and bent upfield there (`continueDir`, line 118). The lead (`passing.ts leadRun`) led him to where he'd be on that path, and `boundaryGovern` (`movement.ts:181`) braked him as the sideline came up. So a late out was a long ball to the boundary with the man slowing under it and caught on the white (round 3's `p3-out-late`: 8 → 3 yd/s over the last second, caught 1.6 yd from the sideline; `stills/out-late-before-sheet.jpg`).

**What changed.**
- `ai.ts routePoints`, `OUT_TO_BOUNDARY` (the out, the quick out, the sail): the out is run to the sideline landmark (1.5 yd inside) and back down it: a settle point 1.5 yd back toward the line and 0.8 yd inside. Unthrown, he gets to the sideline, plants and comes back to the QB (the route's last leg turns back, so it's one of the settle routes that come back to the ball: round 3's `comesBack`, `runToBall`).
- `passing.ts workBack`: a ball thrown to a man still running his out, that would meet him within 2.5 yd of the landmark, doesn't lead him there. He plants short of the boundary with half a second to spare (`OUT_COME_T`) and works back down the line to it, inside the sideline, and the QB throws to where he'll meet it (his route is moved in at the release, so the lead and his run agree). An out thrown on time, or a man with room, is untouched.
- `planThrow`/`previewThrow`: the meant catch point is kept 0.8 yd inside the sideline (`IN_BOUNDS`): the QB leads him in bounds; the error can still push it to the white, where the catch is a toe tap.
- `ai.ts optionRead` reads a Slot Weapon's quick out by the book's drawing (the new settle at the sideline made it read the out as a settle route; `tests/traits-usage.test.ts` caught it).

**Numbers** (`tools/sim/lateout.ts`, the man's last tick before the ball got to him, 4 coverages × 8 seeds):

| Late out | Complete | Inside the sideline | Toward it | Downfield |
|---|---|---|---|---|
| Out (X), key 0.33 s after the break | 34% → **44%** | 1.9 → **3.7 yd** | +0.7 → **−1.5 yd/s** | +2.8 → **−2.6 yd/s** (back to the QB) |
| Out (X), 0.67 s after | 31% → **50%** | 1.9 → 2.4 | −0.4 → −1.7 | +5.1 → −1.4 |
| Quick out, 0.33 s after | 81% → 66% | 1.3 → 2.1 | +3.8 → +3.7 | +3.0 → +0.6 |
| Quick out, 0.67 s after | 47% → **69%** | 1.0 → 2.2 (88% → 0% caught within 1.2 yd of it) | +1.3 → −1.7 | +4.0 → −3.1 |

Before, a late out was caught drifting up the sideline on the white; after, he's caught 2–4 yd inside it coming back to the ball. `passing3.ts`'s late out: 34% → 47% complete. The quick out thrown a third of a second late is the one cell that fell (81% → 66%, 5 balls of 32): the ball meets him as he brakes into the plant at the boundary, where before it met him turning up the sideline at speed. That's the honest cost of planting at the sideline instead of running an out-and-up nobody called.

### 3. The deep ball: where it's put, and whose arm it is

**What was wrong.** Measured from the player's side on the cue (`tools/sim/deepball.ts`), the deep ball wasn't badly led: it came down within ~0.2 yd of where the man would be, ahead of him, on the go, post and seam. What decides the go is the corner in phase: the nearest defender is 0.6–0.9 yd from the ball when it gets there, level with the man and a third of a yard inside him, and a third to half of the goes are broken up. Two things were wrong with *how* it was put there:
- the meant point was the man's own spot (`passing.ts:502` in the base: lead plus placement along his run), whoever was on him: never ahead of a trailer or away from the defender's side, the "throw him open" a fan sees on a completed go;
- the misses were the same from any arm until the range ran out (`passing.ts:572`: the timing error symmetric along his run, a ball past his range dying short): a weak arm's deep ball didn't come up short of the man; a cannon's and a noodle's looked alike.

The user's go at "about 25%" (round 3) was largely timing: the round-3 harness pressed it 0.13 s later than the hitch; on the cue it completes 34–44% for a tap (below).

**What changed.**
- `passing.ts bucket`: a vertical with a man on him (within 4 yd) is put ahead of a trailer (0.6 yd) and over the shoulder away from the defender (0.7 yd across; to the sideline side when he's straight behind or over the top), coming in from 12 air yards to all of it by 20, scaled by deep accuracy (none at 70, all at 95: Montana and Marino drop it in the bucket, a scattershot arm throws at the man). A placement the player asks for with the mouse is his own.
- `passing.ts` `UNDER_FROM`/`UNDER_MAX`: from 60% of his range a throw comes up short along its line, up to 2 yd at the limit: a 75-arm's 45-yd post lands ~0.8 yd short; Marino's (range 77) not at all.

**Numbers** (`deepball.ts`, the player on the cue, the go to two receivers, the post and the seam, tap and touch, 4 coverages × 8 seeds, 256 throws per QB):

| | Before | After |
|---|---|---|
| Joe Montana (Deep Accuracy 95, Throw Power 72) | 45.0% | 46.5% |
| Chad Pennington (Deep 75, Throw Power 59, range 42 yd) | 37.1% | **31.8%** |

The gap between an elite deep passer and a weak arm went from 8 to 15 points; Pennington's seam fell from 56% to 48% and his go from 21% to 16%. The bucket itself moved Montana's completion only 1.5 points: with the corner in phase a 0.7-yd shift doesn't take the ball out of his reach (the contest weight is full inside a yard, `resolveCatch`'s `CONTEST_R`), and on the recorded go (`stills/go-before-after.jpg`) the safety is over the top, where the bucket rightly adds no lead, so the before and after catches look the same.

### 4. The run-speed hands catch

**What was wrong.** `tools/blender/lib/actions_m65.py:145` (`hands_run`): the hands came up from the run 0.09 s before the ball, the ball was secure on frame 8 and tucked on frame 13 (30 fps): 0.17 s in the hands. A catch in stride read as a snatch.

**What changed** (keyed in-house, `python3 tools/blender/build_anims.py`, 178 of 178 clip gates; only `catch_hands_run` and `catch_hands_run_low` changed in `anims.glb`/`anims.json`): eyes, hands, tuck. The hands come up from the run to the chest as the ball comes (0.2 s out), out to it in the diamond at the last moment (late hands), give back toward the chest as it lands (0.06 s), bring it in to the sternum with both hands on it, and only then put it away high and tight: secure on frame 9, tucked on 19, **0.33 s in the hands**, two strides, the legs never breaking stride (an arms-only overlay). The low (pinkies) version the same. Round 3's IK reach to the ball and the hold of the ball in the hands until the tuck (`choreo.ts catchReach`, `catchHold`) use the clip's events, so they follow it.

### 5. The air camera

**What was wrong.** `GameCamera.tsx airPose` (base line 215): the camera's line in the air was the throw's direction with its cross-field part at 80%, so an out to the boundary from the far hash swung the view ~35° toward the catch inside a second.

**What changed.** The line turns at most 15° off straight downfield (`AIR_YAW`); the camera still rides the ball and pushes in on the catch.

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,875 attempts):

| | Before (round 3) | After | NFL |
|---|---|---|---|
| Completion | 66.6% | 67.7% | ~64–66% |
| Yards per attempt | 8.1 | 8.2 | ~7 |
| INT | 2.4% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 9.0 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 16.5% / 4.4% | 16.2% / 4.4% | ~12–14% / ~3% |
| 2+ yd open caught | 88.7% | 89.5% | ~80% |

The point of completion is the out family (`outcomes.ts --routes`, 20 a cell): the quick out 74% → 79%, the sail 67% → 72%, the rest within a point. An out not thrown on time now comes back to the QB at the sideline instead of running up it, and the AI throws some of those. The book stays inside the 62–68% the lead set, near its top.

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | 19 / 20 (Gates vs Lewis, waiting on the owner, as before) |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 (Montana 0.73 yd off the meant spot, Namath 1.47) |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (`slants.ts`), on time zone / man | 62% / 66% | 62% / 66% (late throws within a few balls) |
| Screens (`screens.ts`) | unchanged | unchanged, every coverage |
| Cue truth (`cuecheck.ts`) | (no cue) | ball within 0.03 s of the break on every timed route |

Re-found for this round: the determinism golden (153 of 920 cases moved: the out's route, the late out's work back, the bucket, the short arm) and the coordinator's film (`src/sim/film.ts`); the completion-rac clip (Cover 3 seed 25, the seam and 23 yd after it), the touchdown clip (Cover 2 seed 78) and the coverage identity clip (Cover 2 man seed 37: Deion breaks it up, Kam gives up 39). The e2e seeds (`tools/sim/e2eseeds.ts`: the full play on 4, the touchdown on 19, the stick tackle on 2) still hold.

## The videos

Recorded on the frame-true clock at 20 fps, 960×540, Low, the player's own keys from the default broadcast camera (`BTB_VIDEO=1 BTB_PASSING4=1`, `tools/shots/video.spec.ts`; the round-four clips are `src/game/clips.ts PASSING4`, fixed ticks so the same keys play on the tree before the cue). The before set is a frozen copy of `68dd2a4` on its own dev server. 960 wide and 20 fps because this container draws a frame in 10–20 s.

- `round4/before/`, `round4/after/`: `p4-out-late` (the out pressed 0.33 s after the break), `p4-go` (the go on the cue, held for touch), `p4-out` (the out on the cue: the air camera); after only: `p4-cue-dig` (the dig on the cue, Montana), `p4-cue-dig-marino`, `p4-cue-dig-winston` (the same dig, each QB pressing on his own cue).
- `round4/before-close/`, `round4/after-close/`: `p4-slant` from the close camera on the receiver (`?follow=X,5,-5,2,42`), the catch in stride.
- `round4/compare/`: before on the left, after on the right (`p4-out-late`, `p4-go`, `p4-out`, `p4-slant-close`), and `p4-cue-qbs.mp4`: Marino, Montana and Winston side by side on the same dig.
- `round4/stills/`: the sheets and crops this write-up cites.

{{CRITIQUE}}

