# The passing game, round 12: the finish that reads, the bar on the man, the slower zoom

The owner: "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 11 (`PASSING11.md`) left three visible gaps, all measured from the 60-fps broadcast recordings, which this round took in the brief's order:
1. the QB's finish reads as body language, not mechanics (he's ~75–90 px tall at the release);
2. the box-out's bar is only partly visible from the broadcast camera;
3. the slant's zoom is the fastest part of the camera's move (~67°/s of lens).

Branch `wip/passing12`, from `935c447` (the tip of `claude/m66-polish`, rounds 1–11). Nothing in `src/sim` or `src/engine` changed: every change is in the render (`src/render/game`), the keyed clips (`tools/blender`) and the recording hooks.

## How it was watched

- **At 60 fps from the default broadcast camera**, 960×540 on Low, on the frame-true clock, from the windup to 1.8 s after the ball (`BTB_VIDEO=1 BTB_PASSING12=1 BTB_DIAG=1 BTB_WINDOW=1 BTB_VIDEO_FPS=60`, `tools/shots/video.spec.ts`): the slant, the out, the dig, the go, the RB screen and the fade, and the contested ball (Gronkowski on Lott, to 0.8 s after the ball). The before set is a frozen copy of `935c447` with only the round-12 recording hooks added (the same plays, the same keys).
- **The per-frame log now has the whole figure** (`video.spec.ts diagFrame`, round 12): the QB's pelvis, chest, neck, head, both arms (shoulder, elbow, wrist) and both legs (hip, knee, ankle), and the same for the catcher and the man he's contesting the ball with, each bone's joint in world metres, next to the camera's position, look and lens. A scratch script (`diag.py`) measures from it, frame by frame:
  - the camera's pan (°/s of look), zoom (° of lens/s) and dolly (m/s), central differences over ±3 frames (as round 11's `cam.py`);
  - the QB's drawn height at the release (helmet to the ground under his lower foot) and how long he stays in the frame after it (head, throwing hand and both feet inside it);
  - **the finish's silhouette**: the throwing hand's clearance from the trunk's silhouette (the convex outline of his shoulders, hips, neck and chest as projected, grown by 0.10 m of pads and hips, the hand by 0.05 m), in px; "clear" is more than 3 px (a hand's width at this size), counted over the first 0.5 s after the release while he's in the frame; the back foot clear of the front leg likewise; and **the back heel up** (the back ankle more than 0.2 m off the ground, against ~0.1 planted);
  - **the bar's visibility**: the share of the bar forearm (elbow to the fist) not hidden from the eye by either body (capsules round each trunk, head, arm and thigh), counted over the post-up (the box clip's bar key to the hands' snap, 0.58 to 0.03 s before the secure);
  - the receiver's drawn height at the catch.
