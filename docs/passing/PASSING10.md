# The passing game, round 10: the QB's end of the throw, the camera with the ball, the post-up

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 9 (`PASSING9.md`) put the catch in the shot from the release. It left these visible problems from the default broadcast camera, which this round took in the brief's order:
1. the QB's end of the throw: the follow-through short and mostly off-screen, and the "Space CATCH" prompt sitting over him through the release;
2. the whip-pan on a quick throw;
3. the box-out that doesn't read as a post-up;
4. the ball in flight (spin, attitude, drawn size, trackable on a deep ball at 60 fps);
5. the book's completion and open-caught rates (only if 1–4 were done: see below).

Branch `wip/passing10`, from `b7554cb` (the tip of `claude/m66-polish`, rounds 1–9). Every change this round is in the render, the clips and the HUD: `src/sim` and `src/engine` are untouched, so every harness number is the same as round 9's to the last digit, and the determinism golden and the film didn't move.

## How it was watched

- **The same ten passes as round 9** (`src/game/clips.ts PASSING9`), plus **the fade with touch** (`PASSING10`: the Z's fade on Stick against Cover 3, the key held half a second, caught over the shoulder 19 yd downfield; `tools/sim/p10_clips.ts`). Recorded from the default broadcast camera on the frame-true clock at 960×540 on Low (`BTB_VIDEO=1 BTB_PASSING10=1 BTB_DIAG=1`, `tools/shots/video.spec.ts`).
- **At 60 fps for the camera's move**: `BTB_WINDOW=1 BTB_VIDEO_FPS=60` records from the windup to 1.8 s after the ball (the frames before it are drawn at 30 fps so the camera and the clips step as in play, but not kept). The slant, the out and the go were recorded this way on both trees.
- **The camera, measured**: the per-frame log now has the camera (its position, where it looks, its lens) and the QB (his hands, feet, pelvis, the clip he's in). `cam.py` (scratch) turns it into the pan's speed (yaw and pitch, °/s, a 3-frame mean), the zoom's speed (°/s of lens) and the dolly's speed (m/s) frame by frame; `ballscr.py` projects the drawn ball into the frame each frame (where it is, how long it's drawn in pixels).
- **Close-ups**: the QB from a close camera (`BTB_FOLLOW=1`, `QB,4,-5,2.2,40`) on the slant (the flick), the go (the drive) and the fade (touch); the tight end on the contested ball (the post-up).
- **The before set** is a frozen copy of `b7554cb` with the round-10 recording hooks and clip list added (the same plays, the same keys).
- **The clips in Blender**: a contact sheet of each throw's finish from its release frame on, from the front, the side and three-quarters (the scratch `prev_fin.py`, as `tools/blender/preview_clips.py` but starting at the release).

## What was wrong (root causes)

1. **The follow-through was keyed short and the same for every throw.** `tools/blender/lib/actions_pass.py:89, :94, :98` at `b7554cb` (`_throw`, the quick and the long throws) and `tools/blender/lib/actions.py:388, :393` (the M4 throw): one follow-through key (`fol`) reached 0.15–0.19 s after the release, then straight away blended into the idle stand (the hands' IK let go over the next 0.25–0.43 s). A five-yard slant and a fifty-yard post finished identically: the hand to the hip, the hips 20–28° round, the back foot squaring up late. Nothing held the finish, and the follow-through couldn't say what kind of throw it was.
2. **The air camera left the pocket on the release frame, at full speed.** `src/render/game/GameCamera.tsx:152, :296, :326, :387, :448` at `b7554cb`: the frame the ball went, the camera's target jumped from the pocket framing to a look halfway to the catch (`lead = 0.5 · (1 − e)`), a 20-yd dolly target and a zoom target, and a spring chasing that step (stiffened up to 1.5× on a quick throw, `AIR_QUICK`) took off at once. Measured at 60 fps on the slant (`round10/before/p9-slant-60.mp4`): the pan was at 18°/s on the first frame after the release and 52°/s by the sixth, the lens closed at up to 80°/s, the eye dollied at up to 22 m/s. The QB's release and finish went out of the bottom of the frame as they happened (`before/p9-go-60.mp4`: gone by 0.25 s after the release), and the move read as a snap to the spot, not a camera going with the ball.
3. **The catch call sat on the QB.** `src/ui/styles/game.css:72` at `b7554cb`: `.catch-call` at 79% down the screen, centred, shown from the release frame (`PracticeScreen.tsx:525`, `phase === "air"`). From the pocket framing the QB is drawn 72–85% down the frame, centred: the panel covered his release and finish.
4. **The post-up was turned the wrong way, and nothing moved the man.**
   - `src/render/game/GameScene.tsx:440` at `b7554cb`: a receiver posting up was drawn facing his run (`face`), like any receiver. The box clip (`tools/blender/lib/actions_p8.py:162`) keys the bar arm out to the side and a little ahead of him, which only meets a man who is level with him. On round 9's contested ball (Gronkowski on Ronnie Lott, Cover 1 seed 3) Lott trails him: on the round's first recording the bar arm went out ahead of Gronkowski, away from Lott, so it was hidden by his own back from the close camera behind him (round 9's "the bar arm is hidden by his own back, before and after alike") and pointed at nothing from the broadcast one.
   - `src/render/game/contact.ts` drew a contested pair leaning into each other by their box-out share; nothing drew the defender being moved by the contact, so the box-out read as two bodies jammed together.
   - The air framing widens to 10 m of field for a ball two seconds in the air (`CATCH_FRAME_DEEP`), so a 1.6-s contested ball was framed at ~9 m: the pair ~60 px tall.
5. **The ball in flight was not the problem.** The spin is 600 rpm (±10% by Throw Power), capped at 1 rad a frame against strobing (573 rpm at 60 fps; at 30 fps the recordings show half of it); the nose follows the velocity with ~5° of lag on the way down; the drawn ball grows to 1.6× by 45 m from the camera. Measured in the recordings (`ballscr.py`), the drawn ball is in the frame on every frame of every flight on both trees, and its long axis is 10–33 px at 960×540 (20–66 px at 1080p). Nothing was changed (see below).

## What changed

### The throw's finish, by the throw (`tools/blender/lib/actions_p10.py`, new; `choreo.ts throwFinish`; `animator.ts continueAs`)

- **Nine finishes keyed in-house**: for each windup (the M4 throw, `qb_throw_quick`, `qb_throw_long`: the QB's Release rating, so Marino's compact motion and a long loop stay his own) a finish by the throw, `<throw>_fin_flick`, `_fin_drive`, `_fin_touch`. Each is the throw itself, pose for pose and travel for travel, up to its release frame, then:
  - **the flick** (the quick game: a driven ball in the air under 0.78 s: the slant's 0.71, the RB screen's 0.47): compact. The hand through across the belly to the front hip (no big drop of the shoulder), the hips 26° round, the back foot up off its toe 0.02 s after the release and down level with the front one by 0.2 s; finished 0.13 s after the release, held to 0.26 s, a stand by 0.56 s.
  - **the drive** (every other driven ball, from the dig's 0.81 s on, and every ball of 25 air yards or more, the AI's layered deep ball included): the whole body through it. The hips 34° round and the pelvis tipped 30° so the chest goes over the front knee, the throwing hand finishing low across the body outside the front thigh, the glove arm pulled into the hip, the back foot swinging through to land a quarter metre past the front one by 0.3 s (the weight over it), held to 0.46 s, then a gather step up with the front foot; a stand by 0.98 s.
  - **touch** (a ball the sim says he put air on, short of 25 air yards: the player's hold, as on the fade, or the AI lofting it over a man underneath): the arm follows the ball out and up toward the target and stays there (the hand high and out in front, ~1.4 m up and 0.6 m ahead), the body taller and less turned (22°), the eyes up with the ball, the back foot up onto its toe and stepping softly through by 0.36 s; held to 0.42 s.
  - From quarterback coaching: the weight transfer onto the front foot, "finish across the body", "the back foot comes through", "touch: the hand goes to the target". 215 of 215 clip gates pass (206 + the nine; the slide and clearance gates on every frame).
- **The swap at the release** (`choreo.ts`, the frame the ball is out of his hand): `throwFinish` reads the throw from the ball as it leaves (the sim's own kind, driven or touch; its hang; its air yards; a hit as he throws), and `animator.continueAs` carries the playing throw on as its finish, keeping its time, rate and weight (as a transition, or the upper-body overlay of a throw on the run). Up to that frame they're the same clip, so the swap never shows. A man hit as he throws keeps his own throw's short follow-through (he never finishes), and the fade-away off his back foot has no finishes.
- **The arm slot lets go at the release** (`throwSlot`): round 8's side-arm and over-the-top variants still shape the windup and the release; from the release the finish is the throw's own (the slot's weight eases out over ~0.1 s).
- **A QB who moves off before his finish is through runs out of it** (faster than 2 m/s: the finish is keyed standing).
- Which throws get which, on the recordings (`tools/sim/p10_clips.ts` prints each throw's kind, hang and air yards): the slant and the screen the flick; the out, the dig, the curl, the crosser, the go, the post and the corner the drive; the fade and the contested ball (lofted over a man) touch. (A first cut chose by distance and launch angle; measured, the slant is 15.5 yd from the release to the catch point and the fade leaves at 21°, so it gave the slant the drive and the fade the drive too. It was replaced before the final recordings.)

### The camera goes with the ball (`src/render/game/GameCamera.tsx airPose`)

- **The target itself moves**, from the pocket's framing as the ball left to round nine's catch framing, on a smoothstep in time: it starts from rest and gathers pace with the ball, then eases out onto the spot before the ball gets there. No step for a spring to chase.
- **A beat on the pocket first**, by the flight time: none on a quick throw (the ease-in is the beat: on the 0.7-s slant the shot has gone 8% of the way 0.08 s after the release, so the flick and its finish are seen where they happen), 0.25 × (flight − 0.9 s) on a longer ball, at most 0.25 s (the drive's finish, 0.22 s, seen whole before the shot goes).
- **Settled before the catch**: the move is done 20% of the flight before the ball arrives (0.22 to 0.4 s), so the catch is framed still and as tight as round nine framed it.
- **The eye goes only part of the way on a quick throw** (35% on the slant, all of it on a ball 1.8 s or more in the air): the shot pans and zooms from about where it is, as a broadcast camera does, instead of dollying 15 m in half a second; the zoom (round nine's `fitFov`, unchanged) frames the catch from where the eye really is, on a longer lens.
- **Stiff springs on an eased target** (`AIR_W`: eye 10, look 16, lens 14 rad/s; ~0.1–0.2 s of lag) replace round nine's `AIR_QUICK` stiffening.
- **A post-up is framed as tight as a quick throw** (7.5 m of field at the spot) whatever its depth: when the man nearest the spot is one the receiver boxes out (`boxOut` ≥ 0.4, the box clip's own line).

### The catch call out of the pocket (`src/ui/styles/game.css .catch-call`)

- **In the bottom-right corner**, clear of the pocket (drawn 72–85% down the frame, centred) and of the catch (framed just above centre), and it **comes in 0.12 s after the ball is out** (a 0.16-s fade and rise), so the release is seen clean first. Same panel, same key, same word once the catch is called. (The recordings draw a frame every few seconds of wall time, so they show it on the release frame; the delay is in play only.)

### The post-up (`choreo.ts boxPost`, `GameScene.tsx`, `contact.ts`, `actions_p8.py box_out`)

- **He turns his back into the man**: through the box clip's post (from its bar key, 0.58 s before the ball, in over 0.25 s; out after the tuck) the receiver's drawn facing turns so the man is 125° off it on the clip's side, behind his near shoulder (at most 60° of turn). On the recorded contested ball Lott trails Gronkowski, so he turns ~30° to put Lott on his back and right shoulder.
- **The bar out to the man**: `catch_box_l/_r` re-keyed in-house with the bar arm out from his body, the elbow up and the hand out to his side and a little behind him (where the man is once he's turned), the fight key driving it a hand further in. 215/215 gates.
- **The man is moved by it** (`contact.ts`, render only): from the post to just before the ball the defender is drawn up to 0.35 m further off the receiver than the push-apart puts him and rocked back up to 0.2 rad; the receiver leans on into the space. Both bodies react, then both go up for it (the hands' late snap from round 9 is unchanged).
- The sim's box-out (the contest, the bodies' push, the boxed man's tackle: `sim/bodies.ts boxOut`) is unchanged.

### The ball: left as it is

Checked frame by frame at 60 fps on the slant and the go (`ballscr.py` on the per-frame log): the drawn ball is in the frame on every frame of every flight, its long axis 11–24 px at 960×540 on the slant, 12–25 px on the out and 10–25 px on the go (twice that at 1080p), the spiral turning ~57° a frame at 60 fps (573 rpm; the laces visibly turning, no strobing), the nose on the path going up and riding ~5° above it coming down. With the camera now panning with the ball rather than snapping to the spot, the go's ball stays within the middle half of the frame across (|x| ≤ 0.22 of the half-width, against 0.35 before). Nothing about it needed changing for the owner to track a deep ball; no trail was added.

### The book: left alone

Items 1–4 took the round. The book (66.1% completion, 84.9% of open balls caught) is inside the gate and this round changed nothing in the sim; I didn't look for new causes.

## The numbers

Nothing in `src/sim` or `src/engine` changed, so the sim is the same to the bit: every harness gives round 9's numbers exactly (run again on this branch, the `tools/sim/p10_*.ts` copies).

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,873 attempts):

| | Before (round 9) | After | NFL |
|---|---|---|---|
| Completion | 66.1% | 66.1% | ~64–66% |
| Yards per attempt | 7.5 | 7.5 | ~7 |
| INT | 2.4% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 14.6% / 3.5% | 14.6% / 3.5% | ~12–14% / ~3% |
| 2+ yd open caught | 84.9% | 84.9% | ~80% |
| Batted at the line (`batted.ts`) | 1.4% | 1.4% | ~1–2% |
| Drops / broken up (`batted.ts`, of attempts) | 2.6 / 10.5% | 2.6 / 10.5% | |

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | 19 / 20 (Gates vs Lewis, waiting on the owner) |
| ...Tyreek Hill over Wes Welker after the catch (line 0.8) | +1.07 (4.51 vs 3.44 yd) | +1.07 |
| ...Rob Gronkowski over Tony Gonzalez after the catch (line 0.8) | +1.60 (4.46 vs 2.86 yd) | +1.60 |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (40 reps), on time, zone / man | 57% / 59% | 57% / 59% |
| Slants late (1.5 / 2.0 / 2.5 s), zone | 28 / 26 / 24% | 28 / 26 / 24% |
| Screens (`screens.ts`) | RB screen 83–100% a call, bubble 80–100% | the same |
| Clip gates (`build_anims.py`) | 206 / 206 | **215 / 215** (the nine finishes; `catch_box_l/_r` re-keyed) |
| `npm run check` | passes | passes (78 files, 756 tests) |
| `e2e/practice.spec.ts` (port 5523) | passes | passes, 7 / 7 |

The determinism golden, the coordinator's film, the feel clips (the touchdown clip M7's celebration test plays among them) and the e2e seeds are all unmoved: the sim didn't change, and `npm run check` and the practice e2e (its determinism test reproduces the Node hashes in the browser) pass as they are.

**The camera, at 60 fps** (`round10/*/p9-*-60.mp4`, from the per-frame log; the pan a 3-frame mean):

| | Slant (0.71 s) before | after | Out (1.21 s) before | after | Go (1.33 s) before | after |
|---|---|---|---|---|---|---|
| The pan starts (frames after the release) | 0 | 8 | 0 | 15 | 0 | 19 |
| Its first frame (°/s) | 18 | ~0 | | ~0 | | ~0 |
| Peak pan (°/s) | 52 | 56 | 59 | 55 | 42 | 30 |
| Peak zoom (° of lens/s) | 80 | 88 | 39 | 60 | 57 | 55 |
| Peak dolly (m/s) | 22 | 12 | 23 | 19 | 25 | 24 |
| Lens at the catch (°; smaller is tighter) | 22.7 | 20.2 | 26.0 | 19.2 | 23.5 | 19.8 |
| Ball in the frame, every frame of the flight | yes | yes | yes | yes | yes | yes |
| Ball's long axis drawn (px at 960×540) | 11–26 | 11–24 | 13–24 | 12–25 | 13–34 | 10–25 |
| Ball's furthest from the centre, across (share of the half-width) | 0.17 | 0.17 | 0.45 | 0.40 | 0.36 | 0.22 |

From the 30-fps broadcast recordings, every pass (the pan's start in 30-fps frames after the release; the lens at the catch):

| | Slant | Out | Dig | Curl | Cross | Go | Post | Corner | Fade | Contested | Screen |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Flight (s) | 0.71 | 1.21 | 0.81 | 0.90 | 1.15 | 1.33 | 1.32 | 1.49 | 1.55 | 1.61 | 0.47 |
| Finish drawn (after) | flick | drive | drive | drive | drive | drive | drive | drive | touch | touch | flick |
| Pan starts, before → after | 0 → 4 | 0 → 8 | 0 → 5 | 0 → 5 | 0 → 8 | 0 → 10 | 0 → 13 | 0 → 12 | 0 → 13 | 0 → 12 | 0 → 5 |
| Peak pan °/s, before → after | 53 → 56 | 59 → 54 | 41 → 33 | 48 → 47 | 48 → 42 | 42 → 30 | 24 → 16 | 46 → 27 | 44 → 25 | 59 → 31 | 50 → 44 |
| Lens at the catch °, before → after | 23.2 → 20.4 | 26.3 → 19.3 | 22.7 → 18.5 | 22.9 → 18.0 | 24.4 → 18.2 | 23.5 → 19.5 | 23.1 → 18.9 | 25.5 → 22.7 | 27.4 → 22.4 | 32.4 → 23.6 | 29.3 → 31.6 |
| Ball in the frame every frame | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes | yes, yes |

## The videos

Recorded on the frame-true clock at 960×540 on Low (`BTB_VIDEO=1 BTB_PASSING10=1 BTB_DIAG=1`), encoded at crf 28. The before set is a frozen copy of `b7554cb` with the round-10 hooks and clip list added.

- **`round10/before/`, `round10/after/`** (the default broadcast camera, 30 fps): `p9-slant`, `p9-out`, `p9-dig`, `p9-curl`, `p9-go`, `p9-post`, `p9-corner`, `p9-cross`, `p9-screen`, `p9-contested` (Gronkowski on Lott), `p10-fade`.
- **`*-60.mp4`** (the broadcast camera at 60 fps, from the windup to 1.8 s after the ball): the slant, the out and the go. These are the ones to judge the camera's move by.
- **`*-close-30.mp4`** (a close camera, from the windup): the QB on the slant (the flick), the go (the drive) and the fade (touch); the tight end on the contested ball (the post-up).
- **`round10/compare/`**: before on the left, after on the right: the slant, the out and the go at 60 fps, the fade and the contested ball from the broadcast camera, and the three QB close-ups.
- **`round10/stills/`** (before on top, after below):
  - `broadcast-prompt-release-before-after.jpg`: the slant one and three frames after the release, the catch call over the QB before and in the corner after;
  - `broadcast-qb-release-60fps-before-after.jpg`: the QB from the broadcast camera at 60 fps through the release and finish on the slant and the go (cropped and enlarged);
  - `close-qb-finish-before-after.jpg`: the close camera on the QB from the release on: the slant (the flick), the go (the drive), the fade (touch);
  - `broadcast-slant-60fps-camera.jpg`, `broadcast-go-60fps-camera.jpg`: the whole frame every 0.1 s (the slant) or 0.2 s (the go) from the release to the catch;
  - `broadcast-box-before-after.jpg`: Gronkowski on Lott from the broadcast camera, cropped and enlarged, 0.5 s before the catch to just after it;
  - `close-box-before-after.jpg`: the same from the close camera behind them.

## Watched: an honest critique

I read the 60-fps recordings frame by frame next to the per-frame log, the 30-fps ones as strips from the release to the catch, and crops of the QB and of the contested pair, before against after.

- **The QB's end: the release is now seen, and the finish says what the throw was.**
  - Before, the catch call came up over the QB on the release frame, and the camera was already leaving: on the go the QB went out of the bottom of the frame 0.25 s after the release, with the panel on him for the frames he was in (`stills/broadcast-prompt-release-before-after.jpg`, `broadcast-qb-release-60fps-before-after.jpg`). Now the panel is in the corner and the QB stays in the shot: through ~0.27 s after the release on the slant and ~0.4 s on the go.
  - On the go you can watch the drive from the broadcast camera: he comes over his front leg and stays there, bent, while the ball is in the air. Before, he was standing straight up with his arms down 0.27 s after the release. On the fade the arm stays out toward the target at shoulder height; before, it had come down to his chest by 0.17 s (`stills/close-qb-finish-before-after.jpg`).
  - But the QB is ~50–60 px tall at 960×540 from the pocket framing. The difference between a flick and a drive reads as "a short motion" against "a big one" from the broadcast camera; the arm finishing across the body and the back foot coming through are a few pixels at that size, and from the close camera (behind his right shoulder) the arm across the body is hidden by his own back. The touch finish is the clearest of the three from any angle. At 1080p and 60 fps it is twice the pixels and twice the frames; it's still a detail of the shot, not its subject.
  - The flick is subtle against the old follow-through (which was already compact on a quick release); what changed most on the slant is that the QB is still in the frame for it.
- **The camera goes with the ball; on the slant it's still quick.**
  - On every throw longer than a second the move now starts from rest a beat after the release and peaks lower than round nine's: the go at 30°/s against 42, the post 16 against 24, the corner 27 against 46, the fade 25 against 44, the contested ball 31 against 59. Frame by frame at 60 fps it reads as the shot following the ball up and out: it holds on the pocket as the ball leaves, gathers pace, and lands on the catch before the ball does. The ball stays nearer the middle of the frame (the go's furthest off-centre across 0.22 of the half-width, 0.36 before; the fade's 0.23, 0.59 before), and the catch is framed tighter than round nine had it (the lens 18–23° at the catch, 22.7–32.4° before; the contested pair ~1.4× the size).
  - On the slant (0.71 s) the move starts from rest instead of at 18°/s on the release frame, the dolly is half as fast (12 m/s against 22), and the camera is settled ~0.15 s before the catch; but the pan's peak is about what it was (56°/s against 52) and the zoom's too (88°/s of lens against 80), because the whole move now happens in ~0.45 s instead of starting at the release. I think it reads as the camera going with the ball rather than snapping to the spot, but it is still a fast move on a quick throw. A slower one would mean either framing the slant wider at the catch (the receiver smaller) or not leaving the pocket framing at all on the quick game, as a fixed high broadcast camera would; the owner should play a few slants at 60 fps and say which he wants.
  - The RB screen's move is now spread over 0.45 s whatever the flight (a 0.47-s screen had a quarter of a second for it, faster than before: 62°/s; now 44, 50 before), so its catch is framed a little wider than before (the lens 31.6° at the catch, 29.3° before) and the move finishes in the catch beat.
  - With the eye moving less on a quick throw, the near linemen fill the bottom corner of the frame for a moment mid-flight on the slant (as they did in round nine's before set); they're out of the shot by the catch.
- **The post-up: it reads as a box-out now, not quite as a bar.**
  - The cause was the turn, not the clip: Lott trails Gronkowski on the recorded ball, and Gronkowski was drawn facing his run, so the bar arm (keyed out to the side and ahead) pointed away from the man on him (round nine's "hidden by his own back"). Now he turns his back into Lott (~30° here), Lott is on his right shoulder, Gronkowski leans into him and Lott is visibly moved off his line before both go up; from the broadcast camera, framed tighter, you see a big man with his back and number to the camera walling off the man behind him, then high-pointing it (`stills/broadcast-box-before-after.jpg`). Before, it was two bodies jammed together, Gronkowski facing the camera.
  - The bar arm itself is still not a clear picture: it's between the two bodies from the broadcast camera and behind Lott from the close one (`stills/close-box-before-after.jpg`). The turn shows the post-up; the forearm on the man is implied rather than seen.
- **The ball**: in the frame on every frame of every recorded flight, before and after, 10–25 px long at 960×540, spinning without strobing, nose up on the way up and riding a few degrees above the path coming down. It was fine; with the camera following it rather than snapping, the deep ball is easier to keep your eye on (it stays near the middle).

Would the owner, playing from the broadcast camera, now feel the QB's end, the ball and the WR's end are real?
- **The QB's end: more than before, not all the way.** The release is seen clean (no panel on it) and the shot stays on him long enough to see him finish, and a deep ball's finish is a visibly bigger motion than a slant's. But at the pocket framing the QB is small, so the finish reads as body language (a big drive, an arm left out for touch) rather than as the mechanics a close-up would show.
- **The ball: yes.** It reads as a football from the hand to the catch, and on a deep ball the camera now follows it rather than racing ahead of it.
- **The WR's end: the catch is framed tighter than ever, and the big man's box-out now reads as one.** The reach, the hands and the tuck from rounds five to nine fill more of the frame at the catch.

These are 960×540 recordings on Low; the 60-fps ones are the slant, the out and the go.

## Still open

- **The slant's camera move is still fast** (peak ~56°/s and ~88°/s of zoom over ~0.45 s), though it starts from rest and settles before the catch. The owner should judge it at 60 fps: the options are a wider catch framing on the quick game, or a quick-game shot that pans without leaving the pocket framing.
- **The QB's finish is small at broadcast distance.** The arm across the body and the back foot coming through are a few pixels; a moment's tighter framing on the QB at the release (a broadcast's "QB cam" cut) would show them, at the cost of the shot of the routes. I didn't add one.
- **The bar arm** is between the two bodies from the broadcast camera; the post-up reads through the turn and the displacement, not the forearm.
- **The throwing shoulder's pad** lifts when the arm crosses the body (in the old follow-through too; the drive's finish keeps the hand a little less across to limit it): skinning, not keys.
- **The finish's keys are one per throw type**, not scaled by the throw's length within a type (a 15-yd dig and a 50-yd post both get the full drive).
- **The book is at 66.1% and "2+ yd open caught" at 84.9%**: untouched this round (item 5 wasn't reached).
- **Gates vs Lewis** (identity) still waits on the owner.
