# The passing game, round 14: released from an athletic set, the planted leg kept, the snatch in view

Round 13 (`PASSING13.md`) left three things for this round:
1. **Throws on the move release from the drop's set.** At the release the legs are the pocket set (`qb_set`, ~55–57° of knee), and they rise into the throw's height over ~0.14 s. He rises into the finish instead of releasing tall.
2. **The animator's foot lock straightens planted legs.** On the contested ball the QB's front leg was 3° at the release against 34° keyed.
3. **The box-out's final snap goes up behind his turned head.** Only 1 of the last 4 frames shows it.

Branch `wip/passing14`, from `cd19c61` (the tip of `claude/m66-polish`, rounds 1–13). Nothing in `src/sim` or `src/engine` changed. Every change is in:
- the keyed clips (`tools/blender/lib/actions.py`, `actions_drop.py`, `actions_pass.py`, `actions_p8.py`; anims rebuilt);
- the animator (`src/anim/animator.ts`);
- the render (`src/render/game/choreo.ts`, `GameScene.tsx`);
- the instruments: `src/render/game/popMeter.ts` (a planted-foot slide meter), `tools/shots/video.spec.ts` (`BTB_PASSING14`) and `tools/sim/p14_*.ts`.

## How it was watched and measured

- **At 60 fps from the default broadcast camera:** 960×540 on Low, on the frame-true clock, from the windup to 1.8 s after the ball (0.8 s on the contested ball). The flags are `BTB_VIDEO=1 BTB_PASSING14=1 BTB_DIAG=1 BTB_WINDOW=1 BTB_VIDEO_FPS=60`.
  - The plays: the slant (thrown on the move from the gun, a flick), the fade (thrown on the move, planted 0.3 s before the release, touch), the AI's 5-step, hitch and throw (`p2-drop5-ai`, a set throw), the dig (a set throw, the drive) and the contested ball (Gronkowski on Lott; the AI QB drifting back in the pocket as he throws).
  - The cut run (`cut-run`, a designed run at 30 fps, the whole play) for the runners, the line and the back seven.
  - The before set is `cd19c61` with only the recording hooks added (a frozen copy, the same hooks and the same meter as the after set).
