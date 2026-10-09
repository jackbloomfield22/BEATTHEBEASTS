# The passing game, round 6: the ball, the hands and the lead

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 5 (`PASSING5.md`) made the catch a moment and left the deep ball's last yard, the deep ball's own catches, the carry arm and the early arrival open. This round took them in the order the lead set. Branch `wip/passing6`, from `8a67d95` (the tip of `claude/m66-polish`).

## How it was diagnosed

- **Where the ball meets him, in the sim** (`tools/sim/p6lead.ts`, new): the player's tap on the throw-timing cue to the go, the post, the corner, the crosser, the out and the slant, four coverages, sixteen seeds, for Joe Montana and for Chad Pennington (Throw Power 59, Deep Accuracy 75). For every throw: how far ahead of the man the QB put the ball against how far he runs in its hang (the lead), his speed through the flight, and where the ball was against his body on the tick the sim called the catch.
- **Where it meets him, on screen.** Round five's per-frame log (`BTB_DIAG=1`, `tools/shots/video.spec.ts`): the drawn ball against the midpoint of his finger roots, frame by frame through the catch.
- **The man under the ball in the AI book** (`tools/sim/p6stand.ts`, new): every throw of every base pass play against every call; how long the man stood under it, and his speed two-thirds of the way through the flight against his speed at the release, by how far the ball was off its meant spot.
- **The clips in Blender** (`tools/blender/preview_catches.py`, `preview_clips.py`): the deep ball's catches laid over the run, and the full-body ones from the side and three-quarters.
- **Video**: the same plays on a frozen copy of `8a67d95` (with the round-six clip list added) and on this branch, recorded on the frame-true clock at 30 fps, 960×540, on Low, from the broadcast camera and a close one on the catcher.

## What was wrong (root causes)

1. **The deep ball's last yard: the sim caught the ball a yard before it got to his hands, and the QB threw it at his body.**
   - `src/sim/passing.ts:1338` (base): the catch was called on the first tick the ball came within his reach (`reach().r`, ~0.85 yd) of his *centre*.
   - `passing.ts:673`: the QB's meant point was where his *centre* would be.
   - `passing.ts:23`: it was thrown to 1.25 yd (1.14 m, his belly).
   - On a deep ball dropping in from behind him, the ball comes within 0.85 yd of his centre behind his shoulder. `p6lead.ts`, Montana's go on the cue: at the catch the ball was 0.41 yd *behind* his centre and 0.66 yd inside him, at head height.
   - The drawing put his hands out in front of his face mask. On the catch frame the drawn ball was **0.89 m** off his hands (the base's go and out logs), then jumped **1.03 m** into them in one frame (`GameScene.tsx:536`'s catch-in, clamped to 1–3 frames).
   - From any camera, that also reads as a ball that didn't lead him: it came in behind his shoulder and was yanked forward into his hands.
2. **The hands were aimed at a guess.**
   - `choreo.ts:1220` timed the clip's secure frame on a guess at when the hands would meet the ball, from his Catching. The sim's catch was somewhere else.
   - `choreo.ts:519–524`: the across vector for the two hands was built in `_hr`, which the right hand's target then overwrote mid-expression, so the right hand went off the ball's line.
3. **The deep ball's catches were M6.5's, keyed standing up** (`tools/blender/lib/actions_m65.py:433` over the shoulder, `:255` high point, `:571` toe tap).
   - The over-the-shoulder overlay had round five's in-stride bug: keyed on the idle body, over the run it put the hands low and close, at the face mask, the chest square to the goal line. That's a man catching a ball in front of his face, not one looking it in over his shoulder.
   - This matters more than it sounds: in the AI book and on the player's cue, nearly every completion on the go, the post and the corner is drawn over the shoulder (`p6find.ts`).
   - The high point folded forward on the way up.
   - The toe tap leaned out only a little.
4. **The ball was always in the right arm** (`choreo.ts:1257`, `ovl_carry_r`; the carry gaits have the right-arm tuck baked in).
5. **The man under a short ball eased up the moment he read it** (`src/sim/play.ts:1962`). A ball a stride or two short got round three's late throttle; anything shorter he slowed for at once, at the pace that met it. On a deep underthrow he jogged under the ball for most of its flight. `p6stand.ts`: under a ball 3+ yd off, at two-thirds of the flight he was at 85% of his release speed, so he was there early and waiting.
6. **The scoop lost to the dive** (`passing.ts:985`): "low and more than 1.1 yd away" was measured from his body, so a low ball a step in front of his hands laid him out.