- **In Node, on the game's own camera code** (`tools/sim/p12_cam.ts`, a copy of `p11_cam.ts` that also prints the eye against the QB in his own frame at the release, for the clips' previews): the camera was designed here and the recordings confirmed it. `tests/broadcast-cam.test.ts` pins it.
- **In Blender**, scratch scripts as `tools/blender/preview_contest.py`:
  - `qbfin.py`: each finish from its release frame, rendered from the broadcast eye as `p12_cam.ts --rel` gives it (behind and to one side of the QB, 7 m up), with the same silhouette measure from the bones;
  - `boxbar.py`: the box-out posed (the box clip over the run), turned as `choreo.ts boxPost` turns him, the man where the game drew him (from the before recording's log), the camera where it was, the bar's visibility by ray casts.

## What was wrong (root causes)

1. **The finishes were keyed for the side view, and the slant's QB stood still through his.** From the broadcast camera the QB is seen from behind and above (the eye 4–8 m behind him, 2–8 m to one side, 7 m up). Measured at 60 fps:
   - `tools/blender/lib/actions_p10.py:63` at `935c447`: the flick's throwing hand finished at (0.10, −0.44, 1.10), 10 cm to the left of his middle, at his own belt: inside his silhouette from behind. On the slant the hand was clear of the trunk on 5 of the first 16 frames after the release (mean +3 px); on the RB screen (a throw to his right, the camera behind his right shoulder) on 11 of 31 (mean −1 px). The drive's hand (`:70`, 0.14 m out, outside the front thigh in the side view) was clear on the out, the dig and the go, but by 6–8 px.
   - `:65, :147`: the back foot came up 7 cm (`Steps(height=0.07)`) and landed level with the front one; the back heel was never more than 0.2 m off the ground on any of the six throws (0 frames).
   - `:120`: the glove arm's elbow pole (0.7, 0.3, 1.0) kept the elbow at his ribs, inside the outline.
   - `src/render/game/choreo.ts:1489, :1512` at `935c447`: a throw begun on the move (the quick game from the gun: the key pressed in the drop, `running`) is an upper-body overlay (`THROW_MASK`), and its finish too (`continueAs` over the mask). The slant's QB planted before the ball was out, so through the whole finish his legs were the drop's last stance, frozen: no weight transfer, no back foot (the log: both feet still from 0.07 s before the release to the end).
   - `:65`: the flick held its finish to 0.26 s after the release; on the slant the camera had him out of the frame by 0.25 s.
2. **The bar went up over the man, not onto him.** `tools/blender/lib/actions_p8.py:186, :188` at `935c447` (round 11): the bar's hand at 1.50 m and the elbow pole at 1.80 m. In the game's own log on the contested ball, the hand was drawn 1.57 m up with the elbow 1.68 m up, while the man's chest was at 1.3 m, behind the receiver's near shoulder (132–153° off his facing) and 0.36–0.74 m off him: from behind and above the arm read as a raised elbow over the man's shoulder, the forearm "on" him in the air above his pad. And through the post's first 0.25 s the man was 0.36–0.4 m off the receiver, behind his near shoulder, so the two bodies were one shape on screen with the arm between them: `choreo.ts:288` at `935c447` built the shove up over the whole post (from the post + 0.08 s to 0.1 s before the ball), so the man was knocked off only as the hands went up. The forearm was at least half seen on 11 of the post-up's 23 frames.
3. **The zoom had less than 0.55 s to close ~27° of lens, and couldn't start earlier.** `src/render/game/broadcastCam.ts:527` at `935c447`: the lens ran from the release to `ZOOM_SETTLE` (`:120`, 0.18 s) before the catch, on a ramp whose top speed is 1.43× its mean (`ZOOM_RAMP` 0.3): on the slant ~27° (48.7° at the release, with the push, to 21.2°) in 0.53 s, 67°/s at the peak. Starting it earlier pushed the QB out of the bottom of the frame: the pocket's look is far downfield (`:475`, the catch framing's look 0.4 m up at the spot), so he's drawn in the bottom fifth (his feet at 495 of 540 px at the release), and a zoom about the frame's middle takes him out once the lens has closed by ~15%. And the eye went only 35% of the way to the catch framing on a quick throw (`EYE_SHARE_MIN`, `:146`), so the lens did the rest.

## What changed

### The finish, keyed to read from behind (`tools/blender/lib/actions_p10.py`; `choreo.ts`)

- **The throwing hand clear of the body**, within what a QB does ("thumb to the opposite pocket", the hand finishing outside the front thigh):
  - the flick's hand finishes outside the front hip, the arm longer: (0.28, −0.50, 1.00), from (0.10, −0.44, 1.10);
  - the drive's outside the front knee: (0.32, −0.52, 0.82), from (0.14, −0.46, 0.86);
  - the hips 4–6° more round (the flick 26 → 31°, the drive 34 → 39°), the chest a little more turned.
- **The glove elbow pulled back past the hip** on the flick and the drive (its pole (0.8, 0.5, 1.0), the hand 4–6 cm further back): the front shoulder opening to the target shows as the glove elbow out behind him. (Touch keeps round ten's glove arm: tried, both elbows flared read as a "W", a pose, not a throw.)
- **The back heel kicked up as the hip drives through** (`kick`, new): between its lift and its landing the back foot is held up behind him, its heel turned up (75° on the flick, 80° on the drive, 65° on touch), the ball of the foot 0.10–0.20 m up and moving forward, for 0.10–0.14 s, then down onto its plant (the flick's lands at 0.34 s, round ten's at 0.20; the drive's at 0.36 s, 0.25 m past the front foot as before). The quick game's "flamingo"; on the drive it's the back leg swinging through high.
- **The flick held 0.1 s longer** (to 0.36 s after the release; its stand by 0.66 s).
- **A throw begun on the move finishes with the legs once he's planted** (`choreo.ts`, `FINISH_PLANTED`): as the ball leaves, a QB moving slower than 0.8 m/s whose throw is the upper-body overlay also plays its finish as the full-body clip from the release frame, under the overlay (the arms stay where they are). The drop's last stance and the throw's are within ~0.1 m a foot (measured in Blender), and the back foot lifts at once, so the hand-over doesn't show at 60 fps (the recordings' pop meter: the same worst joint speed, 172 rad/s, before and after on the slant).
- 215 of 215 clip gates pass (the finishes 1–3 frames longer; the slide and clearance gates on every frame).

### The bar on the man (`tools/blender/lib/actions_p8.py box_out`; `choreo.ts boxPost`)

- **The bar level, planted on the man's near shoulder**: the bar's hand at 1.26 m (the game draws it ~0.07 m above its key) out to the side and a little back (0.52, 0.22), the elbow pole out wide at his own shoulder height (1.0, −0.1, 1.34), the fight key a few centimetres further in. The arm crosses the gap between the two bodies level, in profile from behind, where round eleven's rose over the man as a raised elbow. A first cut at 1.36 m put the hand at the man's face mask in the recording (`stills/broadcast-box-before-after.jpg` has round 11, the cut at 1.36 and the final).
- **The shove lands with the bar** (`BOX_SHOVE_IN`, 0.22 s from just after the post, where round ten's built up over the whole post): the man is knocked off the receiver's shoulder as the bar lands and held off, so the gap the arm crosses is open through the post-up, not only as the hands go up. Render only, as before (the sim's box-out, its contest and the boxed man's tackle are unchanged).
- The turn (`BOX_BEHIND`, the man behind the near shoulder) is unchanged. Tried in Blender: turning him so the man is straight behind him (180°) hid the bar behind his own back from the broadcast eye; 150° was no better than 125° once the man was shoved.

### The slower zoom (`src/render/game/broadcastCam.ts`)

- **The push on the passer tilts the shot down onto him** through the windup (`PUSH_LOOK_DOWN`: the look 4 m lower, ~4° of tilt at the pocket's distance), so he's in the middle third of the frame as he lets it go (the slant's feet ~430 px down at the release, against ~495), and the tilt comes back up with the zoom. The zoom can then run longer before he leaves the frame.
- **The lens starts 0.15 s before the release** (`ZOOM_LEAD`) and **settles 0.08 s before the catch** (`ZOOM_SETTLE`, 0.18), on a flatter ramp (`ZOOM_RAMP` 0.3 → 0.25: the top speed 1.33× the mean).
- **More dolly, less lens on a quick throw**: the eye goes 80% of the way to the catch framing on a ball in the air 0.62 s or more (`EYE_SHARE_MIN`, 0.35), so the slant's lens closes ~24° instead of ~27° for a catch framed as large; its peak dolly 10 → 17 m/s. A ball in the air under 0.5 s (the RB screen) keeps round ten's 0.35 (`EYE_SHARE_SCREEN`): its catch is beside the QB, and the eye going in on it took him out of the frame just after the catch (0.82 → 0.52 s in a first recording; 0.78 with it).
- Tried and dropped (in Node): releasing the tilt on the pan's clock (the slant's QB out at 0.28 s, the out's pan 31°/s); a full eye share on the slant (24 m/s of dolly, the zoom still 61°/s with the round-11 timing); only lengthening the zoom (60°/s).

## The numbers

### The camera and the QB, at 60 fps from the broadcast camera (before → after)

From the recordings' per-frame log (`diag.py`). The QB is drawn from the helmet to the ground; "in frame" is his head, throwing hand and both feet.

| | Slant (0.70 s) | Out (1.20 s) | Dig (0.78 s) | Go (1.32 s) | RB screen (0.45 s) | Fade (1.52 s) |
|---|---|---|---|---|---|---|
| **Peak zoom (° of lens/s)** | **67 → 44** | 55 → 42 | 70 → 42 | 51 → 37 | 55 → 51 | 44 → 34 |
| Peak pan (°/s) | 31 → 30 | 38 → 30 | 22 → 22 | 22 → 19 | 38 → 37 | 23 → 19 |
| Peak dolly (m/s) | 10.2 → 17.2 | 15.9 → 21.9 | 10.0 → 19.8 | 20.6 → 23.3 | 10.0 → 8.8 | 22.4 → 19.3 |
| **QB in the frame to (s after the release)** | **0.25 → 0.32** | 0.42 → 0.47 | 0.28 → 0.30 | 0.45 → 0.47 | 0.82 → 0.78 | 0.50 → 0.57 |
| QB at the release (px) | 90 → 86 | 86 → 82 | 83 → 80 | 85 → 80 | 83 → 80 | 79 → 75 |
| Receiver at the catch (px) | 108 → 114 | 116 → 121 | 112 → 117 | 126 → 131 | 84 → 89 | 141 → 140 |
| Lens at the catch (°) | 21.2 → 24.6 | 19.4 → 24.0 | 18.9 → 23.1 | 19.8 → 23.3 | 31.1 → 28.9 | 21.9 → 21.9 |

### The finish's silhouette, the same recordings (before → after; frames of the first 0.5 s after the release with the QB in the frame)

| | Slant (flick) | Out (drive) | Dig (drive) | Go (drive) | RB screen (flick, to his right) | Fade (touch) |
|---|---|---|---|---|---|---|
| **Throwing hand clear of the trunk** | **5/16 → 20/20** | 22/26 → 29/29 | 14/18 → 19/19 | 25/28 → 29/29 | 11/31 → 5/31 | 31/31 → 30/31 |
| ...its mean clearance (px) | +3.2 → +14.4 | +6.7 → +16.4 | +6.1 → +13.4 | +8.2 → +16.5 | −1.3 → −11.0 | +16.5 → +12.7 |
| **Back heel up** | **0/16 → 14/20** | 0/26 → 15/29 | 0/18 → 16/19 | 0/28 → 15/29 | 0/31 → 16/31 | 0/31 → 13/31 |
| Back foot clear of the front leg | 16/16 → 18/20 | 14/26 → 19/29 | 13/18 → 19/19 | 13/28 → 18/29 | 1/31 → 0/31 | 31/31 → 1/31 |

### The bar (the contested ball, Gronkowski on Lott)

From the recordings' per-frame log (`diag.py`): the post-up is the box clip's bar key to the hands' snap (0.58 to 0.03 s before the secure; 23 frames at 60 fps). "Seen" is the share of the bar forearm, elbow to fist, that neither body hides from the eye.

| | Round 11 | First cut (the hand at 1.36 m, round ten's shove) | Final (1.26 m, the shove with the bar) |
|---|---|---|---|
| **Frames with the forearm at least half seen** | **11 / 23** | 12 / 23 | **19 / 23** |
| Mean share of the forearm seen | 0.55 | 0.48 | 0.74 |
| Where the hand is when it's seen | over the man's shoulder, 1.57 m up, the elbow 1.68 m (a raised arm) | at the man's face mask | on his near shoulder and upper chest, the arm level across the gap |
| The man off the receiver through the post's first 0.25 s | 0.36–0.40 m (one shape on screen) | the same | knocked off from the bar's contact |

The geometry, from the same log: the man ends behind the receiver's near (right) shoulder, 132–153° off his facing, and the camera is behind his other shoulder (127–144°), so the line between the two is across the screen (within ~15° of square to the camera's line, `tools/sim/p12_box.ts`): the bar can be seen in profile when it's level and the gap is open, and not when it goes up and over.

### The same camera in Node (`p12_cam.ts`, every recorded pass; before → after)

| | Slant | Out | Dig | Go | Post | Corner | Cross | Screen | Contested | Fade |
|---|---|---|---|---|---|---|---|---|---|---|
| Flight (s) | 0.71 | 1.21 | 0.81 | 1.33 | 1.32 | 1.49 | 1.15 | 0.47 | 1.61 | 1.55 |
| Peak zoom °/s | 67 → 44 | 55 → 42 | 71 → 43 | 51 → 37 | 52 → 38 | 44 → 33 | 64 → 45 | 55 → 52 | 42 → 33 | 44 → 34 |
| Peak pan °/s | 30 → 29 | 38 → 30 | 22 → 22 | 21 → 18 | 20 → 15 | 23 → 20 | 28 → 22 | 39 → 38 | 28 → 23 | 23 → 19 |
| Peak dolly m/s | 10.3 → 17.2 | 16.0 → 22.0 | 10.1 → 19.9 | 20.7 → 23.4 | 20.8 → 24.0 | 25.1 → 22.9 | 14.1 → 22.1 | 10.2 → 9.1 | 25.0 → 20.7 | 22.5 → 19.4 |
| QB in frame to (s after) | 0.25 → 0.32 | 0.40 → 0.47 | 0.28 → 0.30 | 0.42 → 0.47 | 0.45 → 0.47 | 0.43 → 0.48 | 0.38 → 0.43 | 0.57 → 0.55 | 0.45 → 0.53 | 0.52 → 0.55 |
| QB at the release (px, ground to 1.95 m) | 98 → 94 | 99 → 93 | 96 → 91 | 99 → 94 | 96 → 91 | 99 → 94 | 98 → 93 | 97 → 94 | 101 → 95 | 95 → 91 |
| Receiver at the catch (px) | 140 → 148 | 132 → 137 | 133 → 140 | 131 → 134 | 131 → 134 | 125 → 125 | 133 → 138 | 117 → 124 | 146 → 146 | 149 → 147 |

### The checks

Nothing in `src/sim` or `src/engine` changed, so the sim is the same to the bit; every harness was run again on this branch (the `tools/sim/p12_*` copies) and gives round 11's numbers exactly:

| Harness | Round 11 | Round 12 |
|---|---|---|
| The AI pass game (`outcomes.ts`, 60 a cell, 14,873 attempts) | 65.8% completion, 7.5 YPA, INT 2.4%, sacks 7.6%, 84.7% of open balls caught | the same |
| Identity (`identity.ts`) | 19 / 20 (Gates vs Lewis, waiting on the owner) | 19 / 20, the same margins |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Clip gates (`build_anims.py`) | 215 / 215 | 215 / 215 |
| `npm run check` | passes | passes (79 files, 758 tests) |
| `e2e/practice.spec.ts` | passes | passes, 7 / 7 (port 5563) |

- **The determinism golden doesn't move** (nothing in the sim changed; `tests/` has it and it passes unchanged; no re-pin).
- `tests/broadcast-cam.test.ts`: the slant's zoom under 45.5°/s on its measure (44), the QB in the frame past 0.3 s after the release (0.32), the receiver over 140 px at the catch (148), the pan under 35°/s; the out's zoom under 45.5°/s and the QB in the frame past 0.4 s.

## The videos

`docs/passing/round12/` (960×540 on Low, frame-true, crf 28):
- **`before/`, `after/`**: `p9-slant-60`, `p9-out-60`, `p9-dig-60`, `p9-go-60`, `p9-screen-60`, `p10-fade-60` (the broadcast camera at 60 fps, from the windup to 1.8 s after the ball) and `p9-contested-60` (to 0.8 s after the ball).
- **`compare/`**: before on the left, after on the right.
- **`stills/`**:
  - `broadcast-qb-finish-before-after.jpg`: the QB from the broadcast camera (a crop on him, 2× at 960×540) from 0.1 s before the release to 0.4 s after it, before above after: the slant (the flick, now with the legs), the dig and the go (the drive), the RB screen (a flick to his right) and the fade (touch);
  - `broadcast-slant-dig-camera.jpg`: the whole frame from the windup to the catch, before above after;
  - `broadcast-box-before-after.jpg`: Gronkowski on Lott, the post-up from 0.57 s before the secure to just after it: round 11, the first cut of the bar (1.36 m) and the final.

## Watched: an honest critique

I read the 60-fps recordings frame by frame against their per-frame logs, crops on the QB through the release and finish, crops on the contested pair through the post-up, and the whole frame from the windup to the catch, before against after.

- **The QB's finish now reads as a throw's finish from the broadcast camera on a throw to his left (the slant, the out, the dig, the go).** In the crops (`stills/broadcast-qb-finish-before-after.jpg`) the throwing arm comes through long and down across him, the hand out past his front hip or knee where it was tucked against his belt, and the back heel flips up behind him for a beat before the back foot comes down: the throwing hand is clear of his body on every frame of the finish (the slant 5/16 → 20/20 frames, by 14 px against 3), the heel up on 14–16 frames of the first half-second where it never was. On the slant this is the biggest change of the round: round 11's QB stood frozen on the drop's stance with the arm folded into his belly; now he finishes like a quarterback. At 960×540 the QB is still ~80–90 px tall, so these are gestures of a few dozen pixels: they read as "arm through, heel up" at a glance, not as coaching-tape mechanics.
- **The slant's finish is a deep one.** With the legs now the throw's own, the flick's crouch (the hips 13 cm down, the chest over the front knee, as round ten keyed it) shows for the first time, and on a quick slant from the gun it's more bend than a real quick-game flick has. Worth the owner's eye at 60 fps; the knob is the flick's pelvis drop and flex.
- **On a throw to his right the hand is still behind him.** The RB screen (and any throw to the right: the camera is then behind his throwing shoulder) can't show a hand finishing across to the opposite hip: his body is between the camera and it (5/31 frames clear, as before, −11 px). What reads there is the throwing elbow coming through, the glove elbow back and the heel kick (16/31 frames). I didn't cheat the arm out to the throwing side: that's not a finish a QB has.
- **Touch (the fade) is round ten's finish plus the heel.** The arm reaching up to the target was already clear of him (30–31/31 frames); I tried pulling the glove elbow back on it too and it made a "W" of both arms from behind, so it's as it was. The back foot now leaves the ground (13/31 frames) instead of stepping flat.
- **The camera's zoom is no longer the fastest part of the move.** The slant's lens peaks at 44°/s (67), the dig 42 (70), the out 42 (55), the go 37 (51), the fade 34 (44), the screen 51 (55); the pans are where they were or lower (the slant 30, the out 30, the screen 37). The QB is in the frame longer on every throw but the screen (the slant to 0.32 s after the release from 0.25, so the flick's held finish is seen to its end; the out 0.47, the fade 0.57), and every receiver is as large at the catch (the fade 141 → 140 px) or larger (the slant 108 → 114). What it costs, and what the owner should judge:
  - **the shot tilts down onto the QB through the windup** (~4°) and back up with the ball: on screen, the stands leave the top of the frame as he winds up and the shot rises with the throw. I think it reads as an operator going to the passer and then with the ball; it is a visible down-and-up on every pass;
  - **more of the move is a dolly**: the eye travels in on the catch at up to 17–23 m/s (the slant's from 10). The perspective changes under the zoom on a quick throw where round 11 held the eye nearly still;
  - **the QB is ~5% smaller as he lets it go** (the slant 90 → 86 px): he's higher in the frame, a little further from the eye;
  - **the lens settles 0.08 s before the catch** (0.18), so a quick catch is framed as it arrives, not just before.
- **The box-out's bar is now a bar on the man, most of the post-up.** In the crops (`stills/broadcast-box-before-after.jpg`), from ~0.36 s before the ball Gronkowski's near arm goes out level onto Lott's near shoulder and upper chest across a gap the shove has just opened, and Lott is held off it until both go up: the forearm is seen on 19 of the post's 23 frames (11), where round 11's showed only as a raised elbow over the man. It is a dark forearm against Lott's dark jersey at ~110 px for the pair, so it reads as "arm on him, holding him off" more than as a crisp forearm shiver; its first 0.1 s (the bar landing, the bodies still together) is still hidden.

Would the owner, playing from the broadcast camera, now feel the passing is real on the QB's end, the ball and the WR's end?
- **The QB's end: yes on the quick and intermediate throws to his left**: he throws through the ball, the arm comes across and the back heel comes up, and the camera keeps him in the shot through it. Throws to his right still show the finish only by its elbows and heel.
- **The ball and the camera: the move is calmer** (no part of it over ~45°/s on any of the recorded quick throws but the screen's lens at 51), at the price of a tilt and more dolly.
- **The WR's end: the post-up's bar shows on the man.**

These are 960×540 recordings on Low.

## Still open

- **The new camera's tilt and dolly** (the push tilting down onto the passer, the eye travelling in on a quick throw at up to 17 m/s) want the owner's eye at 60 fps: `PUSH_LOOK_DOWN` and `EYE_SHARE_MIN` are the knobs; less of either brings the slant's zoom back over 45°/s.
- **The slant's flick is a deep crouch** now that its legs play: the owner should judge it against a real quick-game release (the flick's pelvis drop and flex in `actions_p10.py FINISHES`).
- **A finish to the QB's right** (the screen, a throw to the right side) can't show the hand across him from a camera behind his throwing shoulder; only the elbows and the heel read.
- **The QB is still ~80–90 px tall at the release** (960×540): the finish reads as gestures. A cut to a QB camera at the release remains the next step if the owner wants mechanics at broadcast speed.
- **The RB screen's QB** leaves the frame 0.04 s sooner after the catch than before (0.78 against 0.82 s; he's in it through his whole finish), and its zoom is 51°/s.
- **The bar's first beat** (as it lands, before the shove opens the gap) is still hidden between the bodies, and the dark forearm on a dark jersey is low in contrast at broadcast distance.
- **Gates vs Lewis** (identity) still waits on the owner.
