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
