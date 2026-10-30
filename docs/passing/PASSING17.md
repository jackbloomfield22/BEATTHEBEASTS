# Passing round 17: the quarterback in the pocket

Round 16 (`docs/anim/FEET16.md`) left two things at the passer's end and one at the receiver's and defender's end:

1. **The QB's pocket movement was never measured.** None of round 16's six plays slid, climbed or escaped with the passer, so the side layer it wired for him had never been seen working.
2. **Escaping to throw on the run** had not been judged at all.
3. **The shuffle-to-run hand-over** was one long blended stride. That matters on the break on the ball: a defensive back out of his pedal or shuffle, a linebacker triggering downhill.

This round recorded the passer's pocket movement as the player and the AI play it, judged it from the broadcast camera and close up, and fixed what read wrong.

Branch `wip/qb17`, from `f6703fc` (the tip of `claude/m66-polish`: rounds 1–14 plus animation rounds 15–16). **Nothing in `src/sim` or `src/engine` changed.** The changes are in these places:

- **The animator** (`src/anim/animator.ts`, `blend.ts`, `library.ts`):
  - the side layer's `'qb'` style;
  - the pocket gait family;
  - the passer's pedal;
  - the break out of the pedal.
- **The render** (`src/render/game/choreo.ts`, `GameScene.tsx`):
  - the passer's inputs;
  - his hips on his gait;
  - the ball held up out of the pocket;
  - the throw on the run turned to the target;
  - the run across his facing;
  - his feet lagging his eyes.
- **Nine new clips**, keyed in-house (`tools/blender/lib/actions_q17.py`).
- **The scripted plays** (`src/game/clips.ts` `PASSING17`, `pocketMove`).
- **The instruments** (`tools/sim/q17_*.ts`):
  - the pocket and break finders;
  - the receiver bearings;
  - a headless bench of the pocket;
  - the harness copies.

## How it was judged

- **The plays** (`src/game/clips.ts` PASSING17; seeds and timings from `tools/sim/q17_pocket.ts`):

  | Clip | What the QB does | Who moves him |
  |---|---|---|
  | `p17-slide-l`, `p17-slide-r` | After his five-step drop and set, he slides left or right for half a second (the stick, ~4 m/s), then throws the dig | The player |
  | `p17-step-up` | Most of a yard up into the pocket (to 2.5 m/s), then the dig | The player |
  | `p17-climb` | ~2.5 yd up the pocket (to 4.6 m/s), then the crosser | The player |
  | `p17-roll-r`, `p17-roll-l` | He escapes the pocket with the tuck-and-run key and throws on the run at 6–7 m/s, to the side he runs to: the Z's go rolling right, the X's post rolling left (`tools/sim/q17_icons.ts`) | The player |
  | `p17-ai-slide` | Against Cover 1 blitz, seed 6. Reads side to side from the set, a slide right off the end at 2.6 s, a drift back 3.1–4.0 s, then away to his left at 6 m/s and the throw on the run at 5 s | The AI |
  | `p2-drop5-ai` | The five-step drop, the hitch, his reads and the throw (passing round 2's clip) | The AI |
  | `pass-onrun` | The play-action bootleg and the throw on the run (passing round 1's clip) | The player |
  | `p9-post` | The strong safety driving out of his pedal on the throw | – |
  | `p9-go` | The weak-side linebacker's drop, scrape and run (round 16's close-up) | – |

- **Recordings:** close-ups at 30 fps (768 px, Medium) for every play, and the broadcast camera at 60 fps (960 px) for the left slide, the right escape and the AI's pocket. Every recording was made twice, from frozen copies of the tree: before (`f6703fc` plus the new scripted plays) and after (this round's tip). A per-frame log of the QB's skeleton goes with each one (`BTB_DIAG`).
- **The QB's numbers** (`tools/sim/q17_*` plus the per-frame logs), whenever he moves in the pocket with the ball (faster than 0.5 m/s, outside his drop):
  - the height of his hips;
  - the ball hands under his chest;
  - his feet crossing;
  - through the throw, from the windup to 0.3 s past the release: the lowest and the highest his hips get (the rise);
  - at the release of a throw on the run: his chest's and hips' facing off the line to the receiver.
