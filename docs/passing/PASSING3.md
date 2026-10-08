# The passing game, round 3: the player's own throws

The owner, after playing: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right. Continue to fix."

Rounds 1 and 2 (`PASSING.md`, `PASSING2.md`) were judged mostly on the AI's throws and the harness. This round reproduces what the owner does: he's the QB in Practice, presses a receiver's key (a tap drives it, a hold puts touch on it) and watches from the default broadcast camera. Branch `wip/passing3`.

## How it was diagnosed

- **The player's throws, scripted** (`src/game/clips.ts` `PASSING3`, `userThrow`): the receiver key pressed at a set tick after the snap, the way the e2e and clip scripts press it, on a slant, an out (hot-routed), a dig, a curl, a post, a go, a crosser and a comeback (hot-routed), each on time (pressed a release's length before his break, so the ball's out on it) and four of them late (pressed as he comes out of the break: a player's reaction).
- **Recorded on the frame-true clock** (`tools/shots/video.spec.ts`, `BTB_PASSING3=1`), 30 fps, 1280×720, from the default broadcast camera, on a dev server of its own (port 5331). Before: `docs/passing/round3/before/`. Frames were cut into contact sheets and read frame by frame; the evidence stills are in `docs/passing/round3/stills/`.
- **Every frame read against the sim** (`tools/sim/p3trace.ts`): a tick trace of the QB, the target, the ball and every other route runner (speed and heading) for the same clip.
- **The player's throws in numbers** (`tools/sim/passing3.ts`): each route × four coverages × six seeds × three press times (before the break, on it, after it); for each throw the press, release, break and arrival times, the lead (the meant point against where he was at the release and where he'd have been with no throw), the target's speed through the flight, how far every other route runner left the path he'd have run with no throw, and the catch.

## What was wrong, and why

### 1. "Receivers give up on their routes … while the ball is in the air"

**Evidence.** On every recorded play the other route runners peel off toward the ball the moment it's thrown. On four verticals (`p3-go`) all three of the other verticals swing from straight up the field to 45–60° toward the catch point within half a second of the release (`p3trace`: SLOT 9.4 yd/s at 3° → 8.4 at 45°, TE 8.8 at 3° → 8.1 at 40°, Z 9.0 at 1° → 7.9 at 45°). On the out (`stills/before-out-catch.jpg`, frames 96–103) a second receiver runs across the catch point in front of the man catching it; on the curl (`stills/before-curl.jpg`, 100–110) the back and both other receivers converge on the curl. In numbers, the other route runners were 1.6–6 yd off their own routes by the time a short ball arrived (`passing3.ts`, "oDev").

**Cause.** `src/sim/play.ts` (base `cd8db79`) line 1786, `offenseRoles`, the `route` case: once the ball is thrown to someone else, every other route runner ran `runBlock` toward the catch point "ready to block when it's caught". A go stopped going, a crosser stopped crossing.

**Fix.** The route is run until the ball's caught (the coaching rule); then the carrier branch already turns them into downfield blockers.

### 2. "Receivers give up … halfway through" and the comeback that never came back

**Evidence.** On the curl (`p3-curl`) and the comeback, the target brakes to a stop on the ball's spot and stands there with the ball in the air (curl: 3.2 yd/s at the release, 0.4 at the catch, 0.7 just after it; `p3trace`), then turns upfield from a standstill. In numbers, a curl or comeback receiver caught it at 0.3–1.4 yd/s on every press time.

**Cause.** `play.ts` line 1855 (`runToBall`, settle routes): "Come back to the ball: at it by the time it gets there, braking into the catch" was an `arrive` to the ball's spot with braking, and the throw (`passing.ts leadRun`) was led to where he stood. Nothing ever came back.

**Fix.** A settle route whose last leg turns back to the line (curl, comeback, hitch) comes back to the ball: he runs into his settle as the lead ran him, squares up to the QB, and as the ball comes he drives back down the line to it at COME_V (4 yd/s), up to 0.9–1.5 yd by his route running (`passing.ts comeBackTo`), and the throw is led to where he'll meet it. A flat, a spot or a checkdown settles facing the QB and the ball comes to him (coming back off those is turning round: a first version that brought every settle route back dropped the AI's flat from 67% to 37% complete).

