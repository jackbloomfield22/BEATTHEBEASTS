# Animation round 16: footwork

Round 15 (`docs/anim/FEET15.md`) made a planted foot hold or step: no drag and no re-plant pops. It left four things for this round:

1. **794 procedural steps over six plays** (OL 259, LB 170, DL 136, DB 114, WR/TE 59, RB 31, QB 25). Each step is a place where the sim's motion and the clips disagree. From the broadcast camera the steps read as quick foot resets, but close up they look plain: the foot stays flat, with no toe-off and no heel strike.
2. **Lateral movement played a forward gait turned 55°**, which reads as a crossover run, not a shuffle. The keyed `lb_shuffle_l/r` was in the library and unused.
3. **The kick-slide couldn't keep up with the sim's 3–4 m/s vertical sets.** After the clip ended, a retreating lineman played the DB backpedal.
4. **The animator cost ~9% more per body** than round 14 (0.436 → 0.474 ms on the contested ball, headless).

Branch `wip/anim16`, from `96fa09f` (the tip of `claude/m66-polish`: rounds 1–14 plus round 15). Nothing in `src/sim` or `src/engine` changed. Every change is in one of these places:
- the animator (`src/anim/animator.ts`, `ik.ts`, `blend.ts`, `library.ts`);
- the render (`src/render/game/choreo.ts`, `GameScene.tsx`, `GameCamera.tsx`);
- the clips (`tools/blender/lib/actions_a16.py`: ten new clips, all keyed in-house);
- the instruments:
  - `src/render/game/popMeter.ts`;
  - `tools/shots/video.spec.ts` (`BTB_FEET_DIR`, `BTB_PROFILE`, `BTB_POSEDUMP`);
  - `tools/sim/a16_*.ts` (the harness copies, a headless bench of the animator `a16_animbench.ts`, and a clip comparison `a16_clipcmp.ts`).

## How it was measured

- **The same six plays as round 15**, measured whole at 60 fps from the snap to 1.8 s after the ball:
  - the slant (`p9-slant`);
  - the go (`p9-go`);
  - the cut run (`cut-run`);
  - the RB screen (`p9-screen`);
  - the contested ball (`p9-contested`);
  - the sack (`sack`).
