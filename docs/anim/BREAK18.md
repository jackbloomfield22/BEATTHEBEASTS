# Animation round 18: the defense breaks on the ball

Round 17 (`docs/passing/PASSING17.md`) left the defense's half of the pass the way round 16 had it:

1. **The pedal-to-run `breakOut` shipped but barely fired.** It fired on one man in six plays (the screen's safety).
2. **The shuffle-to-run hand-over was one long blended stride.** Round 17's procedural plant and crossover was reverted because every version added linebacker steps (89 → 93–97 over the six plays). Its conclusion was that the break needs keyed clips.

This round keys those clips and wires them to the sim's motion. The moment it is for: the ball in the air, the corner planting out of his pedal and driving on it, and a linebacker triggering downhill.

Branch `wip/brk18`, from `fb169fc` (the tip of `claude/m66-polish`: passing rounds 1–14 and animation rounds 15–17). **Nothing in `src/sim` or `src/engine` changed.** The changes:

- **Clips** (`tools/blender/lib/actions_b18.py`, four new, keyed in-house):
  - the W-step plant and drive out of the backpedal, on either foot (`db_break_w_l/r`);
  - the plant and go out of the shuffle, either way (`lb_break_l/r`).
- **The animator** (`src/anim/animator.ts`):
  - the break (`breakClip`), read off the sim's acceleration;
  - its pace (`breakPace`), the clip's travel matched to the ground the sim covers;
  - its release when the sim doesn't follow it;
  - the plant's step line while it plays.
- **The render** (`src/render/game/choreo.ts`, `GameScene.tsx`): the back seven are flagged to break (`Drive.brk`, `AnimInput.brk`).
- **The instruments:**
  - the pop meter's break log (`popMeter.ts` `breaks`, written by `tools/shots/video.spec.ts`);
  - `tools/sim/b18_breaks.ts`: a break finder in the sim;
  - `tools/sim/b18_breakbench.ts`: a headless A/B of the back seven's feet on the sim's own motion;
  - `tools/sim/b18_measure.ts`: the measurement tables;
  - `tools/sim/b18_clipcmp.ts`, and the harness copies `b18_outcomes`, `b18_identity`, `b18_passidentity` and `b18_traitaudit`;
  - `tests/anim-break18.test.ts`.

## How it was measured

- **Round 16's six plays** (`p9-slant`, `p9-go`, `cut-run`, `p9-screen`, `p9-contested`, `sack`) **and two break-heavy plays**, each measured whole at 60 fps from the snap to 1.8 s after the ball (`BTB_PASSING15=1 BTB_MEASURE=1`, 320 px, Low, no shadows or AO):
  - **`p9-curl`** (the curl against Cover 1, round 9's clip): the right corner turns out of his run with the receiver, gives a step in his pedal and plants as the curl comes back (`tools/sim/b18_breaks.ts`: the sim turns his run 151° in a tick at 2.12 s, `sim/ai.ts` `coverPlant`).
  - **`tackle-hurdle`** (the iso against Cover 1): the weak-side linebacker flows back and out at the snap (2–2.5 m/s, 117–139° off his facing) and triggers downhill on the run at 0.4 s.

  These two were picked from every scripted play with `b18_breaks.ts` (a pedal or shuffle turned into a drive within 0.6 s, the facing turning under 60°).
- **The before set** is `fb169fc`, measured from a frozen copy of the tree on this round's meter. Its six-play numbers reproduce round 17's after logs exactly (397 steps, the same per unit and per play).
- **The pop meter** is round 16's, plus a log of every break (`breaks`: who, which clip, when, from where in the clip, the sim's speed, its mean rate and why it ended).
- **The headless A/B** (`tools/sim/b18_breakbench.ts`): every back-seven defender on the eight plays, driven from the sim's own velocity and facing as GameScene feeds the animator, twice (with the break and without). It leaves out the game's one-shots (the get-offs, read steps, hip flips, tackles), so its counts are the gait's alone. It was the loop the trigger was tuned in (five seconds a run, against ~40 minutes for the browser measurement).
- **The cost:** `pops.cost` on the contested ball, the same headless measurement as FEET16.md. Three runs each, before and after alternating. The container was shared (load 4–9 from other sessions' work), not round 16's idle one.

## What was wrong (root causes)

Line numbers are at `fb169fc`.

1. **The break out of the pedal was tested on the one frame where he is standing still.**
   - `breakOut` fired only on the first frame out of the pedal, and only if the sim already had him going forward faster than a walk (`animator.ts:1024`: `!input.backpedal && this.back > 0.5 && this.backWas && this.rawSpeed > PEDAL_BREAK`).
   - The pedal ends when his speed back along his facing drops under 0.8 yd/s (`choreo.ts:1714`).
   - The sim brakes a pedal at his cut deceleration (`sim/movement.ts:99–100`, 8–14 m/s²), so his speed passes through zero over a quarter of a second. On the frame the pedal ends he is still drifting back at ~0.7 m/s, and the speed fed to the gait is zero.
   - It could fire only when the sim turned his run in a single tick: the cover man's plant (`sim/ai.ts:1729–1741`, `coverPlant`).
2. **There was no break, keyed or otherwise.** Out of the pedal the gait came in over the pedal by weights (`animator.ts:1026`, `1079`). Out of the shuffle the side layer eased out (`animator.ts:988`) with the run's phase where it was. Neither has a plant: no foot reached back, no hips sinking, no chest over the knees, no first short drive step.
   - M6's `db_break` (`tools/blender/lib/actions_m6_back7.py:420`) is a plant and drive keyed out of the pedal's left touch-down into the jog, but nothing in `src/` ever played it.
3. **The sim's breaks come in three shapes, and only one of them looks like a break from its first frame.**
   - **Braked and driven** (`breakOnBall`, `sim/ai.ts:2407`, and the zone breaks): the pedal brakes at the cut deceleration, then the sprint model drives him forward. The facing turns toward his velocity only while it is faster than 0.6 yd/s (`sim/movement.ts:126`), so through the stop the facing barely moves.
   - **The cover man's plant** (`coverPlant`): his velocity is sent down the new line in one tick, at the share of his speed his Agility keeps. On the curl the right corner's run turns 143° between two ticks (2.10 → 2.12 s).
   - **A pedal turned into a run sideways:** the sim brakes him for two or three ticks and then accelerates him across his facing. At the trigger this looks the same as a real break.
4. **The run defense doesn't pedal or shuffle.** The linebackers' fits (`sim/runs.ts:484–523`) steer with no facing, so the sim turns them toward their velocity at their turn rate. Their "trigger" is a drift back at the snap (0.73 yd/s, under the render's pedal line), or a flow back and out (the iso's weak-side backer), followed by the velocity swinging forward while the facing follows it. Only the flow is a break the render can see.

## What changed

### 1. The clips, keyed in-house (`tools/blender/lib/actions_b18.py`)

Both are keyed with our keyer's footstep plans (`transitions.py` `Steps`, `actions_m6_back7.py` `foot_on_path`), from coaching descriptions of the W-step break and the linebacker's plant and go. Each starts in the loop he is in, at the plant foot's touch-down (`fromPhase`), and ends on the jog at a touch-down (`toPhase`), so the hand-over to the run doesn't pop.

**`db_break_w_l` / `db_break_w_r`** (the W-step, 0.67 s):

| Time (s) | What |
|---|---|
| 0 | The pedal's touch-down (its frame 0): the plant foot reaching back 0.30 m behind the hips, going back at 2 m/s |
| 0.12 | The other foot comes down wide and a little ahead: the "W", the feet 0.44 m apart |
| 0.2 | Stopped over the W. The hips 9 cm under the pedal's, the chest over the knees, the hands ripped back to the hips. Braking at 10 m/s² (the sim's cut deceleration for a 76-Agility back) |
| 0.26–0.40 | The front foot's short first drive step, the opposite arm driving |
| 0.36–0.67 | The plant foot drives through and lands as the jog's touch-down. 0 → 3.5 m/s at ~7.6 m/s² (the sim's burst) |