### 3. "Timing is all messed up"

**Evidence, in the hand.** A throw started on the key's *release*, not its press (`play.ts` line 504: the windup began only once `s.hold` ended). A tap came out a tap's length late; a touch pass held for its loft sat in his hands for the whole hold before the arm even began: a full one ~1.1 s from the press to the ball. The player presses as his man comes out of the break, the ball comes out well after it.

**Evidence, in the motion.** The slant (`stills/before-slant-qb-throw.jpg`, frames 33–36): with the key pressed on the drop, the QB raises the ball over his helmet in *both* hands, square to the line, for four frames, then throws across his body to the left while his follow-through turns him right. Two causes:
- `choreo.ts` line 993: a throw on the move plays as an overlay over the drop's legs, but the two-hand hold overlay stayed on (it only let go for a full-body throw clip), so his off hand stayed on the ball and went up with it;
- `play.ts` line 390: through the drop he faced straight downfield (`dropStep(s, qb, 0)`) even wound up, so his shoulders only began to open to a man 60° to his left at the set, a few frames before the ball left.

A key pressed early in the drop also let the ball go while he was still backpedalling (off his back foot, the cone 25% wider for "feet not set").

**Fix.**
- The key starts the throwing motion (`qbThrow`, `holdThrough`): a tap's ball goes with his arm (his release time, by rating); a hold chooses the touch while the arm comes through, and a hold past his release keeps the ball cocked behind his ear until the key comes up or the touch is full. A tap now comes out 0.07 s sooner; a full touch pass ~0.35 s sooner (the hold and the arm overlap instead of following each other).
- A key pressed on the drop throws on the plant (the set), as a 3- or 5-step is timed; his front shoulder opens to the target over the last steps (`dropStep` faces him to his read once he's wound up).
- The drawn arm is paced every frame so its release frame lands on the sim's release (`choreo.ts drive`), starting a release's length before the ball goes; the two-hand hold lets go of the ball on a throw over the legs.

### 4. "QB doesn't lead receivers"

**Evidence.** The lead itself is right: the meant point (before any error) is within 0.1–0.2 yd of where he'd have been with no throw on every route (`passing3.ts`, "meant-base"). What the player sees is the throw's *timing error* along the man's run, and how the man handled it:
- On the deep post (`p3-post`), Joe Montana's ball (Deep Accuracy 95) to a wide-open Jerry Rice landed 4.3 yd short of where it was meant; Rice, at 10 yd/s, eased down to 5.5 yd/s over the last 0.7 s of the flight to wait for it, and was hit as he caught it.
- The timing error (`passing.ts timingSigma`, line 300) was the receiver's route running and the chemistry alone, never the QB: on a 1.7-s go to Rice it was ~2.7 yd at 1σ along his run, four times Montana's cone, the same from Montana as from a 65-accuracy passer.
- The receiver paced himself to the ball from the moment he read it (`play.ts` line 1875: `read > 0 ? need`), so on every slightly short ball he visibly eased off a yard or two a second for most of the flight: from the pocket, the ball looks unled and the receiver looks like he's quit.
- A keyboard throw with the mouse cursor resting near the icon took its placement from the cursor (`controls.ts` line 284): a back-shoulder ball nobody asked for, thrown behind his man.

**Fix.**
- The QB's accuracy is in the timing on a ball down the field (`timingQb`): ×0.7 at 99 accuracy, 1 at 85, ×1.3 at 70, coming in from 8 to 20 air yards (short throws keep their few tenths of a yard). With the base timing raised 0.40 → 0.43 to hold the AI book's completion rate (below), Montana's deep ball (Deep Accuracy 95) misses its man by ~15% less than before and a 70-accuracy passer's by ~40% more: the gap a fan should see. (A first version at ×0.6 put the AI book at 67.4%, over its band.)
- A receiver tracking a ball a stride or two short runs on at his pace and throttles down late, in the last 0.45 s, as receivers do (`runToBall`).
- A receiver key places the ball only if the mouse moves while it's down.

### 5. "Catches don't feel natural and don't look right"

**Evidence.** On the slant (`stills/before-slant-catch.jpg`, frames 56–61) and the dig (`stills/before-dig-catch.jpg`, 96–100) the hands reach to a fixed spot in front of the chest for ~0.2 s whichever way the ball is coming, and the ball is bent off its line into them over its last 0.12 s (`choreo.ts catchMagnet`, up to 1 m). The sim takes the ball when it comes within his reach (0.85 yd), 0.03–0.06 s before the spot it was thrown to, while the catch clip's secure frame was timed to the spot: for a frame or two the caught ball was drawn along his forearm (`catchHold` held it in the hands only from 0.05 s before the secure frame, line 314) before snapping into the hands.

**Fix.**
- The hands go to the ball (`choreo.ts catchReach`, `animator.ts reachHands`): over the reach, two-bone IK puts his hands either side of where the ball will be at the secure frame (the sim's flight run forward), a little behind it, elbows down and out; the ball comes into them on its own line.
- The catch clip's secure frame lands on the sim's catch: the moment the ball comes within his reach (its closing speed), not the thrown spot; and a caught ball is in his hands from 0.1 s before the secure frame.

## The numbers

**The player's throws** (`tools/sim/passing3.ts`, the practice rosters, four coverages × six seeds, on time: the key a release's length before the break; base `cd8db79` against this branch):

| Route (on time) | Ball out (s) | Other routes, yd off their path when it lands | Target's speed at the catch (yd/s) | Complete |
|---|---|---|---|---|
| Slant | 0.77 → 0.70 | 1.6 → 0.0 | 8.2 → 7.6 | 46% → 71% |
| Out | 1.69 → 1.63 | 7.4 → 0.2 | 7.2 → 7.3 | 63% → 63% |
| Dig | 1.91 → 1.86 | 4.9 → 0.3 | 6.4 → 6.4 | 54% → 71% |
| Curl | 1.98 → 1.92 | 4.4 → 0.2 | **0.7 → 4.5** (coming back) | 88% → 96% |
| Post | 1.99 → 1.76 (touch) | 13.9 → 0.0 | 8.3 → 9.4 | 38% → 46% |
| Go | 1.78 → 1.50 (touch) | 12.8 → 0.4 | 8.5 → 8.8 | 29% → 25% |
| Crosser | 2.35 → 2.28 | 5.2 → 0.9 | 9.1 → 8.8 | 58% → 71% |
| Comeback | 2.31 → 2.24 | 6.0 → 0.3 | **1.4 → 4.1** (coming back) | 83% → 92% |

(A few seeds a cell: the completion column moves a lot on a seed or two; the other columns are the point. The "other routes" figure is how far every other route runner is from the path he'd have run with no throw when the ball gets there; the deep throws' before figures include plays that had ended in the unthrown run.)

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell):

