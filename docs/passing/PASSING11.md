# The passing game, round 11: the camera reads the throw, the push on the passer, the bar that shows, the catch under a closing man, the arm slot by pressure

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 10 (`PASSING10.md`) left these open, which this round took in the brief's order:
1. the camera on a quick throw (the slant's whole move in ~0.45 s, ~56°/s of pan, ~88°/s of lens);
2. the QB's follow-through, a few pixels at the pocket framing;
3. the box-out's bar arm, hidden between the bodies;
4. the book a point above the NFL (completion 66.1%, open caught 84.9%);
5. the arm slot (side-arm or over the top) drawn on 56% of throws.

Branch `wip/passing11`, from `8e57e46` (the tip of `claude/m66-polish`, rounds 1–10).

## How it was watched

- **The camera in Node, on the game's own code.** The broadcast framing moved out of `GameCamera.tsx` into `src/render/game/broadcastCam.ts` (no React, no DOM: the sim state and its snapshot in, a pose out), so `tools/sim/p11_cam.ts` steps it at 60 fps exactly as a 60-fps recording steps it (the same springs, the same clips, `PASSING9`/`PASSING10`) and reports, from the windup to the catch: the peak pan (the look's direction, °/s), zoom (° of lens/s) and dolly (m/s); the QB's drawn height (feet to 1.95 m, px at 960×540) at the release and how long he stays in the frame; the receiver's at the catch. With the round-11 move switched off it reproduces round 10's 60-fps measures (the slant 53°/s against the recording's 52–56, zoom 88, dolly 10). This is how the move was designed; the recordings then confirmed it.
- **At 60 fps from the default broadcast camera**, 960×540 on Low, on the frame-true clock (`BTB_VIDEO=1 BTB_PASSING11=1 BTB_DIAG=1 BTB_WINDOW=1 BTB_VIDEO_FPS=60`, `tools/shots/video.spec.ts`; the window starts at the windup): the slant, the out, the dig, the go, the RB screen and the fade, before and after. The before set is a frozen copy of `8e57e46` with the round-11 recording hooks.
- **A recording artifact, fixed on both trees first.** A recording draws its pre-snap frames with no game time passing (its camera steps by game time), so every recording since round 9 opened a second into the play still gliding down from the play call's framing: on the slant's windup the eye was 2 m higher and 5 yd further back than the pocket's shot. In play it has settled long before the snap. `GameCamera.tsx` now settles the camera on the pre-snap shot in a recording (`urlFlags.video` only); both sets were recorded with it.
- **Measured from the recordings' per-frame log** (the scratch `cam.py`: the camera's position, look direction and lens each frame, rates as central differences over ±3 frames, since the log rounds the look direction to 1e-3; the QB's drawn height from his head bone to his lower foot, projected through the logged camera; the receiver's from his head bone to the ground).
- **The box-out**: a Blender contact sheet of the bar from behind and above, from three-quarters and from the side, the trailing man placed where `choreo.ts boxPost` puts him (the scratch `prev_box.py`, as `tools/blender/preview_contest.py`), old keys against new; then the contested ball (Gronkowski on Lott) recorded from the broadcast camera and the close camera behind him.
- **The book**: `tools/sim/p11_open.ts` (the open ball, what happens to the ones not caught, and the catch rate by how soon a defender gets to him), and every harness before and after.
- **The arm slot**: `tools/sim/p11_slot.ts` (the AI book: the lane he moved his release by, the pressure on him as he lets it go, and the drawn slot's weight before and after).

## What was wrong (root causes)

1. **The air camera started its move at the release.** `src/render/game/GameCamera.tsx:357–358` at `8e57e46`: the move's clock (`flight.t0`) and its starting framing (`flight.from`, the pocket's) were taken the frame the ball left his hand, and `:448` finished it 0.22 s before the catch. On the slant (0.71 s in the air) that left ~0.45 s for ~20° of pan and ~32° of lens on a smoothstep (`:449`, 1.5× its mean speed at the peak). Two smaller causes added to it: the look's target itself moved quickly early in the flight (`:365`, `e = 1 − (1 − p)²` is fastest at the release, and `:388` led the look from halfway back to the ball), so the pan was the product of two eases, and the zoom and the pan ran on the same clock, so the zoom that takes the QB out of the bottom of the frame had to wait for nothing. Yet the throw is known a third of a second earlier: the key starts the windup (`sim/play.ts:496`, `s.windup`, since round 3), and so does the AI's decision.
2. **The QB was framed for the routes, not the throw.** The pocket's broadcast shot (`GameCamera.tsx:142–149` at `8e57e46`: the eye 17 yd back and 8.5 m up, a 52° lens on the line) draws the QB ~60 px tall (head to feet at 960×540) in the bottom fifth of the frame, and nothing changed it when he started to throw.
3. **The bar was at the height of the bodies.** `tools/blender/lib/actions_p8.py:166, :168` at `8e57e46`: the bar's hand at 1.26 m (the man's numbers) with the elbow at 1.5 m, out to the side and a little behind. Round 10 turned the receiver so the man is behind his near shoulder; from the broadcast camera behind them, the trailing man is then between the camera and the forearm on his chest, and the arm sits in the gap between two bodies in contact.
4. **A man closing on the receiver counted only once he was there.** `src/sim/passing.ts:1411` at `8e57e46` (`resolveCatch`): the hit as the ball arrives counted a defender within 1.1 yd of the receiver at that tick, whatever his closing speed. The catch isn't secured on that tick: the catch clips' secure and high-point frames come 0.13–0.2 s later (`play.ts atHands`). So a safety a stride and a half away closing at full speed, who arrives as the receiver is bringing it in, cost the catch nothing.
5. **The arm slot was drawn for any lineman in the line of the throw.** `src/render/game/choreo.ts:524, :536` at `8e57e46`: the slot's weight was the lane the sim moved his release by (`sim/passing.ts throwingLane`, round 7), and every defensive lineman at the line is in the line of a throw over the middle, blocked or not. `p11_slot.ts`: the slot drawn (a fifth of the way to side-arm or more) on 57% of the AI's throws, and on 52% of the throws from a clean pocket.

