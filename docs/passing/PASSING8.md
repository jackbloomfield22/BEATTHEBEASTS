# The passing game, round 8: the hands get there, the low basket, the arm slot, the box-out

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 7 (`PASSING7.md`) left the ball taken beyond his hands, the low ball over the shoulder, the invisible throwing lane and the box-out open, with two identity pairs sitting on their yards-after-catch line. This round took them in the order the brief set:
- the forward-reach catch;
- the low over-the-shoulder look;
- the QB's arm slot around or over a rusher;
- the box-out on contested catches;
- the book's realism (completion, open balls caught), through realistic causes only;
- broadcast readability, if time allowed (it didn't: see Still open).

Branch `wip/passing8`, from `d4ebdf0` (the tip of `claude/m66-polish`).

## How it was diagnosed

- **What a drawn arm reaches.** `tools/blender/measure_reach.py` (new) lays a catch overlay over the run the way the runtime does (`preview_catches.py over_run`) and prints, at the secure frame, the finger roots (where the runtime holds the ball), the fingertips, the shoulders and the chest against his centre. I read it next to `tools/sim/p8_catchrel.ts` (new): for every catch in the AI book (and the player's cue throws), the ball at the catch tick against his centre, along his run and across it, and its height.
- **The balls nobody touched.** `tools/sim/p8_miss.ts` (new): for each AI throw to a receiver that ends untouched, its closest approach to his hands, where it passed him and the ball's speed against his. `p8_trace.ts` prints a clip's last half second tick by tick.
- **The lane.** `tools/sim/p8_lane.ts` (new): how often, and how far, round seven's `throwingLane` moves the release in the AI book.
- **The yards after the catch.** `tools/sim/p8_yac.ts` (new) breaks the identity harness's X and TE yards after the catch down by play, at any sample; `p8_boxstat.ts` counts how often a tight end boxes a man out; `p8_slantyac.ts` asks what ends a slant after the catch.
- **The clips.** `tools/sim/p8_clips.ts` runs the round's video plays in Node as the Practice Field does: the lane on the throw, the drawn style and where the sim will take the ball a fifth of a second out, the box-out, how it ended.
- **Video**, with round five's per-frame catch log (`BTB_DIAG=1`; it now also logs the trunk's fold): the same plays recorded on a frozen copy of `d4ebdf0` with the round-8 clip list added, and on this branch, on the frame-true clock at 30 fps, 960×540, on Low, from the broadcast camera and from a close one.

## What was wrong (root causes)

1. **The sim took the ball where no drawn arm could.** `src/sim/passing.ts:1527` at `d4ebdf0` (`stepAir`), `:1666` (`catchAhead`).
   - The man it's thrown to took it anywhere within his reach (`reach().r`, 0.85 yd for a 6'2" man) of his hands point (`handsAt`, 0.49–0.79 yd ahead of his centre): up to 1.64 yd out in front, in principle.
   - In the AI book 3.6% of catches were taken more than 1.05 m in front of his centre, the longest 1.49 m (`p8_catchrel.ts 8`). On the player's slant on the cue (seed 1, Cover 3) it was 1.15 m.
   - The run-speed catch clips put the finger roots at most 0.67 m ahead of his centre (`measure_reach.py`: in `catch_hands_run` the arms are already straight and the shoulders only 0.05 m ahead of the hips). Nothing folded the trunk to go further.
   - The recorded slant (before): on the catch frame the ball is 1.15 m ahead of him and his hands 0.70 m, 0.46 m apart; the next frame it's in them.
2. **A low ball over the shoulder was drawn hands-high.** `src/render/game/choreo.ts:331` at `d4ebdf0`: over the shoulder had one clip, the basket in front of the face mask (~1.7 m), whatever the height the sim would take it at. On the recorded deep corner (Smash against Cover 2, seed 5) the hands wait at 1.66 m while the ball comes in to 0.81 m; on the catch frame they are dragged down to 1.04 m, 0.29 m off it.
3. **The arm slot never changed.** `src/render/game/choreo.ts:379` (`throwClip`) chooses the motion by the QB's Release and his pressure only. Round seven's `throwingLane` (`passing.ts:758`) moves the release up to 0.4 yd off a lineman, on 56% of the AI book's throws, by 0.3 yd or more on a third (`p8_lane.ts`). The ball's flight blended from the hand onto the new line; the arm did what it always did.
4. **The box-out was an odds term and a lean.** `passing.ts:1211` (`BOX_MASS`, `BOX_STR`) moved the contested-catch odds by the pair's mass and Strength, and the render's contest lean (`choreo.ts:239 boxShare`) leaned the bigger man into the other. Nothing kept the defender off the catch point, the bodies' push gave ground by mass only, and the catch clip was the generic contested one.
5. **Gronkowski's broken tackles gained nothing.** The Gronk/Gonzalez pair sat on its 0.8-yd line after the catch because the sim's honest gap was 0.78 yd at 144 reps a man (`p8_yac.ts`). He broke 2–3 times as many tackles as Tony Gonzalez (0.37 a catch on the seam to 0.16, 0.18 to 0.07 on the Y-cross), but every broken tackle outside the pocket was an arm he dragged (`play.ts:1454`, `tackle.ts grab(... 'arm')`) until the next man arrived, so it bought little ground. The Bruiser trait ("DBs tackling him alone lose the collision 20% more often") was only the 20%.
6. **Tyreek Hill's margin was noise.** The X yards after the catch ran on three times the reps. On the frozen base, at six times, Hill over Wes Welker reads +0.99 yd (+0.85 at three times); at nine times (`p8_yac.ts 54`) +1.05. A handful of long runs a man moved it a tenth either way.
7. **The book's open-ball catch rate.** "2+ yd open caught" 86.0% (PFF-like ~80%). One reason was cause 1: a ball led a stride long, out past where hands reach, was caught anyway, with no difficulty for it.

## What changed

### The forward reach (`tools/blender/lib/actions_p8.py`, `src/sim/passing.ts`, `src/render/game/choreo.ts`, `src/anim/animator.ts`)

- **`catch_reach_out`, keyed in-house** (overlay over the run; arms, the whole spine and the neck): late hands out of the carriage, then the trunk folds ~50° further forward from the lower spine, the shoulders going after the hands, the arms long, the diamond at chest height; the fingers take it, the elbows bend to absorb it, the trunk comes back up as it comes to the sternum, then high and tight. The neck extends back so the face stays up on the ball. `measure_reach.py`: finger roots 1.00 m ahead at the secure frame (fingertips 1.09, shoulders 0.34).
- **The drawing picks it** for a hands catch the sim will take more than 0.78 m in front of him (`REACH_OUT_FROM`), from where the sim will take it (`catchPoint`, from `catchAhead`), not the throw's aim.
- **The trunk goes after the hands** (`animator.ts reachTrunk`): when the hands' targets are past what the arms reach from the shoulders as the clip has them, the spine folds toward them, up to 25° more, by the hands' weight. For any catch clip, forward, across or up.
- **The hands go for it from where the shoulders will be** (`catchReach`): round seven measured the ball's catch point from where his shoulders are now, so a ball led a stride long, a sixth of a second out, was ~2 m off and the hands never went for it (the IK weight was zero until the catch).
- **The lunge**: through the reach he pitches into it (the run's own forward pitch, `LUNGE`).
- **The sim takes it no further out than that** (`reachFwd`, `beyondReach` in `stepAir`, `comingIn` and `catchAhead`): 1.15 m ahead of a 1.88-m man's centre at chest height (the reach clip's finger roots, the lunge, and a ball in his fingers), scaled by his height; above his shoulders an arm's length round them, raised by his jump for a ball over his head; below the dive's height (0.8 yd) it's the dive's. He's running onto it, so a ball beyond it comes to his hands a tick or two later, or, led too far, it isn't caught.

### The low basket over the shoulder (`actions_p8.py over_shoulder_low`, `choreo.ts`)

- **`catch_over_shoulder_low_l/_r`, keyed in-house**: the eyes and upper back turned back to the ball as the high one, but the trunk folding over it and the hands down at the hip, pinkies together, palms up, out a little ahead toward the ball's side, soft arms; the ball drops in, the hands give down with it, scoop it up into the sternum as he comes square, then the tuck. Finger roots at 0.84 m (`measure_reach.py`; the high basket's at 1.69).
- **Chosen by where the sim will take it**: below 1.2 yd (~1.1 m), from `catchAhead`. The catch event keeps either one once drawn (`family`), so a basket isn't restarted at the ball.