- **Round 15/16's measures** on round 16's six plays (`BTB_PASSING15=1 BTB_MEASURE=1`, 320 px, Low, from the snap to 1.8 s after the ball):
  - the step log;
  - drift and jumps;
  - the pop meter;
  - the cost.

  The before column is round 16's own after logs (`docs/anim/feet16/measure/after`, measured on the tree that `f6703fc` merged).
- **A headless bench** (`tools/sim/q17_animbench.ts`): round 16's bench with scripted pocket movements and two breaks added. For each script it reports:
  - the steps;
  - the height of the hips;
  - the narrowest base;
  - the feet crossing in the hips' own frame;
  - the widest split of the feet.

  `--before` feeds the inputs as round 16's game did.

## What was wrong (root causes)

Line numbers are at `f6703fc`.

1. **The passer moved in the pocket on other men's loops.**
   - **A slide:** the QB got the default side style, the linebacker's shuffle (`GameScene.tsx:502`, `side: d.side ?? 'lb'`; `animator.ts:338`, `SIDE_CLIPS.lb`). That shuffle (`actions_m6_back7.py:116 SHUFFLE` and round 16's quick one) is a scrape: the hips 21–22 cm under the rest, the trunk pitched 26°, the hands out. He dropped to **0.71 m at the hips** (his set is at 0.97), the trunk folded over the ball.
   - **A climb:** the carrier's traffic gait, `out.carry = out.traffic = 1` for a QB stepping up faster than 0.8 yd/s (`choreo.ts:1903–1906`, `CLIMB_ALONG` 1543). Its hips are keyed at 0.78–0.84 m (`actions_m65_carrier.py:116–123`, `pelvis_up` −0.19/−0.20).
   - **Going back:** the defensive back's pedal (`animator.ts:978–979`, `loco_backpedal`): low, his chest over his toes.
