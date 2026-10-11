# The passing game, round 13: the quick game thrown tall, the bar from its first beat

Round 12 (`PASSING12.md`) left two things for this round:
1. **The slant's flick sits too deep.** Round 12 gave the quick finish its legs, and the crouch showed. A real QB throwing a quick slant from the gun or off three steps stays tall, with the front knee at roughly 20–35° at the release.
2. **The box-out bar's first beat is hidden.** The dark forearm on the man's dark jersey is also low in contrast.

Branch `wip/passing13`, from `5c6b9e9` (the tip of `claude/m66-polish`, rounds 1–12). Nothing in `src/sim` or `src/engine` changed. Every change is in:
- the keyed clips (`tools/blender`);
- the render (`src/render/game/choreo.ts`, `GameScene.tsx`);
- the recording hooks (`tools/shots/video.spec.ts`).

## How it was watched and measured

- **At 60 fps from the default broadcast camera:** 960×540 on Low, on the frame-true clock, from the windup to 1.8 s after the ball. The flags are `BTB_VIDEO=1 BTB_PASSING13=1 BTB_DIAG=1 BTB_WINDOW=1 BTB_VIDEO_FPS=60`; `BTB_PASSING13` is round 12's recording into `docs/passing/round13/`.
  - The plays: the slant (a flick), the RB screen (a flick to his right), the dig (a drive) and the fade (touch).
  - The contested ball (Gronkowski on Lott, recorded to 0.8 s after the ball). It is also a touch throw from a set QB.
  - The before set is `5c6b9e9` with only the recording hooks added. Its numbers reproduce round 12's to the frame: slant 20/20 hand clear, 14/20 heel up; screen 5/31 and 16/31; dig 19/19 and 16/19; fade 30/31 and 13/31; the bar 19/23.
- **The per-frame log** (round 12's whole figure) is measured by `diag.py` (scratch, round 12's plus the knees). It gives:
  - **the knee flexion:** the angle between the thigh (hip joint to knee) and the shank (knee to ankle), from the bones' joints, with 0 meaning straight. The front knee is the left for a right-hander. On the rig this measure reads 8° at rest and 23° in the idle stance; the joint centres don't line up straight.
  - **the hips' height:** the pelvis bone's head above the ground, in metres.
  - round 12's readability measures: the throwing hand clear of the trunk's outline by more than 3 px, the back heel up (the back ankle more than 0.2 m off the ground), and the back foot clear of the front leg. Each is counted over the first 0.5 s after the release while the QB is in the frame.
  - **the bar's visibility:** the share of the bar forearm, elbow to fist, that neither body hides from the eye.
    - Round 12 logged the contest partner only once the render paired the two, 0.45 s before the ball. The log now also has the nearest defender before the pairing (`pnear`), so the whole post-up can be measured.
    - The table gives round 12's own count (paired frames) and the full window (from the bar key).
