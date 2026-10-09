# The passing game, round 5: the catch

The owner: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right", and "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Rounds 3 and 4 (`PASSING3.md`, `PASSING4.md`) dealt with the routes, the timing, the lead and the late out. Round 4's own critique said the catch was still the weakest part: the give and tuck barely showed, and catches looked compact and all alike. This round is about the catch. Branch `wip/passing5`, from `e8440d6` (the tip of `claude/m66-polish`).

## How it was diagnosed

- **A per-frame catch log.** `tools/shots/video.spec.ts` with `BTB_DIAG=1` writes `diag.json` next to a recording's frames. For every drawn frame it logs the sim's ball, the drawn ball, and, for the man the ball is thrown to, his catch clip and its time, the overlay layers and their weights, and the world positions of his hands (the finger roots), chest and head. The video and the numbers line up frame by frame.
- **What the catches are.** `tools/sim/p5catch.ts` covers the AI book (every base pass play against every call). For each completion it records the sim's catch look, the drawn style (below) and the ball's height at the catch. `tools/sim/p5find.ts` searches seeds for each kind of catch, and `tools/sim/p5clips.ts` checks the clips.
- **The clips in Blender.** `tools/blender/preview_catches.py` lays each catch overlay over the run the way the runtime does: the overlay's baked local rotations on its masked bones over the run's. It draws a football in the hands from the secure frame and renders six frames around the catch. (A first version applied the overlay's IK targets in world space and hid the main bug; see 1 below.)
- **Video.** One play per kind of catch (`src/game/clips.ts PASSING5`), recorded on the frame-true clock at 30 fps and 960×540 on Low, from the default broadcast camera and from a close camera on the catcher (`BTB_PASSING5=1`, `BTB_FOLLOW=1` for the close one). The before set comes from a frozen copy of `e8440d6` plus the clip list, so it is the same play and the same keys.

## What was wrong

1. **Every run-speed catch was keyed on a man standing up.** `tools/blender/lib/actions_m65.py:145` (`hands_run`), `:171` (`hands_run_low`) and `:197` (`body`) were authored on the idle body. An overlay's arm rotations are local to the chest. Laid over the run, where the trunk is 13–17° forward and the hips 8 cm down (`gait.py:234`), the hands came out about 0.2 m lower than keyed. The diamond met the ball at the belt, and the clip's "into the chest" key brought it to the navel. The before log of `p5-hands` (close) shows it: the ball comes in at 1.53 m, the hands wait at 1.19 m, and two frames after the catch the ball is held at 0.92–0.98 m, on the hip. That's the "doesn't look right" catch: a chest-high ball pulled down to the belt and carried there.
2. **The hands let go of the ball the frame the sim called the catch.** `src/render/game/choreo.ts:393` (`catchReach`): the IK reach to the ball returned as soon as the ball wasn't in the air. Round 4's slant log shows the hands 0.35 m off the ball one frame and back on the clip's pose the next, with the ball dragged after them.
3. **One clip for nine catches in ten.** `catchLook` (`src/sim/passing.ts:921`) returns `hands` for 90.3% of the AI's completions (`p5catch.ts`), and `choreo.ts:1091` drew every one of them with the same `catch_hands_run` (or its low twin). Catching played no part in what you saw: a 99 and a 60 caught identically.
4. **Hands up early, from the hips.** The catch overlay started its full lead (0.3 s) before the ball (`choreo.ts:1099`), from a "ready" key with both hands in front of the hips. The arms left the run's swing early and dropped before they came up, the waiter's hands coaches tell receivers not to show.
5. **The ball shrank at the catch.** In the air the drawn ball grows with distance from the camera (up to 1.6×, so it reads at broadcast distance). The frame it was caught it went back to true size (`src/render/game/GameScene.tsx:515`). On a catch 30 m from the camera it lost a third of its size in one frame, which reads as a pop.
6. **The camera left the catch at once.** The air camera pushes in on the catch point. The frame the sim called the catch, the carrier camera (11 yd back, fov 50) took over and pulled out, so the hands, the give and the tuck happened while the frame was moving away.
7. **The late out still waited** (round 4's first open item). `workBack` timed his plant on the driven ball (`passing.ts:612`). When the QB had to loft it over the flat defender, the ball hung 0.47 s longer, and he planted, stood (0.43 s of the last second, `p5lateout.ts`) and came back at a walk (0.8 yd/s at the catch).
8. **The cue** (round 4's open items): the open glow's thick, pulsing lime ring outshone it. A covered man's icon was dimmed and desaturated as a whole (`game.css:100`), cue included. There was no way to turn it off.

## What changed

### The catch clips, keyed again (`tools/blender/lib/actions_p5.py`)

All of these are keyed in-house (`python3 tools/blender/build_anims.py`: 184 of 184 clip gates pass; six clips are new, and three are re-keyed). They're authored on `RUN_BASE`, the run's mean trunk, so a key's height is where the hands are when he's running. The mask now includes the upper spine, so the chest can lift to a high ball or fold over a low one. From receiver coaching ("late hands", "eyes, hands, tuck", thumbs together above the waist and pinkies below it, "chin it" in traffic):

- `catch_hands_run` (re-keyed): the hands come up out of the run's carriage in the last 0.17 s, out to the ball in the diamond at chest height (arms long, about 0.55 m in front of the shoulders, the chest lifted 3°). They give 8 cm as the ball lands, bring it in to the sternum with both hands by +0.15 s, then put it away high and tight by +0.33 s.
- `catch_hands_run_low` (re-keyed): pinkies together, palms up, the chest folding over the ball, then scooped up to the sternum.
- `catch_hands_high` (new): over the face mask without a jump. The arms go up, the diamond is above the eyes, the chest lifts 7°, then the ball is pulled down to the sternum.
- `catch_scoop` (new): at his shoe tops. The trunk folds deep over the ball (and the runtime sinks his hips with the carrier's traffic gait), the pinkies go under it, and he scoops it up into his chest.
- `catch_reach_l` and `catch_reach_r` (new): across or outside his frame. Both arms go long to the ball at chest height and the trunk leans and turns after them; the ball comes back across to the sternum and is tucked in the right arm, as every carry is.
- `catch_contested_l` and `catch_contested_r` (new): through contact, with the defender on that side. The near shoulder drops and turns into him (the box-out), and the hands come late and strong in front of the face mask. He snatches it with no give and chins it at once, both forearms clamped over it under the chin, his chest folded over it through the hit. He tucks it late (+0.4 s).
- `catch_body` (re-keyed): elbows pinned to the ribs, forearms up. The ball is let into the chest at the numbers and trapped there, then covered and tucked.

### Which catch, and who's catching (`src/sim/catchstyle.ts`, new, pure)

`catchStyle(s, r)` refines the sim's look from where the ball gets to him and who he is. The sim's own looks (the jump, over the shoulder, the toe tap, one hand, the dive, SECURE) stand. A defender predicted within 1.2 yd at the arrival makes the catch **contested**. Below the knees (0.55 yd) it's the **scoop**. Past his shoulder (0.55 yd across his run) it's the **reach**. Below the belt it's **handsLow**, and above the shoulders **handsHigh**. Into the chest, a **body** catch happens as often as his hands say: never for Catching 75 and up (or Glue Hands or Sure Hands), rising to 90% for poor hands; a Body Catcher does it 85% of the time and Drops adds 15 points. The choice is a hash of the play's seed and the throw, so a replay draws the same catch. In the AI book (`p5catch.ts`, 1,985 completions) the drawn catches are 65.6% hands, 15.6% reach, 9.5% over the shoulder, 4.7% through contact, 2.1% low, and the rest the toe tap, high, body, dive, scoop and the jump. The book's receivers are the 1980s 49ers, all sure-handed, so body catches are rare there. Swap in a body catcher and they aren't (below).

**Every player is himself.** `pluckOf` sets where his hands meet the ball: a Catching 95 at the end of his arms (0.72 m from his line), a 60 with his elbows bent and the ball closer in (0.45 m). A body catch meets it at the chest (0.22 m). The secure frame lands where his hands meet the ball (`meetTime`: when the ball comes within that distance of his line, run forward), no longer at the arrival less his reach. On the same snap of Trips Stick, Jerry Rice (Catching 99) plucks the stick out in front of him with his arms long; Kelvin Benjamin (63, Body Catcher) lets it into his chest and traps it (`p5-hands` against `p5-body`). Rob Gronkowski's contested catch takes 0.7 of the pair's lean into each other against Ronnie Lott (`boxShare`: the sim's own body-position terms, the mass share and the Strength gap, plus Big Body), so the bigger man holds his spot and the defender gives ground. The weak hands also bobble more, which the sim already decided (round 2).

### The hands, the eyes and the ball (`src/render/game/choreo.ts`, `GameScene.tsx`)

- **The hands stay on the ball through the catch tick.** The IK targets at the ball are kept in his own frame. After the sim calls the catch, the hands hold where they met it and give with it into the clip's own secure and tuck over 0.16 s (`GIVE_T`), instead of dropping to the clip's pose.
- **Late hands.** An in-stride catch's overlay starts 0.2 s before the ball (`LATE_HANDS`), not its whole lead, so the hands come up out of the run's arm swing. The full-body catches (the jump, the dive, the toe tap) keep their own lead.
- **Eyes into the hands.** Through the secure his look follows the ball into his hands (a wide look: the chin comes down to it), and it goes back up the field as the ball is put away.
- **The ball eases to its true size** in the hands over 0.2 s instead of shrinking in one frame. In the air it still flies on its own line into the hands at its own pace (round 3's catch-in), with the spiral and the nose along the flight (`ballFlight.ts`, unchanged).
- **The catch event no longer restarts the clip** when the sim's final look is the plain hands catch the style already drew (the restart at the secure frame was a pop). A look the sim insists on (the dive, the toe tap, the jump, SECURE) still switches.

### Readability from the broadcast camera

- **The catch beat** (`GameCamera.tsx catchBeat`): for 0.12 s after the catch the air camera's tight framing holds on the catcher, carried along with him, and over the next 0.33 s it eases out to the carrier camera. The game clock doesn't change.
- **The sound of it** (`audio.ts catchPop`, synthesized): the leather's slap on the gloves, duller for a body catch and harder through contact. A completion 20 or more yards downfield lifts the crowd (`bigPlay`).

### The late out on a lofted ball (`src/sim/passing.ts workBackTo`)

The QB's ball is unchanged: where he meant it and when it arrives. After the throw is fitted to his arm (`fitArm`, `clearLoft`), the receiver's plant is moved out along his out, toward the landmark, to the point that leaves him just the time to plant and come back to the ball at `COME_V`. His settle is a stride past the catch point, so he comes back through the catch instead of stopping on it.

### The cue

- Its track and fill are thicker, and the "now" gold is brighter. While the cue runs, the open glow stops pulsing and drops its glow (the lime ring still says he's open).
- A covered man's dimming is on the icon's own parts, not the cue ring, so the cue reads on a covered man too.
- **Settings › Gameplay › Throw-timing cue** turns it off. This is a new boolean with a default, so the settings version is unchanged: the deep merge fills it in for saved settings. How to Play says where the setting is.

## The numbers

The catch work is drawing, not the sim's dice: who catches the ball, and how often, didn't change. The one sim change is the late out's route on a lofted ball (the QB's ball is the same). The determinism golden didn't move (no AI golden case throws a lofted late out), so it wasn't re-pinned.

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell, 14,875 attempts):

| | Before (round 4) | After | NFL |
|---|---|---|---|
| Completion | 67.7% | 67.7% | ~64–66% |
| Yards per attempt | 8.2 | 8.2 | ~7 |
| INT | 2.4% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 8.9 | 8.9 | ~8 |
| 2+ yd open caught | 89.5% | 89.5% | ~80% |

The book's completion stays at 67.7%, inside the 62–68% band. Nothing in the catch work moves it, and a nudge toward 65% would have to come from the sim's catch odds or the coverage, which this round didn't touch (see Still open).

**Checks** (before → after):

| Harness | Before | After |
|---|---|---|
| Identity (`identity.ts`) | 19 / 20 | 19 / 20 (Gates vs Lewis, waiting on the owner) |
| Passing identity (`passidentity.ts`) | 9 / 9 | 9 / 9 (Montana 0.73 yd off the meant spot, Namath 1.47; Harrison drops 2.8% of open balls, Slayton 8.7%) |
| Trait audit (`traitaudit.ts`) | 127 / 127, 25 / 25 | 127 / 127, 25 / 25 |
| Slants (`slants.ts`), on time zone / man | 62% / 66% | 62% / 66% (identical output) |
| Screens (`screens.ts`) | | identical output to the base tree |
| Clip gates (`build_anims.py`) | 178 / 178 | 184 / 184 |

**The late out** (`tools/sim/p5lateout.ts`: the hot-routed out on Doubles Curls pressed a third of a second after the break, four coverages × eight seeds). For the balls the QB has to loft over the flat defender:

| | Before | After |
|---|---|---|
| Stood (under 1.5 yd/s) in the last second before the ball | 0.43 s | 0.13 s (the plant) |
| Coming back to the line at the catch | 0.84 yd/s | 1.69 yd/s |
| Complete | 5 of 10 | 4 of 10 |

The driven late outs and the quick out are unchanged. The lofted ones are only ten throws, and one fewer was caught, which is within a ball of the noise. The stand that's left is a ball the QB missed by more than his read (seed 4: 1.4 yd off its meant spot, intercepted). There he leaves his route for the ball (`play.ts runToBall`), gets to it early and waits under it; that's the general early-arrival case, not the plant's.

**The coordinator's film** (`src/sim/film.ts`) is regenerated. It was already stale at `e8440d6`: the base tree's own film tool writes the same file this branch does, so the late out doesn't change it.

**What the catches are** (`p5catch.ts`, the AI book, 1,985 completions): 65.6% hands at the chest, 15.6% the reach, 9.5% over the shoulder, 4.7% through contact, 2.1% low, and under 1% each the toe tap, high, body, dive, scoop and the jump. Before, all of the in-stride ones were the same clip (90.3% of the book).

## The videos

Recorded on the frame-true clock at 30 fps, 960×540, on Low (`BTB_VIDEO=1 BTB_PASSING5=1 BTB_DIAG=1`, `tools/shots/video.spec.ts`; `BTB_FOLLOW=1` for the close camera). The before set comes from a frozen copy of `e8440d6` with the clip list added, so it's the same play and the same keys. Re-encoded at crf 28 to keep them small. This container draws a frame in 3–6 s.

- `round5/before/`, `round5/after/`: the default broadcast camera. `p5-hands` is Jerry Rice's stick, `p5-body` is the same snap with Kelvin Benjamin at X, `p5-high` is the curl placed over his head, `p5-low` is the slant at his knees, `p5-scoop` is the hitch at his shoe tops (the sim lays him out: see the critique), `p5-reach` is the slant thrown behind him, `p5-contested` is Gronk's leak through Ronnie Lott, `p5-highpoint` is the GO UP call on the go, `p5-shoulder` is the go over the shoulder, and `p5-toetap` is the quick out at the sideline.
- `round5/before-close/`, `round5/after-close/`: the same plays from a close camera on the catcher.
- `round5/compare/`: before on the left, after on the right (`<clip>.mp4` broadcast, `<clip>-close.mp4` close). The identity pair after the change is `p5-rice-vs-benjamin(-close).mp4`: Rice on the left, Benjamin on the right, the same snap.
- `round5/stills/`: the sheets this write-up cites. `clips-before-over-run.jpg` shows the old clips laid over the run as the runtime lays them; `clips-after-*.jpg` shows the new ones; `close-*-before-after.jpg` and `broadcast-*-before-after.jpg` run from five frames before the catch to seven after, before on top, after below.

## Watched: an honest critique

I read every clip as contact sheets and full-resolution crops (round four's cue dig was recorded again on both trees for the cue), before against after, from five frames before the catch to seven after (`round5/stills/`), alongside the per-frame log.

- **The in-stride catch is at the chest now, and it stays there.** Before (`stills/close-rice-vs-benjamin-before-after.jpg`, top row), Rice's hands reach out low and to the side early, the ball meets them at the belt, and for the next half second he runs with it on his hip. After (second row), the hands come up later, meet it out in front at chest height, and bring it in under his chin, then high and tight. The log says the same: the ball held at 1.2 m a quarter second after the catch, not 0.95 m. From the broadcast camera (`stills/broadcast-hands-before-after.jpg`) the difference is small but readable: the ball sits on the numbers instead of the belt, and the catch beat keeps him larger in frame for a few frames after the catch.
- **The pair reads.** On the same snap, Benjamin (`p5-body`, rows three and four) keeps his elbows in and lets it hit his chest, trapping it with his forearms and hunching over it, while Rice plucks it with his arms long. Before, the two were drawn the same, frame for frame. This is the clearest "every player is himself" change in the round. From the broadcast camera it reads as Rice's arms out against Benjamin's arms in; you need to be watching for it.
- **High, low and reach are new shapes.** The curl over his head (`stills/close-high-before-after.jpg`): before, his hands stay at his chest and the ball snaps down into them from above his helmet; after, both arms go up, he takes it above his face mask and pulls it down. The slant at his knees (`close-low-before-after.jpg`): the trunk folds over it and it comes up to his chest instead of being carried at the belt. The slant thrown behind him (`close-reach-before-after.jpg`): both arms go long to it with the trunk leaning after them, where before one arm went a little way out and the ball ended at his belly. All three are obvious from the close camera. From the broadcast camera the high catch is obvious; the reach and the low catch are visible if you look for them.
- **Through contact.** Gronk on the leak (`p5-contested`, close): before, his hands are low at his side and he runs off with the ball at his belly while Lott hits him. After, his hands come up strong in front of his face, he snatches it, chins it under his face mask with both forearms and hunches through the hit. That reads as a contested catch secured. The box-out lean (0.7 of the pair's lean) is subtle at this distance; the clip's dropped shoulder carries more of it than the lean does.
- **The high point, over the shoulder and the toe tap** are round M6.5's clips, and they look much as they did (`p5-highpoint`, `p5-shoulder`, `p5-toetap`). On the go over the shoulder, both before and after, the drawn ball is still a yard off his hands the frame the sim calls the catch and flies into them over the next two frames. At 30 fps it reads as the ball dropping into the basket, but it's the least precise of the catches.
- **The scoop didn't make the video.** On the clip I found for it (the hitch at his shoe tops), the sim calls the catch a dive (`catchLook`: low and over a yard away), and the dive wins in both versions: he lays out for it. The scoop clip itself is shown laid over the run in `stills/clips-after-hands-high-low-scoop.jpg`. In the AI book it's 0.3% of catches.
- **The ball.** It no longer shrinks at the catch: it eases from its broadcast size to its true size over 0.2 s. It never left the sim's flight before the catch, and it never does now. It's held in the right arm after every tuck, including the left-side reach and contest. I haven't found a frame where it passes through the body, but the tuck frames are small at 960×540.
- **The late out** drives back to the lofted ball instead of standing at his plant (0.43 s stood → 0.13 s). I checked this in the trace, not on video; the AI's late outs are driven balls, which are unchanged.
- **The cue** (`stills/cue-covered-and-now-before-after.jpg`: round four's dig on the cue, recorded on both trees). On the covered tight end (icon 4) the cue used to be dimmed with the rest of the icon, barely there; now its white fill and gold release read clearly around the dimmed icon. On the open man lit gold for "now" (icon 1, frame 58), the gold ring is thicker and the lime pulse no longer competes with it. At 960 px it's still a small ring: a player who wants it louder will want it bigger, and one who doesn't can turn it off.

Would the owner, playing, feel that catches now look natural? **Mostly, from the default camera; clearly, from up close.** The biggest thing he'll feel without knowing why is that the ball goes to the chest and stays high, instead of being pulled down to the belt and carried on the hip: that was the "doesn't look right", and it was every in-stride catch. Catches are no longer all the same: a high ball goes up, a ball behind him gets a long reach, traffic gets a chinned ball, and a weak-handed man looks weak-handed. What's left is that at broadcast distance (~60 px tall at 960 wide) the hands are a few pixels, so the shapes read through the silhouette (arms up, arms long, arms in) more than the hands. The catch beat on the camera helps. It isn't a replay-style close-up, and it shouldn't be one in live play.

## Still open

- **The deep ball's last yard.** On a fast ball the sim calls the catch while the drawn ball is still up to a yard off his hands: its reach is measured from his centre, and the drawn ball runs a tick behind. The ball flies the rest of the way in two frames. A catch radius measured from the hands, or the secure frame a frame later on balls over 18 yd/s, would close it.
- **The scoop** loses to the sim's dive whenever the ball is low and more than a yard away. A low ball within reach should be scooped running, not laid out for. That's the sim's `catchLook` threshold (`away > 1.1`), and changing it moves when receivers go to the turf.
- **The carry is always in the right arm** (`ovl_carry_r`, the carry gaits). A catch on the left sideline should be tucked in the outside (left) arm. That needs mirrored carry gaits and a carry-side rule.
- **Early arrival.** A man who gets to an off-target ball early stands under it (`runToBall`). The late out's stand that's left is this case.
- **The box-out** is a lean share and a dropped shoulder. A big man walling the defender off with his body, the defender drawn off his line, would need the contact solver (`contact.ts`) to displace the weaker man, not only lean him.
- **The AI book's completion** is still 67.7%, inside the band but above the NFL's ~65%. The catch work is drawing only, so it can't move it. A nudge would come from the sim's catch odds or the coverage.
- **60 fps in the browser.** These recordings are 30 fps at 960×540. The give (0.05 s) and the hands rising (0.17 s) are one to five frames here.
- **Gates vs Lewis** (identity 19/20) still waits on the owner.
