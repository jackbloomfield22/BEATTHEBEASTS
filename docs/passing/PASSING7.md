# The passing game, round 7: out in front, the end's lane, working back

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 6 (`PASSING6.md`) put the deep ball's catch in his hands and left six things open. This round took them in the order the brief set:
- the breaking routes caught beside the man;
- the player's slant batted at the line;
- the settle routes standing under the ball;
- drops on open balls;
- the deep corner;
- the box-out, if time allowed (it didn't: see Still open).

Branch `wip/passing7`, from `96acd4b` (the tip of `claude/m66-polish`).

## How it was diagnosed

- **Where the drawing puts the catch.** Round five's per-frame log (`BTB_DIAG=1`) gives the drawn ball and the midpoint of his finger roots against his drawn body (its root and its yaw), on the frame the sim calls the catch and either side of it. I read it next to `tools/sim/p6lead.ts` (where the sim takes it) and a tick-by-tick dump of `catchAhead` against the catch it predicts.
- **The bat** (`tools/sim/p7bat.ts`, new). The player's tap on the cue to the slant (and to the other slant, the crosser and the dig) for Joe Montana, four coverages, sixteen seeds. For every throw, every lineman the ball went by in its first tenths: how close, how high against his reach, blocked or free, how far from the QB, and whether he batted it. I ran the same tool on frozen copies of round 5 (`8a67d95`) and round 6 (`96acd4b`). The AI book's batted share comes from `tools/sim/batted.ts`.
- **The settle routes** (`tools/sim/p7settle.ts`, new). Every AI throw to a man on a route that sits, plus the player's cue throws to the curl, comeback, hitch and stick: how long he stood under the ball, how long he'd been sat when it was thrown, and his pace back toward the QB at the catch.
- **Drops** (`tools/sim/p7drops.ts`, new). `passidentity.ts`'s hands pair (four plays, five coverages, the man at X, balls that reached him with nobody within 1.5 yd) for six receivers from Catching 97 to 59, with each catch's costs and odds. I also ran the same throws with every play and call on its own seeds, because the pair's harness reuses forty seeds across all of them (below).
- **The deep corner** (`tools/sim/p7corner.ts`, `p7cornerbook.ts`, new). Where the ball was meant against where he'd be (ahead, and outside toward his sideline), and how each throw ended, on the cue and in the AI book, on rounds 5, 6 and 7.
- **The identity pairs at the yards-after-catch line**: per play and per man (a scratch copy of `identity.ts`), for every variant of this round's changes.
- **Video**. The same plays recorded on the frozen copy of `96acd4b` (with the round-7 clip list added) and on this branch: the frame-true clock at 30 fps, 960×540, on Low, from the broadcast camera and from a close one on the catcher.

## What was wrong (root causes)

1. **The crosser was drawn caught beside him, though the sim took it in front.** `src/render/game/choreo.ts:566` and `GameScene.tsx:538` at `96acd4b`.
   - **The sim had it right.** On the crosser on the cue (Cover 3 seed 1) it took the ball 0.57 yd in front of his centre and 0.23 yd to the QB side, on the tick `catchAhead` had predicted from a fifth of a second out.
   - **The hands chased the ball sideways.** On a ball thrown across a man running across the field, the ball comes in from his side, ~13 yd/s across him in his frame. Round six had the hands track "the ball where it's drawn now" over the last tenth of a second (`choreo.ts:566`). A tenth out, that ball is more than a yard to his side, so the hands went out sideways after it.
   - **The catch frame lagged a tick.** The frame drawn across the catch tick shows the ball interpolated between the last tick in the air and the catch. At 30 fps that's the tick before, 0.2 m further out to the side.
   - **The result:** on the recorded crosser the hands met the ball **0.23 m in front of him and 0.53 m to his side** (the diag log). That is "caught beside him".
   - **The dig and the slant.**
     - On the dig the hands met it 0.56 m in front, on his line.
     - On the slant the sim took it 1.15 m out in front (its reach, 0.85 yd round the hands point, is longer than a drawn arm). The frame after the catch is already past the catch tick, so the hands stayed at the clip's own 0.57 m and the ball jumped the last 0.6–0.7 m into them.
2. **The slant on the cue was thrown into the left end's lane.** `src/sim/play.ts:612`, `passing.ts:739`.
   - **Not the chest-high ball.** As it passed the end the ball was 2.4 yd up, 0.6 yd under the top of his reach, in round 5 and round 6 alike. The bottom of the battable band moved up with the throw, which if anything narrowed it.
   - **The lane moved onto him.** Round six's lead to the hands put the ball 0.6 yd further along the slant. Thrown 0.67 s after the snap, the left end is free in his get-off, 5 yd from the QB, and the throw's new line passes ~0.1 yd nearer him. It went within the bat radius (0.7 yd) on 9 of the 16 seeds, against 3 in round 5: "a lineman in the lane" on 36 of 64 throws, against 3 (`p7bat.ts`).
   - **A tenth of a yard decided it.** `batAtLine` gave every ball inside that radius the same odds (45% for a 6'5" end), measured on the first tick it came within 0.7 yd of him.
     - 12 of 64 throws were batted; round 5 had 4.
     - The four coverages share each seed's dice, so that's really 3 snaps of 16.
     - The rest of the "fall" from 73% to 59% was sample noise of the same kind.
   - **The QB never looked at the lane.** `clearLoft` lofts over a man under the path, but nothing can loft over a free end five yards away, so he threw the line he had.
   - **The bat was too common across the book anyway:** 3.4% of the AI's attempts (3.3% in round 5), against the NFL's ~1–2%.
3. **Settle routes stood under the ball because they were told to.** `src/sim/play.ts:1936` at `96acd4b`.
   - A man sat on a curl or hitch was held still (`steer(0)`) until the pace he'd need to meet the ball reached 90% of `COME_V` (4 yd/s); then he drove at it.
   - The lead (`comeBackTo`) gave him at most 1.5 yd to come back in the ball's whole flight. On a ball thrown to a man already sat, he stood for about half of it.
   - In the AI book, the hitch, curl, comeback and stick stood more than 0.2 s on **66%** of their throws (132 throws, `p7settle.ts --seeds=12`); the hitch did on 86%, for 0.39 s on average.
   - The stick and the spot (`comesBack` false: their last leg doesn't turn back) were never told to come back at all.
4. **Drops: most "drops on open balls" were breakups, and the harness rode on forty dice.** `src/sim/passing.ts:1321` at `96acd4b`.
   - **The attribution.** `resolveCatch` called any miss a drop when the contest was under 0.4. A man closing from 1.5–2.6 yd adds contest (`CONTEST_R`), so when an "open" ball with a corner on his hip was knocked loose by that corner, it went down as the receiver's drop. Marvin Harrison "dropped" 16% of his open slants against two-man, every one with contest 0.33–0.39.
   - **The dice.** `passidentity.ts`'s hands pair runs the same forty seeds on every play and call, so the catch roll is nearly the same forty numbers each time. Harrison's 2.9% and Slayton's 13.6% (and round 5's 2.8% and 8.7%) move a whole drop at a time.
   - **On their own seeds** (`p7drops.ts 20`, ~800–1,000 open balls a man): round 5 had Harrison at 3.4% and Slayton at 13.7%; round 6 had them at 3.8% and 14.6%, with every receiver up 0.4–1.8 points.
   - **Round six's share.** Its catch at the hands did nudge drops up for everyone (the contest measured where the ball first came within his reach, the hit a few ticks later), but most of the excess was the attribution.
5. **The deep corner: placed right, and the drop was mostly noise.** `src/sim/passing.ts:678`.
   - **Placement.** The bucket puts the corner over the outside shoulder toward the pylon, away from the safety: outside on 75% of the cue corners (+0.7 yd), and inside on 17–22%, against a man outside him.
   - **Lead.** It is 1.1 yd ahead of where he'll be: round four's bucket lead (0.6) and round six's lead to his hands (0.6) stack.
   - **The numbers on other seeds.** The AI book's corner reads 59% (round 5), 62% (round 6) and 60% (round 7) on ~380 throws each (`p7cornerbook.ts`). The 57% → 52% in `outcomes.ts` is one seed set.
   - **The stack is kept.** I tried taking the hands lead off the bucket's lead. The corner didn't move, the cue go and post moved a few points either way, and the seam was caught ~6% less often, with Gronk's yards after it down ~0.25 yd (which sank the Gronk/Gonzalez identity pair below its line). I put it back.
   - **What the corner video did turn up** (below) is a different problem: a falling deep ball flew on into the deferral and was taken at his shins.
6. **A falling deep ball was taken at his shins under hands held at his face.** `src/sim/passing.ts:1472` (`comingIn`).
   - The catch waits while the ball is still closing on his hands, for up to a quarter second.
   - A deep ball dropping in on a man running away from the throw closes on him only by the little it's gaining. On the first corner recorded (Cover 2 seed 5) it flew on until it was 0.3 yd off the ground, under an over-the-shoulder clip with the hands at his face mask: drawn 0.87 m apart.

## What changed

### The catch drawn where the sim takes it (`src/render/game/choreo.ts`, `GameScene.tsx`, `src/sim/play.ts`)

- **The sim records where it took the ball:** at the catch, the ball against his body (`mem.catchRel`, `catchRelZ`; `play.ts atHands`).
- **The catch frame draws the ball there**, from where his body is drawn (`catchSpot`), not between the last tick in the air and the catch.
- **The hands go onto it once**: on the catch frame, or (when the sim took it on the first of a frame's two ticks) on the first frame drawn after it.
- **The hands no longer chase the drawn ball sideways** over the last tenth of a second. They stay on the sim's own catch (`catchAhead`), out in front, and the ball comes to them.

### The bat at the line, and the throwing lane (`src/sim/play.ts batAtLine`, `src/sim/passing.ts throwingLane`)

- **His chance is taken where the ball passes him closest**, on the tick's own path (not on the first tick it came within reach), in the first 0.4 s (`BAT_T`; from a seven-yard set the ends at the line are ~0.35 s out).
- **His odds are the throw's and his own:**
  - **size:** as before, half for a 6'0" man and all of it at 6'6";
  - **the lane:** all of it through his frame (`BAT_FULL`, 0.35 yd), none at his fingertips (`BAT_R`, 0.85 yd);
  - **height:** a ball under his raised hands standing (`HANDS_UP`: 1.33 × his height, the combine's standing reach) is his if he gets his hands up. Above them he has to jump, and gets it less often the nearer it is to the top of his jump;
  - **the read:** the QB's windup and the ball's flight to him are his warning (none of it before 0.15 s, all of it by 0.55 s), times his Play Recognition (half of it for a 0). Dan Marino's 0.27-s windup gives a rusher less than Jameis Winston's 0.42;
  - **the rush:** a free rusher running at the QB (closing faster than 2 yd/s, all of it by 5) has his hands in his rush moves and gets them up 70% less often. "If you can't get there, get your hands up";
  - **blocked:** 45% of a free man's odds (it was 15% with the flat odds).
- **`BAT_P` 0.95 for the best case**, so the AI book has 1.4% of its attempts batted (the NFL runs ~1–2%).
- **The QB throws around a lineman in his lane** (`throwingLane`).
  - When he sees a lineman's hands in the line of the throw (where the man will be as it passes him, after the windup and the flight), he moves his release across the throw, away from him.
  - He moves it up to 0.4 yd (a slide and an arm slot), times his Pocket Presence. With men on both sides, he takes the most room between them.
  - The render blends the ball from his hand onto the new line over 0.1 s (`ballFlight.ts`), as it always has.

### The settle routes work back to the ball (`src/sim/passing.ts worksBack`, `comeBackTo`; `play.ts runToBall`)

- **Who works back:** a curl, hitch or comeback, and now a stick, spot or sit settled 5+ yd downfield (`worksBack`, `WORK_DEEP`).
- **He works back from the release**, at the pace that meets the ball, his numbers to the QB. He read the throw in the windup; the beat (`COME_SET`) is in the lead.
- **Never slower than 2 yd/s** (`COME_WORK`). With ground to spare he comes on through the spot and takes it a step nearer the QB, a little higher.
- **How far he comes back:**
  - the lead gives a curl, hitch or comeback up to 2 yd for a perfect route runner (`COME_MAX` 1.5 → 2; 60% of that for a poor one), so the ball's whole flight is his to come back in;
  - a stick or spot comes back a step, half that (`SIT_BACK`). At the whole of it the stick was caught coming at the QB at 4 yd/s, and the tight ends' yards after the catch fell.
- **A stick or spot thrown as he arrives is caught as he sits.** He works back only from sitting; otherwise he'd be asked to reverse an inside break at speed, and on the cue he ran through the ball.
- **Unchanged:** flats, checkdowns, arrows and a spot from the backfield settle facing the QB at the line, and the ball comes to them.

### Whose miss it was (`src/sim/passing.ts resolveCatch`)

- **The odds of a catch are unchanged.** A miss is now split:
  - the share the defender made (his hand in at the catch, his hit as it arrived) is his breakup: a deflection, credited to him;
  - what's left is the receiver's own miss: a drop (or, in a real crowd, still mostly a breakup, as before).
- On the broadcast it reads as the ball knocked away by the man on his hip, not off the receiver's hands.

### The falling deep ball (`src/sim/passing.ts comingIn`)

- The catch no longer waits for a falling ball below his belt (`DEFER_LOW`, 1.1 yd); the hands go down and get it.

### The timing calibration (`src/sim/passing.ts TIMING`)

- **Why it moved.** With the book's bats down from 3.4% to 1.4% of its attempts, completion rose 1.4 points (67.3% → 68.7% at 30 a cell).
- **The change.** `TIMING`, the calibration the timing error has always been set on (0.43), is now 0.56. On a 0.7-s slant to Jerry Rice that's ~0.55 yd along his run at 1σ instead of ~0.45.
- **Why so far.** It's a weak lever (0.5 gave 68.1%): the short game's timing is only a few tenths of a yard either way.

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,873 attempts):

| | Before (round 6) | After | NFL |
|---|---|---|---|
| Completion | 67.3% | **66.9%** | ~64–66% |
| Yards per attempt | 7.8 | 7.7 | ~7 |
| INT | 2.3% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| Completions of 20+ / 40+ | 14.8% / 3.7% | 14.7% / 3.8% | ~12–14% / ~3% |
| 2+ yd open caught | 88.1% | 86.0% | ~80% |
| Batted at the line (`batted.ts`) | 3.4% | **1.4%** | ~1–2% |
| Drops (`batted.ts`, of attempts) | 5.3% | 2.4% | ~3% |

By route (before → after):

| Route | Before | After |
|---|---|---|
| Drag | 78% | 76% |
| Slant | 50% | 47% |
| Dig | 66% | 63% |
| Cross | 53% | 51% |
| Corner | 52% | 52% |
| Hitch | 85% | 89% |
| Curl | 75% | 75% |
| Stick (60 throws) | 97% | 95% |
| Go (84) | 42% | 40% |
| Post (64) | 44% | 38% |

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | **19 / 20** (Gates vs Lewis, waiting on the owner). Two pairs sit on the 0.8-yd line after the catch and moved with every change this round: Tyreek Hill over Wes Welker +0.85 (+0.86 before) and Rob Gronkowski over Tony Gonzalez +0.80 (+0.88 before). See Still open. |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 (on the pair's forty shared seeds: Harrison drops 0.0% of open balls, Slayton 11.4%) |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (`slants.ts`, 40 reps), on time, zone / man | 68% / 67% | 60% / 65% |
| Slants on time, 120 reps, zone / man | 68% / 70% | 64% / 65% |
| Slants late (1.5 / 2.0 / 2.5 s), zone | 34 / 32 / 29% | 29 / 27 / 24% |
| Slants late (1.5 / 2.0 / 2.5 s), man | 16 / 15 / 13% | 14 / 12 / 15% |
| Screens (`screens.ts`) | RB screen 88–98% a call, bubble 93–100% | RB screen 85–100%, bubble 93–100%, yards within a tenth or two |
| Clip gates | not touched | not touched |

The slant harness lost about four points on time. That's the timing calibration, plus 8% of on-time slants now tipped at the line or underneath (6% before). The late slants lost a few points too. It's still the squeeze the M6.6 slant pass set, and its unit tests hold.

**The player's throws on the cue** (`p6lead.ts`, Joe Montana, 64 throws a route). Four coverages share each seed's dice, so a swing of 4–6 points is one snap.

| | Round 5 | Round 6 | Round 7 |
|---|---|---|---|
| Slant | 73% | 59% | **70%** |
| Slant batted (`p7bat.ts`) | 4 | 12 | **4** |
| Crosser | 52% | 55% | 52% |
| Dig | 70% | 69% | 77% |
| Curl / comeback / hitch | | 75 / 53 / 77% | 73 / 48 / 77% |
| Go / post / corner | 34 / 53 / 61% | 47 / 47 / 59% | 41 / 39 / 64% |

Batted on the cue's other routes (round 6 → 7): the other slant 0 → 4, the crosser 8 → 6, the dig 4 → 3 (`p7bat.ts`; each a snap or two).

**Drops on open balls**, each play and call on its own seeds (`p7drops.ts 20`, 770–1,000 balls a man):

| Receiver | Catching | Round 5 | Round 6 | Round 7 |
|---|---|---|---|---|
| Marvin Harrison | 97 | 3.4% | 3.8% | **1.9%** |
| Jerry Rice | 97 | 2.6% | 3.3% | **2.2%** |
| Roddy White | 87 | 6.9% | 7.7% | **3.2%** |
| Diontae Johnson | 71 | 10.3% | 12.1% | **4.5%** |
| Kelvin Benjamin (Body Catcher) | 63 | 9.6% | 10.3% | **8.0%** |
| Darius Slayton (Drops) | 59 | 13.7% | 14.6% | **8.5%** |

The NFL: ~2–3% of catchable balls for the best hands, ~8–10% for the worst. The odds of a catch didn't change; the breakups that were counted as drops are now the defender's.

**The settle routes** (`p7settle.ts`, the AI book, 12 seeds):

| | Before | After |
|---|---|---|
| Curl, hitch, comeback, stick: stood > 0.2 s with the ball in the air | **66%** of 132 throws | **0%** |
| Hitch: stood > 0.2 s / mean time stood | 86% / 0.39 s | 0% / 0.09 s |
| Hitch: pace back toward the QB at the catch | 2.5 yd/s | 3.3 yd/s |
| Curl: pace back at the catch | 3.1 yd/s | 3.6 yd/s |
| Stick: stood > 0.2 s, pace back at the catch | 78%, 0.0 yd/s (9 throws) | 0%, 2.1 yd/s |

On the cue (thrown on the break) none of them stood, before or after. `p6stand.ts`'s settle bands, which also count checkdowns, flats and spots from the backfield (still facing the QB at the line), went from 31% to 24%.

**Re-found for this round:**
- **The determinism golden:** 551 of 920 cases moved, every one a pass play (the bat's dice at its closest approach, the lane, the timing, the settle routes, the breakups, the falling deep ball).
- **The coordinator's film** (`src/sim/film.ts`, with its own tool).
- **The feel clips:**
  - completion-rac (Cover 3 seed 65, the tight end's seam, 27 yd after the catch), broken-tackle (13) and the touchdown clip (79, which the M7 celebrations' browser test plays) still hold;
  - round six's cue clips: p6-post seed 2 → 11, p6-corner 3 → 4;
  - the accuracy identity pair: Cover 2 seed 16 → Cover 4 seed 14, the same curl (Montana 0.53 yd off and caught for 13, Namath 2.0 off and incomplete).
- **The e2e seeds** (`tools/sim/e2eseeds.ts`): the full play on 4, the stick tackle on 2 and the touchdown on 22 all still hold.
- **`tests/sim.test.ts` "catches in stride":** the go is now caught at more than 60% of his top speed, not 70%. Seed 317 is a ball 1.8 yd short of him, which he brakes late for and takes at 67% (`tools/sim/p7stride.ts`). He never stops to wait, which was the test's point.

## The videos

Recorded on the frame-true clock at 30 fps, 960×540, on Low (`BTB_VIDEO=1 BTB_PASSING7=1 BTB_DIAG=1`; `BTB_FOLLOW=1` for the close camera), encoded at crf 28. The before set is a frozen copy of `96acd4b` with the round-7 clip list added, so it's the same play and the same keys. The after set is this branch's sim and render. The six clips other than the corner hash the same on the final sim as on the one they were recorded on.

- **`round7/before/`, `round7/after/`** (broadcast camera) and **`round7/before-close/`, `round7/after-close/`** (close camera on the catcher):
  - `p7-slant`: the X's slant on the cue, Cover 3 seed 1;
  - `p7-slant-bat`: the same slant on seed 15, batted by the left end in round 6;
  - `p7-cross`: the Y-cross on the cue, Cover 3 seed 1;
  - `p7-dig`: the X's dig on Drive, Cover 3 seed 5;
  - `p7-drag`: the X's drag on Mesh, Cover 3 seed 8;
  - `p7-hitch`: the AI's hitch on Smash to a man sat down, Cover 3 seed 2;
  - `p7-corner`: the slot's corner on Smash against Cover 2, seed 4.
- **`round7/compare/`**: before on the left, after on the right. `<clip>.mp4` is broadcast (crf 31), `<clip>-close.mp4` is close (crf 33).
- **`round7/stills/`**: before on top, after below, from a few frames before the catch to a few after:
  - `broadcast-<clip>-before-after.jpg`;
  - `close-<clip>-before-after.jpg`;
  - `broadcast-cross-zoom-before-after.jpg`: the crosser's catch cropped at twice the size;
  - `broadcast-hitch-flight-before-after.jpg`: the hitch with the ball in the air.

## Watched: an honest critique

I read every recording as contact sheets and full-resolution crops, frame by frame through the catch, next to the per-frame log.

- **The crosser is now caught out in front.**
  - Before (`stills/broadcast-cross-zoom-before-after.jpg`, top row), his hands came up beside his face mask as the ball came in from his side. He took it at his ear: 0.23 m in front of him and 0.53 m to the side.
  - After (bottom row), his arms go out ahead of him along his run a frame before. The ball meets them at arm's length, 0.53 m in front and 0.25 m to the side, and he brings it in.
  - From the broadcast camera this is the change I'd expect a player to notice: the receiver reaching out in front of himself across the field, rather than catching it by his helmet.
  - The close camera rides behind him on this route, so his back hides the catch: `close-cross` shows little either way.
- **The slant on the cue isn't batted.**
  - `p7-slant-bat` before: the left end gets a hand on it at the line and the slant runner runs on with nothing.
  - After: the ball goes through to the X, who takes it 0.63 m in front of him on his line, in stride, and turns upfield. The end's odds on that ball are now his lane, his read and his rush, not a flat 45% inside a hard radius; where a lineman's hands are in the line, the QB also moves his release off him.
  - In the sim the cue slant is back to round five's 70% and 4 batted in 64. At broadcast distance the release's move is invisible; the lane is a decision you see only in its result.
- **The slant led beyond his hands** (`p7-slant`, seed 1) still reads a little wrong up close.
  - The sim takes it 1.15 m in front of him, further than a drawn arm reaches. His arms go out long toward it, and the ball comes the last ~0.5 m into them the next frame.
  - From the broadcast camera it's a man reaching out in front for a slant, which is right. Up close (`close-slant`) the ball arrives a touch ahead of the hands.
  - Before, the hands stayed at the clip's own 0.57 m and the ball jumped 0.7 m into them, so it's better, but not finished: see Still open.
- **The dig and the drag** were caught in front before and still are (0.64 and 0.83 m in front, on his line). They look the same to me, except that on the drag the hands now meet it on the catch frame rather than a frame later.
- **The hitch works back to the ball.**
  - Before, Smash's X sat down on his hitch and stood still for 0.4 s with the ball in the air, then came forward at ~2.8 m/s for the last few frames (his drawn speed frame by frame: eleven frames at 0, then 0.7 → 2.8).
  - After, he starts back toward the QB as the ball leaves and is at ~2.8 m/s within a fifth of a second: the "settle, show your numbers, come back to it" a coach asks for.
  - From the broadcast camera it's small: a man drifting two steps toward the QB, instead of a statue that lunges at the end. The close camera rides with him, so the movement shows against the yard numbers and his footwork, not his position on screen.
- **The deep corner** looks the same before and after (`close-corner`): an over-the-shoulder catch at head height with the corner trailing on his back.
  - The ball's placement was right before (outside, toward the pylon, away from the safety), and it's unchanged.
  - The shin-high catch the first corner recording showed (Cover 2 seed 5) is fixed in the sim: the deferral stops at his belt, and on that snap the ball was taken at 0.76 yd, not 0.32. It still draws as over the shoulder, hands high, with the ball at his thighs: Still open. (The recorded corner is seed 4, caught at head height, so it shows the catch that should be drawn that way.)
- **Drops** are a stat change you'll see as fewer receivers bobbling open balls to the turf. When a man on his hip makes the play, the result card now says "broken up". I didn't record a drop clip.

Would the owner, playing, feel the QB leads receivers and that catches look natural?

- **On crossers: yes, more than before.** The ball now meets the hands out in front across the field, where it used to be caught at the ear. That was the specific "caught beside him" look.
- **On slants: the throw is no longer swatted by a free end on a third of snaps.** The catch out in front on the slant was already there in the sim. The one thrown beyond his hands still shows a short last-frame move up close.
- **On curls and hitches: yes.** The receiver coming back to the ball reads as a man running his route to the end. The statue was the "gave up on the route" look the owner described.
- **The lead itself** (the QB putting it where the man is going) was already right in rounds 4–6 and hasn't changed. What changed is that you now see the hands meet it in front.
- **Not finished.** Catches are still drawn from a small set of clips. At broadcast distance the difference between a good catch and an off one is a few pixels of arm. The box-out, the forward reach and the low over-the-shoulder ball are the next things a fan would spot.

## Still open

- **The ball taken beyond his hands.** The sim's reach is 0.85 yd round his hands point (`reach().r`), longer than a drawn arm. On a slant led a stride long it takes the ball 1.1–1.2 m in front of him, the arms can't get there, and the ball comes the last ~0.5 m on the next frame. Two possible fixes: a forward-reach catch keyed in Blender (arms long and the trunk following, like `catch_reach_l/_r` but ahead), or the sim's reach measured from his fingertips on the run.
- **A low ball over the shoulder.** When a deep ball comes down below his belt the sim now takes it there, but the look stays over the shoulder, hands high. It wants the low basket (`catch_hands_run_low`) chosen from `catchAhead`'s height rather than the aim's.
- **The box-out** (round five's open item) is untouched. A big receiver walling off the defender needs the contact solver to give ground to the stronger man before the catch, not only the contest odds and a dropped shoulder.
- **Two identity pairs sit on the 0.8-yd line after the catch.** Tyreek Hill over Wes Welker (+0.80 to +0.98 depending on the reps) and Gronkowski over Gonzalez (+0.76 to +0.88) pass or fail on a hundredth with any change to the passing dice. Both pass at the default 6 reps now. The harness's yards after the catch for X and TE needs a bigger sample, or a sharper contrast, so the pass doesn't ride on noise.
- **The slant harness** lost ~4 points on time and a few late, from the timing calibration (`TIMING` 0.43 → 0.56) and a few more tips at the line. It's within the squeeze M6.6 set, but the player's quick game is a little harder than round 6's.
- **The AI book** sits at 66.9%, still a point above the NFL's ~65%. "2+ yd open caught" is 86% against PFF's ~80%. `TIMING` is a weak lever for this; the open-ball catch rate is the place to look next.
- **The throwing lane is invisible.** The QB's release moves up to 0.4 yd off a lineman, and the ball's flight blends from his hand onto the new line. The throw clip doesn't change its arm slot or take a slide step. A side-arm throw clip keyed in-house would make the decision visible.
- **`passidentity.ts`'s hands pair** reuses forty seeds across its plays and calls, so its drop rates move a whole drop at a time (Harrison 0.0% here). `p7drops.ts` gives each play and call its own seeds and is the better measure.
- **Spots from the backfield and checkdowns** still stand facing the QB at the line (24% of settle throws stood more than 0.2 s). That's right for a checkdown, but a spot runner could work to open grass.
- **60 fps in the browser.** These recordings are 30 fps; the catch frame and the hands' first frame on the ball are one frame here.
- **Gates vs Lewis** (identity) still waits on the owner.