- **In Blender** (scratch):
  - `knees.py` gives the same angles, hip height, trunk lean and back-ankle height for every throw and finish, frame by frame from the release;
  - `qbfin.py` (round 12's) gives the hand's clearance from the slant's broadcast eye (`tools/sim/p13_cam.ts --rel`: 3.9 m behind him, 7.9 m to his left, 7.1 m up);
  - `reach.py` finds where a planted foot falls short of its IK target;
  - `exp.py` was used to try the pelvis drops before keying them.

## What was wrong (root causes)

1. **Every throw went down through the release and stayed down.**
   - `tools/blender/lib/actions_pass.py:78, :82, :86, :90` and `actions.py:369, :374, :379, :384` (at `5c6b9e9`): the load, the cock, the release and the follow-through dropped the pelvis 0.10, 0.12, 0.11 and 0.12 m below the rig's rest. The pocket set is only 0.085.
   - So the front knee was bent 53–59° at the release on every base throw (Blender), with the hips 9 cm under his standing height.
   - The finishes went deeper still (`actions_p10.py:79–80, :88, :97`: the pelvis 0.12–0.13 m down):
     - the flick and the drive reached 63–64° of front knee, with the hips 11 cm down;
     - the flick's chest was 38° over the front knee (pelvis flex 25°, spine 12°);
     - touch also reached 63°.
   - Round 12's `FINISH_PLANTED` (`choreo.ts:1530`) plays the finish's legs on the quick throw from the gun, so the slant now showed this sit. In the game the front knee held 57–61° through the slant's finish with the hips at 0.87 m. The dig sat at 62–65°, the fade at 57–59°, and the screen at 53–60°.
2. **The bar was up before the man was paired, and the turn banked him.** Two render causes, both measured in the per-frame log.
   - **The pairing came late.** The box clip's bar went up 0.58 s before the ball (`actions_p8.py:194`). But the render paired the receiver with his man only `CONTEST_LOOKAHEAD`, 0.45 s, before the ball (`choreo.ts:166, :214`). Both the post's turn (`:1730` needs `b.contest`) and its shove (`contact.ts:180` works on contested pairs) wait for that pairing.
     - So for the bar's first 0.13 s the receiver was neither turned nor shoving. The man came onto his shoulder, 0.54–0.59 m centre to centre.
     - When the pairing came, the turn and the shove jumped in partway through their ramps.
     - The forearm was at least half seen on 1 of the first 11 frames of the post (20/31 over round 12's window from the bar key; round 12 counted 19/23 from the pairing).
   - **The turn banked him.** The post's turn is a yaw of the drawn heading (`choreo.ts:1735`, applied at `GameScene.tsx:440`). The run's lean reads the drawn yaw's rate as a curve in his run (`GameScene.tsx:471` into `animator.ts:832`, atan(v·ω/g) up to its 0.35 rad limit), so turning on his line at full speed tipped him sideways toward the man as the bar went up.
     - The bar arm dropped with the near shoulder: the hand was drawn down to 1.02 m through the hold, against 1.26 m keyed. When the bar was first brought up earlier this round, the hand went down to 0.89–0.91 m, the man's belt.
     - The forearm went behind the receiver's own back and the man's arms.
   - The dark forearm is low in contrast against the man's dark jersey, but not against the turf. Wherever the gap between the two bodies is open, the bar is seen against the field.

## What changed

### The throws stand tall (`tools/blender/lib/actions.py`, `actions_pass.py`, `actions_p10.py`, `actions_p8.py`)

- **The hips rise onto a firming front knee through the release.** This is `actions.py THROW_UP`, shared by the M4 throw and `_throw`.
  - The pelvis drop at the load, the cock, the release and the base follow-through goes from (−0.10, −0.12, −0.11, −0.12) to (−0.085, −0.06, −0.035, −0.08).
  - The stride lands on a flexed front knee (~54°) that extends through the ball: 25–34° at the release, with the hips ~1.5 cm under his standing height.
  - The sources, cited in the code:
    - the owner's brief: 20–35° for a quick slant;
    - Labbe et al. 2025 (IJSPT 20(8)): the stride knee 29–46° through a quarterback's full throw;
    - Fleisig (ASMI): the pitcher's lead knee 35 ± 12° at the release, extending through it.
  - The base throw's own follow-through goes back down to −0.08. It is only seen when he's hit as he throws, and on the long stride the back foot is still planted 0.15 s past the release: higher hips over-reached it, and the foot slid 1.7 cm, a gate failure in the first build.
- **The hands and the elbow poles ride up with the hips** (`throw_rise`, `lifted`; `actions_p10.py up12`), so the upper body keeps the shape it was keyed in. The throwing hand is still 0.28 m over the head bone at the release, and the arm slot doesn't change. The slot overlays (`actions_p8.py throw_slot`) are solved against the same hips.
- **The fade-away keeps round four's hips** (`FADE_UP`): off platform he sits back on the back leg.
- **The finishes keep the height:**
  - the flick's pelvis is 0.03 m down (from 0.12–0.13), with less flex (25 → 18°, the spine 12 → 10°);
  - touch is 0.03–0.035 m down;
  - the drive, the whole body through a longer throw, is 0.04–0.065 m down, so the front knee reaches ~45° as the weight goes over it;
  - the back heel's kick (`kick`) is unchanged.
- All 215 of 215 clip gates pass. `qb_throw_long_fin_touch` slides 0.43 cm on two frames after the release (the gate is 0.5).

### The bar from its first beat (`actions_p8.py box_out`; `choreo.ts`; `GameScene.tsx`)

- **The bar is up 0.75 s before the ball** (`BAR_LEAD`, from 0.58). The clip is 5 frames longer, and everything after the bar keeps its time against the ball. At 0.75 s Lott is still 0.75 m off (`tools/sim/p13_box.ts`): the arm goes up into the gap and meets him as he arrives.
- **A posted-up receiver is paired with his man from the box clip's start** (`contests`), not 0.45 s out. The man's own contest clip still starts on its lead (`contestAt`).
- **The turn no longer banks him** (`GameScene.tsx`, `postYaw`). The post's turn is taken off the yaw rate the run's lean reads. It is eased as the drawn yaw is, so a turn on his line is drawn as a turn, not a curve. The turn is only used by the post-up (`out.turn`), so nothing else changes.
- **The turn leads the bar** (`BOX_TURN_LEAD`, 0.08 s, from the clip's start). The bar comes off a back already turning into the man, instead of reaching behind him.
- **The shove lands faster** (`BOX_SHOVE_AT` 0.05 → 0.03 s after the post, `BOX_SHOVE_IN` 0.22 → 0.16 s), because the man is now arriving onto the bar.
- **No outlines, glows or material changes.** The contrast comes from the pose and the gap: the forearm level at the man's chest, across turf.

## The numbers

### The knees and hips in Blender (each base throw and finish; before → after)

The front knee is at the release and its deepest in the first 0.5 s after it; the hips are at the release and their lowest after it; the trunk is its greatest lean from vertical; the back ankle is its highest (the heel kick).

| | Front knee at the release (°) | Front knee deepest to +0.5 s (°) | Hips at the release / lowest (m) | Trunk lean (°) | Back ankle highest (m) |
|---|---|---|---|---|---|
| quick + **flick** | 59 → **34** | 64 → **34** | 0.889 / 0.867 → **0.964 / 0.964** | 38 → **28** | 0.30 → 0.30 |
| M4 + flick | 53 → 25 | 63 → 33 | 0.889 / 0.865 → 0.964 / 0.964 | 38 → 28 | 0.30 → 0.32 |
| long + flick | 57 → 32 | 64 → 34 | 0.889 / 0.866 → 0.964 / 0.964 | 38 → 28 | 0.30 → 0.36 |
| quick + **drive** | 59 → 34 | 63 → **45** | 0.889 / 0.868 → 0.964 / 0.933 | 47 → 46 | 0.38 → 0.38 |
| M4 / long + drive | 53 / 57 → 25 / 32 | 63 → 46 / 45 | 0.889 / 0.868 → 0.964 / 0.933 | 47 → 46 | 0.38 → 0.38 |
| quick / M4 / long + **touch** | 59 / 53 / 57 → 34 / 25 / 32 | 63 → **37** | 0.889 / 0.878 → 0.964 / 0.963 | 25 → 25 | 0.29 → 0.29 |

The rig stands with its hips at 0.980 m (idle), and the pocket set is 0.914 m with the knees at 55–57°.

### In the game, at 60 fps (the per-frame log; before → after)

| | Slant (flick, quick from the gun) | Screen (flick, set) | Dig (drive, set) | Fade (touch, from the gun) | Contested (touch, set) |
|---|---|---|---|---|---|
| Front knee at the release (°) | 56 → 53 | 57 → **31** | 58 → **32** | 56 → 52 | 45 → 3 |
| ...at +0.05 / +0.10 s | 56 / 59 → 41 / 35 | | 56 / 59 → 34 / 38 | 54 / 58 → 43 / 34 | 48 / 54 → 3 / 17 |
| Front knee through the finish, +0.15 to +0.5 s (°) | 58–61 → **22–24** | 53–60 → 15–31 | 62–65 → **42–48** | 57–59 → **25–27** | 51–54 → 15–17 |
| Hips at the release / lowest after (m) | 0.910 / 0.870 → 0.920 / 0.920 | 0.880 / 0.870 → 0.970 / 0.970 | 0.890 / 0.870 → 0.960 / 0.930 | 0.910 / 0.880 → 0.920 / 0.920 | 0.880 / 0.880 → 0.950 / 0.950 |
| **Throwing hand clear of the trunk** (frames, mean px) | 20/20 (+14.4) → **20/20 (+20.4)** | 5/31 (−11.0) → 5/31 (−9.5) | 19/19 (+13.4) → 19/19 (+14.4) | 30/31 (+12.7) → **31/31** (+13.0) | 31/31 (+8.7) → 31/31 (+8.6) |
| **Back heel up** (frames) | 14/20 → **14/20** | 16/31 → 16/31 | 16/19 → **15/19** | 13/31 → 13/31 | 20/31 → 20/31 |
| Back foot clear of the front leg | 18/20 → 16/20 | 0/31 → 0/31 | 19/19 → 19/19 | 1/31 → 1/31 | 31/31 → 31/31 |
| QB drawn at the release (px) | 86 → 86 | 80 → 84 | 80 → 84 | 75 → 76 | 80 → 83 |
| Pop meter, worst joint (rad/s) | 172 → 172 | 174 → 174 | 163 → 163 | 109 → 98 | 177 → 177 |

- **The slant's and the fade's release frame is still the drop's set.** Both are thrown on the move from the gun, as an upper-body overlay. Round 12's `FINISH_PLANTED` hands the legs to the finish from the release over the animator's 0.14 s fade, so at the release itself the legs are the drop's set (`qb_set`: 55° of knee, the hips at 0.91 m). They rise to the throw's 35° by +0.10 s and are at 22–27° through the finish.
- **The dig's heel up is 15/19 against 16/19.** The ankle curve is the same to the centimetre; on the landing frame it is 0.20 m against 0.21 m, at the 0.2 m line. It is not a change in the kick.
- **The contested ball's QB in the game is straighter than the clip.** The front knee is 3° at the release and 15–17° through the finish, against 34° and 37° in Blender. The animator's foot lock (`animator.ts` two-bone IK) holds the planted front foot where it landed while his root moves with the sim. On this play that stretches the leg ~30° straighter than keyed, and ~14° on round 12's deeper keys (45 against 59). The taller hips leave the lock less slack, so the leg goes nearly straight.

### The bar (the contested ball, Gronkowski on Lott)

"Seen" means at least half the bar forearm (elbow to fist) is hidden by neither body. The times are before the secure frame.

| | Round 12 (before) | Bar earlier and paired from the clip's start, still banking (first cut) | Bank fixed, turn with the bar (second cut) | **Final** (the turn leads, the shove in 0.16 s) |
|---|---|---|---|---|
| Round 12's count (frames after the pairing, 0.43 → 0.03 s) | **19 / 23** | n/a (paired from 0.83 s) | n/a | n/a |
| **Round 12's window, every frame (0.58 → 0.03 s)** | **20 / 31** (mean 0.61) | 27 / 31 (0.84) | 23 / 31 (0.73) | **27 / 31 (0.84)** |
| ...its first 11 frames (0.58 → 0.41 s) | 1 / 11 | 8 / 11 | 7 / 11 | **11 / 11** |
| The new post (0.75 → 0.03 s) | n/a | 27 / 41 | 26 / 41 | **35 / 41** (0.77) |
| The bar hand drawn before the snap (m; keyed 1.26) | 1.02–1.44 (dipping to 1.02 through the hold) | 0.91–1.35 (down to the man's belt) | 1.11–1.28 | **1.09–1.28** |
| The pair centre to centre, 0.58 → 0.33 s (m) | 0.46–0.63 (one shape early) | 0.56–0.79 | 0.54–0.79 | **0.66–0.81** |

- The first cut's 27/31 matched the final's, but the arm it counted was hanging at the man's belt (0.91 m), dropped by the bank. The second cut put the arm back at the man's chest, where the man's arms covered it in the middle of the post (23/31). The final turns him first and opens the gap sooner, so the arm is seen at chest height.
- In the final, six frames of the post are under half seen:
  - two at the bar's rise, 0.70 and 0.68 s before the ball (0.33 and 0.44 seen), with the man arriving;
  - the last four, 0.09–0.03 s out. Those are the hands leaving the bar to go up for the ball. With his back turned into the man they go up behind his own head and shoulders: 0.44 / 0.22 / 0.33 / 0.00, where round 12 had 0.78 / 0.67 / 0.89 / 0.33.
- The bar itself, from the bar key to the fight (0.75 → 0.10 s), is at least half seen on 35 of its 37 frames.

### The checks

Nothing in `src/sim` or `src/engine` changed. The harnesses were run on this branch (`tools/sim/p13_*`, copies of round 12's) and their output is byte-identical to round 12's logs:

| Harness | Round 12 | Round 13 |
|---|---|---|
| The AI pass game (`outcomes.ts`, 16,200 plays, 14,873 attempts) | 65.8% completion, 7.5 YPA, INT 2.4%, sacks 7.6%, 84.7% of open balls caught | identical |
| Identity (`identity.ts`) | 19 / 20 (Gates vs Lewis, waiting on the owner) | identical |
| Passing identity (`passidentity.ts`) | 9 / 9 | identical |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | identical |
| Clip gates (`build_anims.py`) | 215 / 215 | 215 / 215 |
| `npm run check` | passes | passes (79 files, 758 tests) |
| `e2e/practice.spec.ts` | 7 / 7 | 7 / 7 (port 5586), the browser reproducing the Node hashes |

The determinism golden doesn't move: `tests/` is untouched and passes, with no re-pin.

## The videos and stills

`docs/passing/round13/` (960×540 on Low, frame-true, crf 28):
- **`before/`, `after/`:** `p9-slant-60`, `p9-screen-60`, `p9-dig-60`, `p10-fade-60` (the broadcast camera at 60 fps, from the windup to 1.8 s after the ball) and `p9-contested-60` (to 0.8 s after the ball). The contested `after` is the final cut.
- **`compare/`:** before on the left, after on the right, for each.
- **`stills/`:**
  - `broadcast-qb-finish-before-after.jpg`: the QB, cropped 2× from 0.1 s before the release to 0.4 s after it, before above after: the slant, the dig, the screen and the fade;
  - `broadcast-box-before-after.jpg`: the post-up from 0.72 s before the secure to the secure. Round 12, the second cut and the final;
  - `broadcast-box-close-before-after.jpg`: a tighter crop of the post-up from 0.66 to 0.18 s before the secure, round 12 above the final.

## Watched: an honest critique

I read the 60-fps recordings against their per-frame logs: crops on the QB through the release and finish, crops on the contested pair through the post-up, and the compares side by side.

- **The slant's QB now throws tall.**
  - In round 12's crops he sat into the finish: the hips dropped, the chest folded over the front knee, and the back knee folded under him, like a man sitting down behind the ball.
  - Now he comes up through the ball. The front leg is long and firm under him (22–24° through the finish in the game, from 58–61), the hips ~10 cm higher (0.97 m through the finish, from 0.87), and the chest over the front foot rather than past it (28° of trunk lean in the clip, from 38).
  - The finish's readable parts are unchanged or clearer: the arm through and the hand outside the front hip (20/20 frames, now by 20 px, from 14), and the back heel up behind him (14/20).
  - At 86 px tall, it reads as a quarterback finishing a quick throw and staying on his feet, not crouching.
- **The release frame of a throw on the move is still the drop's set.** On the slant and the fade the legs at the instant the ball leaves are the drop's last stance (55° of knee), and the throw's taller legs fade in over 0.14 s. At 60 fps you see him rise into the finish over two or three frames rather than release tall. A set QB (the dig, the screen, the contested ball) releases at 31–32° in the game.
- **The drive and touch are in range.**
  - The dig's QB now releases at 32° and settles to 42–48° as the weight goes over the front leg: a full throw's follow-through, no longer a squat (62–65°).
  - Touch stays taller, at 25–27° on the fade.
- **On the contested ball the QB's front leg goes nearly straight** (3° at the release, 15–17° after). That is the game's foot lock stretching the planted leg as his root moves, not the clip (34°/37°). From the broadcast camera, behind and above, the front leg is mostly hidden by his body, and in the crops he reads as tall rather than stiff. It is still straighter than a real release.
- **The bar is now on from its first beat.**
  - In round 12's crops, for the first ~0.15 s of the post the two bodies were one shape and the receiver leaned into the man; you couldn't tell an arm was there.
  - Now Gronkowski turns his back into Lott as the bar comes up, and from ~0.58 s out there is a gap with the arm across it, level at Lott's chest, against the turf. Lott is held off it through the post (0.66–0.86 m), and then both go up.
  - The lean that drooped the arm in round 12 is gone: it was the run's banking reading the turn as a curve. The arm now stays at about the height it was keyed (1.09–1.28 m).
  - The forearm is still a dark arm on a dark jersey where it touches him. What reads is the stretch of arm across the green gap, not the contact; nothing was added to the arm to make it pop.
- **What the bar costs.**
  - The post is 0.17 s longer, so the receiver's back is turned into the man and the arm is up from 0.75 s out. That is a deliberate tight end's post-up rather than a late one.
  - The man is held a little further off through the post: 0.66–0.81 m from 0.58 to 0.33 s out, where round 12 had him at 0.46–0.63.
  - The hands' snap up to the ball in the last 0.09 s now goes up behind his own turned head from this camera (1 of 4 frames, from 3 of 4). The catch itself (the secure, the ball) is unchanged.

Would the owner, watching from the broadcast camera, now see a real quick-game release and a real post-up?
- **The QB's end: yes on the finish.** He stays tall and throws through the ball. The release instant on a throw from the gun is still the drop's set, for a beat.
- **The WR's end: the bar is on the man from the start of the post,** across an open gap, at chest height.

These are 960×540 recordings on Low.

## Still open

- **The drop's set** (`qb_set`, 55–57° of knee, the hips at 0.914 m) is the release frame of every throw on the move. A pocket set that deep may itself be deeper than a real QB's (30–45°). It is outside this round's scope: it changes every drop and the set stance.
- **The game's foot lock straightens a planted front leg** when his root moves relative to it: the contested ball's QB releases at 3° against 34° keyed. A lock that lets the planted foot slide a few centimetres before it straightens the knee past ~15° would keep the keyed bend. It is animator work (`src/anim/animator.ts`), not keying.
- **The hands' snap on the box-out** goes up behind his turned head from the broadcast camera, in the last 0.09 s.
- **The bar's contact is a dark forearm on a dark jersey.** The pose now shows the arm across the gap, but where it presses into him it is still low in contrast.
- **Round 12's open items stand:**
  - the camera's tilt and dolly;
  - a throw to his right (the screen's hand is still behind him, 5/31);
  - the QB at ~80–90 px;
  - Gates vs Lewis (identity).
