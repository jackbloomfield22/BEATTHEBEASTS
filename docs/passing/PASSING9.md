# The passing game, round 9: the pass as the owner sees it

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Rounds 3–8 fixed most of the mechanics, and their recurring critique was that much of it was "a few pixels at broadcast distance" or "in the numbers only". The owner plays from the default broadcast camera at 60 fps, so this round watched the passing game from there first, and then took the brief's list in order:
1. the passing play as the owner sees it (ten passes from the broadcast camera, reviewed play by play, and the biggest problems fixed);
2. the forward reach's one depth;
3. the box-out that doesn't show;
4. Tyreek Hill's yards after the catch over Wes Welker's;
5. the book's realism (left alone: see below).

Branch `wip/passing9`, from `0d301d9` (the tip of `claude/m66-polish`, rounds 1–8).

## How it was watched

- **Ten passes, thrown the way a player throws them** (`src/game/clips.ts PASSING9`, checked in Node by `tools/sim/p9_clips.ts`): the quick slant, the out, the dig, the crosser, the go, the post and the corner on the player's tap on the throw-timing cue (rounds 6–7's plays); the curl and the RB screen as the M6.5 concepts throw them; and Rob Gronkowski's contested ball on Ronnie Lott (round 8's box-out play, thrown by the AI). All ten are completions on both trees.
- **Recorded from the default broadcast camera** on the frame-true clock, 30 fps, 960×540, on Low (`BTB_VIDEO=1 BTB_PASSING9=1 BTB_DIAG=1`), with round five's per-frame catch log. The before set is a frozen copy of `0d301d9` with the clip list added: the same plays and the same keys. Close-ups (`BTB_FOLLOW=1`) on the dig, the slant and the contested ball for the reach and the box-out.
- **Read as a fan would**: each recording as six full frames (the release, mid-flight, 0.3 s before the catch, the catch, +0.2 s, +0.6 s), as consecutive-frame strips through the camera's move, and as crops of the QB through the release.
- **The yards after the catch**: `tools/sim/p9_yac.ts` breaks identity's X sample down (speed at the catch and after it, the nearest defender, when the first hand lands) for Hill and Welker; `tools/sim/p9_fx.ts` prints their sprint constants; `tools/sim/p9_racfind.ts` finds a snap both catch clean for the side-by-side video.

## The broadcast review (before)

What reads wrong, per play, at broadcast distance on the before tree (`round9/before/`, `round9/stills/`):

| Play | Flight | What a fan sees |
|---|---|---|
| Quick slant (Cover 3 seed 1) | 0.7 s | The QB's drop, set and release read (he's ~50 px tall, the release a clear arm motion, though the "Space CATCH" prompt sits right over him through the release). Once the ball is out the camera is still swinging off the pocket when it gets there: 0.3 s before the catch the receiver is in the left third, ~70 px tall, with the line's pile filling the near corner; the ball, a brown speck of ~8 px, only meets him on screen on the catch frame. The lead (the ball out in front of him, the reach) is invisible. |
| Out (Cover 3 seed 3) | 1.2 s | The best of the before set: a 1.2-s flight gives the camera time, and in the last 0.3 s the ball, the receiver's hands and the corner share the frame. Mid-flight the receiver is a few pixels at the frame's edge. |
| Dig (Cover 3 seed 5) | 0.8 s | As the slant: 0.3 s out the receiver is ~40 px in the upper left, the ball invisible, the pile in the foreground; the camera reaches the catch after it's made. |
| Curl (Cover 1 seed 5) | 0.9 s | The receiver works back but is ~50 px tall at the catch; the ball in flight is a dot between the pocket and him. |
| Go (Cover 3 seed 3) | 1.4 s | Framed, loosely: the ball reads as an orange dot coming down, the receiver and two DBs ~60 px at the catch. Fine for a deep ball, small for judging the lead. |
| Post (Cover 3 seed 11) | 1.3 s | As the go: the race reads, the catch is ~50 px with a safety closing. |
| Corner (Cover 3 seed 4) | 1.4 s | As the post. |
| Crosser (Cover 3 seed 1) | 1.1 s | The receiver crosses the LBs mid-frame but small; the ball isn't seen until the catch. |
| RB screen (Cover 3 seed 19) | 0.5 s | Reads: the camera stays wide on the pocket, the back and the released linemen are all in it. |
| Contested: Gronk on Lott (Cover 1 seed 3) | 1.6 s | The ball, Gronk and Lott share the frame at the sideline, the pair ~60 px. From 0.4 s out Gronk's arms are already up at his chest: no post-up, no bar arm, the high point indistinguishable from a hands catch. |