### The arm slot (`actions_pass.py _throw`, `actions_p8.py throw_slot`, `animator.ts setSlot`, `choreo.ts throwSlot`, `passing.ts`)

- **Eight slot variants, keyed in-house**: each throw (the M4 throw, the quick, the long, the fade) in a side-arm version and an over-the-top one, on the same timing, as overlays on the upper body.
  - **Side-arm** (the release moved to his throwing side): the elbow drops, the hand comes through ~0.3 m wider and ~0.36 m lower, the shoulders tip toward the throwing side (9° of side bend).
  - **Over the top** (to his glove side): tall, the elbow above the shoulder, the hand ~0.15 m higher and ~0.1 m inside, the glove-side shoulder down.
- **Blended by the release's move.** The sim records it on the throw (`ThrowPlan.lane`, the event's `lane`, yd across the throw). Through the windup the render asks the lane he'd find for the throw as it would go now (`laneAhead`, read-only, on `previewThrow`); from the release, the throw's own. At most 80% of a variant (`SLOT_K`), so the most extreme throw is a low three-quarters sling rather than a pure side-arm.
- **The QB is himself in it**: the move is his Pocket Presence's (none for a man with none), the motion his Release's (round two's compact quick throw, the long loop, the fade), and an Off-Platform QB on the run drops it lower (`SLING`).

### The box-out (`src/sim/bodies.ts boxOut`, `passing.ts`, `contact.ts`, `actions_p8.py box_out`, `choreo.ts`)

- **How well he walls a man off the ball** (`boxOut`, 0..1): his share of their mass, his Strength over the other's, his height over the other's, and Big Body. Gronkowski on a safety ~0.7 (mean 0.47 over the harness's catches, a man boxed on 34% of them; Tony Gonzalez 0.24 on 36%), Kelvin Benjamin on a corner ~0.7, Terrell Owens ~0.2, a 185-lb slot receiver 0.
- **In the sim:**
  - **the contest**: a defender on his body (within 1.3 yd) with the receiver between him and the ball has his share of the contest cut by up to 35% (the hand fight keeps his hands off it). The other way, a defender between the receiver and the ball walls him off by his own box-out;
  - **the bodies' push**: in the ball's last half second, the receiver gives up to 70% less ground to the man on him (`contact.ts separate`);
  - **after the catch**: the man he boxed out tackles from his back with an arm: his first try in the next 0.6 s has its logit down by the box-out (Gronkowski's ~0.7 takes a 90% tackle to ~82%).
- **In the drawing**: `catch_box_l/_r`, keyed in-house: posted up through the ball's last half second (the trunk leaning and turning into the man, the near forearm a bar across his chest at the numbers, the far hand ready), then late both hands up together over the bar's side to take it above the face mask, snatched and chinned with the shoulder still in him. Chosen for a contested catch with a box-out of 0.4 or more; it starts its whole lead before the ball (`POSTED`). The contest lean between the pair now uses the sim's own box-out (`boxShare`).

### Bruiser: the DB who loses the collision (`src/sim/play.ts bounces`)

- **The catalog's line, read whole**: "after the catch, DBs tackling him alone lose the collision 20% more often". A defensive back alone on a Bruiser after the catch who doesn't bring him down has lost the collision: he's bounced off and down (drawn knocked off his feet), not hanging on an arm while the tight end drags him. The 20% is unchanged.
- This is what gives Gronkowski's broken tackles their ground (cause 5).

### The fingertip catch (`passing.ts stretchOf`, `STRETCH_K`)

- **A new catch cost** (`stretch`): a ball taken past his own hands toward the end of his reach costs up to 4.5 points for a Catching 95, 15 for a 60, by the square of how far out (nothing at his own hands, where the QB leads him). The result card says "led out at his fingertips".

### The harness

- **The identity's X yards after the catch run on six times the reps** (three before), as the tight ends' already run on twelve: cause 6.

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,873 attempts):

| | Before (round 7) | After | NFL |
|---|---|---|---|
| Completion | 66.9% | **66.1%** | ~64–66% |
| Yards per attempt | 7.7 | 7.6 | ~7 |
| INT | 2.4% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 14.7% / 3.8% | 14.6% / 3.7% | ~12–14% / ~3% |
| 2+ yd open caught | 86.0% | **84.9%** | ~80% |
| Batted at the line (`batted.ts`) | 1.4% | 1.4% | ~1–2% |
| Drops / untouched / broken up (`batted.ts`, of attempts) | 2.4 / 10.3 / 11.2% | 2.6 / 11.6 / 10.5% | |

By route (before → after): drag 76 → 75%, dig 63 → 60%, slant 47 → 45%, cross 51 → 50%, seam 49 → 47%, sail 65 → 64%, quick in 31 → 28%; go 40 → 42% and post 38 → 41% (84 and 64 throws); the rest within a point.

**Where the sim takes the ball** (`p8_catchrel.ts 8`, the AI book, ~1,280 catches):

| | Before | After |
|---|---|---|
| Out in front of his centre, median / 90th percentile | 0.51 / 0.86 m | 0.49 / 0.85 m |
| ...more than 1.05 m | 3.6% | 2.0% |
| ...the longest | 1.49 m | 1.18 m (a 6'5" man) |

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | **19 / 20** (Gates vs Lewis, waiting on the owner) |
| ...Tyreek Hill over Wes Welker after the catch (line 0.8) | +0.85 yd (three times the reps; +0.99 at six on the frozen base) | **+0.98** (six times) |
| ...Rob Gronkowski over Tony Gonzalez after the catch (line 0.8) | +0.80 | **+1.53** |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 (Harrison 0.0 → 0.8%, Slayton 11.4 → 12.7% of open balls dropped, on the pair's forty shared seeds) |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (`slants.ts`, 40 reps), on time, zone / man | 60% / 65% | 57% / 59% |
| Slants late (1.5 / 2.0 / 2.5 s), zone | 29 / 27 / 24% | 28 / 26 / 24% |
| Slants late (1.5 / 2.0 / 2.5 s), man | 14 / 12 / 15% | 13 / 11 / 15% |
| Screens (`screens.ts`) | RB screen 85–100% a call, bubble 80–100% | the same to a ball (fire zone 85 → 83%) |
| Clip gates (`build_anims.py`) | 193 / 193 | **206 / 206** (13 new) |

**The player's throws on the cue** (`p6lead.ts --seeds=16`, Joe Montana, 64 throws a route; four coverages share each seed's dice, so 4–6 points is one snap): slant 70 → 70%, crosser 52 → 48%, dig 77 → 75%, curl 73 → 73%, go 41 → 42%, post 39 → 36%, corner 64 → 64%.

**Re-found for this round:**
- **The determinism golden**: 72 of 920 cases moved, every one a pass play (the reach to his drawn hands, the box-out, the stretch, the bounced DB); 4 of them changed their result.
- **The coordinator's film** (`src/sim/film.ts`, with its own tool).
- **The feel clips**: completion-rac Cover 3 seed 65 → 19 (the tight end's seam, 31 yd after the catch); the touchdown clip (which the M7 celebrations' browser test plays) 79 → 52, 70 yd to the end zone (on 79 the ball was led past his hands). Broken tackle (13) and the cut run hold.
- **The e2e seeds** (`tools/sim/e2eseeds.ts`): the full play on 4 and the stick tackle on 2 hold; the touchdown moved 22 → 336 (on 22 the go is caught and tackled 54 yd on).

## The videos

Recorded on the frame-true clock at 30 fps, 960×540, on Low (`BTB_VIDEO=1 BTB_PASSING8=1 BTB_DIAG=1`; `BTB_FOLLOW=1` for the close camera), encoded at crf 28. The before set is a frozen copy of `d4ebdf0` with the round-8 clip list added: the same plays and the same keys.

- **`round8/before/`, `round8/after/`** (broadcast camera) and **`round8/before-close/`, `round8/after-close/`** (close camera, on the catcher or on the QB):
  - `p8-reach`: the X's slant on the cue, Cover 3 seed 1 (round seven's `p7-slant`, the ball taken 1.15 m out in front);
  - `p8-low-shoulder`: the slot's deep corner on Smash against Cover 2, seed 5, taken at his belt;
  - `p8-lane`: the slant on the cue on seed 15, thrown over the left end (the lane +0.39 yd), from the close camera on the QB;
  - `p8-lane-side`: the AI's corner on Smash, Cover 3 seed 4, thrown side-arm round a rusher (the lane −0.39 yd);
  - `p8-box`: Gronkowski on the Y-cross against Cover 1, seed 3, Ronnie Lott on him (box-out 0.67).
- **`round8/compare/`**: before on the left, after on the right (`<clip>.mp4` broadcast, `<clip>-close.mp4` close).
- **`round8/stills/`** (before on top, after below):
  - `broadcast-reach-zoom-before-after.jpg`: the slant from the broadcast camera, cropped, three frames before the catch to two after; `broadcast-reach-catch-frame-before-after.jpg`: the whole frame either side of the catch;
  - `close-reach-zoom-before-after.jpg`: the same catch from the close camera, two frames before to one after;
  - `close-low-shoulder-before-after.jpg`: the deep corner taken low (the corner between the camera and the catch);
  - `close-lane-over-before-after.jpg`, `close-lane-side-before-after.jpg`: the QB's release, over the end and side-arm round a rusher;
  - `close-box-zoom-before-after.jpg`: Gronkowski on Lott, posted up to the catch;
  - `clips-reach-low-box.jpg`: the new catch clips in Blender, laid over the run as the runtime lays them (the reach out, the low and high baskets over the shoulder, the box-out's last 0.2 s).

## Watched: an honest critique

I read every recording as contact sheets and full-resolution crops, frame by frame through the catch (or the release), next to the per-frame log.

- **The forward reach is the clearest win, and it reads from the broadcast camera.**
  - Before (`stills/broadcast-reach-zoom-before-after.jpg`, top row), on the frame the sim calls the catch the ball is a hand's length past his outstretched hand (the log: ball 1.15 m in front of him, his hands at 0.70 m, 0.46 m apart), and the next frame it's in them.
  - After (bottom row), he folds forward into it with both arms long and the ball meets them out in front: on the catch frame it's 1.01 m ahead of him and his finger roots 0.96 m, so it's in his fingers; the frame after it's in both hands at 0.86 m, and he pulls it in.
  - Up close (`stills/close-reach-zoom-before-after.jpg`) the difference is large: before, his hands are by his chest and the ball arrives beside them; after, he's laid out over his front foot with his arms at full length.
  - Not perfect. The fold is deep: on the frame before the catch his back is close to flat, which reads like a lunge for a ball a little further than this one. A forward reach chosen only at 0.78 m and keyed for the end of his reach can't be both a slight and a full extension; a middle variant (or blending the reach by how far out it is) would be better.
  - The hands only went for this ball at all once they were asked from where his shoulders would be at the catch. Round seven's check, from where they were, had zeroed the reach on every ball led a stride long.
- **The low basket.**
  - The log is the evidence: before, the hands wait at 1.66 m while the ball comes down to 0.81 m, and on the catch frame they're dragged down to 1.04 m, 0.29 m off it. After, the hands are at the hip (0.78–0.90 m) the whole way in, and on the catch frame they're 0.10 m from the ball.
  - On video it doesn't show well. From the broadcast camera the receiver is ~60 px tall; from the close camera (`stills/close-low-shoulder-before-after.jpg`) the trailing corner is between the camera and the catch on this snap. The clip itself is in `stills/clips-reach-low-box.jpg` (Blender, laid over the run).
- **The arm slot is visible up close, not at broadcast distance.**
  - Side-arm (`stills/close-lane-side-before-after.jpg`, the AI's corner round a rusher): before, the ball goes up over his helmet; after, the arm comes through lower and wider, the ball out at the shoulder away from his head, the shoulders tipped toward the throwing side. It reads as a sling.
  - Over the top (`stills/close-lane-over-before-after.jpg`, the slant over the left end): the arm is higher and more vertical and the glove side drops. Subtler than the side-arm.
  - From the broadcast camera the QB is too small for either to read; the decision still shows only as its result (the ball not batted).
  - A worry: the lane moves the release on 56% of the AI book's throws, so a slot is drawn on most throws. Capped at 80% of a variant, I think that reads as a QB changing his arm angle with the rush rather than a gimmick, but the owner should look at a few drives.
- **The box-out is mostly in the sim.**
  - Up close (`stills/close-box-zoom-before-after.jpg`, Gronkowski on Lott), the after shows his arms going long to the ball and the catch out in front of him; before, the hands are bent at the chest. The posting-up (the lean into the man and the bar arm) is there in the clip but I can't honestly say it reads: the close camera on this snap is behind and to the side of the pair, and by the time the bar should show the hands' reach is already taking the arms.
  - In the numbers it is real: Gronkowski boxes a man out on a third of his catches, the contest he gives up falls, and his yards after the catch rose (+1.53 over Gonzalez).
- **The bounced DB** (Bruiser) shows as the defensive back knocked off his feet away from the tight end, the way a broken tackle by a truck already draws. I didn't record a clip built for it.

Would the owner, playing, feel the catches look natural and the QB is himself?
- **The slant led a stride: yes.** The receiver now extends into the ball instead of the ball arriving beside him; at broadcast distance it's a man reaching out in front, which is the catch a fan expects on a well-led slant.
- **The deep ball low: in the numbers, yes; on screen, small.**
- **The QB: up close, yes; at broadcast distance, no.** He throws around and over the rush now, but the default camera can't show it.
- **Gronk: in the numbers and the yards after the catch; on screen it's the contested catch made out in front of him and the DB bouncing off, more than a visible post-up.**

## Still open

- **The forward reach has one depth.** `catch_reach_out` is keyed for the end of his reach; a ball 0.8 m out and one 1.15 m out get the same deep fold (the trunk fold adds up to 25° more, it never takes any away). A medium reach, or blending the reach clip with the chest catch by how far out the ball is, would look better on the near ones.
- **The box-out's post-up doesn't read on video.** The bar arm and the lean are in the clip and in the sim's push, but the reach to the ball takes the arms in the last 0.2 s and the camera angle on the recorded snap hides the pair. A camera on the side of the pair, or a longer bar phase for a ball that hangs, would show it.
- **The slant harness lost a few points on time** (zone 60 → 57%, man 65 → 59%): balls led more than ~1.15 m out in front now aren't caught. That's the long tail of the timing error (round seven raised `TIMING` 0.43 → 0.56 to hold completion while the sim caught every one of them); now that the reach takes them, `TIMING` could come back down. I left it, because the book is only now near the NFL's completion rate.
- **The book is at 66.1% and "2+ yd open caught" at 84.9%**, still a point and five points above the NFL. The reach, the fingertip cost and the box-out are the realistic causes added; the rest of the gap is in the open-ball catch rate and the timing, which I didn't touch.
- **Tyreek Hill over Wes Welker is +0.98** after the catch at six times the reps, 0.18 above its line, and the base read +0.99 at the same sample: his edge is genuine but no bigger than before. Its yards after the catch come from a few long runs, so the reading still moves a tenth or two.
- **The arm slot at broadcast distance** is invisible, like the lane was.
- **Broadcast readability** (item 6) wasn't reached: the catch beat (round 5) is the only presentation help, and there's no ball highlight.
- **The low basket on video**: the recorded snap hides it from both cameras.
- **Gates vs Lewis** (identity) still waits on the owner.
