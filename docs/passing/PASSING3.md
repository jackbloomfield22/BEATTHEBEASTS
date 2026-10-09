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

## The videos

All recorded on the frame-true clock at 30 fps, 1280×720, Low quality, the player's own throws from the default broadcast camera (`BTB_VIDEO=1 BTB_PASSING3=1`, `tools/shots/video.spec.ts`), the before set from a frozen copy of `cd8db79` on its own dev server, the after set from this branch:

- `round3/before/`, `round3/after/`: `p3-slant`, `p3-out`, `p3-dig`, `p3-curl`, `p3-post`, `p3-post-b`, `p3-go`, `p3-cross`, `p3-comeback` (on time) and `p3-slant-late`, `p3-out-late`, `p3-dig-late`, `p3-go-late` (the key pressed as he comes out of his break).
- `round3/compare/`: before on the left, after on the right, the same play and the same keys.
- `round3/before-close/`, `round3/after-close/` and `compare/*-close.mp4`: the curl and the slant from a close camera on the receiver (`?follow=X,5,-5,2,42`), for the catch.
- `round3/stills/`: the contact sheets this write-up cites.

The catch's last-stretch fix (the ball carried into the hands at its own pace) went in after the first eight after clips were recorded; the close-ups, `p3-post-b` and the late clips have it.

## Watched: an honest critique

Read frame by frame from contact sheets of every clip, before against after.

- **The routes run through the throw.** This is the clearest change on screen. Before, on every play, the other receivers peeled off toward the ball the moment it was thrown: on four verticals three verticals bent in toward the go, on the out a second receiver ran across the catch point in front of the catcher (`stills/before-out-catch.jpg`), on the curl and the comeback the back and both other receivers converged on the ball (`before-curl.jpg`, `before-comeback.jpg`). After, the go's partners keep going up the field, the flat stays in the flat, the slot's slant keeps crossing (`after-out.jpg`, `after-curl.jpg`, `after-comeback.jpg`, `after-go.jpg`), and they turn to block once the ball's caught. It reads as a pass play now, not a crowd running to the ball.
- **The curl and the comeback come back to the ball.** In the close-up (`stills/before-close-curl.jpg` against `after-close-curl.jpg`) the before receiver stands square on the spot and the ball comes in sideways into his belly; after, he's striding back toward the QB with his hands out to the side the ball comes from, takes it on the move, tucks it and turns up the field in two steps. This is the change a player will feel most on the short game.
- **The QB's throw.** Before, on the slant thrown off the drop (`before-slant-qb-throw.jpg`), the QB lifts the ball over his helmet in both hands for four frames, square to the line, then throws across his body with his follow-through going the wrong way. After (`after-slant-qb-throw.jpg`) the off hand comes off the ball, the front arm points at the target, the shoulders open to the left and he follows through toward his man. One frame (32) still shows both hands up together as the throw clip blends in over the hold; it reads as part of the motion at full speed.
- **Timing.** The ball is out 0.05–0.07 s sooner for a tap and 0.2–0.35 s sooner for a touch pass, and a key pressed in the drop now waits for the plant, so the slant and the out come out of the hand as the man comes out of his break. On screen this is felt more than seen; the numbers (above) are the evidence.
- **Lead.** On the deep post the before ball (seed 2) lands four yards short of a wide-open receiver who eases from 10 to 5.5 yd/s to wait for it. The after recording of that seed is batted at the line (the ball now leaves 0.25 s sooner, into a rusher's hands), so it doesn't show the lead; `p3-post-b` (seed 4) does: caught in stride ~30 yd down the field. The lead itself was right before this round (the meant point is on his path within 0.2 yd); what changed is how far the throw misses along his run (the QB's accuracy now matters there) and how the man handles a short ball (he runs on and throttles down late instead of easing off for the whole flight). From the broadcast camera, at the distance a deep ball is caught, the difference between a ball led 1.5 yd and 2 yd is small; the player will notice the receiver no longer easing up more than the placement.
- **The catch.** The close-up slant (`stills/close-slant-catch-before-after.jpg`) is the honest case: before and after look much alike. Before, the ball is ~0.8 m short of his hands one frame and at his chest the next; after, his hands are out toward the side it's coming from, and it reaches them over two frames at its own pace instead of one, then he's tucked and turning. It no longer pops, but it's still a quick, compact catch, and the hands-to-the-ball reach is subtle at broadcast distance. The curl is where it's clearly better.

Would the owner, playing, feel the four problems are gone? Receivers giving up on routes: yes, that's fixed at its root and obvious on every play. Timing: better (the arm starts on the key, the ball goes on the plant, the touch doesn't delay it), but a player still has to throw on anticipation: the QB's release time is his rating, and a key pressed as the man breaks is a late ball by a release's length (0.3–0.45 s); there's no on-screen cue for "throw now" yet. The QB not leading: the curl/comeback/short-ball behaviour removes the most common cases where it looked unled (the man standing or slowing for it); deep-ball placement is only modestly better for an elite passer (~15%), by design to hold the AI book's completion rate. Catches: the short-game catches look natural now (coming back, hands to the ball, run after it); the run-speed hands catch is still compact and quick.

## Still open

- **The seam is harder to complete for the player.** The old pre-catch "blocking" by the other receivers was, in effect, a pick: it screened the defenders from the catch point. With it gone, a blind tap to the slot's seam on four verticals at 1.7 s (the e2e touchdown script) is caught 32% of the time instead of 50% (more balls broken up: 27% → 40% of those throws). The AI's book didn't move (it throws to open men). If the owner finds the seam too hard, the defenders' break on a seam is the place to look, not bringing back the picks.
- **A "throw now" cue.** The player still has to anticipate the break by his QB's release time; a route-timing cue on the receiver icon (the ring filling to the break) would help the timing feel without changing the football.
- **The broadcast camera swings hard in the air** (up to ~35° toward the catch on an out), which makes the ball's lead harder to judge from the couch; a calmer air camera is worth trying.
- **The run-speed hands catch** could use a slower give and tuck (the clip holds the ball out for only 0.17 s).
- **Late outs** still run toward the sideline and slow there with the ball in the air (the route ends at the boundary); a late out should come back toward the QB.
- Gates vs Lewis (identity 19/20) waits on the owner.