**`lb_break_l` / `lb_break_r`** (the plant and go, 0.57 s):

| Time (s) | What |
|---|---|
| 0 | The shuffle's lead-foot touch-down (0.49 m out), the foot turned 18° out toward the break |
| 0.02–0.30 | The hips open 25° toward the break. The spine turns the same back, so the chest stays square to the ball |
| 0.03–0.24 | The trail leg crosses over in front and lands on the break's line |
| 0.30–0.57 | The lead foot drives through to the jog's touch-down |

The body keeps the shuffle's sideways speed into the break and builds the forward speed from rest: downhill and to the side he was going.

- The right twins are mirrors. They hand over at the jog's right touch-down.
- All four pass every clip gate (238/238: slide 0.00 cm, clearance ≥ 16.5 cm). The 234 old clips are byte-identical in `anims.glb` and `anims.json` (`tools/sim/b18_clipcmp.ts`).
- **The speed turn out of the pedal for a deep ball** is the hip flip (`db_hip_flip_l/r`, M6): open the hip to the break side, whip the shoulders round, cross over and run, 180° in 0.6 s. The game plays it when the sim takes a pedalling back past his pedal speed (`choreo.ts` drive, unchanged), so no new clip was keyed for it.

### 2. The break in the animator (`breakClip`)