## What changed

### The camera reads the throw (`src/render/game/broadcastCam.ts`, new)

- **The broadcast framing in its own module.** `BroadcastCam` holds what used to be module state in `GameCamera.tsx` (the breakaway blend, the throw being followed, the pocket's last framing, the catch beat's framing, the camera as drawn); `GameCamera.tsx` keeps the other cameras, the springs and the shake. `p11_cam.ts` and `tests/broadcast-cam.test.ts` run the same code.
- **The move begins with the windup** (`windupPose`): from the frame the key goes down (or the AI decides; at most 0.45 s before the planned release, so a key pressed in the drop waits for the plant), the camera moves toward the release framing of the throw he's winding up: where it'll meet the receiver on the sim's own lead (`sim/passing.ts lead` and the arm's hang, iterated as `leadFor` does, once a tick) and how long it'll hang. At the release the real throw takes over (the sim's own catch point, as round 9), the move's clock carrying on from the windup.
- **The pan, the lens and the eye on their own clocks** (`move`):
  - the pan (the look) runs from the windup to 0.1 s before the catch on a ramp with a steady middle (it gathers pace over the first quarter, holds it, eases out over the last quarter: its top speed 1.33× its mean, a smoothstep's 1.5×). It is mostly sideways (the slant's ~20° of yaw against ~2° of tilt), so the QB at the bottom of the frame stays in it while the shot drifts toward the target;
  - the lens and the eye's travel run from the release (later on a longer ball: 0.3 s a second of flight past 0.7 s, at most 0.2 s, so the drive's finish is seen first) to 0.18 s before the catch, never quicker than 0.4 s (a screen finishes into the catch beat);
  - the look's lead toward the ball is a quarter of the way back at the release, not half, and the catch framing follows the flight on a smoothstep (`smooth(p)`) instead of an ease-out that was fastest at the release.
- **The rig is as stiff from the windup** (`weights`), so the eased target is followed closely from its start; a windup smothered before the ball's out (a sack) sends the camera back to the pocket on the soft springs.
- Constants (all ours, with their reasons in the file): `ANTIC_MAX` 0.45 s, `LOOK_SETTLE` 0.1 s, `LOOK_RAMP` 0.25, `ZOOM_K` 0.3, `ZOOM_MAX` 0.2 s, `ZOOM_SETTLE` 0.18 s, `ZOOM_MIN` 0.4 s, `ZOOM_RAMP` 0.3, `LOOK_LEAD` 0.25. Round 10's beat and settle constants are gone.
- Tried and dropped (in Node): holding the QB in the frame through his finish by widening the lens (it put a zoom out and back in the middle of the move: the slant's zoom 109–125°/s) or by tilting toward him (the tilt back cost the pan: 62–81°/s).

### The push on the passer (`broadcastCam.ts move`)

- Through the windup the eye comes in 2 m along its line and down 3 m, and the lens closes by a tenth: a broadcast "push" on the passer as he loads. The lower eye lifts him in the frame as the nearer one drops him, so he stays where he was, ~1.3× as large at the release. The lens's share eases out from 0.1 s after the release over 0.3 s; the eye's is taken over by its own travel to the catch framing, which now goes all the way down to the long lens's 4.8 m on every throw (round 10 took a quick throw's eye only 35% of the way: with the push it would have craned back up), so it never rises again.

