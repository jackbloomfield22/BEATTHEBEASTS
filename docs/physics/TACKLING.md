# Contact and tackling: bodies, the hit, the hold, the fall

M6.5 #12, the sim side (Playtest 1, "Tackling and physics": *a tackle attempt starts on contact, then a resolution over several frames where the carrier keeps moving (drive, drag, spin off, break) and the spot is where the ball is when a knee is down. Being touched is not being tackled*). The body side (the drawn model, skinning, the render's contact) is `docs/m65/BODIES.md`.

Code: `src/sim/bodies.ts` (bodies standing and on the ground), `src/sim/tackle.ts` (the hit, the hold, the fall, bodies in the carrier's path), `src/sim/play.ts contactStep` (who reaches him and what the roll gives), `src/render/game/choreo.ts` (the clips and the ragdoll on the sim's moments). Harness: `tools/sim/tackling.ts`. Clip finder: `tools/sim/findtackles.ts`. Tests: `tests/tackle.test.ts`.


## 1. What was wrong

- **Touched was tackled.** A defender who reached the carrier rolled once (`contact.ts tackleOdds`) and a made tackle ran a scripted "wrap": the carrier kept going along his heading, slowing at a constant rate over a fall-forward distance of `0.7 × his speed × his share of the mass × leg drive`, clamped to 0–2.5 yd, then went down. Nobody was ever driven back (0.0% of tackles in `tools/sim/tackling.ts`), the tackler's speed and direction barely mattered, and a big back and a small receiver fell forward the same way. The bubble agent measured it: every contact added 3–4 yd.
- **Broken tackles were a velocity multiplier.** 62% of his speed kept (88% off a block), no contact, nobody on the turf.
- **Bodies were circles a skill player too wide** (BODIES.md: ~5 cm a side for the WRs, CBs and safeties) and as deep as wide (the trunk is half as deep).
- **A man on the ground had no body.** A diver who missed lay where he fell for the rest of the play and nobody saw him; the render's hurdle over him was a render-only guess the sim didn't know about.

## 2. Bodies (`src/sim/bodies.ts`)