**When.** Every frame, for a back-seven defender (`AnimInput.brk`, set by `choreo.ts` for every defender off the line), the animator reads the sim's velocity:

- **The trigger is his velocity's acceleration along his facing** (`BRK_ACC`, 5 m/s², eased over 30 ms). It is the velocity's own change, so the drawn facing turning under a run doesn't count.
- **Out of the pedal**, all of these must hold:
  - he has been in it at least 0.2 s (`BRK_SUST`);
  - he is going back slower than 1.6 m/s (`BRK_BACK`: the W is keyed from 2);
  - he is moving no faster than 2 m/s across his facing (`BRK_ACROSS`);
  - his speed is not climbing faster than 4 m/s² (`BRK_BRAKE`: braked, or swung forward at the speed he had);
  - he is not spinning faster than 2.5 rad/s (`BRK_TURN`).
- **The cover man's plant** (a velocity jump past 40 m/s², `BRK_PLANT`, from going back to forward) breaks whatever his turn: the curl's corner is turning to the ball as he plants.
- **Out of the shuffle** (the linebacker's style), all of these must hold:
  - he has been in it at least 0.2 s;
  - he is going forward faster than 0.5 m/s;
  - his velocity is within 55° of his facing, toward the lead side or straight (the crossover goes the way he was going);
  - his lead foot is in the air or has just landed (`BRK_LEAD`). Planted any longer, the body has gone on over it, and the break waits for its next landing.
- **One break per 0.6 s** (`BRK_GAP`).

**Which clip and where in it.** The clip is picked by the break's angle (out of the pedal, the W, which drives straight on; out of the shuffle, the plant and go toward the lead side) and by the foot:
- **Out of the pedal:** the planted foot if it is in the first 0.3 of the cycle (behind or under his hips), else the one about to land, which reaches back.
- **Out of a deep run** he is turning out of: the foot last down.
- **Out of the shuffle:** the lead foot.

The clip starts at the frame whose keyed speed along its line has come down to the sim's: a break that starts mid-stop starts mid-stop. A cover man's plant starts at the plant frame.

### 3. Paced by the sim (`breakPace`), and let go when the sim doesn't follow

- **Until the sim has him going forward**, the clip's time is where its keyed travel back matches the ground the sim has taken him back since the break started.
- **Once forward**, its time is where its keyed travel from its plant matches the ground the sim has covered from his (the furthest back he went), along the break's line. The rate is capped at 2.5× (`BRK_RATE`: a cover man's plant turns his run in a tick, so the plant plays quick, never skipped).
- **So the clip's rate is the sim's speed over the keyed speed, frame by frame.** A man who brakes and drives harder plays the break faster, and his planted foot stays where the clip keyed it under his body. The sim's acceleration already carries his ratings: the cut deceleration is Agility, the burst is the forty and its split. `tests/anim-break18.test.ts` checks it: a corner braking at 13 m/s² and driving at 12 finishes the break sooner than one at 8 and 6.
- **It lets go** (fading out over the gait or the stance, as his speed asks) when:
  - the sim holds him still for 0.35 s (a settle in his zone: the W and then his stance);
  - past the plant, it paces him under half speed for 0.25 s;
  - past the plant, it takes him more than 60° off the break's line for 0.15 s;
  - it takes him back again after he had gone forward;
  - before the plant, it speeds him up going back (`BRK_AWAY`: a pedal it turns into a run sideways, the third shape above).