- **Measurement settings:** `BTB_PASSING15=1 BTB_MEASURE=1`, 320 px, Low, no shadows or AO.
- **The before set** is `96fa09f` (round 15's tip), run on this round's meter. The step log is the exception: it reads the lock's new debug fields, so it exists for the after set only. Its slide statistics match round 15's own logs exactly, so the before column below reproduces round 15's after column.
- **The meter** (`popMeter.ts`) is round 15's, with three additions:
  - **Every step is logged** (`stepLog`): who stepped, which foot, why (off the clip's foot, or out of reach), what was playing, how far off it was, how far out of reach, how long the foot had been planted, the gait's speed and shares, and the drawn turn rate. This log drove every decision this round.
  - **Modes:** for each unit, the share of frames in which the sim moves a player faster than 0.5 m/s and his legs play the forward gait, the side layer, the pedal, a stance, or a one-shot.
  - **`bySlot`:** each slot's modes by second, used to choose the close-ups.
- **A headless bench** (`tools/sim/a16_animbench.ts`) runs the animator in Node on the exported library: a scrape, a corner's slant shuffle, a tackle's vertical set, a cut, the read step, a QB's drop and slide, a pedal, steady gaits, and a hard curve.
  - It counts steps per script and times the animator.
  - `--dump` writes every bone's world matrix every frame. Each change to the animator's cost was checked against this dump: bit-identical, or with the difference stated.
- **The cost** is round 15's: `pops.cost`, timed around `animator.update` in GameScene, each play run alone on the idle container.
- **Profiles:** Chrome's sampling profiler in the browser (`BTB_PROFILE=1`) and `node --cpu-prof` on the bench.

## What was wrong (root causes)

Line numbers are at `96fa09f`.

1. **There was no gait for moving sideways or for a lineman's retreat.**
   - The gait layer had two parts: the forward families (`animator.ts:727–736`) and the backpedal (`738–741, 786–790`).
   - Round 15's hip turn (`gaitSpeed` 1026–1049, `warpHips` 1057–1078, `WARP_MAX` 55°) pointed the forward gait up to 55° toward the sim's velocity. Anything past that was left to steps.
   - The keyed `lb_shuffle_l/r` (`tools/blender/lib/actions_m6_back7.py:116`) was referenced nowhere in `src/`.
2. **The lineman's set was a one-shot, and after it came the defensive back's pedal.**
   - The kick-slide (`choreo.ts:1145`) is a 1 s one-shot keyed at ~1.2 m/s. `KICK_RATE` (`choreo.ts:1196, 1565–1572`) could only speed it up 1.6×.
   - When it ended, the backward rule (`choreo.ts:1548`, `along < -0.8 yd/s`) put any lineman the sim still had retreating into `loco_backpedal`.
   - Interior linemen stood in `stance_ol_pass` while the sim moved them.
3. **The step was a flat foot on an arc** (`animator.ts:1324–1328`). The ball of the foot was lerped toward the clip's, a `sin` lift was added, and the foot kept the clip's orientation the whole way: no toe-off, heel strike or roll.
4. **The steps that remained came from a handful of mismatches.** The step log sorts them by kind:
   - **One-shots whose travel isn't the sim's:**
     - the block clips (`ol_anchor`, `ol_punch_mirror`) played whole while the sim's block moved the pair (`choreo.ts:1226–1229`): 110 of the line's 259 steps;
     - the drives (`dl_bull_rush`, `ol_fire_drive`) and the get-offs, keyed at 1.2–2 m/s against the sim's 2.5–3;
     - the linebacker's read step (`choreo.ts:1151`): 0.15 m forward, played in place while the sim held him or dropped him.
   - **Engaged linemen stood still.** In a still stance (both feet always planted, `animator.ts:903`) while the sim drifted the pair, each foot was held until it was 20 cm off and then stepped. The keyed hand fight `dl_engage` has chopping feet, but its contacts were ignored for the same reason.
   - **The gait's phase ran on the eased speed** (`animator.ts:741, 1047`: 60 ms behind the sim). A man accelerating at 10 m/s² ran his gait 0.6 m/s slow, and his planted foot was left behind.
   - **A lock still fading out at the next touch-down** planted the foot where the fade had it (`animator.ts:1300`), up to 30 cm off the clip's. It stepped within a few frames: a third of the remaining steps came within 0.15 s of a plant.
   - **A foot that had only drifted off the clip's** stepped even when its lift was a few frames away, and then lifted again.
   - **A banked runner's outside foot** rose ~6 cm about the hips (`lean`, `animator.ts:1100–1114`). The lock pins the foot to the turf, so the leg couldn't reach it, and the runner stepped every stride through a curve.
   - **Half the remaining steps fired between 0.20 and 0.25 m off the clip's foot** (`STEP_FAR`, `animator.ts:265`). These were slow drifts, re-set a fraction of a second before the clips would have re-set them.
5. **The animator's cost.** Chrome's profiler on the contested ball, under `animator.update`:
   - **25% in `update` itself.** It looped over all 215 actions every frame to set the transitions' weights (`animator.ts:803–809`), and copied the clip pose through the bones' quaternions.
   - **20% converting quaternions to Euler angles.** Three's `Object3D` keeps `.rotation` in step with every write to `.quaternion` (`onQuaternionChange`). The mixer, the pose restore, the overlays and the solves write every bone several times a frame, and nothing reads a bone's Euler rotation.
   - **10% in `warpPhase` and `order`** (`blend.ts:93–128`): arrays allocated and sorted for every gait clip every frame, weighted or not.
   - **~14% recomputing ancestors.** `getWorldPosition` and `getWorldQuaternion` recompute every ancestor's matrix (`ik.ts:25–26, 42–44, 65–69`, and throughout the animator) where the matrices were already current.
   - **Half the clips the mixer sampled had a weight under 1e-3** (the bench's `--count`). The eased shares never reach their targets (`animator.ts:712, 738, 794`), and the mixer samples a clip whole at any weight above zero.
   - **Three updates of the whole skeleton a frame:** after the mixer (the whole `player.root`, meshes included, `844`), after the hip turn (`1077`) and after the lean (`1115`).

## What changed

### 1. The side layer: shuffles and the line's slide and set

- **New layer in the animator** (`animator.ts`, `sideMode`, `sideAxis`, `sideLoops`, constants `SIDE_*` with their sources in the comment). It sits beside the forward families and the backpedal.
  - **When:** his velocity is more than 58° off the way he faces (and more than 58° off straight back); he leaves it under 48° (hysteresis, a scrape's angle wobbles a few degrees a tick). Faster than 3.9 m/s (4.4 to leave) he turns and runs instead: past that a scrape is a crossover run.
  - **What:** the left or right loop by the side his velocity is on. The side only changes once he's 0.3 (sin) on the other side. A lineman comes in on his outside foot (`sidePref`: the tackles and guards) and keeps it unless the sim takes him more than 45° inside of straight back (`SIDE_PREF_OL`), so a tackle setting straight back keeps his kick foot. The slow and fast loops blend by speed, and both share one phase advanced by the ground covered (stride matching, like the gaits).
  - **The hips** turn toward his velocity by up to 45° off the loop's own travel (a shuffle on a slant opens or closes the hips, the chest kept where he faces).
  - **Weight:** the side share eases in and out like the other gait shares; the forward gait and the pedal take what's left.
- **The line's version** (`side: 'ol'` from `choreo.ts`, every OL slot). No upper angle: a lineman moving back never backpedals (the pedal only past 5.2 m/s, which a lineman never reaches). The layer blends the slide (sideways) into the set (back and out, 28° off straight back) by the angle of his velocity. Speed limits 5.0/5.6 m/s.
- **Clips, keyed in-house** (`tools/blender/lib/actions_a16.py`, with the existing keyer's `loop()` and `lineman()` trunk):
  - `lb_shuffle_fast_l/r`: the shuffle at 3.4 m/s, ten frames, lift 7.5 cm.
  - `ol_slide_l/r`: the line's lateral slide at 1.8 m/s, twelve frames, a 30 cm base.
  - `ol_set_l/r` and `ol_set_fast_l/r`: the kick-slide as a loop, back and out at 28°, 1.6 and 3.2 m/s (the deep set). The kick foot goes straight back, the post foot slides; ol_pass's trunk, hands up at the chest, eyes inside.
  - The existing `lb_shuffle_l/r` (round M6) is now played.
- **The kick-slide one-shot hands over to the loop** once its first slide is down (`KICK_HANDOFF`, 0.34 s of the clip) if the sim is retreating him faster than the one-shot keeps up. The set's first kick is still the keyed technique clip.

### 2. Engaged linemen keep their feet alive

- **`ol_engage`, keyed in-house:** a 1.2 s loop of a pass-blocker locked on (ol_pass's base, hands inside, each foot chopping twice). It replaces the still `stance_ol_pass` while the sim has him blocking.
- **A stance's own contacts plant its feet** (`downIn` mode 4, "partial-contact stance"): `dl_engage`'s chops and `ol_engage`'s now lift and set the feet, so a pair the sim drifts re-sets its feet in the clip's rhythm instead of stepping at 20 cm.
- **The block clips go on over the gait on the move** (`HANDS_ON_THE_MOVE`): `ol_anchor`, `ol_punch_mirror`, `dl_shed` let the legs go to the gait (or the side layer) once the sim moves him faster than 1.2 m/s, and play from the waist up (the throw mask). Standing, they play whole as before.
- **The drives and get-offs are paced by the sim** (`PACED`, the get-offs): their rate follows the sim's speed over the keyed speed, clamped to 0.7–1.4.

### 3. The step: toe-off, swing, heel strike, roll

- **`stepRoll`** (`animator.ts`): over the first 20% of the step the heel comes up off the ball (toe-off, to 24°: the shuffle's keyed toe-off); the foot swings on the gait keyer's lift profile to 85%; it lands heel first (9° toes up, between the keyer's walk and jog) and rolls flat over the rest, pivoting on the heel. A clip that has him on the balls of his feet (12° or more: a set lineman, a shuffle) lands on the ball.
- The heel's position comes from the rig's rest foot (`skeleton.py`, `poses.py HEEL_REST`), not a guess.
- The step is a little longer (0.12–0.26 s, was 0.10–0.22) to fit the toe-off and the roll.

### 4. Fewer steps

Each fix came from the step log (what was playing, how far off, how long planted):

- **Stride matching on the sim's speed as it is:** the gait phases advance by the raw speed (the ground covered), the blend weights still by the eased speed. Accelerating, the planted foot no longer falls behind.
- **A fading lock is gone by the clips' next touch-down** (`TOUCH_*`): the release fades fast enough to be done before the clip plants that foot again, so the foot plants where the clip has it.
- **A foot only drifted off the clip's holds on to a lift within 0.1 s** (`HOLD_SOON`, up to 0.3 m off) instead of stepping just before the clip lifts it.
- **The lean sinks the body by what it lifts the outside foot:** a banked runner dips into the cut, and his outside foot reaches the turf.
- **The read step's travel is drawn** (`ROOT_DRAWN`, `Body.rootOff` in GameScene): the body steps forward with its feet and eases back onto the sim's spot over 0.3 s as he moves off. It lets go when the sim opens him to his drop (faster than 0.5 m/s more than 45° off its line, or faster than 1.2 m/s).
- **`STEP_FAR` 0.20 → 0.25 m** (half a set lineman's base): the slow drifts are left to the clips, which re-set the foot within a fraction of a second anyway. Measured both ways (the 0.20 column in the tables).
- **The slow pedal** (`loco_backpedal_slow`, keyed in-house at 1.5 m/s): a defensive back easing back at 1–2 m/s played the 3 m/s pedal at half rate, with feet that didn't land where the pedal put them. It blends under the pedal by speed.

### 5. The animator's cost

Checked against the bench's per-bone dump after each change: bit-identical unless stated.

- **No Euler sync on the bones** (`NO_SYNC`, `animator.ts:571`): each bone's quaternion change callback, which kept `.rotation` in step, is a no-op. Nothing reads a bone's `.rotation`.
- **Clips with no weight are off in the mixer:** every action is still created up front, in library order (the mixer's accumulation order is unchanged, so the pose is bit-identical), but a clip whose weight is zero is `enabled = false` and isn't sampled.
- **Eased shares snap** to their target within 1e-3 (`SNAP`), so the clips fading out reach zero and go off. (Not bit-identical: a weight that was 0.0009 is 0. Under 0.1 mm at the foot.)
- **`warpPhase`, `events` and `order`** (`blend.ts`) don't allocate or sort.
- **World reads from the matrices as they stand** (`ik.ts` `fresh`, `wpos`/`wquat` in the animator): one update of the skeleton after the mixer (the root bone's chain, not the whole `player.root` with its meshes), and after the hip turn and the lean only the legs (the upper body is marked stale and updated once, before the look-at).
- **The look-at and the bone lookups** don't allocate; bones are looked up once.

## Results

The full logs are in `docs/anim/feet16/measure/`:
- `before/`;
- `after/`;
- `after-020/`: the 0.20 m step line, measured on the tip before the round's last fix (the lineman's outside foot, which moves no play's step count by more than one).

Each play's log has each slot's modes by second (`bySlot`). The after logs also have every step (`stepLog`).

### Steps

#### Steps taken by feet that could not stay planted (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0 → **0** | 1 → **1** | 6 → **4** | 3 → **3** | 7 → **6** | 8 → **6** | 25 → **20** |
| OL | 24 → **5** | 39 → **10** | 38 → **17** | 45 → **16** | 63 → **16** | 50 → **17** | 259 → **81** |
| DL | 10 → **3** | 22 → **13** | 16 → **10** | 28 → **12** | 31 → **18** | 29 → **15** | 136 → **71** |
| LB | 21 → **13** | 29 → **17** | 19 → **13** | 31 → **20** | 39 → **15** | 31 → **11** | 170 → **89** |
| DB | 12 → **11** | 18 → **16** | 10 → **8** | 21 → **11** | 27 → **17** | 26 → **17** | 114 → **80** |
| WR/TE | 9 → **4** | 5 → **5** | 16 → **11** | 14 → **14** | 14 → **9** | 1 → **1** | 59 → **44** |
| RB | 4 → **3** | 6 → **2** | 3 → **3** | 8 → **6** | 7 → **3** | 3 → **1** | 31 → **18** |
| **All units** | 80 → **39** | 120 → **64** | 108 → **66** | 150 → **82** | 188 → **84** | 148 → **68** | 794 → **403** |

**794 → 403 steps over the six plays: −49%, just short of the brief's "at least halved".** By unit:
- the line −69% (OL) and about half (DL −48%, LB −48%);
- the defensive backs −30%, receivers −25%, backs −42%, quarterback −20%.

The 403 that remain, by kind (from the step log):

| Kind | Steps | What it is |
|---|---|---|
| Blocking and rushing | 115 | a lineman or rusher in a block clip, a rush move or the engaged loops while the pair moves: the hand fight's travel isn't the sim's |
| Turning faster than 300°/s | 75 | the sim turns him (a hip flip, a pedal turning to run, a man reacting to the ball): a step on a turn is what a player does |
| Off the clip | 65 | half of them the line (30: 14 in the side layer, 15 in the forward gait). Most are just past the step line (25–29 cm): the loops' stride and the sim's set or run drift apart a little each stride. The rest are linebackers drifting in their first drop steps and the QB's drops. |
| Out of reach | 54 | the body outran the planted foot: receivers accelerating off the line (13), the pedal (10), runs |
| At the snap, a foot planted presnap | 51 | the corners and safeties opening at the snap (`getoff_db_ready`), the linebackers' first drop step, the center's snap: one open step each, as a coach teaches it |
| Other one-shots | 25 | press jams, cut plants, drops |
| Tackles | 18 | |

The ones at the snap and on a turn (126) are steps a player takes. The rest are where the clips and the sim still disagree.

**With the round-15 step line (0.20 m)**, everything else of this round gives 794 → 469 (−41%):

#### Steps with the round-15 step line (0.20 m) and everything else of this round (before → after at 0.20 m)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0 → 0 | 1 → 1 | 6 → 4 | 3 → 3 | 7 → 6 | 8 → 8 | 25 → 22 |
| OL | 24 → 8 | 39 → 15 | 38 → 21 | 45 → 20 | 63 → 21 | 50 → 23 | 259 → 108 |
| DL | 10 → 5 | 22 → 15 | 16 → 13 | 28 → 13 | 31 → 20 | 29 → 18 | 136 → 84 |
| LB | 21 → 13 | 29 → 19 | 19 → 14 | 31 → 23 | 39 → 21 | 31 → 14 | 170 → 104 |
| DB | 12 → 11 | 18 → 16 | 10 → 9 | 21 → 11 | 27 → 19 | 26 → 18 | 114 → 84 |
| WR/TE | 9 → 4 | 5 → 5 | 16 → 13 | 14 → 14 | 14 → 11 | 1 → 1 | 59 → 48 |
| RB | 4 → 4 | 6 → 2 | 3 → 3 | 8 → 6 | 7 → 3 | 3 → 1 | 31 → 19 |
| **All units** | 80 → 45 | 120 → 73 | 108 → 77 | 150 → 90 | 188 → 101 | 148 → 83 | 794 → 469 |

So the line from 0.20 m to 0.25 m is worth 66 steps. These are slow drifts, which the clips re-set within a fraction of a second.

### The planted feet (round 15's measures)

The drift and jump measures stay where round 15 left them:
- **No planted foot drifts more than 2 cm** except two of the quarterback's spans (2.4 cm, one on the screen and one on the contested ball: `0/45 → 2/45`).
- **No one-frame jump over 5 cm.** One jump over 2 cm (a defensive back on the slant).
- **The largest drift of a planted span** is 1.7–2.4 cm by unit (before: 1.6–2.0).

#### Planted spans drifting over 2 cm / all spans (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0/2 → **0/2** | 0/6 → **0/6** | 0/6 → **0/5** | 0/7 → **1/7** | 0/12 → **1/14** | 0/12 → **0/11** | 0/45 → **2/45** |
| OL | 0/51 → **0/42** | 0/67 → **0/57** | 0/50 → **0/43** | 0/75 → **0/61** | 0/104 → **0/88** | 1/87 → **0/83** | 1/434 → **0/374** |
| DL | 0/26 → **0/34** | 0/40 → **0/51** | 0/28 → **0/32** | 0/42 → **0/53** | 0/59 → **0/71** | 0/46 → **0/60** | 0/241 → **0/301** |
| LB | 0/19 → **0/16** | 0/32 → **0/25** | 0/20 → **0/15** | 0/35 → **0/35** | 0/40 → **0/41** | 0/36 → **0/34** | 0/182 → **0/166** |
| DB | 0/21 → **0/24** | 0/21 → **0/24** | 0/24 → **0/30** | 0/34 → **0/40** | 0/29 → **0/30** | 0/23 → **0/27** | 0/152 → **0/175** |
| WR/TE | 0/23 → **0/22** | 0/26 → **0/28** | 0/20 → **0/24** | 0/44 → **0/39** | 0/40 → **0/41** | 0/22 → **0/23** | 0/175 → **0/177** |
| RB | 0/7 → **0/7** | 0/7 → **0/7** | 0/6 → **0/5** | 0/9 → **0/11** | 0/10 → **0/9** | 0/6 → **0/6** | 0/45 → **0/45** |

#### One-frame jumps of a planted foot over 5 cm (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| OL | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| DL | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| LB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| DB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| WR/TE | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| RB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |

#### One-frame jumps over 2 cm (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| OL | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 1 → **0** | 1 → **0** |
| DL | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| LB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| DB | 0 → **1** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **1** |
| WR/TE | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |
| RB | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** | 0 → **0** |

#### The largest drift of a planted span (m) (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0.000 → **0.000** | 0.001 → **0.001** | 0.014 → **0.001** | 0.016 → **0.024** | 0.017 → **0.024** | 0.000 → **0.009** | 0.017 → **0.024** |
| OL | 0.018 → **0.002** | 0.016 → **0.007** | 0.015 → **0.014** | 0.017 → **0.018** | 0.016 → **0.016** | 0.020 → **0.015** | 0.020 → **0.018** |
| DL | 0.003 → **0.003** | 0.016 → **0.017** | 0.010 → **0.006** | 0.016 → **0.017** | 0.015 → **0.016** | 0.009 → **0.008** | 0.016 → **0.017** |
| LB | 0.012 → **0.016** | 0.016 → **0.018** | 0.013 → **0.017** | 0.017 → **0.008** | 0.015 → **0.017** | 0.019 → **0.010** | 0.019 → **0.018** |
| DB | 0.016 → **0.018** | 0.013 → **0.018** | 0.014 → **0.013** | 0.013 → **0.016** | 0.013 → **0.015** | 0.014 → **0.016** | 0.016 → **0.018** |
| WR/TE | 0.011 → **0.020** | 0.016 → **0.016** | 0.017 → **0.015** | 0.015 → **0.014** | 0.015 → **0.017** | 0.017 → **0.016** | 0.017 → **0.020** |
| RB | 0.015 → **0.015** | 0.010 → **0.007** | 0.003 → **0.017** | 0.014 → **0.016** | 0.010 → **0.007** | 0.016 → **0.012** | 0.016 → **0.017** |

### What the legs play

#### What the legs play while the sim moves them (share of frames over 0.5 m/s, before → after)

| Unit | forward gait | side layer | pedal | stance | one-shot |
|---|---|---|---|---|---|
| QB | 9% → **7%** | 0% → **2%** | 9% → **9%** | 26% → **26%** | 56% → **56%** |
| OL | 32% → **24%** | 0% → **64%** | 23% → **0%** | 9% → **4%** | 36% → **8%** |
| DL | 35% → **40%** | 0% → **8%** | 6% → **5%** | 4% → **2%** | 55% → **45%** |
| LB | 71% → **65%** | 0% → **12%** | 7% → **6%** | 6% → **13%** | 16% → **4%** |
| DB | 77% → **73%** | 0% → **3%** | 3% → **3%** | 0% → **0%** | 19% → **20%** |
| WR/TE | 83% → **83%** | 0% → **1%** | 2% → **2%** | 1% → **2%** | 14% → **12%** |
| RB | 79% → **77%** | 0% → **5%** | 2% → **1%** | 2% → **2%** | 16% → **15%** |

- **The line:** 64% of its moving frames are in the side layer now (the slide and the set). Before, 23% were in the defensive back's pedal; now none are. Its one-shot share fell from 36% to 8%: the kick-slide hands over to the set loop, and the block clips go on over the gait on the move.
- **The linebackers:** 12% in the side layer (scrapes and the shuffle in a drop). Their one-shot share fell from 16% to 4%, because the read step lets go as the sim moves them. Their stance share rose from 6% to 13%: the first drop steps after the read step, which the procedural step covers. That is where most of their remaining steps at the snap are.
- **The defensive backs** only 3%. The sim has them turn and run or pedal, rarely move sideways while facing the ball (the screen's strong safety is the longest shuffle, 1 s).
- **The quarterback** 2% (the cut run's carry-out). In these six plays the sim doesn't slide a quarterback in the pocket; his feet are in his drops and throws (56%) and the pocket stance.

### The pop meter

#### The pop meter (before → after)

| | Slant | Go | Run (cut) | Screen | Contested | Sack |
|---|---|---|---|---|---|---|
| Worst joint (rad/s) | 145 → **145** | 143 → **151** | 87 → **87** | 87 → **67** | 177 → **177** | 130 → **154** |
| p99 (rad/s) | 45 → **44** | 41 → **42** | 35 → **39** | 41 → **43** | 46 → **46** | 48 → **47** |
| Spikes | 95 → **64** | 86 → **66** | 42 → **35** | 96 → **65** | 150 → **110** | 150 → **115** |
| Leg spikes (thigh, calf) | 25 → **22** | 27 → **28** | 10 → **15** | 41 → **41** | 66 → **61** | 80 → **79** |
- Slant: worst before 145 (SLB forearm_r, tackle); after 145 (SLB forearm_r, tackle)
- Go: worst before 143 (LCB forearm_l, tackle); after 151 (LE upperarm_l, dl_bull_rush)
- Run (cut): worst before 87 (WLB forearm_r, tackle); after 87 (WLB forearm_r, tackle)
- Screen: worst before 87 (RDT thigh_l, dl_bull_rush); after 67 (RB calf_l, cut_plant_r)
- Contested: worst before 177 (SS upperarm_r, dive); after 177 (SS upperarm_r, dive)
- Sack: worst before 130 (LE upperarm_l, dl_shed_l); after 154 (LE upperarm_l, dl_club_l)

The worst joints are arms, not legs: the tackles, the dive and the rush moves. Two are higher:
- the go's, 143 → 151 rad/s: a defensive end's upper arm in the bull rush, which now plays up to 1.4× its keyed rate when paced to the sim;
- the sack's, 130 → 154: the same end's club.

Spikes are down on every play (619 → 455 over six plays). Leg spikes are about level (249 → 246).

## Performance

`pops.cost`: time inside `animator.update` per body per frame. Headless Chromium, the measurement settings above. Each run was taken alone on the idle container, before and after alternating.

| Play | Before (`96fa09f`) | After | Change |
|---|---|---|---|
| Contested ball, run 1 | 0.447 ms | **0.218 ms** | −51% |
| Contested ball, run 2 | 0.419 ms | **0.206 ms** | −51% |
| The go | 0.396 ms | **0.172 ms** | −57% |

**The target (≤ 0.436 ms per body on the contested ball, round 14's) is met with room:** 0.21 ms, half of round 15's, and that is with the side layer, the step's roll and the engaged loops added.

The headless bench (`node tools/run-ts.mjs tools/sim/a16_animbench.ts`, 150 frames; the before tree's copy lacks the hard-curve script, added later, so eleven bodies against twelve): 0.30–0.34 → 0.15–0.17 ms per body per frame. Its scripted steps went 40 → 12 (the curve takes 1 of the 12).

**Where the time goes now** (Chrome's profiler on the contested ball, after; self time under `animator.update`):
- **~30%: the mixer** sampling and blending the weighted clips (`slerpFlat`, `copySampleValue_`, `_update`, `evaluate`, `apply`, `accumulate`);
- **~23%: matrix updates** (`updateMatrixWorld`, `multiplyMatrices`): the one skeleton update after the mixer and the legs' after the hips and lean;
- **18%: `update`'s own body**, the pose copies and share bookkeeping;
- **3.5%: `weigh`** (the clips' weights and enabling);
- **a few % each:** the lock and steps (`lockFoot`, `downIn`, `holdOver`), the lean, the look-at and the pads.

None of the before list's overheads is left:
- no Euler conversions;
- no allocation in `blend.ts`;
- no zero-weight clips sampled;
- one skeleton update after the mixer, not three.

The extra clips the side layer adds cost nothing when they have no weight (they're off in the mixer).

## Videos

In `docs/anim/feet16/`, 960×540. `before/` is `96fa09f` and `after/` this round's tip, recorded the same way; `compare/` has them side by side (before left).

- **Broadcast, 60 fps:** the go (`p9-go-60.mp4`) and the sack (`sack-60.mp4`), whole, from the default broadcast camera.
- **Close cameras on the feet, 30 fps** (`BTB_FOLLOW15`, the framings round 15 used where there was one):
  - **The left tackle's pass set** on the go (`p9-go-lt-close.mp4`);
  - **The weak-side linebacker's drop and scrape** on the go (`p9-go-wlb-close.mp4`);
  - **The strong safety's shuffle** taking on a blocker on the screen (`p9-screen-ss-close.mp4`: the longest stretch any defensive back spends in the side layer in the six plays, a high camera);
  - **The left corner's press and hip flip** on the sack (`sack-lcb-close.mp4`);
  - **The quarterback** on the contested ball (`p9-contested-qb-close.mp4`).
- **Stills** (`stills/`): contact sheets of the tackle's set and the linebacker's scrape, before and after.

The linebacker's, the safety's and the corner's close-ups were recorded one commit before the tip. The last commit changes only a lineman's choice of foot, so their own feet are the same. The linemen in the safety's frame may differ.

## Critique

Watched at speed and frame by frame, as a coach and as a fan would.

**What reads now:**
- **The line is the clearest win.** Before, the left tackle kicked once and then stood up and backpedalled like a corner, narrow and tall, for the rest of the set. Now he stays in his set the whole way:
  - wide base and bent knees;
  - kick foot back and post foot sliding;
  - hands up at the chest, eyes inside.

  At broadcast distance the pocket looks like a pocket: five men sinking in a line, not five men jogging backwards. The engaged linemen's feet re-set in the hand fight's own rhythm instead of holding and then stepping at 20 cm. Close up, the chop is small and mostly hidden by the two bodies.
- **The linebacker's scrape is a shuffle** while he's square to the quarterback: lower, the feet apart. Past ~4 m/s or 58° he opens and runs, as a linebacker does. It is a modest change from the broadcast camera; from the close camera it reads.
- **Fewer steps everywhere**, and the ones left have a heel coming up before the foot leaves and a heel landing first. At 30 fps from the close camera the toe-off shows for a frame or two. The heel strike and roll mostly don't read at broadcast distance: the foot is a few pixels.

**What doesn't:**
- **The defensive backs barely changed.** The sim has them pedal, turn and run, or press. They spend 3% of their moving frames sideways, so the shuffle rarely plays. The corner's press and hip flip look as they did. They still take 80 steps over six plays (−30%), most of them the open step at the snap and the pedal turning to run. Those are steps a corner takes. The pedal's out-of-reach steps (16 for the defensive backs) are not: they are the pedal's stride not matching the sim's at 2–3.5 m/s.
- **The quarterback doesn't slide in these plays.** His close-up is almost the same before and after: the drop and the throw. The side layer is wired for him (his hips stay square), but no measured play exercises it beyond the cut run's 10-frame carry-out. A play with a pocket climb or a slide away from pressure is needed to judge it.
- **The shuffle-to-run hand-off is visible close up.** The kick-slide one-shot's hand-off into the set loop reads as continuous at 30 fps, frame by frame: get-off, first kick, then the loop. The shuffle into the run is one long blended stride as the hips open. It doesn't pop (the meter's worst joints are arms in tackles and rush moves), but a coach would see a stride too long where a linebacker crosses over.
- **A tackle's first 0.4 s of set were on the wrong foot until late in the round.** The layer chose its side by the sign of his velocity while the sim's first steps wobbled either side of straight back, so he slid inside after his first kick and then flipped. Fixed (`SIDE_PREF_OL`): a lineman comes in on his outside foot and keeps it unless the sim takes him more than 45° inside. Every after recording and measurement here is with the fix.
- **Blocking is still where the feet and the sim disagree most:** 115 of the 403 steps. The block clips' hands are now over the gait on the move, but the gait under a lineman being driven back is still a slide or a run, not the short, choppy, braced steps of a man anchoring.
- **The screen's safety** is in traffic, and from any camera the difference is small.

**Brief targets:**
- **Shuffle and kick-slide:** done.
- **Linemen look like linemen:** done for pass sets. Run blocking is unchanged.
- **The procedural step:** done.
- **Steps halved: just short.** 794 → 403 (−49%) overall: OL −69%, DL −48%, LB −48%, DB −30%. Round 15's drift and jump measures are unchanged except the quarterback's two 2.4 cm spans.
- **Cost:** see Performance.

## Still open

1. **Steps in the hand fight (115).** The block clips and the rush moves carry their own travel; the sim moves the pair its own way.
   - A blocker driven back needs a short braced retreat (an anchor loop paced by the sim, like the set loop).
   - A rusher's bull rush needs a drive loop paced by the sim, not a one-shot.
   - Both need keying in `tools/blender`.
2. **The pedal's stride at 2–3.5 m/s** (out-of-reach steps: 16 for the defensive backs, 6 for the linebackers). The pedal's phase already runs on the ground covered, but its stride is keyed at 3.2 m/s. When the sim accelerates a pedal hard, or turns it, the planted foot falls out of reach. It needs a quicker pedal clip (short, fast steps), blended above the pedal the way the slow pedal is blended below it.
3. **The quarterback's slide in the pocket** has no measured play. Add a pocket-climb and a slide-away-from-pressure clip to the six-play set and judge it.
4. **The shuffle into the run** should open with a crossover step (a keyed transition, `lb_open_l/r`) rather than one long blended stride.
5. **The open step at the snap** (51 steps from presnap-planted feet): it's a real step, but it's the procedural one. A keyed open step for corners and safeties (`db_open_l/r`), played at the snap by the side the sim turns them, would put a coached first step there.
6. **The cost on a busy container** is noisy. Under load, the same plays read 0.36–0.90 ms before and 0.21–0.28 ms after; alone, two runs agree within ±3%. A profile on the target desktop would settle it.