### The bar over the top (`tools/blender/lib/actions_p8.py box_out`)

- Re-keyed in-house: the bar's elbow up above his own shoulder line (1.80 m pole, 1.82 m in the fight key) and the forearm coming down over the top of the man's near pad into his upper chest (the hand at 1.50 m, 1.47 m in the fight key, further out to the side): the arm-over a receiver uses to keep a defender's arm off the high point. From behind and above, the upper arm reads as a bar at shoulder height across to the man, over his shoulder, instead of a bent arm down at the numbers between two bodies. The late hands, the snatch, the chin and the tuck are unchanged. 215/215 clip gates.

### The catch secured under a closing man (`src/sim/passing.ts resolveCatch`)

- The hit as the ball arrives is now counted where the defender will be when the catch is secured, 0.2 s on at his closing speed (`SECURE_T`, the catch clips' secure and high-point frames), not only where he is on the tick it gets to the hands: a man arriving as the receiver brings it in hits him with the ball not yet his. Everything downstream is as it was: the hit's catch cost (Catch in Traffic holds on, Sure Hands never loses it to a hit, a Missile dislodges it more), a miss within the defender's share credited to him as a breakup at the catch, the bobble band.
- The candidates the brief named, checked: a ball thrown behind him already costs the catch (`behind`, up to 15%); the receiver braced for a hit is this (the hit he's about to take, by his Catch in Traffic). Nothing else was tuned to move the numbers.

### The arm slot by pressure (`src/render/game/slotThreat.ts`, new; `choreo.ts throwSlot`)

- The release still moves off any lineman in the lane (the slide, and the ball's line off his hands; the batted-ball odds are the sim's and didn't change), but the drawn slot is weighted by the threat of the man in the lane: the sim's own pressure from him (`ai.ts pressureFrom`: a free rusher within ~4.5 yd, or one driven back into the QB's lap through his blocker), full at 0.5. A clean pocket throws from his normal slot; a rusher in his lane gets the side-arm sling or the over-the-top release. Off-Platform's sling on the run is as it was.

## The numbers

### The camera, at 60 fps from the broadcast camera (before → after)

From the recordings' per-frame log (`cam.py`). The QB's height is head to feet at 960×540; "in frame" is his head, hand and feet.

CAMTABLE

The same in Node (`p11_cam.ts`, the game's code stepped at 60 fps; the QB from the ground to 1.95 m, the receiver likewise), every recorded pass:

| | Slant | Out | Dig | Go | Post | Corner | Cross | Screen | Contested | Fade |
|---|---|---|---|---|---|---|---|---|---|---|
| Flight (s) | 0.71 | 1.21 | 0.81 | 1.33 | 1.32 | 1.49 | 1.15 | 0.47 | 1.61 | 1.55 |
| Peak pan °/s | 53 → 30 | 52 → 38 | 33 → 22 | 29 → 21 | 17 → 20 | 26 → 23 | 41 → 28 | 47 → 39 | 29 → 28 | 24 → 23 |
| Peak zoom °/s | 88 → 67 | 60 → 55 | 80 → 71 | 54 → 51 | 55 → 52 | 48 → 44 | 60 → 64 | 71 → 55 | 48 → 42 | 50 → 44 |
| Peak dolly m/s | 10.4 → 10.3 | 18.1 → 16.0 | 11.8 → 10.1 | 23.4 → 20.7 | 23.4 → 20.8 | 28.4 → 25.1 | 16.6 → 14.1 | 4.6 → 10.2 | 29.4 → 25.0 | 26.1 → 22.5 |
| QB at the release (px) | 77 → 98 | 78 → 99 | 76 → 96 | 80 → 99 | 77 → 96 | 78 → 99 | 77 → 98 | 78 → 97 | 79 → 101 | 75 → 95 |
| QB in frame to (s after) | 0.28 → 0.25 | 0.40 → 0.40 | 0.28 → 0.28 | 0.40 → 0.42 | 0.42 → 0.45 | 0.43 → 0.43 | 0.38 → 0.38 | 0.40 → 0.57 | 0.48 → 0.45 | 0.52 → 0.52 |
| Receiver at the catch (px) | 137 → 140 | 131 → 132 | 132 → 133 | 129 → 131 | 130 → 131 | 123 → 125 | 132 → 133 | 103 → 117 | 142 → 146 | 145 → 149 |
| Lens at the catch (°) | 20.2 → 21.2 | 19.2 → 19.4 | 18.2 → 18.8 | 19.9 → 19.8 | 19.2 → 19.2 | 23.1 → 22.6 | 18.1 → 18.4 | 31.6 → 31.1 | 24.3 → 23.4 | 22.4 → 21.9 |

### The book (`tools/sim/outcomes.ts`, 60 a cell, 14,873 attempts; the `p11_*` copies)

| | Before (round 10) | After | NFL |
|---|---|---|---|
| Completion | 66.1% | 65.8% | ~64–66% |
| Yards per attempt | 7.5 | 7.5 | ~7 |
| INT | 2.4% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 14.6% / 3.5% | 14.6% / 3.6% | ~12–14% / ~3% |
| 2+ yd open caught | 84.9% | 84.7% | ~80% |
| In phase (< 1 yd) caught | | 19.7% | |
| Batted at the line (`batted.ts`) | 1.4% | 1.4% | ~1–2% |
| Drops / broken up (`batted.ts`, of attempts) | 2.6 / 10.5% | 2.6 / 10.7% | |

**The open ball, broken down** (`p11_open.ts`, 4 a cell): of 518 open balls that got to the receiver's hands, 95.0% were caught (21 drops, 3 off the fingertips, 2 broken up), the same before and after: on a ball that reaches him, an open man's catch rate is the NFL's (drops ~3–5% of catchable balls). The harness's 84.7% counts every open target, and ~10 points of it are balls that never got to him (overthrown, behind, out of reach). The book's point above the NFL on open balls is on the QB's side, the share of open targets thrown where he can catch it, not the receiver's hands.

**The arm slot** (`p11_slot.ts`, 497 AI throws, 2 a cell): the release moved off a lineman on 57% (unchanged; the sim's). The slot drawn (weight ≥ 0.2): before 57% (52% of clean pockets, pressure < 0.3; 74% under pressure), after 14% (5% of clean pockets; 41% under pressure).

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | 19 / 20 (Gates vs Lewis, waiting on the owner) |
| ...Tyreek Hill over Wes Welker after the catch (line 0.8) | +1.07 (4.51 vs 3.44 yd) | +1.09 (4.55 vs 3.46) |
| ...Rob Gronkowski over Tony Gonzalez after the catch (line 0.8) | +1.60 (4.46 vs 2.86) | +1.59 (4.47 vs 2.88) |
| ...every other margin | | within ±0.8 points of its before (catch rate in traffic, completions allowed) |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (40 reps), on time, zone / man | 57% / 59% | 59% / 60% |
| Slants late (1.5 / 2.0 / 2.5 s), zone | 28 / 26 / 24% | 29 / 28 / 25% |
| Screens (`screens.ts`): RB screen a call | 83–100% | 83–100% |
| ...bubble a call | 80–100% | 75–100% (Cover 2 man 80 → 75%: the press corner arriving at the catch) |
| Clip gates (`build_anims.py`) | 215 / 215 | 215 / 215 |
| `npm run check` | passes | CHECK |
| `e2e/practice.spec.ts` (port 5543) | passes | E2E |

- **The determinism golden doesn't move** (920 cases, every hash the same: re-generated with `BTB_UPDATE_GOLDEN=1` and diffed; no re-pin).
- **The coordinator's film** regenerated with its tool (`tools/sim/p11_film.ts`, a copy of `film.ts`): 7 lines of `src/sim/film.ts` moved.
- **The feel clips and the e2e seeds hold**: `tests/sim.test.ts` passes as it is (the touchdown clip M7's celebration test plays among them), and `tools/sim/p11_e2eseeds.ts` keeps the touchdown on 336, the full play on 4 and the stick tackle on 2.

## The videos

`docs/passing/round11/` (960×540 on Low, frame-true, crf 28):
- **`before/`, `after/`**: `p9-slant-60`, `p9-out-60`, `p9-dig-60`, `p9-go-60`, `p9-screen-60`, `p10-fade-60` (the broadcast camera at 60 fps, from the windup to 1.8 s after the ball); `after/p9-contested` (Gronkowski on Lott from the broadcast camera, 30 fps; its before is `round10/after/p9-contested.mp4`) and `after/p9-contested-close-30` (the close camera behind him; before: `round10/after/p9-contested-close-30.mp4`).
- **`compare/`**: before on the left, after on the right.
- **`stills/`**: STILLS

## Watched: an honest critique

CRITIQUE

## Still open

OPEN