- **The per-frame log** (rounds 12 and 13's) now has the QB's legs at the millimetre: hips, knees, ankles, the balls of the feet, his root, his sim velocity, each foot's lock (locked, weight, the lock's point), and, after, the animator's hold, give and keyed knees.
  - **Knee flexion** is the angle between the thigh (hip joint → knee) and the shank (knee → ankle), with 0 meaning straight. The rig reads 8° at rest and 23° in the idle stance. The front knee is the left. The hips are the pelvis bone's head above the ground.
  - Scratch `qbknee.py` reads it; `qbslide.py` gives the QB's planted spans; `boxsnap.py` gives the box-out's forearms (round 12's capsule test, both arms, through the snap).
- **Foot slide in play** (`popMeter.ts`, new; on with `?pops`, written into each recording's `.pops.json`):
  - A *planted span* is a foot whose lock is fully on (weight ≥ 0.98). It ends when the foot lifts or the lock's point jumps more than 2 cm (a re-plant).
  - Its *drift* is how far the drawn ball of the foot gets from its first frame along the ground. The clips' own gate is 0.5 cm.
  - A *jump* is a planted foot moving more than 2 cm in one frame.
  - Counts are kept by group: the QB, the line (both sides), the backs and receivers, and the back seven. A root moving over 0.5 m in a frame (a lineup) is skipped.
- **In Blender** (scratch `knees.py`, `exp.py`, `foot.py`): knees, hips and the ball of the foot for every clip frame by frame.

## What was wrong (root causes)

1. **The pocket set was a squat.** `tools/blender/lib/actions.py:246` (at `cd19c61`) keyed `qb_set` with the pelvis 0.085 m under the rig's rest. That gives 55° front and 57° back knee, with the hips at 0.914 m (6.6 cm under his standing height).
   - The throws release at 25–34° with the hips at 0.964 (round 13).
   - A throw on the move is an upper-body overlay whose legs are handed to the finish only at the release (`choreo.ts:1561`, `FINISH_PLANTED`), so the release frame was the set. From there the hips rose 4–5 cm over 0.1 s (in the game: the slant 0.913 → 0.968 m, the fade 0.915 → 0.968).
2. **The slant's drop planted 0.1 s early.** `choreo.ts:1135` paced the drop clip to land its *whole length* on the sim's set. The clips run a frame and a rounding past the plant (`actions_drop.py:106`), so the gun 3-step played 21% fast.
   - The drawn plant came 0.1 s before the sim's. The sim carried him on another 0.53 m while the clip held the planted front foot.
   - The front leg was dead straight (2–5°) for the four frames before the release, the foot dragged 2.7 cm, and then it jumped 0.61 m in one frame when the stance re-planted it (the meter's QB step 0.61 m).
3. **On the contested ball the run's lean rolled the planted foot.** This is the main cause.
   - The animator's lean (`animator.ts` `lean`, the run's pitch on the sim's acceleration) tips the whole body about the hips. That includes the planted foot.
   - The lock kept the foot's *leaned* orientation and its leaned ankle-to-ball offset (`animator.ts:911–917` at `cd19c61`). As the sim slid the QB back at ~1 m/s, the front foot rolled onto its heel: in the log the ankle sat level with the ball of the foot (0.001 m above it, against 0.06 keyed).
   - That pulled the ankle target 5 cm into the turf. The two-bone IK clamps an out-of-reach target to a straight leg (`ik.ts:48`): 3° at the release, 2° at +0.05 s, and 14–18° through the finish, against 34–37° keyed.
   - Two smaller causes added to it:
     - the sim's drift off the planted foot (0.10 m back in 0.15 s);
     - the clip's stride over the front foot, played in place: the sim doesn't step, so the body never travels over the foot it lands.
4. **The box-out's late hands went up on the bar's side.** At the secure the clip took both hands up over the face mask on the man's side (`actions_p8.py:201–202`), and `catchReach` (`choreo.ts:787, :853`) took both hands to the ball.
   - On the contested ball the sim takes it at the receiver's chest, 0.3 m in front and 0.2 m to the outside (away from the man).
   - The bar hand had to leave the man, go up behind his own helmet, and then go across behind his outside arm. From behind the far shoulder, the bar forearm was hidden on 7 of the snap's 9 frames.

## What changed

### The athletic set (`actions.py SET_UP`; the throws, drops and hitch with it)

- **`qb_set` stands in an athletic base.** The pelvis is 0.03 m under the rest, from 0.085 (`SET_UP`, `SET_RISE`). The knees read 37° front and 41° back on the rig (from 55/57), which is roughly 25–40° under the rig's 8° offset (the owner's 25–40°). The hips are at 0.969 m, level with a throw's release (0.964).
  - The ball stays at the chest: the hands and elbow poles go up with the hips. The pocket's own hold overlay is keyed on the idle body at 0.980.
- **The throws start from it.**
  - The load is at the set's height (`THROW_UP[0] = SET_UP`, the hands riding up with it as round 13's `throw_rise` does).
  - The stride lands on a less-flexed front knee (`THROW_UP[1]` −0.06 → −0.05: 34–40° at the landing, from 38–43), so the hips dip only 2 cm into the stride and rise 1.5 cm to the release. Round 13's set was 5 cm lower than the stride, so the hips there only rose.
  - The release itself is unchanged (25–34°, 0.964 m).
- **The fade-away keeps its motion relative to the set** (`actions_pass.py FADE_UP`). It drops 1.5, 3.5, 2.5 and 3.5 cm from the set, as round four keyed it from the old set. Kept absolute, it sat down 6.5 cm in two frames.
- **The hitch dips onto its reach** (`actions_drop.py`, −0.04 m at mid-step, from a 1.5 cm rise). On the taller set the rise had the front leg dead straight (0.3°) as it reached for its landing. Now the reach is round two's: 13–23° at the landing, the hips at 0.929.
- **Long-stride drops keep round two's depth through their steps** (`LONG_STRIDE`, over 0.85 m a step: from under center and the gun's 5-step). They rise into the set over the last step. Taller hips over-reached the 3-step's 1.1 m strides from under center (a planted foot slid 1.86 cm, against the 0.5 cm gate).
- **215 of 215 clip gates pass.** The gun 5-step's slide is 0.00, with 0.50 on the first cut.