The pattern is the camera, not the motion. On the short and intermediate throws (the slant, the dig and the curl, under a second in the air, and even the 1.1-s crosser: most of the passing game) the broadcast camera never framed the receiver and the ball together before the catch frame, so the QB's lead, the ball's flight into the hands and the reach were all drawn but not seen. The ball itself is the size a broadcast shows it (round six's distance growth: ~8 px at 960×540 at 20 m) and reads once it is near the man; what was missing was the shot that holds them both. The deep throws were framed, but loose.

The QB's motion (the drop, the hitch, the release, the arm slot) reads at the pocket's distance; the follow-through is short (the finish is reached 0.15 s after the release and the arm comes down over the next 0.28 s) but by then the camera has gone with the ball, and after this round it goes sooner.

## What was wrong (root causes)

1. **The air camera only arrived as the ball did.** `src/render/game/GameCamera.tsx:265` at `0d301d9` (`airPose`): the look started 30% of the way from the ball to the catch and reached the catch point only at the arrival (`0.3 + 0.7 · e`, eased on the flight's progress); the eye came 20 → 10.5 yd off the catch (`:270`) and the lens 50° → 38° (`:279`), all on springs whose time constants are a quarter to a half second (`:346`: the eye's ω 4.2, the look's 7). A 0.7-s slant is over before the rig settles, so the catch was drawn in the corner of a frame still turning off the pocket. The catch point itself was a guess (between the aim and where the receiver was then), not the sim's own.
2. **The forward reach had one depth.** `src/render/game/choreo.ts:388` at `0d301d9`: `catch_reach_out` played whole for any ball more than 0.78 m out (`REACH_OUT_FROM`), keyed for the end of the reach (the finger roots 1.00 m out, the trunk ~50° forward); a ball at 0.8 m got the same deep fold as one at 1.15 m, and the lunge (`:1463`) was all or nothing.
3. **The box-out's post-up lasted a third of a second and the hands took the arms from it.** `tools/blender/lib/actions_p8.py:138, :156` at `0d301d9`: the bar arm held from 0.47 s to 0.17 s before the ball, and the runtime's hands-to-the-ball IK (`choreo.ts:656`) took the arms over from 0.2 s out (`REACH_IN`), so the bar was on screen for ~0.1 s; the lean into the man was 6–8° a bone, a few pixels at broadcast distance.
4. **Every receiver caught a catch-and-run in stride.** `src/sim/play.ts:1594` at `0d301d9`: on a RUN call the receiver kept all his speed through the catch and was free to move four ticks later, whatever his Run After Catch. The rating (`src/engine/ratings/attributes/offense.ts`: "yards after the catch") fed only the stand-ins for Break Tackle and Elusiveness, and the identity harness's carrier never jukes, so on the field Hill and Welker came out of the same slant at the same pace. Their sprint constants are close too (`p9_fx.ts`: Hill 10.63 yd/s, τ 0.648 s; Welker 9.86, τ 0.645), so the gap was top speed alone, 0.8 yd/s, on catches where the first hand lands 0.4 s after the ball (`p9_yac.ts`).

## What changed

### The air camera leads the landing spot and zooms to hold it (`src/render/game/GameCamera.tsx`)

- **Where they'll meet**: the sim's own catch (`catchAhead`: the tick the ball gets to his hands), else between the aim and where he'll be at the arrival.
- **The look leads it from the release**: halfway between the ball and the spot as it leaves the QB's hand, on the spot as it arrives (`lead = 0.5 · (1 − e)`). A broadcast operator pans to the receiver and the ball flies into the shot.
- **The zoom fits the shot** (`fitFov`): from where the eye really is (the dolly lags its target), the lens is the narrowest that holds the ball, the spot (feet to 2.1 m), the receiver and the defender nearest the spot (within 4 yd) inside the frame with a tenth to spare, no wider than the pre-snap lens (52°) and no tighter than 7.5 m of field height at the spot (the receiver a quarter of the frame), widening to 10 m for a ball two seconds in the air so a deep race and the safety coming over read as a broadcast shows them.
- **The long lens**: the eye ends 13 yd off the catch and 4.8 m up (round two's 10.5 yd and 3.9 m put it among the underneath defenders, and with the zoom a linebacker between the camera and the ball filled a corner of the frame).
- **A quick throw tightens the rig**: the springs' stiffness × 1/flight time, up to 1.5× for a ball in the air under a second (a 0.7-s slant at 1.43×).
- Nothing on the HUD: no trail, no marker, no ball highlight. The ball is drawn as before (round six's spiral and distance growth); it reads because the shot holds it.

### The forward reach by depth (`src/anim/animator.ts setMix`, `src/render/game/choreo.ts reachDepth`)

- **A depth layer on a one-shot overlay** (`setMix`): another clip keyed on the same beat laid over it, sampled at its time plus the offset that lines up their secure frames, over its mask, faded with it.
- **The reach blended by how far out the ball is**: `catch_hands_run` (round five's chest catch) laid back over `catch_reach_out` by 1 − k, k linear from 0 at 0.67 m ahead of his centre (the chest catch's finger roots, `measure_reach.py`) to 1 at 1.05 m (the reach's 1.00 m and the lunge). The reach is now chosen from 0.67 m (it was 0.78), so the two meet without a step; the depth follows the sim's catch point as it comes (eased at 12/s) and holds from the catch; the lunge goes with it.
- On the recorded dig (the ball 0.73 m out) it's 16% of the reach, a man extending his arms; on the slant (1.14 m) it's all of it.

### The box-out posts up longer and shows (`tools/blender/lib/actions_p8.py box_out`, `choreo.ts`)

- **Re-keyed in-house**: posted for 0.67 s (0.47), the lean and turn into the man roughly doubled (~25° of side bend and ~25° of turn over the spine: a shoulder visibly into him), the bar arm's elbow up and out, a "fight" key 0.12 s out driving the bar a hand further into him, then both hands snap up to the high point over the last 0.1 s, snatched, chinned with the shoulder still in him. 206/206 clip gates.
- **The hands wait** (`REACH_IN_POSTED`, 0.12 s): a posted-up receiver's hands go to the ball over the last 0.12 s, not 0.2, so the bar stays on the man until the ball is nearly there.

### The catch in stride, by Run After Catch (`src/sim/play.ts racGather`)

- **How much he gathers the ball** on a catch-and-run, 0..1 from his Run After Catch: none at 90 and up (the top tenth of 980 WR stints is 87+; Hill 97), all of it at 60 (the bottom tenth, 59). A full gather costs 15% of his speed at the catch (a step, ~1 yd/s at a slant's pace) and 8 ticks (0.13 s) more before he can make a move or burst. A back or a lineman (no rating) is as before.
- Wes Welker (70) gathers 0.67 of it: on the quick out he comes out of the catch 9% slower than he went in and bursts a beat later; Hill catches it on the run.

### The book's realism: left alone

The book is at 66.1% completion and 84.9% of open balls caught. I looked for a realistic cause left and didn't find one this round's changes touch (the gather moves nothing before the catch); the remaining gap is the open-ball catch rate and the timing error, which round 8 also left. Nothing was tuned to move the numbers.

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,873 attempts):

| | Before (round 8) | After | NFL |
|---|---|---|---|
| Completion | 66.1% | 66.1% | ~64–66% |
| Yards per attempt | 7.6 | 7.5 | ~7 |
| INT | 2.4% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 14.6% / 3.7% | 14.6% / 3.5% | ~12–14% / ~3% |
| 2+ yd open caught | 84.9% | 84.9% | ~80% |
| Batted at the line (`batted.ts`) | 1.4% | 1.4% | ~1–2% |
| Drops / broken up (`batted.ts`, of attempts) | 2.6 / 10.5% | 2.6 / 10.5% | |

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | **19 / 20** (Gates vs Lewis, waiting on the owner) |
| ...Tyreek Hill over Wes Welker after the catch (line 0.8) | +0.98 | **+1.07** (4.51 vs 3.44 yd) |
| ...Rob Gronkowski over Tony Gonzalez after the catch (line 0.8) | +1.53 | +1.60 |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (40 reps), on time, zone / man | 57% / 59% | 57% / 59% |
| Slants late (1.5 / 2.0 / 2.5 s), zone | 28 / 26 / 24% | 28 / 26 / 24% |
| Screens (`screens.ts`) | RB screen 83–100% a call, bubble 80–100% | the same |
| Clip gates (`build_anims.py`) | 206 / 206 | 206 / 206 |

**Hill over Welker, broken down** (`p9_yac.ts`, identity's X sample, 36 reps):

| | Before | After |
|---|---|---|
| Hill / Welker yards after the catch | 4.49 / 3.56 (+0.93) | 4.51 / 3.46 (+1.05) |
| Speed at the catch, Hill / Welker (yd/s, all routes) | 5.71 / 5.39 | 5.71 / 4.92 |
| Quick outs: yards after / share of 10+ | 7.46 / 6.01, 36% / 22% | 7.46 / 5.88 |
| Slants | 3.95 / 2.86 | 3.99 / 2.78 |
| First hand on him after the catch | 0.41 / 0.42 s | the same |

**Re-found for this round:**
- **The determinism golden**: 373 of 920 cases moved, every one a completion where the receiver gathers the ball (his speed at the catch changes); 4 changed their result. Re-pinned on purpose for that.
- **The coordinator's film** (`src/sim/film.ts`, with `tools/sim/film.ts`).
- **The feel clips and the e2e seeds** hold: the M5.5 clips (`tests/sim.test.ts`, the touchdown clip M7's celebration test plays included) pass unchanged; `tools/sim/e2eseeds.ts` keeps the full play on 4, the stick tackle on 2 and the touchdown on 336.

## The videos

Recorded on the frame-true clock at 30 fps, 960×540, on Low (`BTB_VIDEO=1 BTB_PASSING9=1 BTB_DIAG=1`; `BTB_FOLLOW=1` for the close camera), encoded at crf 28. The before set is a frozen copy of `0d301d9` with the round-9 clip list added.

- **`round9/before/`, `round9/after/`** (broadcast camera): `p9-slant`, `p9-out`, `p9-dig`, `p9-curl`, `p9-go`, `p9-post`, `p9-corner`, `p9-cross`, `p9-screen`, `p9-contested`; and `p9-rac.mp4`, Tyreek Hill (left) and Wes Welker (right) on the same quick out (Cover 3 seed 4, the throw at 50 ticks: both caught clean, no broken tackle; Hill 14.1 yd after the catch, Welker 9.3), recorded with 3.2 s after the ball.
- **`round9/before-close/`, `round9/after-close/`**: the dig (0.73 m out), the slant (1.14 m) and `p9-reach-mid` (the slant on Cover 3 seed 6, taken 0.85 m out: the reach about halfway) on the catcher, and the contested ball from behind Gronkowski (the box-out).
- **`round9/compare/`**: before on the left, after on the right.
- **`round9/stills/`** (before on top, after below):
  - `broadcast-0.3s-before-the-catch.jpg`: the slant, the dig, the curl and the crosser nine frames before the catch;
  - `broadcast-mid-flight.jpg`: the slant, the dig, the go and the corner half a second before the catch;
  - `broadcast-catch-frame.jpg`: the slant, the out, the post and the contested ball on the catch frame;
  - `broadcast-box-zoom-before-after.jpg`: Gronkowski on Lott from the broadcast camera, cropped and doubled, 0.5 s before the catch to 0.1 s after;
  - `close-box-before-after.jpg`: the same from the close camera behind him;
  - `close-reach-mid-before-after.jpg`: the ball taken 0.85 m out, the four frames before the catch and the catch;
  - `rac-hill-top-welker-below.jpg`: the quick out on the after tree, the catch and 0.5 / 1.0 / 1.5 s after it, Hill above, Welker below.

## Watched: an honest critique

I read every recording as six-frame sheets, consecutive-frame strips through the camera's move and full-resolution crops, next to the per-frame log.

- **The camera is the change the owner will feel, and it reads.**
  - On the slant, the dig, the curl and the crosser the receiver, the ball and the nearest defenders now share the frame for the last third of a second and more (`stills/broadcast-0.3s-before-the-catch.jpg`): the receiver goes from ~40–70 px to ~120–150 px tall at 960×540 (a quarter of the frame), the ball reads as a brown football flying into the shot rather than a speck in the corner, and on the catch frame you can see the hands out in front taking it (`stills/broadcast-catch-frame.jpg`).
  - Whether the QB led him is now something you can see: on the slant the ball arrives ahead of his numbers and he reaches into it; on the out it comes to his outside shoulder at the sideline with the corner trailing; on the dig it crosses the linebacker's face into his hands.
  - The move is fast on a quick throw (on the slant the shot turns from the pocket to the catch over ~10 frames, about a third of a second), smooth frame to frame with no jumps (the strips), but it is a whip-pan. I think that's how a broadcast follows a slant; the owner should say whether it's too quick for him at 60 fps.
  - The deep balls were framed before and are framed tighter now (the go, the post, the corner): the race with the corner and the safety reads, the ball drops into the frame from above. A linebacker trailing the play still crosses the near corner of the frame on the go, smaller than it was.
  - The screen is unchanged (a half-second throw; the shot stays wide on the pocket, which is right).
  - The QB leaves the frame sooner than before. His release reads at the pocket's distance; his follow-through is now mostly off-screen, which suits the broadcast but means the follow-through itself didn't get any better.
- **The reach by depth: visible up close, a detail at broadcast distance.** On the ball taken 0.85 m out (`stills/close-reach-mid-before-after.jpg`) the before folds right over it, the helmet down and the back nearly flat, for a ball that only needs his arms; after, he extends with his chest up (the chest 5–6 cm higher in the log through the last 0.2 s) and his eyes on it, which is what a receiver does. The deep fold is kept for the ball led a full stride (the slant at 1.14 m). From the broadcast camera it is part of "he reaches out and takes it", not something a fan would name.
- **The box-out: better timed, still not a picture.**
  - The bar arm is held longer: in the log Gronkowski's bar hand rises 0.07 s before the ball, not 0.13 s (`p9-contested` before/after, the right hand's height), and the hands snap up late to the high point.
  - But I can't honestly say the post-up reads. From the broadcast camera (`stills/broadcast-box-zoom-before-after.jpg`) the two bodies are jammed together with Gronk leaning into Lott in both; from the close camera behind him (`stills/close-box-before-after.jpg`) the bar arm is hidden by his own back, before and after alike. The re-keyed lean is there in the clip, but at the size the pair is drawn it changes a few pixels. What the owner sees of Gronk's box-out is still mostly its result: he catches it with Lott on him, and Lott ends on the turf.
- **Tyreek Hill after the catch: a real but modest margin.** The harness margin is +1.07 (from +0.98), with Welker now losing a step at the catch where he gathers it. On the side-by-side quick out (`after/p9-rac.mp4`, `stills/rac-hill-top-welker-below.jpg`) Hill is a couple of yards further on a second after the catch and still running when Welker is down; the difference shows if you watch for it. Most of the harness's catches are made with a defender 3–4 yd away and the first hand on him 0.4 s later, so his speed can only show on the few in space (quick outs: 36% of Hill's go 10+ yards after the catch, 22% of Welker's). I didn't make his speed itself bigger than his ratings make it.

Would the owner, playing from the broadcast camera, now feel the QB leads receivers and the catches look natural?
- **The lead: much more than before.** The biggest reason the passing game felt like it had no lead was that on most throws the catch was never in the shot until it had happened. Now the shot goes to where they'll meet as the ball leaves the QB's hand and holds the receiver, the ball and the defender on him as it arrives, so a ball thrown ahead of him visibly arrives ahead of him and he goes to get it.
- **The catches: yes, mostly, because they can be seen.** The hands-out reach, the over-the-shoulder looks and the body catch from rounds five to eight now fill a quarter of the frame at the moment they happen. The forward reach no longer lays out over a ball that only needs his arms.
- **What would still look wrong to a coach**: the box-out (it doesn't read as a post-up), and on deep throws the occasional defender crossing the near corner of the frame.

These are 30-fps recordings at 960×540 on Low; at 60 fps and full resolution the ball is twice the pixels and the camera's move is twice as smooth.

## Still open

- **The box-out still doesn't read as a post-up** at the sizes the pair is drawn, from either camera. A bigger, earlier lean (a hip check into the man a stride before the ball), or a moment's cut to a tighter angle on a contested catch (the catch beat already holds the air framing for 0.45 s), would show it; both are bigger changes than this round made.
- **The forward reach's trunk IK hits its cap on the approach** (0.44 rad on the mid-depth ball as on the deep one): it reaches for where the ball will be from where his shoulders will be. The clip's blend made the body more upright; the IK's extra fold could be scaled by the same depth.
- **The air camera on a quick throw is a whip-pan** (a third of a second from the pocket to the catch). It reads smooth on the frame strips, but the owner should play a few slants at 60 fps and say whether `AIR_QUICK` (1.5) should come down.
- **The QB's follow-through** finishes 0.15 s after the release and blends off over 0.28 s (`actions_pass.py _throw`). With the camera leaving the pocket sooner it's mostly off-screen now; holding the finish a beat longer means re-keying every throw and its slot variants together.
- **"Space CATCH"** (the catch-call prompt) sits over the QB through the release on the broadcast camera.
- **Tyreek Hill over Wes Welker is +1.07**: clear of its line, but it still moves a tenth with the dice; his edge in space shows, his edge in traffic is his broken tackles.
- **The book is at 66.1% and "2+ yd open caught" at 84.9%**, a point and five points above the NFL; nothing this round was a realistic cause to move them.
- **Gates vs Lewis** (identity) still waits on the owner.