- **Standing: an ellipse at the pads.** Half-width across = the pad half-width, half-depth along his facing = the chest's, both from the per-position fits `tools/blender/measure_bodies.py` made of the shipped model (BODIES.md; within 0.7 cm). The render's contact layer now reads the same table (`BODY_FIT`). `separate()` measures each pair along the line between them (the ellipses' support), so two receivers side by side stand pads to pads and a tackler can get chest to chest with a back.
- **Linemen and the QB keep the old circle.** They work with their hands out (the pass set's punch, the rush, the ball at the numbers), BODIES.md measured the circle "about right across the pads for the big men", and the line's engagements are built on it. Fitted to their pads, the best and worst pass-blocking units held up within 0.2–0.35 s of each other (0.63 s before, 0.77 s now; `tests/sim.test.ts` asks 0.5) and, with the chest's depth, rushers slid past the sets (pressure 25% → 29%).
- **Contact distance is kept.** Hands get on a man at `reach_o + reach_c + 0.6 yd` (`play.ts ARM_REACH`), the reach base being the sim's old circle: 0.9–1.0 m from the tackler's centre, which is what BODIES.md measured the model's hands at. Measured from the fitted pads with 0.7–0.8 m of arm instead, contact on runs came 0.25 yd earlier (yards a carry 4.7 → 3.5); from the chests head on, it came later and yards a throw rose to 9.0.
- **On the ground: a capsule along his body.** Hips to the top of his head (0.48 of his height) one way, hips to heels (0.53) the other (Drillis & Contini's segment ratios), 0.22 yd thick. Anyone standing on a man's trunk steps off it (half the overlap a tick), except a man in the air over him. Bodies lie the way they fell.
- **Pancakes put bodies in the trash.** A run block the blocker owns (leverage −0.8 or better) can put the man on his back, by the blocker's Impact Block and Strength (`blocks.ts`): about one run in 20–25. Those are the bodies a back steps over, goes round or hurdles at the line.
- **Men get up.** A man on the turf mid-play (a diver who missed, a man run over or spun to the ground) is up after 0.5 s plus the 1.1 s get-up clip; before, he lay there for the rest of the play.

## 3. The tackle (`src/sim/tackle.ts`)

`contactStep` still rolls the same calibrated odds when a man gets his hands on the carrier (`tackleOdds`: Tackle, Hit Power, Pursuit against Break Tackle or the move he's in, mass, angle, the traits). What the roll *gets* is now played out by two (or more) bodies:

| The roll | The hold | How he got there |
|---|---|---|
| big hit | `big` | the roll's big hit (Hit Power against what the runner can take) |
| tackle | `hit` | square in front (within 60°), closing faster than 3 yd/s |
| tackle | `wrap` | from the side |
| tackle | `drag` | from behind |
| tackle | `ankle` | a dive or a lunge, or a defensive back going low (`goesLow`) |
| broken | `arm` | a hand on him he may run through |

**1. The hit.** An inelastic collision along the line between them: the impulse takes `k` of the closing speed times the reduced mass (`k` 1.25 for a big hit, i.e. restitution 0.25: padded collisions are mostly plastic; 1.0 a shoulder hit, 0.85 a wrap, 0.6 from behind, 0.45 at the ankles, 0.35 an arm). Hit Power puts more of him into it (±15%). **A tackler comes to balance before he hits** (break down, buzz the feet, the hips through: how every tackler is coached), so what he brings into the man is 2.5 yd/s plus up to 4 more with Hit Power, not his pursuit speed; only a big hit arrives at full tilt. A runner whose velocity changes by 9 yd/s at the hit (a back stopped dead from full speed) has lost his feet; less takes that share of his balance.

**2. The hold.** Everyone who has hold of him moves with him as one pile, with the momentum of the collision. Each tick:
- **His legs** push along his drive (his run, turned toward the goal line; the player's stick steers it) with the sprint force–velocity line the sim already gives him from his Speed and Acceleration (`m·vmax/τ·(1 − v/vmax)`, the model the ratings were built from; Samozino et al. 2016), times his power in a pile (Trucking, Strength, Break Tackle), less what the holds bind (arms round his thighs 40%, round the waist from behind 50%, at the ankles 80%, an arm 15%; he keeps at least 15%: he churns). He is moved only by the pile: a step of his own toward the sideline had carried him out of bounds out of a man's arms.
- **A tackler in front or beside him** drives into him the same way, times his finish (Tackle, Strength, Hit Power), half through the man and half against where the pile is going (he plants and turns him). **One behind him or at his ankles hangs on and brakes**: his weight dragging, μ ~0.5.
- **Nobody pushes harder than his cleats hold**: traction, μ·m·g with μ ~1.0 for cleats on grass (Villwock et al. 2009 measured 1.0–1.4), ±25% for the lower man (leverage: the low man lifts the high man off his feet). Pushing contests in football are traction contests, which is why mass wins them.
- **A hold gives** when keeping the tackler with the pile takes more than his grip: ~600 N for an arm (one hand on a jersey: grip strength in rugby players runs 500–700 N), 900 at the ankles, 1,600 from behind, 3,000 for a wrap (it's broken by a move, not by running), Tackle ±20%, the carrier's Break Tackle ∓25%. An arm whose hand can't take the impulse of matching his speed in 0.18 s is run through at once; a big man through a small one runs him over (on the turf).
- **His balance** drains a share a second for each man on him: wrap 2.2, shoulder hit 2.6, ankles 3.2, from behind 1.8, an arm 0.45, scaled by the tackler's finish, √(his mass over the carrier's), leverage (±50%), and the carrier's steadiness (Break Tackle, Strength, Agility). Driven back, he loses his base 1.4 a second faster. Low Center: a man hitting above the waist loses 30% of it (the catalog's line).
- **His moves inside it**: a spin, juke, stiff arm or the shoulder begun while he's held gets one try against each man (a wrap only in its first 0.25 s, before the arms lock), at half the chance the tackle had of failing (the same odds the HUD ranks); a stiff arm or a truck puts a man his size or smaller on the turf. **A dive** inside a tackle gives up his feet and falls forward for it.

**3. The fall.** Out of balance he goes down the way the pile is moving (or, stopped, the way the strongest man drives him; over the ankles, forward), 0.25 s from his feet going to a knee on the turf, the pile sliding at 1 g (his cleats still in the turf and a man on him), the ball going with him (0.65 yd ahead of his feet falling forward). The ball is spotted where it is when he's down, **or at his forward progress if he was driven back** (the furthest the ball's nose got). The catalog's after-contact traits (Battering Ram +0.8 yd head on, Goal-Line Hammer +1 inside the 5, Grinder's stuffed run +1, Thumper −0.5, Undersized +0.5) ride on the fall. Held up with no ground gained for 0.7 s, the officials blow forward progress (the stood-up runner).

**Gang tackles**: a second or third man who gets a hold adds his momentum to the pile (a linebacker arriving at speed moves it), his legs and his drain; the pile goes where the sum of them pushes it.

**After a broken tackle** the runner has lost his feet for a stride or two: 75% of his balance scaled by his steadiness (a power back ~65%, a receiver ~75–80%; an arm off a block 35%), back at 1.2 a second (30% faster with Low Center); a man off balance can't run at his full speed (55% of it with no balance left, `movement.ts steer`). The impulse of a hand alone barely slowed him; the old sim took 38% of his speed at once, and every pass and run calibration sits on that cost.

**Bodies on the ground in his path**: the AI carrier's lane choice sees them (a body across a lane costs it up to about a free tackler's threat), so he goes round. Running at a man lying across his run 1–2.4 yd ahead at speed, he hurdles him if he has the spring (Jumping, or Agility for backs, 84+, or the Hurdler trait); the one button does too. Otherwise he goes through: a stumble over the legs, a worse one into a man's trunk (Agility keeps him up), and tripped by an opponent on the ground he's down by contact.

The QB in the pocket keeps the old pocket wrap (a step, then down, the throw still getting away in its last 0.1 s): the sacks are the pass game's calibration, and a passing-game agent owns it.

## 4. Events for the render

| Event | When | Data |
|---|---|---|
| `hit` | a hold begins (and each man joining: `join`) | `kind` (wrap, hit, big, drag, ankle, arm), `side` (front, left, right, back of the carrier), `imp` (the impulse, N·s), `nx, ny` (the line of the hit), `px, py` (the contact point, at his pads), `lev`, `headOn`, `eta` (s to his knee on the turf on this hold alone) |
| `brokenTackle` | a hold gives or an arm is run through | `how` (runThrough, runOver, shed, spin, stiffArm, truck, jukeL/R), `flat` (the man is on the turf), `imp` |
| `tackle` | his feet go (the fall begins) | `fall` (forward, back, side, held), `fx, fy` (the way he goes down), `v` (the pile's speed), `kind`, `gang`, `assists`, `wrapT` (first hold to the fall, s) |
| `move` | `getup` (up off the turf), `stumble` (over a body), `hurdle` with `over` (the body) and `tc` (s to it) | |
| whistle | his knee on the turf (0.3 s after `tackle`) | the spot |

The render (`choreo.ts`):
- The tackler's form-tackle clip starts on its contact frame at the hit and is slowed so its going-down key lands on `eta`; when the sim says they fall, every man who had him catches up to it.
- A grab at the ankles is the dive clip from its reach.
- An arm that's run through is the contest overlay's reach and rake.
- The carrier in a tackle runs the drive gait (pads low, legs churning) with both hands on the ball.
- A man put on the turf falls (the ragdoll) away from the carrier.
- At the fall, the carrier's ragdoll starts with the pile's velocity and his upper body thrown the way the sim says he goes down.
- The hurdle starts so its flight's top lands on `tc`; the render-only guess is gone.
- A man the sim gets up plays the get-up from where he lies.

## 5. Numbers, before and after

`node tools/run-ts.mjs tools/sim/tackling.ts 6 --duels` (the AI-vs-AI harness book: 715 runs, ~500 completions; before = `23299d9`, after = this branch).

| Runs | Before | After | NFL reference |
|---|---|---|---|
| Yards after first contact (mean / median) | 3.67 / 1.5 | 3.39 / 1.3 | RB ~2.9 a carry (PFF yards after contact per attempt, recent seasons ~2.8–3.1; Henry, Chubb 3.5+) |
| Tackles broken a carry | 0.375 | 0.366 | |
| Tacklers made to miss a carry | 0.134 | 0.117 | forced missed tackles ~0.15–0.20 an attempt for RBs (PFF) |
| Tackles with 2+ in on it / 3+ | 35% / 2% | 44% / 7% | about one tackle in four or five shared (gamebook assists run ~1 for every 2 solo tackles credited) |
| Tackles where he was driven back | **0%** | **11%** | |
| Contact to the whistle (median, p10–p90) | 0.35 s (0.07–1.07) | 0.52 s (0.38–1.27) | film: a solo form tackle has him down ~0.5–0.8 s after the hit (our estimate; no published figure) |
| Big hits | 6% | 6% | |

| After the catch | Before | After |
|---|---|---|
| Yards after first contact (mean / median) | 3.73 / 1.7 | 3.59 / 1.8 |
| Broken / made to miss a carry | 0.109 / 0.107 | 0.111 / 0.137 |
| Driven back | 1% | 22% |
| Contact to the whistle (median) | 0.33 s | 0.53 s |

Yards after first contact by carrier and first tackler (all carries, n in brackets):

| Carrier \ first man there | DL before → after | LB | DB |
|---|---|---|---|
| RB (under 225 lb) | 3.22 → 2.54 | 2.57 → 3.04 | 4.79 → 4.67 |
| WR (195+) | — | 0.87 → 1.63 | 3.85 → 4.03 |
| WR small (<195) | — | 3.11 → 4.24 | 4.43 → 3.83 |
| TE | 4.89 → 3.32 | 5.80 → 2.22 | 5.81 → 4.15 |

The duels (each man in the RB slot, or at strong safety, on the whole run book):

| Carrier | Yards after contact before → after | Driven back before → after | Contact to whistle after |
|---|---|---|---|
| Jerome Bettis | 3.99 → 3.61 | 0% → 9% | 0.72 s |
| Derrick Henry | 4.55 → 4.17 | 0% → 8% | 0.71 s |
| Earl Campbell | 3.86 → 3.76 | 0% → 12% | 0.75 s |
| Barry Sanders | 4.40 → 5.49 | 0% → 13% | 0.96 s |
| Jamaal Charles | 4.87 → 4.09 | 0% → 11% | 0.71 s |
| Chris Johnson | 5.76 → 6.23 | 0% → 10% | 0.74 s |

| At strong safety | Yards after contact when he's first there, before → after | Big hits |
|---|---|---|
| Kam Chancellor (Hit Power 97, Tackle 95) | 5.80 → 4.71 | 8% → 9% |
| Steve Atwater (96, 89) | 4.45 → 5.37 | 7% → 6% |
| Ronnie Lott (94, 71) | 5.09 → 4.63 | 6% → 6% |
| Ed Reed (91, 33: Arm Tackler) | 6.76 → 6.20 | 6% → 5% |

The power backs are driven back least (Henry 8%, Bettis 9%) and Barry Sanders most (13%), but Barry lasts longest once held (0.96 s: he slips holds and runs on) and gains the most after contact. Kam now gives up 1.5 yd less after contact than Ed Reed (was 1.0). Honest: Bettis' yards after contact are below Henry's and Barry's because most of the after-contact mean is breakaways after a broken tackle, which the elusive backs make more of; on the tackles themselves (`tests/tackle.test.ts`) the Bus falls forward further than a receiver or the same back on a linebacker.

The run game (`tools/sim/runhist.ts`, 10 a cell) and the pass game (`tools/sim/outcomes.ts`, 60 a cell):

| Runs (`runhist.ts`, 1,200 carries) | Before | After | NFL (2018–23 RB carries, nflverse) |
|---|---|---|---|
| Yards a carry / median | 4.73 / 2.3 | 4.03 / 1.9 | ~4.2–4.5 |
| Yards after first contact | 3.45 | **2.89** | ~2.8–3.0 |
| Yards before contact | 0.95 | 0.81 | |
| Stuffed (no gain or a loss) | 12.1% | 14.6% | ~18% |
| Losses / 0 / 1–3 / 4–6 / 7–9 | 4.1 / 8.0 / 53.1 / 18.8 / 6.3% | 5.6 / 9.0 / 55.5 / 16.8 / 6.0% | 10 / 8 / 34 / 25 / 11% |
| 10+ / 20+ / 40+ | 9.1 / 3.8 / 2.0% | 6.6 / 3.1 / 1.5% | ~11 / 2.7 / 0.5% |

| Passing (`outcomes.ts`, 60 a cell) | Before | After | Band |
|---|---|---|---|
| Completion | 68.4% | 67.9% | 58–70% |
| Yards an attempt | 8.57 | 8.6 | under 8.8 |
| Yards after the catch: short routes / all | 6.0 / 6.6 | 6.3 / 6.8 | |
| Completions of 20+ / 40+ | 17.8 / 4.6% | 18.6 / 5.3% | under 20 / 8% |
| Sacks / pressured | 6.8 / 24.3% | 7.1 / 23.9% | |

Identity: **19 of 20** (as before; Gates/Lewis still fails on top speed and separation, pending the owner's decision). The contact pairs hold or widen: Barry Sanders makes 0.21 tacklers miss a carry to Jerome Bettis's 0.04; Jamaal Charles 0.20 to Brandon Jacobs's 0.06 (Jacobs' moves 32% trucks and stiff arms, Charles' 0%); Gronk's yards after the catch over Tony Gonzalez +1.24 yd (5.17 to 3.93: the pair had sat on the line); Kam Chancellor finishes 85.9% of his tackles to Ed Reed's 61.4%; Reggie White beats his blocker 15.2% to Aaron Smith's 8.3%. Trait audit 127 of 127.

## 6. The videos (watched)

Recorded with the frame-true video harness from the broadcast camera (Low quality, 960 wide, 20 fps; `BTB_VIDEO=1 BTB_PHYSICS=1 BTB_PORT=5297 BTB_VIDEO_W=960 BTB_VIDEO_QUALITY=low npx playwright test -c tools/shots/playwright.config.ts`); each recording checked one scene step per frame. The plays are `src/game/clips.ts PHYSICS`, found by `tools/sim/findtackles.ts` and held by `tests/tackle.test.ts`. The sheets are crops round the ball carrier, 0.1 s apart, from just before the contact to the turf.

| Video | The play | The sim's moments (video frame) |
|---|---|---|
| [tackle-fall-forward.mp4](tackle-fall-forward.mp4) · [sheet](tackle-fall-forward-sheet.jpg) | Jerome Bettis, inside zone against the fire zone: Aaron Smith wraps him from the front | hit f63 (wrap, 223 N·s, Bettis the lower man), feet gone f72 falling forward, down f77: 3.5 yd after contact |
| [tackle-gang.mp4](tackle-gang.mp4) · [sheet](tackle-gang-sheet.jpg) | Derrick Henry on the toss against Cover 2 man: Singletary, Revis and Ray Lewis | holds f64, f65, f67; three in on it, down 0.17 s after the first hold, falling sideways |
| [tackle-arm-broken.mp4](tackle-arm-broken.mp4) · [sheet](tackle-arm-broken-sheet.jpg) | Barry Sanders on the toss against the fire zone | runs over Revis f67 (on the turf), stumbles over him f68, Ed Reed wraps him f84 and is dragged 4 yd and out of bounds (1.28 s) |
| [tackle-big-hit.mp4](tackle-big-hit.mp4) · [sheet](tackle-big-hit-sheet.jpg) | Roger Craig on heavy power against Cover 2, Kam Chancellor at strong safety | Singletary dives and misses f69, Ray Lewis at the ankles f71, Kam's big hit f73 (1,103 N·s), he goes down backwards |
| [tackle-hurdle.mp4](tackle-hurdle.mp4) · [sheet](tackle-hurdle-sheet.jpg) | Barry Sanders on the iso, the player steering at a pancaked lineman and pressing the one button | hurdle f57 over the man on the turf, through an arm in the air f58, Ronnie Lott's shoestring tackle f72, falling forward |
| [tackle-driven-back.mp4](tackle-driven-back.mp4) · [sheet](tackle-driven-back-sheet.jpg) | Jerry Rice's slant against Cover 4 | Ed Reed meets him square f74 (616 N·s), his feet go f78 falling back, spotted at his forward progress |

### What the frames show (honest)

- **Driven back** reads best: Rice running at the 50, Reed square in front of him, the hit, Rice going down on his back with the dust off the landing, Reed over him. That is the picture the old sim could never make (it pushed every tackled man forward).
- **The gang tackle** reads as a pile once he's down: two men go in low and wrapped, Henry topples over them and lies across them. First cut (before `830edf3`) the fall launched him 1–2 m clear and he cartwheeled, legs over head, beside two neat prone tacklers; with the gentle topple he lands on them. His legs still kick up for a frame as he goes over the top: the ragdoll has no joint limits at the hip.
- **The arm tackle broken / the drag**: Revis goes to the turf at Barry's feet and Barry stumbles over him (the trip check reads the man he's just flattened as a body in his path: true to life, but it happens every time a man is run over); later Reed hangs on his side and is carried four yards and out of bounds, riding him the whole way. The ride is visible; the tackle clip under Reed is a form tackle slowed down, so his arms read as wrapped rather than clutching.
- **The big hit** happens inside a cluster: Singletary's dive and miss and the bodies on the turf read clearly, but Kam's hit itself is hidden among his teammates at this distance; the result (Craig down on his back) is legible, the moment of impact isn't.
- **Fall forward (Bettis)** is the weakest: his own pulling lineman (#77) is between the camera and the contact for most of it. The sim's moment (a front wrap, 3.5 yd after contact) is right; this recording doesn't show it. A different seed or a side camera would.
- **The hurdle** happens behind the HUD's move panel: the broadcast camera keeps a back low in the frame early in a run, and at 960 px the panel covers him. The sim did the hurdle (the event, the clip timed to its `tc`), but this video is not evidence of how it looks.
- **Everywhere**: at the broadcast distance and 960 px the players are 30–40 px tall; the contact clips' detail (hands, arms round a man) can't be judged here. The tackle clip is one form tackle for every hold kind except the ankle grab (the dive) and the arm (the contest overlay): a man hit from behind and a man hit square play the same clip. The tacklers' prone end poses lie beside the carrier rather than on his legs.
- Pops (the animation pop meter) worst 43–61 rad/s with 3–7 spikes a clip, in the range of the earlier feel videos.

**What would make it broadcast-grade:** a close camera for the replay of a tackle (the in-game camera has no fixed-shot override; `?cam` is the menus'), a drag clip (a tackler hanging on the hip, feet trailing), a high-wrap and a low-wrap variant, a carrier's "wrapped and fighting" upper body, and hip limits on the ragdoll.

## 7. Honest critique of the physics and what's open

- **The run game's shape.** Yards after contact is now in the NFL's band (2.89 a carry against ~2.8–3.0; it was 3.45) and a back driven back is a real outcome (11% of tackles), but yards a carry fell 4.73 → 4.03 and the explosive runs with it (10+ 9.1% → 6.6%; NFL ~11%). The distribution was already too peaked at 1–3 yd before this work (53%, NFL 34%) and still is (55%): yards before contact (0.81) is a blocking and lane question, not a tackling one. The cost of a broken tackle (SHED_JOLT) is the knob between the two games: lighter and the runs come back but the passing game's yards a throw goes over its 8.8 ceiling (8.7 at 0.75, 8.4 at 0.85, 8.6 at 0.8, `tools/sim/outcomes.ts` at 20–60 a cell).
- **40+ completions** 4.6% → 5.3% (band under 8%).
- **Gang tackles are more common than the NFL's** (44% of run tackles with 2+ in on it, against roughly one in four or five shared in the gamebooks), and contact to the whistle on a gang tackle is short (0.17 s from the first hold on the recorded one: three holds' drains add).
- **Hurdles stay rare.** Bodies on the ground are mostly behind the carrier (men he ran over, missed divers) or in the trash at the line (pancakes, one run in 20–25), and the lane choice goes round them. In the harness book the AI hurdles about never; the recorded one is a player steering at a body. That matches the NFL (a hurdle of a man on the ground is a highlight), but it means the feature is mostly for the player.
- **The constants are physics with our numbers on them.** Masses, speeds, the force-velocity line and traction are the sim's or published; the hold strengths, balance drains, the jolt, the breakdown speed, the bind and the fall reach are ours, sized from film and to keep every band. Each has its comment.
- **One QB is still the old wrap**: a sack is the old pocket wrap (the pass game's calibration, owned by the passing agent).
- **Contact distance is the old circle's**: bodies are fitted to the model for collision, but where a tackler's hands get on a man is the sim's old contact distance (0.9–1.0 m from his centre, matching the model's hand reach), because the run and pass calibrations sit on it.
- **Not done**: teammates pushing the pile (legal in the NFL; nobody steers to it), a tackler's own balance (only the carrier's is modelled), a drag clip and hold-specific tackle clips, a close replay camera for contact.

## 8. Tools

| Tool | What it does |
|---|---|
| `node tools/run-ts.mjs tools/sim/tackling.ts [reps] [--duels]` | The numbers in section 5 |
| `node tools/run-ts.mjs tools/sim/findtackles.ts [seeds] [--only=id]` | Seeds for the six videos |
| `npx vitest run tests/tackle.test.ts` | Bodies, the hit, the hold, the fall, the hurdle, and the videos' plays |
| `BTB_VIDEO=1 BTB_PHYSICS=1 BTB_PORT=… npx playwright test -c tools/shots/playwright.config.ts` | Records the six videos into `docs/physics/` |

## 9. Merged with the passing pass (2026-10-06)

`claude/m66-polish` (the passing pass, the character pass, the test plumbing) merged into `wip/physics`.
- **Where the two meet:** the passing pass keeps the throw and the catch. The QB in the pocket still uses the pocket wrap, which is what the passing pass's hit-as-he-throws (`planThrow(..., wrapped(qb))`) reads. A carrier after the catch goes to the pile. Nothing in the sim conflicted.
- **Rebuilt:** the film was regenerated and the golden re-pinned. completion-rac was re-found (seed 12); every other feel, concept, identity and tackling clip still shows its moment. The e2e seeds (2, 307, 5) still hold under the merged `e2eseeds.ts`.
- **Passing (`outcomes.ts`, 60 a cell):**
  - Completion 65.3%, ypa 8.2, INT 2.5%, sacks 7.1%.
  - Completions of 40+ 7.1%, under the 8% band.
  - For comparison, the passing pass alone measured 65.7%, 8.1 ypa and 6.3% of 40+, so the tackle physics adds about 0.8 points of 40+, as it did on its own (4.6% → 5.3%).
- **Runs (`runhist.ts`):** 4.03 a carry; 2.89 yd after contact.
- **Tackling (`tackling.ts`):**
  - Runs: driven back 11%; contact to whistle median 0.52 s.
  - After the catch: yards after first contact 3.17; driven back 23%.
- **Identity:** 19/20 (Gates vs Lewis, as before). Passing identity: 7/7.
- **Traits:** 127/127.
- **`npm run check`:** passes (71 files, 722 tests).
- **Practice e2e:** 7/7 on port 5297, determinism included.