### The drop lands on the sim's set (`actions_drop.py` `set` event; `choreo.ts startDrop`)

- Each drop clip carries its plant's frame (`set`), and the render paces the clip so that frame lands on the sim's set:
  - from the snap: the plant over the time from the snap to the set;
  - after a fake: the plant less the catch, over the drop's time.
- The slant's drawn plant now lands on the sim's, and the front foot plants 0.08 s before the release with the sim nearly stopped.

### A planted foot keeps the clip's knee (`animator.ts`: `AnimInput.holdFeet`, `holdOver`, `lockFoot`)

These apply to the QB only: `GameScene` sets `holdFeet` for `s.qb`, and every other player's lock is exactly as it was. A first cut applied the hold to everyone, and the line's and the back seven's per-frame foot jumps rose (on the fade: the line 94 → 154, the back seven 265 → 347), so it was narrowed to the one player whose planted one-shots the sim slides around.

- **His planted feet stay flat under the leans.** Each frame the foot's world rotation, its ankle-from-ball offset and the ball's height are taken as the clips keyed them, *before* the run's pitch and the contact lean tip the body. The lock puts the ankle there. This was the contested ball's straight leg.
- **The body is held over a planted foot in his one-shots** (the throws and their finishes; not his stances or the run's cycle):
  - When the leg would be straighter than the clip's knee less `KNEE_GIVE` (5°), the body is drawn back over the foot along the ground, up to `ROOT_GIVE` (0.12 m) off the sim's spot.
  - It takes only as much as is explained by the sim's drift off the foot since it planted, plus the one-shot's own stride onto a foot *ahead* of him (its travel since the plant, which in-place clips don't make).
  - It skips a foot that only the hips' height keeps out of reach, where moving along the ground can't help.
  - It is let go over `ROOT_OUT` (0.25 s).
- **Past the hold, the planted point gives.** It follows the clip's foot by just enough to keep that knee, and by no more than the drift the hold didn't take (spent as it gives). It never moves where moving doesn't bring the foot into reach.
- `KNEE_GIVE`, `ROOT_GIVE` and `ROOT_OUT` are commented with where they came from. The meter and the log read the lock through `footLockOf`, `give`, `slid` and `keyedKnee`.

### The box-out snatched with the outside hand (`actions_p8.py box_out`, `AWAY_HAND`; `choreo.ts catchReach`, `BOX_ONE`)

- The bar stays on the man until the ball is in his hands. The outside hand (away from the man) snatches it, and the bar hand comes off him to cover it as it's pulled in and chinned.
- `catchReach` takes the outside hand alone to the sim's ball. If the ball comes 0.12 m or more onto the man's side of his middle, both hands go, as before (`BOX_ONE`).
- From the coaching: catch it away from the defender, keep the bar until the ball is there.

## The numbers

### In Blender (each clip's keyed legs; before → after)

| | Front knee (°) | Back knee (°) | Hips (m) |
|---|---|---|---|
| `qb_set` | 55.0 → **37.0** | 57.4 → **40.7** | 0.914 → **0.969** |
| `qb_throw_quick`: the stride's landing (f6) / the release (f8) | 43 / 34 → 40 / 34 | 61 / 51 → 59 / 51 | 0.939 / 0.964 → 0.949 / 0.964 |
| `qb_throw` (f9 / f11) | 38 / 25 → 34 / 25 | 61 / 48 → 59 / 48 | 0.939 / 0.964 → 0.949 / 0.964 |
| `qb_throw_long` (f12 / f14) | 41 / 32 → 37 / 32 | 53 / 27 → 50 / 27 | 0.939 / 0.964 → 0.949 / 0.964 |
| `qb_throw_fade`: the load (f2) / the release (f9) | 61 / 59 → 45 / 43 | 76 / 62 → 64 / 46 | 0.900 / 0.889 → 0.955 / 0.944 |
| `qb_hitch`: the landing (f4 / f5) | 13 / 23 → 13 / 23 | 53 / 66 → 53 / 66 | 0.928 → 0.929 |
| `qb_drop_gun3`: the plant (f18) | 54 → 35 | 67 → 53 | 0.914 → 0.969 |

### In the game, at 60 fps (the per-frame log; before → after)

| | Slant (on the move) | Fade (on the move) | Hitch and throw (set) | Dig (set) | Contested (set, drifting back) |
|---|---|---|---|---|---|
| **Front knee at the release (°)** | 53 → **37** | 52 → **36** | 29 → 31 | 32 → 31 | **3 → 40** |
| ...over the last 0.1 s before it | 2–55 → 35–37 | 52–54 → 36 | 29–46 → 31–41 | 31–46 → 31–41 | 3–44 → 37–43 |
| Frames under 10° in the 0.3 s before it | **4 → 0** | 0 → 0 | 0 → 0 | 0 → 0 | 2 → 0 |
| ...at +0.05 / +0.10 s | 42 / 33 → 34 / 33 | 43 / 34 → 34 / 34 | 26 / 25 → 29 / 28 | 35 / 38 → 30 / 33 | **2 / 16 → 2 / 17** |
| Front knee through the finish, +0.15 to +0.5 s (keyed: flick 34, touch 37, drive 45) | 22–24 → **30–32** | 25–27 → **32–34** | 22–24 → 27–29 | 42–48 → 38–43 | **14–18 → 32–35** |
| **Hips across the release, −0.15 to +0.15 s (range)** | **5.5 → 0.1 cm** | **5.3 → 0.4 cm** | 3.8 → 1.7 cm | 3.8 → 2.2 cm | 4.0 → 2.6 cm |
| ...from the release to +0.10 s | +3.9 → +0.1 cm | +3.9 → −0.1 cm | +0.2 → +0.2 | −1.0 → −1.0 | +2.1 → +2.1 |
| The hold over the feet, at most (m) | 0 | 0.054 | 0.057 | 0.058 | 0.12 |

- **The release on the move no longer rises.** The slant's and the fade's release frames are still the set's legs (the overlay, round 12's hand-over), but the set is now the release's height. The hips move 1–4 mm across the release instead of 5 cm.
- **The contested release.** The front knee is 40° at the release (keyed 34), but **straight for two frames after it** (2° at +0.05, 17° at +0.10). As he comes up into the touch finish his hips rise 2 cm (0.952 → 0.973 m) directly over the planted foot, with the ankle at its keyed height. That is out of reach straight down, which the hold rightly skips, and nothing else in the lock can fix it. The finish then holds 32–35° against 34–37 keyed.
- **The contested ball's back leg.** At the throw's start his back foot was locked 15 cm *off the turf* in the before (the stance's lock re-planted while it was lifting; knee 62–65°, the foot floating). Now it is on the turf at the clip's height, and the leg is straight (2–13°) for the 0.15 s before the release: his yaw turned 30° on the planted foot and left it 0.37 m out to the side. The hitch and throw's back knee at the release reads 29 against 54 for the same reason (the taller set, and the foot on the ground).

### Foot slide (the pop meter's planted spans; before → after)

The QB, from the per-frame log (`qbslide.py`, the meter's rules):

| | Slant | Fade | Hitch and throw | Dig | Contested |
|---|---|---|---|---|---|
| Planted spans drifting over 0.5 cm | 1 (2.7 cm: the drag into the jump) → **0** | 0 → 0 | 0 → 1 (1.0 cm) | 0 → 1 (0.7 cm) | 1 (0.6 cm) → **3** (1.0, 3.9, 3.0 cm) |
| The QB's largest one-frame foot move (m) | **0.61 → 0.06** | 0.14 → 0.13 | **0.41 → 0.10** | 0.11 → 0.17 | 0.50 → 0.50 |
| QB foot jumps (> 2 cm in a frame) | 3 → 2 | 4 → 4 | 3 → 3 | 4 → 4 | 14 → 13 |

- **The contested ball's new slides are the planted points giving** as the sim walks him off after the finish (+0.85 s): the front foot 3.6 cm and the back 3.0 cm over three frames.
  - In the before the front toe was dragged up off the turf and then both feet jumped, 0.32 m and 0.21 m in one frame, as the stance re-planted them. Now they jump 0.18 m and 0.13 m.
  - The 1.0 cm before the release is the back leg's IK miss on the straight back leg (above).
- **Everyone else is identical, to the frame.** Every play's line, back seven, backs and receivers have the same spans, slides and jumps before and after (`holdFeet` is the QB's alone).
- **The cut run (30 fps, the whole play):** identical except the QB's handoff span, 1.078 → 1.107 m.
- **The pop meter doesn't regress.** The worst joint (rad/s) before → after: slant 172 → 172, fade 98 → 98, hitch and throw 174 → 174, dig 163 → 163, contested 177 → 177, cut run 87 → 87. The p99 is the same, and spikes 129/156/174/152/170/17 → 128/156/173/152/171/17.
- **Pre-existing, and not this round's:** the meter shows a lot of planted-foot slide across the field on every play. On the contested ball, 55 of the back seven's 152 spans drift past 2 cm and there are 362 one-frame jumps.
  - The sources: re-plants as a foot's lock source changes (stance, gait, one-shot), a stance lock held while the sim drifts the player, and one-shots whose travel doesn't match the sim.
  - The worst single spans are 1.4–1.7 m, a back-seven player in a one-shot carried off by the sim.
  - "Still open" has it.

### The box-out's snap (the contested ball; `boxsnap.py`, both forearms, elbow to fist)

| | Before | After |
|---|---|---|
| **The snap (0.12 s out to the secure): frames with both forearms at least half seen** | **2 / 9** | **9 / 9** |
| ...at least one forearm | 9 / 9 | 9 / 9 |
| ...both hands at least half seen | 6 / 9 | 8 / 9 |
| ...mean share of the forearms seen | 0.65 | **1.00** |
| The post (0.75 → 0.13 s out): both forearms half seen | 34 / 36 (0.91) | 34 / 36 (0.91) |
| In the before's last 4 frames, the bar forearm hidden by | his own helmet, trunk and outside arm | (seen) |

### The checks

Nothing in `src/sim` or `src/engine` changed. The harnesses were run on this branch (`tools/sim/p14_*`, copies of round 13's), and their output is byte-identical to round 12's logs (which round 13 matched):

| Harness | Round 12/13 | Round 14 |
|---|---|---|
| The AI pass game (`outcomes.ts`) | 16,200 plays, 65.8% completion, 7.5 YPA, INT 2.4%, sacks 7.6% | identical |
| Identity (`identity.ts`) | 19 / 20 | identical (19 / 20) |
| Passing identity (`passidentity.ts`) | 9 / 9 | identical |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | identical |
| Clip gates (`build_anims.py`) | 215 / 215 | 215 / 215 |
| `npm run check` | passes | CHECK |
| `e2e/practice.spec.ts` | 7 / 7 | E2E |

The determinism golden doesn't move: `tests/` is untouched and passes, with no re-pin.

## The videos and stills

`docs/passing/round14/` (960×540 on Low, frame-true, crf 28):
- **`before/` and `after/`:**
  - the broadcast camera at 60 fps from the windup: `p9-slant-60`, `p10-fade-60`, `p2-drop5-ai-60` (the hitch and throw), `p9-dig-60` and `p9-contested-60` (to 0.8 s after the ball);
  - `cut-run` at 30 fps, the whole play;
  - each with its `.pops.json`, which now has the planted-foot slide by group.
- **`compare/`:** before on the left, after on the right, for each.
- **`stills/`:**
  - `broadcast-qb-release-before-after.jpg`: the QB cropped 2× from 0.15 s before the release to 0.35 s after it, before above after, on the slant, the fade, the hitch and throw, and the contested ball;
  - `broadcast-box-snap-before-after.jpg`: the contested pair from 0.14 s before the secure to just after it, before above after.

## Watched: an honest critique

I watched the 60-fps recordings against their per-frame logs, the crops through the release, and the compares side by side.

- **The QB stands in the pocket like a quarterback now.**
  - In the before, on the fade and the slant, his set was a wide, low crouch: knees out over his feet, his seat down, a lineman's stance with a ball in it. He came up out of it as the ball left.
  - Now he's tall over a shoulder-width base with his knees soft, and the ball goes from a body already at its height. In the crops the release frame and the frames after it are the same height (the fade's hips move 4 mm, the slant's 1 mm).
  - Sharper: on the slant the drop no longer plants early, so the four frames before the ball where his front leg was a straight stick, and the foot that then jumped 0.6 m to catch up, are gone.
- **Through the finish his front leg holds its bend.** The slant's front knee holds 30–32° and the fade's 32–34° (keyed 34), from 22–27°. On the contested ball it is 32–35° from 14–18°. At 80 px this reads as a flexed, braced front side rather than a post.
- **The contested release is right at the release frame and wrong for the next two.** The release is 40°, from 3°, which was the main defect. But as he comes up into the touch finish his hips rise straight over the planted foot, and for two frames (+0.03 to +0.07 s) the leg is straight again. At 60 fps from behind and above it's a flick of a stiff leg as the arm comes through; at 30 fps it would be one frame. The fix would be in the clip, with the touch finish's hips less high over a set QB's front foot (or the foot rolling to its toe). I didn't re-key it this round.
- **The contested ball's back leg at the throw's start is straight, where it floated.**
  - Before, his back foot hung 15 cm off the turf for 0.25 s at the start of the throw. That was the lock re-planting a foot that was lifting while his body turned 30°. You couldn't see it from the broadcast camera; his body hides that foot.
  - Now the foot is on the ground and the leg is straight (2–13°) for 0.15 s. From this camera it reads as a push off the back foot. It is still not the keyed leg.
- **The hold costs a few centimetres of slide on the contested ball, at the walk-off.** As the sim walks him away after the finish, his planted feet give 3–4 cm over three frames before the stance re-plants them. Before, the front toe was dragged up off the turf and then both feet jumped 0.2–0.3 m in a frame. It's a better trade but not a clean one. I couldn't see either from the broadcast camera; they're in the log.
- **The box-out reads as a contested catch by a big man.**
  - In the before, the last tenth of a second was his outside arm out to the ball and his bar arm gone: it went up behind his helmet and across behind his outside arm, and the catch looked one-handed with the other arm nowhere.
  - Now the bar stays on Lott's chest to the catch, seen every frame. The outside hand snatches it at arm's length, and his head turns back over his outside shoulder to it. Then the bar hand comes off the man and covers the ball into the chin.
  - It is a one-hand snatch at the moment of the catch. A coach might want two hands on a contested ball. The sim's catch point (at his chest, out to the side away from the man) is where a boxed-out ball goes, and the snatch away from the defender is the technique for it.
- **Everyone else is unchanged by construction.** The hold is the QB's. The pop meter's worst joint and spikes are the same on every play.
- **Not seen from this camera:** at 80 px the knee angles are a few pixels of shin. What does read is the height (the fade's set is visibly less of a crouch in the compare) and the stiff-leg flicks.

## Still open

- **The touch finish's hips over a set QB's front foot.** On the contested ball the front leg goes straight for two frames after the release, because the hips rise 2 cm directly over the planted foot. The clip, `actions_p10.py` touch, and the throw's release keys could keep the hips a centimetre or two lower over the front foot, or roll the front heel up as the weight goes over.
- **The throw's start re-plants a turned back foot.** When the sim turns the QB on a planted foot (30° on the contested ball) and the throw starts, the lock re-plants the foot where the throw clip has it. Before that was 0.5 m off; now the leg is straight there for 0.15 s.
- **Planted-foot slide across the field (pre-existing; the new meter).** The back seven, the line, and the backs and receivers slide and re-plant often. On the contested ball the back seven drift past 2 cm on 55 of 152 spans with 362 one-frame jumps, the line on 22 of 107, the backs and receivers on 31 of 56. The worst single spans are 1.4–1.7 m (a one-shot carried off by the sim). `holdFeet` was tried on everyone and narrowed to the QB, because it raised the line's and the back seven's jumps. A pass over the lock for everyone is its own round:
  - re-plants on source changes;
  - stance locks under drift;
  - one-shots whose travel the sim doesn't make.
- **The throws' stride is still played in place.** The sim doesn't step into the throw. The hold takes up to 0.12 m of the stride onto the front foot, and a longer stride (the drive, 0.4 m) still turns the leg about the planted foot rather than carrying the body over it.
- **Round 13's open items stand:**
  - the bar's dark forearm on a dark jersey where it meets him;
  - the camera's tilt and dolly;
  - a throw to his right;
  - the QB at ~80–90 px;
  - Gates vs Lewis (identity).