## What changed

### The catch at his hands (sim: `src/sim/passing.ts`, `play.ts`)

- **Where his hands are**: `handsAt(a)`, out in front of him along his run by his pluck. A Catching 95 takes it at the end of his arms (`HANDS_FAR`, 0.79 yd ≈ 0.72 m); a 60 has his elbows bent (`HANDS_NEAR`, 0.49 yd). These are round five's drawn `MEET_FAR`/`MEET_NEAR`, now the sim's. `pluckOf` moved here from `catchstyle.ts`, which re-exports it.
- **The QB leads him to his hands**: the meant point is `LEAD_HANDS` (0.6 yd) ahead of where he'll be, along the way he'll be running (at the QB for a man sitting down). `previewThrow`'s reticle agrees. Air yards are still marked to his body, so the stat doesn't move.
- **The ball is thrown to his chest**: `CATCH_Z` 1.25 → 1.45 yd (1.33 m, the sternum, where round five's clips key the diamond). The line a ball passes under a rusher's hands at the line rises with it (`BAT_UNDER`).
- **He runs his body to where his hands meet it** (`play.ts runToBall`): the ball's spot less his hands' reach. Before, he ran his centre to the ball's spot.
- **The sim takes it at his hands**:
  - `stepAir`: the man it's thrown to reaches round his hands (his full reach) and round his body (`BODY_REACH`, 0.55 yd).
  - While the ball is still closing on the line from his chest out to his hands, and will still be his next tick, it flies on (`comingIn`). It flies on for at most `DEFER_MAX` (0.25 s), and no defender is nearer it than he is.
  - `catchAhead(s, a)` steps the same flight forward and says when and where the sim will call the catch. The drawing uses it.
- **Contested where it came to him**:
  - A defender plays the ball on its way into the hands, so the contest and the separation stat are measured where the ball first came within his reach of his body. That was round five's catch point, the one the contest odds were sized on.
  - Measured at the hands instead, the AI book went from 67.7% to 70.5% (every trailing defender a yard further from the ball). Contested at the hands' body point, Tyreek Hill's yards after the catch fell under Wes Welker's (identity) because more tight balls were caught. Both versions are in the history.
- **The scoop**: the dive's "away" is now measured from his hands, so a low ball he's running onto is scooped in stride.

### The drawing meets the sim (`src/render/game/choreo.ts`, `GameScene.tsx`)

- **The secure frame lands on the sim's catch.**
  - Every catch except the body catch starts its clip so its secure frame lands on the tick `catchAhead` predicts.
  - `paceCatch` re-times it every frame until then (0.6–1.6× its keyed pace) as he speeds up or eases off.
  - The body catch still lets the ball on past his hands into his chest (`BODY_MEET`).
- **The hands track the ball into the catch frame.**
  - Over the last tenth of a second the IK target moves from the predicted catch point onto the ball where it's drawn this frame.
  - On the catch frame itself (the last tick in the air drawn into the catch), the hands go onto the drawn ball, and that's where they hold and give from.
- **The catch frame shows the ball on its own flight**, between the sim's two spots. It's in his hands because his hands are there; it no longer flies a yard in one frame.
- **Over the other shoulder is the same catch**: the catch event no longer restarts an over-the-shoulder, toe-tap or dive clip on the other side when the side read at the catch differs from the one read as it came. On the recorded go it had flipped `_r` to `_l` on the catch frame.
- The `_hr` aliasing is fixed (`handsOn`, its own across vector).

### The deep ball's catches, keyed again (`tools/blender/lib/actions_p6.py`, new)

All are keyed in-house (`python3 tools/blender/build_anims.py`: **193 of 193** clip gates pass; 184 before, plus the nine below). They replace M6.5's three in the registry; the old keys stay in `actions_m65.py` for reference.

- `catch_over_shoulder_l/_r` (overlay over the run, keyed on round five's `RUN_BASE`, the run's mean trunk, so the keys land where they're keyed):
  - the upper back turns about 30° toward the ball and the chest lifts;
  - the hands come up late from the run's carriage, out and away in front of the face mask (~0.5 m ahead of the chest, ~1.6 m up) in the basket, pinkies together and palms to the sky;
  - the ball drops in (the secure frame), the hands give 8 cm with it, bring it to the sternum by +0.15 s and tuck it by +0.3 s.
  - The legs never leave the run, and the runtime turns his head to the ball.
- `catch_high_point` (full body; M6.5's legs, flight and footfalls):
  - both arms swing up *together* from a loaded gather, through the face, to full length; the hands meet the ball above and in front of the helmet at the top of the jump (the secure frame, paced to the sim's catch);
  - the trunk's run lean comes out, so he's long and a touch arched at the top;
  - the ball comes down to the chin, then the tuck.
- `catch_toe_tap_l/_r` (full body):
  - the hips tip toward the line and the trunk leans out over it (22° at the pelvis, ~56° through the spine) with both arms long, high and outside;
  - the catch on the inside foot, the outside foot taps on its toes;
  - the inside foot's toe drags in bounds, pointed and trailing long (it scrapes forward 0.32 m while he moves ~1.5 m);
  - then the ball comes in to the chest and is tucked.

### The ball in the outside arm (`actions_p6.py carry_left`, `src/anim/*`, `choreo.ts carrySide`)

- **The left-arm clips are built in code from our own** (CLAUDE.md rule 6: variants from our clips).
  - Each of the eight carry gaits gets a `_l` twin: the right-arm gait half a cycle on, mirrored. Mirroring swaps the legs, the half cycle swaps them back, so the left foot plants on the same phase and the twin blends on the shared phase with everything else.
  - `ovl_carry_l` is the mirror of the carry overlay.
- **The animator** blends the carrier families' weight between the right-arm and left-arm sets (`familyWeights`'s `left`, eased like the carry). `library.ts` falls back to the right-arm twin for an older library.
- **Which arm** (render only, from the sim's state):
  - away from a tackler within 5 yd; in the open, toward the sideline when he's more than 4 yd off the middle.
  - He wants it there for 0.25 s before it moves, and keeps an arm at least 0.8 s, so it doesn't flick back and forth.
  - A cut moves it at once.
  - A move keyed with the ball in the right arm (the spin, the juke, the stiff arm with the left) takes it back to the right.
- **The switch**: 0.22 s with both hands on it at the chest (`ovl_protect`), the ball sliding across from one forearm to the other.
- After a catch the tuck is still in the right arm (every catch clip tucks right); on the left side of the field it then goes across to the outside arm. That's the receiver's own coaching: catch, tuck, switch it outside.

### The man under the ball (`src/sim/play.ts runToBall`)

- **Under a short ball he holds his stride and brakes late**, at his own deceleration (`BRAKE_K` 0.7 of his cut: an agile receiver plants later than a big one), to meet it as it comes down.
- A ball too short to stop for even braking now: he pulls up at once and comes back to it.
- He still drifts to it as he reads it (round three's read, from the meant spot to the real one) and goes up for a high one when he can (the sim's high point).

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,873 attempts):

| | Before (round 5) | After | NFL |
|---|---|---|---|
| Completion | 67.7% | **66.5%** | ~64–66% |
| Yards per attempt | 8.2 | **7.8** | ~7 |
| INT | 2.4% | 2.3% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 16.2% / 4.4% | 14.9% / 3.7% | ~12–14% / ~3% |
| 2+ yd open caught | 89.5% | 86.8% | ~80% |

The book moved toward the NFL on every line, and completion is no longer at the top of the band. The deep routes are a touch harder. The ball is at his hands a few ticks later than it was at his body, so the man chasing him is a little closer: corner 57% → 52%, go 40% → 42%, post 31% → 44% (64 throws). The short game is unchanged (drag 77%, quick out 80% → 79%, slant 47% → 50%).

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | IDENTITY_AFTER |
| Passing identity (`passidentity.ts`) | 9 / 9 | PASSID_AFTER |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | TRAIT_AFTER |
| Slants (`slants.ts`), on time zone / man | 62% / 66% | SLANTS_AFTER |
| Screens (`screens.ts`) | | SCREENS_AFTER |
| Clip gates (`build_anims.py`) | 184 / 184 | 193 / 193 |

**The catch, in the sim** (`p6lead.ts`, the player's tap on the cue, 64 throws a route):

| Joe Montana | Lead ÷ his run in the hang | Ball at the catch, along his run (+ ahead of his centre) | across | Complete |
|---|---|---|---|---|
| Go | 1.07 → 1.09 | **−0.41 → +0.38 yd** | −0.66 → −0.38 | 34% → 47% |
| Post | 1.03 → 1.07 | +0.09 → +0.83 | −0.45 → −0.06 | 53% → 47% |
| Corner | 1.07 → 1.09 | −0.19 → +0.60 | +0.36 → +0.26 | 61% → 59% |
| Crosser | 1.02 → 1.05 | −0.73 → −0.15 | | 52% → 55% |
| Out | 1.40 → 1.47 | −0.28 → +0.72 | | 75% → 69% |
| Slant | 1.21 → 1.34 | +0.44 → +1.14 | | 73% → 59% |

- The QB was already throwing to where the man was going: the lead was a full run ahead of him at the release (round four's finding, measured again).
- What was wrong was the last yard. The ball was taken behind his shoulder; now it's taken out in front of him, in his hands.
- The slant on the cue lost 14 points over these 64 throws. Most of it is two snaps, repeated across the four coverages because they share the throw's dice: the ball is now aimed 0.6 yd further along the slant, inside, and passes within a defensive end's reach at the line, where he bats it. The AI book's slant went 47% → 50%; the slant harness is below.
- **A weak arm visibly misses.** Pennington's go: the ball 2.1 yd off its meant spot (Montana's 1.0), and his receiver slowing from 8.7 to 7.4 yd/s to come back to it (Montana's runs through at 8.5). His corner: 3.1 yd off, slowed to 79% of his speed.

**The drawn catch** (the per-frame log, the frame the sim calls the catch):

| | Before | After |
|---|---|---|
| The go: drawn ball to his hands on the catch frame | 0.89 m | **0.06 m** |
| ...and the ball's move into the hands on the next frame | 1.03 m | 0.16 m |
| The out | 0.91 m, then 1.06 m | 0.04 m, then 0.24 m |
| The crosser (before only) | 1.02 m, then 1.03 m | |

**The man under the ball** (`p6stand.ts`, the AI book, his speed two-thirds of the way through the flight ÷ his speed at the release):

| Ball off its meant spot | Before | After |
|---|---|---|
| on (< 0.7 yd) | 1.06 | 1.05 |
| 0.7–1.5 yd | 0.98 | 1.00 |
| 1.5–3 yd | 0.95 | 0.99 |
| 3+ yd | 0.85 | **0.94** |

No man on a route that runs through the catch stands under the ball in either version. The settle routes (the hitch, the curl, the spot) still sit for a beat on 32% of their throws (33% before): see Still open.

**Re-found for this round:**
- the determinism golden: 568 of 920 cases moved, every one a pass play (the catch at his hands, the lead to the hands, the chest-high ball);
- the coordinator's film (`src/sim/film.ts`, with its own tool);
- the feel clips (`tools/sim/p6_refind.ts`, `p6_feel.ts`): completion-rac (Cover 3 seed 47 → 65, the tight end's seam), broken-tackle (icon 2 → 3, the same snap), the touchdown clip (Cover 2 seed 78 → 79, still 70 yd to the end zone; the M7 celebrations' browser test plays it); the scramble drill holds at seed 17;
- round five's contested clip (Gronk on Lott: the leak → the Y-cross against Cover 1, seed 3).

The e2e seeds (`tools/sim/e2eseeds.ts`: the full play on 4, the touchdown on 19, the stick tackle on 2) still hold.

## The videos

Recorded on the frame-true clock at 30 fps, 960×540, on Low (`BTB_VIDEO=1 BTB_PASSING6=1 BTB_DIAG=1`; `BTB_FOLLOW=1` for the close camera), encoded at crf 28. The before set is a frozen copy of `8a67d95` with the clip list added, so it's the same play and the same keys. This container drew a frame in 5–20 s.

- `round6/before/`, `round6/after/`: the broadcast camera.
  - `p6-go`: Montana to Rice's go on the cue, over the shoulder.
  - `p6-out`: the hot-routed out on the left sideline.
  - `p6-weak-go`: the same go thrown by Chad Pennington.
  - `p6-cross`: before only.
  - after only: `p6-shoulder` (the Z's go, touch), `p6-highpoint` (GO UP), `p6-toetap` (the quick out at the sideline), `p6-carry` (the ball in the outside arm). Their before is round five's `round5/after/p5-shoulder`, `p5-highpoint` and `p5-toetap`: the same plays on the same tree.
- `round6/before-close/`, `round6/after-close/`: the close camera on the catcher.
- `round6/compare/`: before on the left, after on the right.
- `round6/stills/`: the sheets cited below.

## Watched: an honest critique

CRITIQUE

## Still open

STILLOPEN
