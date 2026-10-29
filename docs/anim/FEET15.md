# Animation round 15: planted feet that stay planted

Round 14 (`docs/passing/PASSING14.md`) added a planted-foot slide meter to the pop meter and found heavy slide on every player on every play: on the contested ball, 55 of the back seven's 152 planted spans drifted more than 2 cm, with 362 one-frame foot jumps. It left three things for this round:

1. **Planted-foot drift and pops for every player:** receivers, defensive backs, linemen and the carrier.
2. **The contested throw's front leg straightens for two frames just after the release.** The touch finish's hips rise straight over the planted foot.
3. **Round 14's new 3–4 cm slide** as the QB walks off after the contested finish.

Branch `wip/anim15`, from `97a4a47` (the tip of `claude/m66-polish`, rounds 1–14). Nothing in `src/sim` or `src/engine` changed. Every change is in:
- the animator (`src/anim/animator.ts`);
- the render (`src/render/game/choreo.ts`, `GameScene.tsx`);
- the instruments: `src/render/game/popMeter.ts`, `tools/shots/video.spec.ts` (`BTB_PASSING15`, `BTB_MEASURE`, `BTB_FOLLOW15`, `BTB_TRACE`) and `tools/sim/a15_*.ts`.

No clip was re-keyed: `anims.glb` and `anims.json` are untouched, and all 215 of 215 clip gates pass.

## How it was measured

- **The six plays:**
  - the slant (`p9-slant`);
  - the go (`p9-go`);
  - the cut run (`cut-run`);
  - the RB screen (`p9-screen`);
  - the contested ball (`p9-contested`, Gronkowski on Lott);
  - the sack (`sack`).