| | Before (round 2) | After | NFL |
|---|---|---|---|
| Completion | 66.5% | 66.6% | ~64–66% |
| Yards per attempt | 8.3 | 8.1 | ~7 |
| INT | 2.5% | 2.4% | ~2.2–2.5% |
| Sacks | 7.6% | 7.6% | ~6.5–7% |
| aDOT | 9.0 | 9.0 | ~8 |
| Completions of 20+ / 40+ | 16.8% / 4.4% | 16.3% / 4.3% | ~12–14% / ~3% |
| 2+ yd open caught | 88.7% | 88.7% | ~80% |
| YAC, all | 6.2 | 5.9 | |

The other receivers no longer run to the catch point to block before the catch, so they're further from the carrier when he turns upfield: YAC fell 0.3 yd.

**Checks.**
- Identity: 19 of 20 (Gates vs Lewis fails as before, on top speed and separation at the break; waiting on the owner).
- Passing identity: 9 of 9 (Montana's ball 0.73 yd off the meant spot against Namath's 1.47).
- Trait audit: 127 of 127 traits, 25 of 25 combinations.
- Tackling (`tools/sim/tackling.ts`): runs unchanged (yards after first contact 3.67, gang 43%, driven back 11%, contact to whistle 0.53 s); after the catch 2.70 yd after first contact (2.72 in round 2), driven back 24% (20%), gang 30%.
- The slant harness's "on time" key moved from tick 48 to 52 so its ball comes out on the same tick as before (the key now starts the arm); with that, Cover 2 man still takes the on-time slant away more than Cover 1 does.