2. **Out of a crouch the throw rose.** The throw on the move is an upper-body overlay over whatever the legs play (`choreo.ts:1684`). The finish is keyed standing at the set's height, so from the shuffle he came up **0.22–0.24 m** through the release (left and right slides, the AI's pocket), the crouch-and-rise round 14 removed from the set.
3. **His hips were held square on his gait** (`GameScene.tsx:502`, `warp: i !== s.qb`). Round 15 kept the passer's clips square, and that also fed his gait only the speed along his facing. Moving across his facing faster than the shuffle (the AI's 5–6 m/s away from a rusher, eyes downfield), he played a gait at about no speed while the sim slid him: a stance, with his planted feet stepping every few frames. The bench's AI escape at 6 m/s: **15 steps in 2.5 s.**
4. **The throw on the run was drawn down the line he ran.** A scrambling passer is a runner in the sim: his facing is his run (`sim/play.ts:377`, `steer` with no facing). The throw on the move is an overlay over that heading. So the ball left his hand down his run and flew off 60–85° to one side of it. At the release in the before recordings, **the chest was 36° off the line to the receiver rolling right, 87° rolling left and 106° on the bootleg.**
5. **Escaping, he tucked the ball like a runner** (`choreo.ts:1826`). The two-hand hold is the pocket's only, so a scrambling passer behind the line, eyes downfield and still allowed to throw, carried it in one arm at his ribs and looked for tacklers (`carrierDrive`'s look, `choreo.ts:1908`).
6. **His whole body swung with his eyes.** The sim faces the passer at his read (`sim/pocket.ts:217` `qbFace`). Against the blitz, the AI's reads swing ±40° two or three times a second (`tools/sim/q17_pocket.ts --ai=doubles-curls:cover1blitz:6`). The drawn facing chased it at everyone's pace (`GameScene.tsx:451`, 22/s). The whole passer spun read to read on planted feet, stepping at up to 350°/s (the AI pocket's step log).
7. **The shuffle-to-run and the pedal-to-run hand-overs** blended two loops on unrelated phases (`animator.ts:947, 978, 987`). The forward gait's phase runs on its own while the side loop or the pedal plays. When either eases out over ~0.12 s, the run comes in with whichever foot its own phase has down, not the one the shuffle or the pedal planted.

## What changed

### 1. The passer's own loops, keyed in-house (`tools/blender/lib/actions_q17.py`)

Nine loops, keyed with our gait keyer (`gait.py`). Every one is in the passer's set, from coaching descriptions of pocket movement:
- the feet a little wider than the shoulders;
- the knees flexed;
- the hips at the set's height, give or take a few centimetres;
- the trunk qb_set's;
- the ball at the chest in both hands (qb_set's hold, its hands riding with the hips);
- the eyes level downfield.

| Clip | Speed (m/s) | What | Key numbers |
|---|---|---|---|
| `qb_shuffle_l/r` | 1.8 | The slide: short, quick steps sideways, the lead foot stepping and the trail foot replacing it, never crossing | Ten frames a cycle (six steps a second), a 0.5 m base, lift 4.5 cm |
| `qb_shuffle_fast_l/r` | 3.6 | The quick slide away from a free rusher | Eight frames; the feet 0.14 m apart at their closest and 0.90 m at their widest |
| `qb_climb_slow`, `qb_climb`, `qb_climb_fast` | 1.3, 2.8, 4.4 | Short, choppy steps up, heel-first slow to midfoot fast | At a quicker cadence than the walk and the jog, and with half their trunk turn (the ball's in both hands) |
| `qb_pedal_slow`, `qb_pedal` | 1.5, 3.2 | The drift straight back off the rush | The pedal's mechanics in the passer's set, upright, not the corner's chest over his toes |

The right slides are the left ones' legs mirrored, with the ball still in his right hand behind it. All nine pass every clip gate (234/234), and the 225 old clips are byte-identical in `anims.json`. The quick slide was first keyed with a 1.0 m spread; it was narrowed after it was seen. The passer's hips in the bench (`q17_animbench.ts`, after vs `--before`):

| Script | Hips min / mean (m), before | After | Steps before → after |
|---|---|---|---|
| Slide (2 m/s left, 4.3 m/s right) | 0.767 / 0.856 | **0.931 / 0.957** | 2 → 2 |
| Step up (2.5 m/s) | 0.872 / 0.950 | **0.911 / 0.959** | 3 → 0 |
| Climb (4.5 m/s) | 0.785 / 0.885 | **0.884 / 0.942** | 2 → 1 |
| Drift (2.5 m/s back, then 3 m/s back and out) | 0.797 / 0.854 | **0.903 / 0.941** | 6 → 1 |
| Away from a rusher (6 m/s across his facing) | 0.813 / 0.951 | 0.835 / 0.942 | 15 → **1** |

### 2. The animator

- **The side layer's `'qb'` style** (`SIDE_CLIPS.qb`, `SIDE_VIN_QB`/`SIDE_VOUT_QB` 5.0/5.6 m/s):
  - The passer slides on his own loops up to the line's speeds. The player's stick slides him at 0.55 of his top speed (~4.3 m/s), and the AI's push from a free rusher reaches 4–5 m/s.
  - His hips stay square in it (no `SIDE_WARP`).
- **The pocket gait family** (`library.ts` `FAMILIES[7]`, `blend.ts` `familyWeights(…, pocket)`, `AnimInput.pocket`): the passer's forward gait is the climb. Its share comes off the other families, eased like the carry.
- **The pedal by whose it is** (`PEDALS`, `AnimInput.pedal`): the passer drifts on his own pedal.
  - The pedal changes only when he's out of it, so a pedal that's playing never swaps clips.
  - The defensive back's pedal is unchanged (its clips, weights and phases are the same; checked on the six plays below).
- **The break out of the pedal** (`breakOut`; `BREAK_RATE`, `BREAK_T`, `BREAK_PHASE`, `PEDAL_BREAK`):
  - **When:** a defender in his pedal whom the sim sends forward (faster than 1 m/s, his velocity ahead of his drawn facing; not the sim's turn-and-run, which the hip flip turns).
  - **What:** the forward gait comes in on the pedal's planted foot. Its phase starts with that foot early in its stance, so the lock keeps it where it is (the plant), and the other foot drives through first. The pedal hands over in ~60 ms instead of ~120.

### 3. The render (`choreo.ts`, `GameScene.tsx`)

- **The passer's inputs** (`drive`): with the ball in his drop or the pocket, `side: 'qb'`, `pocket: 1` and `pedal: 'qb'`. The passing-round-2 climb (`CLIMB_ALONG`, the carrier's traffic gait) is gone.
- **His hips on his gait** (`GameScene.tsx`, warp for everyone): his hips turn toward where he goes, up to 55°, as everyone's do. His one-shots (the drop, the throws) are unaffected: the warp is the gait's only.
- **Across his facing faster than his slide** (`passerRun`): past the slide's top speed (5.0–5.6 m/s), the drawn heading turns toward his run by what the hips can't take. The hips go on his run, the shoulders turn 55° back toward his read, and the head takes the rest. On the bench, his hips free on his gait took the 6 m/s escape from 15 steps to 9, and this turn took it to 1.
- **The ball up out of the pocket** (`onTheMove`, `TUCK_NEAR`): behind the line in the sim's scramble (eyes downfield, still allowed to throw), he keeps it in both hands at the chest and his eyes on the sim's read. He puts it away as a runner does once a defender is within 1.6 yd, or past the line.
- **The throw on the run turned to the target** (`throwTurn`; `THROW_TURN_MAX` 55°, `THROW_TURN_IN` 0.15 s, `THROW_TURN_OUT` 0.4 s):
  - On the move, from the windup the drawn heading turns toward the receiver by up to 55° off his run. The hips stay on the run (the gait's own turn, back the other way), and the chest comes round to the target.
  - The throw's keyed trunk rotation and the finish across the body take the rest.
  - It eases out after the release.
- **His feet lag his eyes in the pocket** (`POCKET_YAW_EASE`, 4/s against everyone's 22). The head and chest take the read first (70° of neck), and the hips and feet settle toward it, as a passer's do working a progression. In the windup he comes round at once. In the AI's pocket against the blitz, his steps went from 11 to 7, and the fastest turn on a planted foot from 350 to 180°/s (the step log).

### 4. Tried and reverted: the break out of the shuffle

The same hand-over as the pedal's, out of the side layer into the run, was built and measured four ways. Every version added steps on the six plays:

| Version | Steps against round 16's (the plays it was measured on) |
|---|---|
| Any exit faster than 2 m/s, every style | All six: LB 89 → 97, OL 81 → 87, DB 80 → 83 |
| The same, the plant held up to 0.45 m off the run's foot | Four plays (slant, screen, contested, sack): LB 59 → 66, OL 54 → 56 |
| The back seven only, out of a full shuffle faster than 3 m/s, the plant held | Screen and sack: LB 31 → 33 |
| The same, no plant hold | All six: LB 89 → 93 (the contested ball +3, the sack +2) |
| Off (the control, with the pedal's break) | All six: LB 89, round 16's exactly |

Where the linebacker's scrape flips in and out of the layer, each reset of the run's phase left a foot behind it (`tools/sim/q17_animbench.ts` and the sack's per-frame trace of the strong-side linebacker). It's reverted, and the shuffle into the run is as round 16 left it (see Still open).

## Results

### The quarterback in the pocket

From the per-frame logs of the close-ups. **Moving** means faster than 0.5 m/s in the pocket with the ball, outside his drop.

#### The QB moving in the pocket, and through the throw (before → after; 30 fps logs)

| Play | Hips moving, min / mean (m) | Ball under the chest (m) | Feet crossed (frames moving) | Hips through the throw, low → high (m) | Rise |
|---|---|---|---|---|---|
| Slide left | 0.71 / 0.83 → **0.87 / 0.93** | 0.22 → 0.22 | 0/16 → 0/16 | 0.73 → 0.97, after 0.92 → 0.97 | 0.24 → **0.05** |
| Slide right | 0.77 / 0.83 → **0.93 / 0.94** | 0.23 → 0.23 | 0/16 → 0/16 | 0.71 → 0.94, after 0.89 → 0.96 | 0.23 → **0.07** |
| Step up | 0.83 / 0.88 → **0.90 / 0.92** | 0.17 → 0.21 | 4/11 → 0/11 | 0.91 → 0.97, after 0.93 → 0.97 | 0.06 → **0.04** |
| Climb | 0.75 / 0.83 → **0.84 / 0.90** | 0.17 → 0.19 | 0/20 → 2/20 | 0.87 → 0.95, after 0.91 → 0.95 | 0.08 → **0.04** |
| Escape right | 0.79 / 0.83 → **0.80 / 0.87** | 0.15 → 0.17 | 0/23 → 0/23 | 0.81 → 0.93, after 0.87 → 0.95 | 0.12 → **0.08** |
| Escape left | 0.80 / 0.84 → **0.84 / 0.88** | 0.20 → 0.15 | 3/23 → 4/23 | 0.81 → 0.94, after 0.89 → 0.94 | 0.13 → **0.05** |
| The AI against the blitz | 0.71 / 0.83 → **0.83 / 0.92** | 0.23 → 0.22 | 0/83 → 6/83 | 0.72 → 0.94, after 0.85 → 0.90 | 0.22 → **0.05** |
| The AI's drop, hitch and reads | 0.93 / 0.94 → **0.93 / 0.94** | 0.24 → 0.24 | 0/9 → 0/9 | 0.95 → 0.97, after 0.95 → 0.97 | 0.02 → **0.02** |
| The bootleg | 0.82 / 0.87 → **0.84 / 0.89** | 0.14 → 0.18 | 0/21 → 3/21 | 0.87 → 0.95, after 0.89 → 0.95 | 0.08 → **0.06** |

- **The crouch is gone.** Sliding, stepping up and climbing, his hips stay at 0.84–0.94 m against his set's 0.97 m, where the slides took them to 0.71. Escaping, he runs, and his hips sit at a runner's height.
- **The rise through the throw is 2–8 cm,** the finish's own settle onto the set, against 22–24 cm out of the slides and the AI's pocket. The ball stays at the chest (0.15–0.24 m under the chest bone; the set's hold has it at 0.24).
- **No crossover in a slide:** the feet never cross in either slide, and the bench's slide crosses on 2 frames of 89, at the change of direction.

#### A throw on the run, at the release (before → after)

The chest's and hips' facing (from the shoulders' and the thighs' line), and his run, off the line from his hips to the receiver.

| Escape | Chest off the line to the receiver | Hips off it | His run off it |
|---|---|---|---|
| Right (the Z's go) | 36° → **21°** | 53° → 40° | 59° → 59° |
| Left (the X's post) | 87° → **31°** | 69° → 64° | 61° → 61° |
| The bootleg | 106° → **48°** | 88° → 73° | 85° → 85° |

Rolling right to the go, the throw is 59° off his run, a natural throw on the run, and his chest was already near it. Rolling left (a right-hander throwing across his chest) and on the bootleg, the chest was 87° and 106° off the line of the ball. It now comes round to 31° and 48°: the turn takes 55°, and the throw's own rotation and finish the rest.

### Round 15/16's measures on the six plays (before → after)

Round 16's after logs against this round's (`docs/passing/round17/measure/`). Totals over the six plays: the slant, the go, the cut run, the RB screen, the contested ball, the sack.

#### Steps taken by feet that could not stay planted (before → after)

| Unit | Slant | Go | Run (cut) | Screen | Contested | Sack | All six |
|---|---|---|---|---|---|---|---|
| QB | 0 → **0** | 1 → **1** | 4 → **3** | 3 → **3** | 6 → **3** | 6 → **6** | 20 → **16** |
| OL | 5 → **5** | 10 → **10** | 17 → **17** | 16 → **16** | 16 → **16** | 17 → **17** | 81 → **81** |
| DL | 3 → **3** | 13 → **13** | 10 → **10** | 12 → **12** | 18 → **18** | 15 → **15** | 71 → **71** |
| LB | 13 → **13** | 17 → **17** | 13 → **13** | 20 → **20** | 15 → **15** | 11 → **11** | 89 → **89** |
| DB | 11 → **11** | 16 → **16** | 8 → **8** | 11 → **9** | 17 → **17** | 17 → **17** | 80 → **78** |
| WR | 4 → **4** | 5 → **5** | 11 → **11** | 14 → **14** | 9 → **9** | 1 → **1** | 44 → **44** |
| RB | 3 → **3** | 2 → **2** | 3 → **3** | 6 → **6** | 3 → **3** | 1 → **1** | 18 → **18** |
| **All units** | 39 → **39** | 64 → **64** | 66 → **65** | 82 → **80** | 84 → **81** | 68 → **68** | 403 → **397** |

- **Steps:** 403 → 397. The quarterback's go down (20 → 16: the cut run's carry-out and the contested ball's pocket), and the screen's strong safety out of his pedal (DB 80 → 78). No unit goes up.
- **Planted spans drifting over 2 cm:** QB 2 → 2 (the same two spans), every other unit 0 → 0.
- **One-frame jumps:** over 5 cm, 0 → 0 for every unit; over 2 cm, 1 → 1 (the same defensive back on the slant).
- **The largest drift of a planted span:** unchanged by unit (the QB's 0.024 → 0.023 m).

#### The pop meter (before → after)

| | Slant | Go | Run (cut) | Screen | Contested | Sack |
|---|---|---|---|---|---|---|
| Worst joint (rad/s) | 145 → **145** | 151 → **151** | 87 → **87** | 67 → **67** | 177 → **177** | 154 → **154** |
| p99 (rad/s) | 44 → **44** | 42 → **42** | 39 → **39** | 43 → **43** | 46 → **46** | 47 → **47** |
| Spikes | 64 → **64** | 66 → **66** | 35 → **35** | 65 → **65** | 110 → **111** | 115 → **115** |
| Leg spikes (thigh, calf) | 22 → **22** | 28 → **28** | 15 → **15** | 41 → **41** | 61 → **61** | 79 → **79** |

The pop meter doesn't move. The worst joints are the same arms in the same tackles and rush moves, and the contested ball has one spike more (110 → 111).

## Performance

`pops.cost`: the time inside `animator.update` per body per frame on the contested ball, headless Chromium, the measurement settings above. It's round 16's measurement. The before tree (`f6703fc` plus the scripted plays) and the after tree each ran alone with nothing of this session's running, alternating. The container was shared with other sessions, though (load average 2–5 throughout), so this is not round 16's idle container.

| Run | Before | After |
|---|---|---|
| 1 | 0.188 ms | 0.212 ms |
| 2 | 0.180 ms | 0.220 ms |
| 3 | 0.217 ms | 0.221 ms |
| Mean | 0.195 ms | **0.218 ms** |

- **The after cost (0.21–0.22 ms) holds round 16's 0.21.** The means differ by 12%, but the before runs spread 0.18–0.22 on the shared container, and the third pair is 2% apart. The round's own share can't be told from the noise here; an idle container or the target desktop would settle it.
- **The headless bench** (`tools/sim/a16_animbench.ts`, round 16's twelve scripts, 300 frames, alternating three times): before 0.094–0.132 and after 0.104–0.136 ms per body. The same steps (12), so no difference beyond noise.
- **What the round adds per body and frame:**
  - nine more clips in the mixer (off while they have no weight, as round 16 made them);
  - two more pedal clips weighed at zero;
  - one more gait family (skipped at no weight).
- **The quarterback's own work** (his hips' turn, the throw's turn, the lag) is one body's.
- Six-play measurement runs, under load, read 0.18–0.26 ms (the logs in `docs/passing/round17/measure/after`).

## Videos

In `docs/passing/round17/`. `before/` is `f6703fc` with this round's scripted plays, `after/` this round's tip, each recorded from a frozen copy of its tree. `compare/` has them side by side, before on the left.

- **Broadcast, 60 fps** (960 px): the left slide (`p17-slide-l-60.mp4`), the right escape and its throw (`p17-roll-r-60.mp4`), and the AI's pocket against the blitz (`p17-ai-slide-60.mp4`).
- **Close cameras, 30 fps** (768 px, `*-close.mp4`):
  - the slides left and right;
  - the step up;
  - the climb;
  - the escapes right and left;
  - the AI's pocket;
  - the AI's five-step drop, hitch and reads (`p2-drop5-ai`);
  - the bootleg (`pass-onrun`);
  - the strong safety out of his pedal on the post (`p9-post`, the break on the ball);
  - the weak-side linebacker's drop, scrape and run on the go (`p9-go`).
- **Stills** (`stills/`): contact sheets of the slide, the climb and the escape, before over after.

## Critique

Watched at speed and frame by frame, close up and from the broadcast camera, as a coach and as a fan would.

**What reads now:**
- **The slide is a passer's slide.**
  - **Before:** the moment the stick moved him he dropped 26 cm into a linebacker's scrape: wide, low, trunk pitched, the ball going down with him. He threw from that crouch, rising through the release.
  - **Now:** he stays tall in his set, feet sliding under him and never crossing, the ball at the chest in both hands, eyes on his read. When the stick lets go, he throws from the same height.
  - From the broadcast camera, the before passer looks like he's ducking a rusher he isn't, and the after one like he's buying a window.
- **The step up and the climb** are short steps up in his set with the ball high. Before, he ran up in a carrier's traffic crouch. The 4.6 m/s climb reads as a jog up the pocket, which is what the stick asks for.
- **The escape** is the clearest change in the hands:
  - The ball stays up in both hands as he leaves the pocket (before, it was tucked at his ribs like a runner's).
  - At the throw, his chest comes round toward the receiver while his legs keep running the line. The arm then comes through and finishes across his body.
  - Rolling left, he had been throwing with his chest 87° off the line of the ball; now it's 31°.
- **The AI's pocket against the blitz** no longer spins (judged from the broadcast camera and the logs; its close camera is mostly behind linemen):
  - his head goes read to read and his body settles after it;
  - the drift back is upright on his own pedal (before: the corner's crouch);
  - away from the rusher at 6 m/s, his hips run and his shoulders stay toward the field.
- **Every metric that was held stays held:**
  - no unit takes more steps on the six plays;
  - the planted feet don't drift or jump more;
  - the pop meter doesn't move.

**What doesn't (yet):**
- **The quick slide is a big, fast shuffle.** The player's stick moves him at ~4.3 m/s sideways, which a coach would call a bail, not a slide. Keyed as a slide, a shuffle at that speed has to cover 0.38 m a stance, so the feet open to 0.9 m and close to 0.14. It never crosses, but at full speed it reads as hopping sideways. A slower stick slide is a sim decision (`sim/play.ts`, the 0.55 of top speed), and this round leaves the sim alone.
- **The shuffle into the run is unchanged.** The procedural plant-and-crossover added linebacker steps on every version tried (see "Tried and reverted"). A linebacker breaking out of his scrape still opens with one long blended stride. `p9-go`'s weak-side linebacker is the same before and after: the same modes frame by frame and the same three steps.
- **The break out of the pedal barely shows.** The sim's defenders rarely reverse out of a pedal: they turn (the strong safety on the post rotates 120° in 0.4 s). The plant-and-drive fires on one man in the six plays (the screen's safety, two fewer steps), and from the close camera on the post the safety looks as he did.
- **The reset between reads** isn't a keyed reset. It's the lag and, past 25 cm, the procedural step (toe-off, heel strike). At broadcast distance the feet now re-set after the eyes, as they should. Close up, a re-set is one foot stepping, not the coached two-foot chop.
- **The hitch was already right.** The AI's five-step drop, hitch and quick throw are one-shots end to end, and they are identical before and after.
- **The close cameras on the climb and the AI's pocket** spend half their frames behind linemen. Moving with the passer at a fixed offset, they put the line between the lens and him. The broadcast clips and the slide and escape close-ups carry the judgement.
- **Crossings in the escape** (4 of 23 moving frames rolling left, 6 of 83 in the AI's pocket) are frames of his run across his facing, where the feet pass under the turned hips as a runner's do, not a slide's.

## Still open

1. **A keyed break out of the shuffle** (`lb_break_l/r`). The lead foot plants, the hips open and the trail leg crosses over, all in the shuffle's frame, handing over to the run with the hips already turned the warp's way. Procedurally the plant fights the sim's acceleration and leaves a foot behind (+4 linebacker steps). It has to be keyed.
2. **The stick's pocket speed.** A slide at 0.55 of top speed is a bail. A pocket slide is 1.5–3 m/s (the AI's push is mostly there). Slowing the player's pocket movement (or making the run key the bail) is a sim and feel change for the owner. It would let the quick slide narrow.
3. **A keyed reset** (`qb_reset_l/r`): two quick chops turning the base 30–45° toward the new read, played when the lagged facing has turned that far, instead of the procedural step.
4. **The sim's AI drift.** Against interior pressure the AI passer backs straight up 4–6 yd at up to 5 m/s (`--ai=trips-four-verts:cover1:3`), toward the edge rushers, where a coach would slide him. This round leaves it alone (`src/sim` untouched). It needs a sim change, with its harness numbers.
5. **Defenders breaking on the ball out of a pedal** are rare because the sim turns them. A sim-side "plant and drive" (reverse the pedal on the throw while still facing the passer) would give the break-out its moment.
6. **Close cameras that frame the passer through traffic**: a follow camera offset from the line, rising over it.