- **While a break plays, or fades out, its planted foot steps only 0.45 m off the keyed plant** (`BRK_FAR`, the W's base), not 0.25 (`STEP_FAR`). The sim's last pedal step sets the plant up to a stride from where the W keys it, and the leg reaches it. Stepping at 0.25 m put a second plant on half the breaks in the bench.
- **Round 17's `breakOut` stays** for the frames no keyed break takes (a pedal the trigger turns down that still goes forward). It is skipped while a break plays.

## Results

The full logs are in `docs/anim/break18/measure/`:
- `before/` and `after/`, one pop-meter log per play;
- `tables.md`, all the tables (`b18_measure.ts`);
- `breakbench.txt`, the headless A/B;
- `cost/`, the cost runs.

### Steps

#### Steps taken by feet that could not stay planted (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | **Six plays** | Curl | Iso (hurdle) | **All eight** |
|---|---|---|---|---|---|---|---|---|---|---|
| QB | 0 → 0 | 1 → 1 | 3 → 3 | 3 → 3 | 3 → 3 | 6 → 6 | 16 → **16** | 1 → 1 | 3 → 3 | 20 → **20** |
| OL | 5 → 5 | 10 → 10 | 17 → 17 | 16 → 16 | 16 → 16 | 17 → 17 | 81 → **81** | 3 → 3 | 23 → 23 | 107 → **107** |
| DL | 3 → 3 | 13 → 13 | 10 → 10 | 12 → 12 | 18 → 18 | 15 → 15 | 71 → **71** | 6 → 6 | 14 → 14 | 91 → **91** |
| LB | 13 → 13 | 17 → **14** | 13 → 13 | 20 → 20 | 15 → **16** | 11 → 11 | 89 → **88** | 13 → 13 | 21 → 21 | 123 → **121** |
| DB | 11 → 11 | 16 → 16 | 8 → 8 | 9 → **10** | 17 → 17 | 17 → 17 | 78 → **79** | 23 → **22** | 30 → 30 | 131 → **131** |
| WR/TE | 4 → 4 | 5 → 5 | 11 → 11 | 14 → 14 | 9 → 9 | 1 → 1 | 44 → **44** | 6 → 6 | 12 → 12 | 62 → **62** |
| RB | 3 → 3 | 2 → 2 | 3 → 3 | 6 → 6 | 3 → 3 | 1 → 1 | 18 → **18** | 4 → 4 | 4 → 4 | 26 → **26** |
| **All** | 39 → 39 | 64 → **61** | 65 → 65 | 80 → **81** | 81 → **82** | 68 → 68 | 397 → **396** | 56 → **55** | 107 → 107 | 560 → **558** |

- **Over the eight plays the linebackers take 123 → 121 steps and the defensive backs 131 → 131.** No other unit moves.
- **Per play, three steps go and two come:**
  - The go's middle linebacker takes three fewer (17 → 14): his two plant-and-gos out of his drop's shuffle.
  - The curl's corner takes one fewer (23 → 22): his W-step on the curl.
  - The screen's free safety takes one more (9 → 10): a step of his right foot (47 cm off) as his plant and go fades out, when the sim takes him off its line.
  - The contested ball's strong-side linebacker takes one more (15 → 16): 0.37 s after a W-step that let go after six frames (below), on his run out of it.
- **The headless A/B** (the gait alone, the back seven on the sim's motion): 227 → 226 steps.

### The planted feet

Round 15's measures don't move:
- no planted span drifts over 2 cm in any back-seven unit, on any play;
- no new one-frame jumps (over 5 cm: 0 → 0 everywhere; over 2 cm: the slant's one defensive back, as before);
- the largest drift of a planted span is unchanged in every unit on every play (the linebackers' 0.008–0.018 m, the defensive backs' 0.013–0.018 m).

### The pop meter

| | Slant | Go | Run (cut) | Screen | Contested | Sack | Curl | Iso |
|---|---|---|---|---|---|---|---|---|
| Worst joint (rad/s) | 145 → 145 | 151 → 151 | 87 → 87 | 67 → 67 | 177 → 177 | 154 → 154 | 114 → 114 | 130 → 130 |
| p99 (rad/s) | 44 → 44 | 42 → 42 | 39 → 39 | 43 → 43 | 46 → 46 | 47 → 47 | 37 → 37 | 34 → 34 |
| Spikes | 64 → 64 | 66 → 65 | 35 → 35 | 65 → 65 | 111 → 111 | 115 → 116 | 33 → 33 | 27 → 26 |
| Leg spikes | 22 → 22 | 28 → 27 | 15 → 15 | 41 → 41 | 61 → 61 | 79 → 80 | 12 → 12 | 13 → 12 |

The worst joints are the same arms in the same tackles and rush moves. Spikes 516 → 515 and leg spikes 271 → 270 over the eight plays.

### How often the break fires, and on whom

Nine breaks in the eight plays (the pop meter's `breaks`):

| Play | Who | Clip | Starts at (clip s) | Gait speed fed at the start (m/s) | Mean rate | Ended |
|---|---|---|---|---|---|---|
| Go | MLB | `lb_break_l` | 0 | 0.5 | 0.73 | his run turned back (`back`) |
| Go | MLB | `lb_break_r` | 0 | 0.6 | 0.87 | played to the end, into the jog |
| Screen | WLB | `db_break_w_r` | 0.03 | 2.1 | 0.88 | off its line (`off`) |
| Screen | FS | `lb_break_l` | 0 | 1.0 | 0.84 | off its line |
| Contested | SLB | `db_break_w_l` | 0.03 | 2.1 | 1.31 | **let go after 6 frames** (`away`: the sim turned his pedal into a run sideways) |
| Sack | SLB | `db_break_w_l` | 0.03 | 2.1 | 1.28 | **let go after 6 frames** (`away`) |
| Curl | RCB | `db_break_w_l` | 0.2 (the plant: the cover man's plant) | 1.3 | – | still playing when the measurement ends (the catch) |
| Iso | WLB | `db_break_w_r` | 0.13 | 1.5 | 0.80 | off its line, past its first drive step |

- **The linebackers' plant and go** fires out of their drops' shuffles (three times). Its rate is under 1: the sim drives them out of the shuffle more gently than the keyed 2 → 3.5 m/s.
- **The W-step** fires on the corner's plant on the curl, the iso's weak-side backer's trigger, and the screen's backer driving on the screen. Two more were wrong reads, released inside a tenth of a second.
- **Every player is himself:** the rate is the sim's, and it ranges 0.73–1.31 across these men. The unit test pins it: a corner braking at 13 m/s² and driving at 12 finishes the break before one at 8 and 6.
- **The break is rare in these plays,** as round 17 found: once or twice a play. The sim's coverage mostly turns its defenders (their facing follows their run, `sim/movement.ts:126`) rather than reversing them, and a turned man runs on the gait.

## Performance

`pops.cost` (the time inside `animator.update` per body per frame) on the contested ball, headless Chromium, the measurement settings above. Before (`fb169fc`, the frozen copy) and after alternated, each run alone among this round's work, on a container shared with other sessions (load 4–9).

| Run | Before | After |
|---|---|---|
| 1 | 0.206 ms | 0.200 ms |
| 2 | 0.189 ms | 0.196 ms |
| 3 | 0.218 ms | 0.235 ms |
| Mean | 0.204 ms | **0.210 ms** |

- **The after cost (0.20–0.24, mean 0.21 ms per body) is at round 16's 0.21**, inside the brief's ~0.22.
- The means differ by 3%, under the spread of either column. The third pair ran under the most load.
- **What the round adds per body and frame:**
  - for a back-seven defender, a dot product, a hypot and two eased rates (the trigger);
  - while a break plays, a walk along its 18–21 travel samples;
  - four more clips in the mixer, off while they have no weight.
- The eight-play measurement runs (three browsers at once on the shared container) read 0.21–0.31 ms after against 0.22–0.27 before. They were never meant for timing.

## Videos

VIDEOS_GO_HERE