- **Each play is measured whole, at 60 fps**, from the snap to 0.6 s after the whistle. `BTB_MEASURE=1` draws every frame and keeps none (320 px, Low, no shadows or AO, none of which touch the animation). Only the pop meter's log is kept.
- **The before set** is `97a4a47` with only the instruments added: the meter, the animator's read-only debug fields and the recording hooks. It's a frozen copy, run on the same meter.
- **The meter** (`popMeter.ts`) follows round 14's rules:
  - A *planted span* is a foot whose lock is fully on (weight ≥ 0.98). It ends when the foot lifts or the lock's point jumps more than 2 cm.
  - Its *drift* is how far the drawn ball of the foot gets from its first frame along the ground.
  - A *jump* is a planted foot moving more than 2 cm in one frame. This round also counts the jumps over 5 cm (the brief's line).
- **New this round**, in the meter:
  - the counts by unit (QB, OL, DL, LB, DB, WR/TE, RB);
  - each jump's and each drifting span's cause: a re-plant (by the lock sources it changed between), *reach* (the leg's IK short of the ankle's target by more than 1 cm: the body carried off the foot), or other;
  - the twelve worst spans with a per-frame trace (the gait's speed, loco and backpedal shares, phase, IK miss, root, yaw, lock point and toe);
  - the steps the new lock takes, by cause;
  - `?trace=SLOT`, every frame of one player's feet;
  - the animator's cost per body per frame (`pops.cost`, timed around `animator.update` in GameScene, only under `?pops`).
- **The per-frame log** (`BTB_DIAG`, round 14's QB legs at the millimetre) also has the QB's lean (bank and pitch) now.
- **Watched at 60 fps** from the broadcast camera (960×540, Low, frame-true):
  - the slant, the go and the screen to 1.8 s after the ball, and the contested ball to 1.2 s after it;
  - the cut run and the sack at 30 fps, the whole play;
  - close cameras (`BTB_FOLLOW15`) on the feet: the weak-side linebacker (Lawrence Taylor) and the left tackle on the go, the left corner (Deion Sanders) through his hip flip on the sack, and the QB's legs on the contested ball at 60 fps.
- **In Blender's data** (scratch `fk.py`, a forward-kinematics reader of `anims.glb`), the balls of the feet, the hips and the knees of the gaits, the hip flip and the touch finish, frame by frame.

## What was wrong (root causes)

All line numbers are at `97a4a47`. The meter's causes come from all six plays before (`docs/anim/feet15/measure/before/`).

1. **A planted foot that couldn't stay planted was dragged.** This was most of the drift on every unit.
   - The lock (`animator.ts:1037–1131 lockFoot`) held a planted foot's ball where it landed until the clip lifted it, whatever the body did. When the sim carried the body away, the two-bone IK clamped to a straight leg (`ik.ts:48`) and the foot was dragged at the end of it.
   - In the before set, 483 of the 487 spans that drifted past 2 cm were *reach* spans, and so were 2,077 of the 2,744 one-frame jumps over 2 cm. The traces show:
     - Taylor's planted foot dragged 0.88 m sideways (`p9-go`, 19 frames, the IK 0.94 m short);
     - the strong safety's 1.41 m through his pedal on the slant;
     - the left tackle's 0.48 m when the sim set him back at 3.7–4 m/s while his kick-slide clip planted at its keyed ~1.2 m/s.
2. **The gait was fed only the speed along his facing** (`choreo.ts:1517`, `speed: max(0, along)`; `animator.ts:609`). A player moving sideways or at a slant to his facing (a linebacker scraping with his eyes on the QB, a corner bailing, a lineman sliding) ran his cycle slowly or stood still (`animator.ts:780`: a stance has both feet down) while the body went sideways at 3–4.5 m/s.
   - In the trace, Taylor's fed speed was 0.9–1.4 m/s while he moved 3.3 m/s sideways. The cycle's phase barely moved, so one plant lasted 19–29 frames.
3. **A change of lock source re-planted the foot in one frame** (`animator.ts:1057`). The stance's lock became the get-off's, the gait's became a cut's, a one-shot's became the stance's, and each time the lock was taken again at the new clip's foot.
   - At the snap the run's burst pitches the body (the lean) and the get-off's feet are already 14–30 cm off the stance's.
   - In the before set, 655 of the 2,744 jumps over 2 cm were these re-plants. The largest one-frame move of a planted foot was 1.19 m.
4. **The lock was taken where the leaned clip had the foot.** The run's lean (`animator.ts:756`, before the lock) tips the body about the hips: the bank on the yaw rate is up to 0.35 rad and the pitch is on the acceleration.
   - A receiver's outside foot was planted 12 cm in the air on a curving go route. In the trace the right ball was locked at y 0.12 m, against the clip's 0.022 m (checked in `anims.glb`).
   - A burst's pitch moved every planted foot at the snap.
5. **A lifted foot let go in ~15 ms** (`animator.ts:1053`, the weight falling at 200/s). It jumped in a frame by whatever the lock had corrected.
6. **The knee's pole was 0.5 m ahead of the knee along his facing** (`animator.ts:1124–1126`). Under a clip that turns the body off the root (the hip flip), the solve bent the knee sideways. It was part of the calf's 112–162 rad/s spikes through hip flips and spins (the rest was item 7).
7. **The hip flip turned him twice.**
   - The clip turns the body 180° about the hips (`actions_m6_back7.py:396`) and hands over to the run, which faces the root.
   - The drawn facing chased the sim's new heading at the same time (`choreo.ts:1524` faceVelocity, `GameScene.tsx:449`, up to 12 rad/s). The animator turned the root by the clip's turn only for stances (`animator.ts:660`).
   - On the sack, Deion Sanders opened his hips and then spun round to run downfield chest-first toward the camera. His planted feet were left behind the spin: in this round's traces, before the fix, the clip's planted foot went round 1.3–2.0 m from where the lock held it.
8. **On the contested ball the QB's run lean lifted his front hip** (item 2).
   - The round-14 log put it down to the touch finish's hips rising over the planted foot. In Blender the clip's hip-to-ankle rises only 0.5 cm from the release to +0.05 s (`fk.py`).
   - In the game it rose 4.9 cm. The new per-frame lean shows why: the sim turns the QB at 3 rad/s and stops his 1 m/s drift just as the ball goes, and the lean read that as a run. It banked him −12.9° and swung the pitch from +17.2° to −8.6° in 0.1 s. His left hip joint rose from 0.921 to 0.973 m while the right stayed at 0.92: the front leg was out of reach and straight (2°).
9. **Round 14's walk-off slide** (item 3) is round 14's give: the planted point following the clip's foot to keep the knee, by up to the sim's drift (`animator.ts:1106`). With nothing to end it, it reached 12 cm on the contested finish once this round had removed the re-plant that used to cut it short.
10. **Why round 14's hold made the line and the back seven worse.** The hold's give is a controlled slide: in a one-shot the planted point moves toward the clip's foot each frame by as much as the sim has drifted him.
    - For a QB drifting 0.1 m in the pocket, that's a few millimetres a frame.
    - For a tackle the sim sets back at 4 m/s through his kick-slide, or a corner carried at 6 m/s through his flip, by the same rule it's 5–10 cm a frame: a skate the meter counts as jumps (reasoned from the rule, not re-measured this round).
    - So it isn't a fix for them. A foot that can't hold has to step.

## What changed

### The planted foot holds, or steps (`animator.ts lockFoot`, `stepFoot`, `letGo`, `capture`)

- **A planted foot holds until it lifts.** If the clip has its foot more than `STEP_FAR` (0.2 m) from where it's held, or the leg can't reach it (the ankle's target over the straight leg by `REACH_MISS`, 3 cm), it **steps**.
  - The foot lifts from where it's drawn and goes to where the clip has its foot, in an arc: 0.1 s + d / 4 m/s (at most 0.22 s), 3 cm + 0.12·d high (at most 9 cm).
  - It plants there if the clip has it down, and blends back into the clip's swing if not.
  - One foot at a time: the second waits until the first is past halfway, unless it can't reach.
  - The step is built from the clip's own foot (its pose and orientation through the step are the clip's). The IK only carries the ball of the foot. No new motion data.
  - `STEP_FAR` is a third to a half of a set lineman's or a DB's stance width. Under it, the lock absorbs the gait blends' own 2–10 cm of mismatch.
- **A foot the clips lift within `LIFT_SOON` (0.06 s) lets go a little early** into its own swing instead of stepping. Most of these were a sprinter's toe-off, whose leg is near straight.
- **A change of lock source keeps the lock** (stand → get-off, gait → cut, one-shot → stance). The clips hand over on the same foot, and one whose new clip puts it far away steps there.
- **A lifted foot follows the clip's swing.** The lock's difference from the clip's foot blends out over 0.08 s, longer for a larger difference (at most 3 m/s of foot, 0.25 s). It used to be dropped in ~15 ms.
- **The lock settles with the landing ball.** While the clip still has the ball coming down (a heel strike rolling onto the ball), the point follows it until it lands. This is only while the lock engages, and is read before the leans.
- **The lock is on the turf under a lean.** It's taken at the clip's own ball height before the leans. The step's "far" is measured against the clip's foot before the leans, less what the leans had moved it when it planted, so a burst's pitch or a turn's bank doesn't make planted feet step.
- **The knee bends the way the clip bends it** (`kneePole`), or over the toes when the clip's leg is near straight. It no longer bends along his facing.
- **The QB** (`holdFeet`) keeps round 14's hold, with two limits:
  - his planted point gives at most `GIVE_MAX` (1.5 cm) in all, then steps;
  - his "far" is measured less the hold over his feet (the body drawn back over the foot moves the clip's foot with it).

### The gait paced by where he's going (`animator.ts gaitSpeed`, `warpHips`; `GameScene.tsx`)

- **The gait is fed the sim's ground velocity** (`AnimInput.vel`). Its speed is the speed along the way the hips point, not along his facing.
- **The hips turn toward the velocity** by up to `WARP_MAX` (55°), eased at 10/s. The trunk turns back up the spine (thorax most), so the chest keeps facing where the sim has him looking.
  - A back-seven player running with his eyes on the QB opens his hips; a corner's bail is ~45°. Past that, he turns and runs.
  - Not in one-shots (their clips are keyed turned), not standing, not past 120° off his facing without a pedal, and not for the QB (his pocket clips stay square).
  - The four spine turns are about the world's up, so they commute: one matrix update for the skeleton.

### The turns and the line (`choreo.ts turnClip`, the kick-slide)

- **A one-shot that turns him into his run holds the drawn facing while the clip turns the body** (the hip flip's 180°, a pull's 90°), and takes the clip's turn at its hand-over (`turnClip`; `animator.ts` calls `onTurn` into the gait too). A clip cut off early releases the hold.
  - The pop meter skips that one frame's bone rates: the pose is the same in the world, but the bones' local rotations jump by the turn.
- **A tackle's kick-slide quickens with the sim's set**, up to `KICK_RATE` (1.6×), so its own planted feet keep up with a set of ~2 m/s (1.2 m/s × 1.6). That's still steps at 30 fps; a faster set steps between them.

### The contested QB (item 2)

- **For the QB, the run's lean is his gait's alone** (`animator.ts`, `leanW`). In his one-shots (the drop, the set, the throw and its finish) the clip has him balanced.
- No clip change was needed: the touch finish keeps its keyed front knee once the lean doesn't tip him.

## The numbers

Each play is measured whole at 60 fps (`docs/anim/feet15/measure/before/` and `measure/after/`, the pop meter's logs). A cell is before → after.

- **The planted feet no longer drift or pop, by construction.** A planted foot holds, steps, or lets go into its swing; it is never dragged and never re-planted in a frame. The meter's own counts (spans, drift, jumps) are of the frames a foot is planted. The steps are counted separately: that is where the mismatch between the sim and the clips now goes, and those steps are the next thing to look at.
- The one span left past 2 cm (the sack's left guard, 2.0 cm) is a straight leg whose IK fell 3.1 cm short, just over the step's 3 cm line.
- There are fewer planted spans than before, because a foot that steps or settles starts a new span rather than dragging one long one.

#### Planted spans drifting over 2 cm / all spans (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0/4 → **0/2** | 0/7 → **0/6** | 1/5 → **0/6** | 2/9 → **0/7** | 4/12 → **0/12** | 2/5 → **0/12** | 9/42 → **0/45** |
| OL | 8/79 → **0/51** | 12/90 → **0/67** | 7/38 → **0/50** | 28/105 → **0/75** | 22/124 → **0/104** | 12/117 → **1/87** | 89/553 → **1/434** |
| DL | 0/40 → **0/26** | 6/59 → **0/40** | 6/37 → **0/28** | 10/65 → **0/42** | 12/81 → **0/59** | 8/71 → **0/46** | 42/353 → **0/241** |
| LB | 9/35 → **0/19** | 15/50 → **0/32** | 5/28 → **0/20** | 19/47 → **0/35** | 23/58 → **0/40** | 19/41 → **0/36** | 90/259 → **0/182** |
| DB | 15/41 → **0/21** | 16/54 → **0/21** | 6/38 → **0/24** | 20/61 → **0/34** | 30/57 → **0/29** | 27/51 → **0/23** | 114/302 → **0/152** |
| WR/TE | 8/37 → **0/23** | 21/52 → **0/26** | 6/35 → **0/20** | 19/63 → **0/44** | 35/74 → **0/40** | 29/59 → **0/22** | 118/320 → **0/175** |
| RB | 2/8 → **0/7** | 6/13 → **0/7** | 0/8 → **0/6** | 6/14 → **0/9** | 7/15 → **0/10** | 4/10 → **0/6** | 25/68 → **0/45** |

#### One-frame jumps of a planted foot over 5 cm (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 1 → **0** | 2 → **0** | 11 → **0** | 4 → **0** | 8 → **0** | 0 → **0** | 26 → **0** |
| OL | 29 → **0** | 48 → **0** | 21 → **0** | 102 → **0** | 70 → **0** | 56 → **0** | 326 → **0** |
| DL | 18 → **0** | 22 → **0** | 22 → **0** | 25 → **0** | 33 → **0** | 34 → **0** | 154 → **0** |
| LB | 31 → **0** | 44 → **0** | 10 → **0** | 63 → **0** | 130 → **0** | 70 → **0** | 348 → **0** |
| DB | 39 → **0** | 20 → **0** | 5 → **0** | 35 → **0** | 88 → **0** | 77 → **0** | 264 → **0** |
| WR/TE | 22 → **0** | 22 → **0** | 18 → **0** | 23 → **0** | 43 → **0** | 39 → **0** | 167 → **0** |
| RB | 2 → **0** | 2 → **0** | 2 → **0** | 25 → **0** | 5 → **0** | 3 → **0** | 39 → **0** |

#### One-frame jumps over 2 cm (round 14’s line) (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 2 → **0** | 2 → **0** | 26 → **0** | 15 → **0** | 12 → **0** | 35 → **0** | 92 → **0** |
| OL | 62 → **0** | 82 → **0** | 54 → **0** | 218 → **0** | 123 → **0** | 118 → **1** | 657 → **1** |
| DL | 21 → **0** | 34 → **0** | 25 → **0** | 49 → **0** | 58 → **0** | 45 → **0** | 232 → **0** |
| LB | 67 → **0** | 107 → **0** | 18 → **0** | 144 → **0** | 224 → **0** | 138 → **0** | 698 → **0** |
| DB | 77 → **0** | 51 → **0** | 44 → **0** | 77 → **0** | 195 → **0** | 143 → **0** | 587 → **0** |
| WR/TE | 36 → **0** | 44 → **0** | 45 → **0** | 78 → **0** | 81 → **0** | 69 → **0** | 353 → **0** |
| RB | 12 → **0** | 19 → **0** | 2 → **0** | 47 → **0** | 28 → **0** | 17 → **0** | 125 → **0** |

#### The largest drift of a planted span (m) (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0.00 → **0.000** | 0.00 → **0.001** | 1.04 → **0.014** | 0.03 → **0.016** | 0.21 → **0.017** | 0.94 → **0.000** | 1.04 → **0.017** |
| OL | 0.28 → **0.018** | 0.48 → **0.016** | 0.29 → **0.015** | 1.12 → **0.017** | 1.54 → **0.016** | 0.45 → **0.020** | 1.54 → **0.020** |
| DL | 0.00 → **0.003** | 0.27 → **0.016** | 0.31 → **0.010** | 0.40 → **0.016** | 0.59 → **0.015** | 0.26 → **0.009** | 0.59 → **0.016** |
| LB | 0.56 → **0.012** | 0.88 → **0.016** | 0.17 → **0.013** | 1.66 → **0.017** | 1.66 → **0.015** | 1.27 → **0.019** | 1.66 → **0.019** |
| DB | 1.41 → **0.016** | 0.28 → **0.013** | 0.46 → **0.014** | 1.52 → **0.013** | 1.16 → **0.013** | 1.14 → **0.014** | 1.52 → **0.016** |
| WR/TE | 0.97 → **0.011** | 0.16 → **0.016** | 0.46 → **0.017** | 0.45 → **0.015** | 0.19 → **0.015** | 0.12 → **0.017** | 0.97 → **0.017** |
| RB | 0.29 → **0.015** | 0.21 → **0.010** | 0.00 → **0.003** | 0.83 → **0.014** | 0.23 → **0.010** | 0.21 → **0.016** | 0.83 → **0.016** |

#### Steps taken by feet that could not stay planted (after; before there were none: the foot was dragged)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0 | 1 | 6 | 3 | 7 | 8 | 25 |
| OL | 24 | 39 | 38 | 45 | 63 | 50 | 259 |
| DL | 10 | 22 | 16 | 28 | 31 | 29 | 136 |
| LB | 21 | 29 | 19 | 31 | 39 | 31 | 170 |
| DB | 12 | 18 | 10 | 21 | 27 | 26 | 114 |
| WR/TE | 9 | 5 | 16 | 14 | 14 | 1 | 59 |
| RB | 4 | 6 | 3 | 8 | 7 | 3 | 31 |

#### The pop meter (before → after)

| | Slant | Go | Run (cut) | Screen | Contested | Sack |
|---|---|---|---|---|---|---|
| Worst joint (rad/s) | 172 → **145** | 143 → **143** | 101 → **87** | 162 → **87** | 177 → **177** | 130 → **130** |
| p99 (rad/s) | 55 → **45** | 59 → **41** | 52 → **35** | 60 → **41** | 58 → **46** | 54 → **48** |
| Spikes | 136 → **95** | 175 → **86** | 87 → **42** | 229 → **96** | 279 → **150** | 214 → **150** |
| Leg spikes (thigh, calf) | 63 → **25** | 115 → **27** | 55 → **10** | 176 → **41** | 194 → **66** | 146 → **80** |

- Slant: worst before 172 (SLB forearm_r, tackle); after 145 (SLB forearm_r, tackle)
- Go: worst before 143 (LCB forearm_l, tackle); after 143 (LCB forearm_l, tackle)
- Run (cut): worst before 101 (LG thigh_r, run); after 87 (WLB forearm_r, tackle)
- Screen: worst before 162 (RE calf_r, dl_spin_r); after 87 (RDT thigh_l, dl_bull_rush)
- Contested: worst before 177 (SS upperarm_r, dive); after 177 (SS upperarm_r, dive)
- Sack: worst before 130 (LE upperarm_l, dl_shed_l); after 130 (LE upperarm_l, dl_shed_l)

### The contested QB's legs (the per-frame log at 60 fps; keyed: release 34°, finish 34–37°)

| | Before | After |
|---|---|---|
| Front knee at the release (°) | 40 | **29** |
| ...at +0.05 s / +0.10 s | **2** / 17 | **28** / 29 |
| ...over the last 0.1 s before the release | 38–43 | 29–41 |
| Frames under 10° from −0.3 s to +0.5 s | 1 | **0** |
| Front knee through the finish, +0.15 to +0.5 s (keyed 34–37) | 32–35 | 30–32 |
| The front hip joint, from the release to +0.1 s (m) | 0.921 → **0.973** | 0.939 → 0.943 |
| The hips (pelvis) over the same | 0.952 → 0.974 | 0.964 → 0.968 |
| The lean over the same (bank / pitch, °) | 0 → **−12.9**, +17.2 → **−8.6** | 0 / 0 |
| The QB's planted feet (the meter, the whole play): spans past 2 cm, largest drift, jumps over 5 cm | 4 of 12, **0.21 m**, 8 | 0 of 12, 1.7 cm, 0 |
| The walk-off (+0.85 to +1.1 s) | the feet slide (the give) | each foot steps (toes up 9 cm, 0.13 s) |

- The release is 29°, against 34° keyed, where round 14's was 40°. There's no lean now, and the hold draws the body back over the front foot by up to 0.1 m against the sim's drift. The knee then holds 28–32° through the ball and the finish, with no straight frame.
- The walk-off slide (item 3) is gone. The planted points give at most 1.5 cm, then the feet step as the sim walks him off.

### Performance

The animator's cost, timed around `animator.update` for every body every frame (`pops.cost`, `?pops`). Each play is run alone on an otherwise idle container (headless Chromium with SwiftShader, 4 shared cores), at 60 fps over the whole play.

| | Before (ms per body per frame) | After | Change |
|---|---|---|---|
| Contested ball (7,964 body-frames) | 0.436 | 0.474 | +0.038 (+9%) |
| Go (5,918 body-frames) | 0.376 | 0.408 | +0.032 (+9%) |

- For 22 players that's ~0.8 ms more a frame **on this container**, whose JavaScript is far slower than the target desktop's.
- The added work is per foot: the clip's ball before the leans, the knee's pole, the step's checks and the drawn ball. When moving, the hips' turn adds eight quaternion reads and one skeleton update.
- The round's new reads take the world position from the bone's matrix as it stands (`wpos`), not `getWorldPosition`, which recomputes every ancestor on each call. That took the first cut's +11–13% down to +9%, with identical results.
- The render isn't touched (no draw calls, materials or shadows). I didn't run the `?perf` screen: this container has no GPU, so the Medium frame time on the target hardware wasn't measured. "Still open" has it.

## The checks

Nothing in `src/sim` or `src/engine` changed (`git diff 97a4a47 -- src/sim src/engine tests` is empty). The harnesses were run on this branch (`tools/sim/a15_*`, copies of round 14's `p14_*`) and on the frozen before copy, and the outputs are byte-identical (`cmp`):

| Harness | Round 14 | Round 15 |
|---|---|---|
| The AI pass game (`a15_outcomes.ts`) | 16,200 plays, 65.8% completion, 7.5 YPA, INT 2.4%, sacks 7.6% | identical |
| Identity (`a15_identity.ts`) | 19 / 20 | identical (19 / 20) |
| Passing identity (`a15_passidentity.ts`) | 9 / 9 | identical |
| Trait audit (`a15_traitaudit.ts`) | 127 / 127, 25 / 25 | identical |
| Clip gates | 215 / 215 | 215 / 215 (no clip changed) |
| `npm run check` | passes | passes: typecheck, lint, extract, data, ratings; tests 79 files, 758 tests (two `sim-m6` tests timed out at 600 s while six recordings ran beside them, and pass alone, 27 / 27) |
| `e2e/practice.spec.ts` | 7 / 7 | 7 / 7 (port 5627), the browser reproducing the Node hashes |

The determinism golden doesn't move: `tests/` is untouched and passes, with no re-pin.

## The videos and stills

`docs/anim/feet15/` (960×540 on Low, frame-true, crf 28; ~16 MB in all):
- **`before/` and `after/`:**
  - the broadcast camera at 60 fps from the windup: `p9-slant-60`, `p9-go-60` and `p9-screen-60` (to 1.8 s after the ball), and `p9-contested-60` (to 1.2 s after it, the walk-off included);
  - `cut-run` and `sack` at 30 fps, the whole play;
  - the close cameras, at 30 fps for the whole play:
    - `p9-go-wlb-close`: Lawrence Taylor opening to his drop;
    - `p9-go-lt-close`: the left side's pass set (the framing is too tight to see the feet; see the critique);
    - `sack-lcb-close`: Deion Sanders's press, pedal and hip flip with Rice;
  - `p9-contested-qb-close-60`: the QB's legs through the release, at 60 fps;
  - each with its `.pops.json`.
- **`compare/`:** before on the left, after on the right, for each.
- **`measure/before/` and `measure/after/`:** the six plays' measurement logs (the tables above, and the per-span traces), and the two perf runs.
- **`stills/`:**
  - `lb-taylor-opening-before-after.jpg`: Taylor opening on the go, every other frame at 30 fps, before above after. Before, his planted leg is dragged a metre out to the side, straight; after, he turns over his feet.
  - `cb-sanders-hip-flip-before-after.jpg`: the sack's corner from the press through the flip. Before, he opens and then spins on round to run downfield chest-first; after, he flips once and runs with Rice, his back to the camera.
  - `qb-contested-release-before-after.jpg`: the contested QB from the top of the throw through the finish at 60 fps (every third frame). Before, he tips over a straight front leg as the ball goes; after, he stays over a bent one.

## Watched: an honest critique

I watched the 60-fps broadcast recordings and the close cameras side by side, frame-stepped the crops, and read them against the per-frame traces.

- **The worst of it was the drag, and it's gone.**
  - Before, a back-seven player opening to run, a lineman set back by the sim, or a receiver bending his route left a planted foot behind, and the leg stretched out straight to it for a fifth to a third of a second. On the go, Lawrence Taylor's left leg trails a metre out to the side as he opens (the still, frames 3–5).
  - From the broadcast camera this reads as a player gliding with one leg splayed. It's the "not AAA" tell, and it showed on some player on every play.
  - Now the leg stays under him and the foot steps. Taylor turns over his feet as a linebacker opening to his drop does.
- **The hip flip is a hip flip.** Before, Sanders opened his hips, and then the drawn facing chased his new heading as well, so he spun on round. He ran with Rice chest-first toward the camera, backward to his run. The clip's last frame is turned 180° from the run it hands to (`fk.py`), so he snapped round again at the hand-over. That's a technique clip the project never cuts (TECH_PLAN T8: backpedal and hip flip), shown wrong on every flip. Now he flips once, runs with Rice, and the hand-over is invisible.
- **The contested QB stays over his front leg.** Before, he tipped sideways onto a straight front leg as the ball went: the run's lean read the sim's turn as a curve. Now he's upright over a bent front knee through the ball. The walk-off's slide is gone too: as the sim walks him away, each foot steps off its plant instead of skating.
- **What this costs, honestly:**
  - **The feet now step where the clips don't.** 794 times over the six plays, a planted foot that couldn't hold stepped:
    - the line 259 (their stances, the kick-slide's and anchor's plants, and the pass sets the sim moves faster than the clips);
    - the linebackers 170;
    - the defensive backs 114;
    - the receivers 59.
  - These steps are procedural: the clip's own foot, flat, carried in a low arc (3–9 cm) over 0.1–0.22 s.
    - At broadcast distance they read as a quick re-set of the feet (a lineman's choppy feet in his set, a linebacker's shuffle), better than the skate.
    - Close up they're plainer than a keyed step: no toe-off, no heel strike, and the foot stays flat in the air.
  - The zero in the drift tables is partly by construction: a foot that can't hold now steps rather than slides. The steps are where the mismatch between the sim's motion and the clips now goes, and that count is the number to drive down next.
- **The hips' turn** helps a player moving at a slant to his facing (fewer steps, and the gait runs at his ground speed). But a player moving straight sideways at 3–4 m/s still runs a forward gait turned 55°, the rest taken by steps. It reads as a crossover run, not a shuffle. The linebackers' keyed shuffle (`lb_shuffle_l/r`) is in the library and still unused.
- **The kick-slide.** At 1.6× it keeps up with a 2 m/s set. The sim's vertical sets at 3–4 m/s are still past it, so the tackle's feet step between the clip's plants. After the clip ends, a lineman the sim still retreats at speed plays the DB backpedal, which is wrong for a lineman (pre-existing). My close camera on the left side was framed too tight (knees to helmet), so its feet can't be judged from it. The step counts and traces are the evidence there.
- **Not seen from the broadcast camera:** individual centimetres of slide. What reads at 60–90 px is the splayed legs, the spin and the tipping QB, and those are what changed.

## Still open

- **The steps that remain** (794 over six plays). Each is the sim and a clip disagreeing:
  - **Lateral movement:** blend in the keyed shuffle for a player moving sideways under ~3 m/s (a linebacker's scrape, a DB's zone shuffle, a lineman's slide), on its own phase like the backpedal's.
  - **The line's pass set:** a kick-slide loop for a set the sim carries past the one-shot, in place of the backpedal.
  - **One-shots whose travel isn't the sim's:** a get-off, a rush move, the anchor. Pace each to the sim along its travel, as the drop and now the kick-slide are.
- **The procedural step's look:** a toe-off and a heel-first landing (rolling the foot's pitch through the arc) would make it read as a step close up.
- **The QB's release knee** is 29° against 34° keyed: the hold's draw over the front foot takes a little of the bend.
- **The run's lean in everyone's one-shots.** This round takes it off the QB's one-shots only. A cut or a juke gets the yaw-rate bank on top of its keyed lean, which may double it.
- **Performance on the target hardware:** +9% of animator time per body on this container (~0.8 ms a frame for 22 players here). The `?perf` screen on Medium at 100% on the target machine wasn't run (no GPU here).
- **Round 14's open items stand:**
  - the turned back foot at the throw's start;
  - the throw's stride played in place;
  - the bar's dark forearm;
  - the camera's tilt and dolly;
  - a throw to his right;
  - the QB at ~80–90 px;
  - Gates vs Lewis (identity).
