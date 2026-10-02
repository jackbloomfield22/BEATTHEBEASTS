# The slant exploit (Playtest 2)

> "Slants are an exploit: backing up and throwing is always open. Coverage on quick game has to squeeze it; part of the zone work."

## Measuring it

`tools/sim/slants.ts` plays the slant as the player does, in user mode: the snap, then either the three-step drop and the key down as he sets (0.8 s; the ball is out ~1.2 s after the snap with the windup), or the arrow held back from 0.4 s so the QB retreats (to ~18–21 yd behind the line) for 1.5, 2.0 or 2.5 s before the tap. The called Slants concept (each of the three slants in turn), and slants hot-routed onto Quick Outs, Four Verticals and Curl Flat; both hashes and the middle, flipped and not; every call on the sheet; then up the field after the catch. Per call: completion, interceptions plus breakups, yards an attempt, yards after the catch, separation at the catch, and the separation as the ball leaves the hand (what the player sees when he lets it go). `--how` says what decided each throw, `--pick` throws to whichever slant looks open, `--lbs` swaps the linebackers.

## What was wrong

Traced play by play (`--how`, and dumps of every defender at the windup, the release and the arrival):

1. **Zone defenders kept spacing on their landmarks however long the QB held it.** A slant not thrown on rhythm flattens across the field; the hook and curl defenders "matched" it only within 4–5 yd of their spots (the windows between zones are the offense's, on time) and let it go, and when the QB had bailed 11–13 yd straight back there was no rule that said the timing was gone. At 2.5 s the target was 3+ yd clear as the ball left on half the throws against zone.
2. **A slant counted as a vertical.** `vertical` was any receiver past 4 yd moving upfield at 3.5+ yd/s, so a 45° slant qualified: a flat defender or a Cover 2 cloud corner "carried #1 vertical" and followed the slant inside, across the field, and left the flat and the sideline empty.
3. **A defender breaking on the ball braked to stop on the catch point from 10+ yd out, whatever the time.** On a ball that hung 2 s (the late throw from 20 yd deep), a half-field safety arrived at 6 yd/s, 4 yd short.
4. **Nobody undercut.** A defender who got to the spot first stood on it; the receiver, arriving with the ball, caught it in front of him. A ball that hangs is the one that gets picked, and it wasn't.

## The fix (`src/sim/ai.ts`)

- **Plaster when the QB is off schedule** (`offScheduleT`, `offSchedule`, `plaster`). Off schedule is the drop's set plus a hitch or two (`HOLD_LATE`, 1.0 s: ~1.6 s on a three-step, ~2.0 on a five-step), or the QB bailing 3 yd behind his launch point (`BAIL`). Each underneath zone defender sees it after his own read (`reaction`, Play Recognition) and from then on sticks to the nearest receiver in his area nobody else has, wherever he goes: a step underneath and on his inside hip, at his speed. How tight is his Zone Coverage (~0.5 yd under for a 95, ~0.9 for a 70, ~1.5 for a 30). A vertical with a deep defender over him is still handed to the deep man. Deep zones are unchanged (they already keep the deepest man in their band in front of them).
- **A vertical is upfield, not across** (`VERTICAL_TAN`: within ~35° of straight up the field).
- **Undercut, not from a trail** (`breakOnBall`). A defender who can be a yard in front of the catch point, back along the ball's line, 0.3 s before the ball (`UNDERCUT`, `UNDERCUT_SLACK`) plays it there, so it reaches his hands first; interceptions and breakups then come from the existing roll (his Ball Skills). A man behind the receiver along his run (on his hip, `TRAIL_R`) can't get round him and plays through the hands.
- **Break at the pace that gets there** (`breakOnBall`): he brakes to stop on the spot only while that still gets him there with the ball; a man who'd be late runs at the speed that makes it (flat out if need be).

The AI QB is untouched; it already reads the coverage before it throws.

## Figures

Called and hot-routed slants pooled; ~1000 throws a script against zone (cover 3, 2, 4, Tampa 2, fire zone, sim pressure), ~670 against man (cover 1 press and off, 2-man, 1 blitz). "At release" is the nearest defender to the target as the ball leaves the hand.

| | before | after |
|---|---|---|
| zone, on time | 58%, int+pbu 31%, 5.5 ypa, YAC 1.9, sep 1.24 | 53%, 36%, 5.1, 1.9, 1.23 |
| zone, late 1.5 s | 37%, 22%, 6.4, 4.0, 1.82; at release 3+ yd 18% | 38%, 22%, 6.3, 3.5, 1.76; 11% |
| zone, late 2.0 s | 55%, 23%, 11.6, 5.3, 1.55; at release 3+ yd 26% | 48%, 32% (int 6%), 10.1, 5.4, 1.49; 14% |
| zone, late 2.5 s | 57%, 22%, 18.1, 8.6, 1.90; at release 3+ yd 49% | 49%, 31% (int 6%), 14.6, 6.6, 1.57; 31% |
| man, on time | 59%, 32%, 4.9, 0.8, 1.12 | 50%, 42%, 4.2, 0.9, 0.95 |
| man, late 1.5 s | 53%, 16%, 8.8, 3.8, 1.70 | 46%, 28%, 7.3, 2.7, 1.41 |
| man, late 2.0 s | 55%, 25%, 11.0, 3.8, 1.30 | 46%, 38% (int 6%), 8.7, 2.4, 1.09 |
| man, late 2.5 s | 47%, 37%, 12.1, 2.4, 1.06 | 40%, 44% (int 6%), 10.5, 2.6, 0.86 |

Per call (before | after; cmp, int+pbu, ypa, YAC, separation at the catch):

| call | throw | cmp | int+pbu | ypa | yac | sep | cmp | int+pbu | ypa | yac | sep |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cover3 | on time | 48% | 38% | 4.6 | 2.0 | 0.95 | 41% | 45% | 4.0 | 2.2 | 0.92 |
| cover3 | late 2.0 | 50% | 26% | 9.9 | 4.5 | 1.29 | 43% | 34% | 8.9 | 5.0 | 1.28 |
| cover3 | late 2.5 | 60% | 21% | 19.2 | 9.8 | 1.89 | 46% | 32% | 13.7 | 7.4 | 1.40 |
| cover1 | on time | 57% | 31% | 4.5 | 0.8 | 1.06 | 41% | 48% | 3.3 | 0.9 | 0.89 |
| cover1 | late 2.0 | 56% | 25% | 12.0 | 5.2 | 1.40 | 43% | 44% | 8.5 | 3.5 | 1.16 |
| cover1 | late 2.5 | 45% | 41% | 11.9 | 3.0 | 1.05 | 43% | 42% | 11.4 | 3.3 | 0.88 |
| cover2 | on time | 58% | 32% | 4.9 | 0.9 | 1.09 | 49% | 40% | 4.4 | 1.4 | 1.09 |
| cover2 | late 2.0 | 64% | 12% | 13.9 | 5.7 | 1.60 | 57% | 20% | 12.5 | 5.8 | 1.75 |
| cover2 | late 2.5 | 63% | 21% | 19.5 | 7.5 | 1.72 | 56% | 27% | 17.4 | 7.2 | 1.80 |
| cover4 | on time | 58% | 33% | 5.6 | 2.0 | 1.27 | 57% | 34% | 5.5 | 2.0 | 1.22 |
| cover4 | late 2.0 | 51% | 26% | 10.2 | 4.2 | 1.56 | 41% | 38% | 8.3 | 4.5 | 1.40 |
| cover4 | late 2.5 | 54% | 25% | 15.3 | 5.6 | 2.22 | 46% | 33% | 12.5 | 4.6 | 1.80 |
| cover2man | on time | 62% | 31% | 5.1 | 1.0 | 1.01 | 56% | 36% | 4.7 | 1.0 | 0.76 |
| cover2man | late 2.0 | 47% | 30% | 9.0 | 2.8 | 1.22 | 46% | 37% | 8.4 | 1.8 | 1.01 |
| cover2man | late 2.5 | 42% | 43% | 10.6 | 1.2 | 1.04 | 37% | 47% | 9.3 | 1.1 | 0.85 |
| cover1blitz | on time | 54% | 38% | 4.4 | 0.7 | 1.11 | 46% | 50% | 3.7 | 0.8 | 0.93 |
| cover1blitz | late 2.0 | 56% | 21% | 11.7 | 4.2 | 1.39 | 49% | 34% | 9.4 | 2.4 | 1.15 |
| cover1blitz | late 2.5 | 46% | 32% | 12.3 | 2.9 | 1.08 | 35% | 47% | 9.5 | 3.3 | 0.87 |
| cover1off | on time | 65% | 28% | 5.6 | 0.7 | 1.30 | 58% | 35% | 5.0 | 0.8 | 1.22 |
| cover1off | late 2.0 | 60% | 25% | 11.3 | 2.9 | 1.21 | 49% | 37% | 8.7 | 2.1 | 1.05 |
| cover1off | late 2.5 | 53% | 33% | 13.7 | 2.5 | 1.07 | 46% | 40% | 11.8 | 2.7 | 0.83 |
| tampa2 | on time | 55% | 29% | 5.4 | 2.3 | 1.32 | 52% | 33% | 5.2 | 2.3 | 1.27 |
| tampa2 | late 2.0 | 57% | 16% | 12.5 | 5.5 | 1.87 | 57% | 22% | 14.1 | 8.4 | 1.89 |
| tampa2 | late 2.5 | 52% | 26% | 17.3 | 9.2 | 1.66 | 50% | 28% | 16.4 | 8.5 | 1.61 |
| firezone | on time | 63% | 23% | 6.5 | 2.6 | 1.73 | 60% | 25% | 6.2 | 2.5 | 1.76 |
| firezone | late 2.0 | 51% | 32% | 12.4 | 8.6 | 1.68 | 48% | 35% | 9.4 | 4.0 | 1.25 |
| firezone | late 2.5 | 54% | 24% | 19.4 | 12.3 | 2.22 | 46% | 35% | 13.4 | 6.5 | 1.26 |
| simpressure | on time | 67% | 28% | 6.1 | 1.4 | 1.10 | 59% | 37% | 5.3 | 1.2 | 1.09 |
| simpressure | late 2.0 | 58% | 25% | 10.8 | 3.2 | 1.32 | 40% | 41% | 7.8 | 4.4 | 1.33 |
| simpressure | late 2.5 | 60% | 18% | 17.9 | 7.4 | 1.71 | 51% | 34% | 14.1 | 5.5 | 1.52 |

**Ratings.** The same plays and seeds with the Beasts' three linebackers swapped (hot slants, zone calls): Ray Lewis, Kuechly, Brooks (Zone Coverage 88–92) give up 51% on time and 50% / 47% late (2.0 / 2.5 s, 9.5 / 12.7 ypa); Sam Mills, Paup, Porter (67–68) 58% and 51% / 50% (10.0 / 14.3); Carl Banks, Bart Scott, Millen (29–33) 63% and 53% / 52% (10.7 / 15.0). The gap is clear on time, smaller late, where all three groups are trailing a receiver across the field.

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell): completion 68.3% → 66.6%, 8.5 → 8.1 yd an attempt, interceptions 1.2% → 1.7%, 20+ yd completions 18.3% → 17.8%, YAC 7.6 → 7.3; the AI's slants 51% → 50%. Sacks, pressure, hang times unchanged.

**The identity harness**: 17 of 20. DeSean/Boldin (traffic catch) and Gronk/Gonzalez (YAC) failed before too; Gates/Marcedes Lewis now misses top speed by 0.04 mph (0.76 against the 0.8 needed; it was 0.80 before): Gates is unchanged at 21.1, Lewis's 90th-percentile speed moved with the coverage around him. The coverage pairs (Deion/Kam, Revis/Law, Reed/Kam) pass with their gaps a little wider.

**Clips.** Three scripted plays behind the recorded videos changed outcome and were re-found (`src/game/clips.ts`): the PA post concept against Cover 2 man (seed 13 → 40, the same play, call and throw; on 13 the half safety now gets a hand to it), the scramble-drill concept (Cover 3 seed 9 was now picked, the zones plastering once the QB is out; now Cover 4 seed 17, the Y working back to the QB in the open, 10 yd, the same escape and throw time), and the coverage identity pair (seed 15 → 20, Deion's pick and Kam's 70 yd as before). Those three videos need re-recording.

## What is still wrong

- **The late slant is closed, but not shut.** Late throws are now ~45–49% complete with a third of them picked or broken up, against ~55% and a fifth before, and the man is rarely clear as the ball leaves. But they still go for 9–15 yd an attempt, because a completion is a 40–50 yd throw caught 15–25 yd down the far sideline. Two things outside coverage make that throw exist: the QB backs straight up 11–13 yd for 2–3 s and is sacked on 0–7% of them (the rush and its blockers retreat with him; a real pocket can't), and an uncaught slant runs on across the whole field and up the far sideline at full speed (the route's continuation past its last point), where no zone can stay on a receiver for 40 yd.
- **On time it is still not the high-percentage throw it should be** (~53% vs zone, ~50% vs man; NFL ~65–70%), and the squeeze took ~5 points (zone) and ~9 (man) off it. Two offense-side causes found on the way, both left alone here: (1) `clearLoft` (`src/sim/passing.ts`) counts a rusher locked up with a blocker as a defender in the throwing lane, so 72–87% of on-time slants go up as touch passes hanging ~1.0–1.1 s instead of ~0.7, the receiver waits, and the defense closes (the AI's own read, `openness`, already ignores engaged linemen); (2) with that fixed, `lead()` puts the driven slant ~1.1–1.4 yd ahead of where the receiver really is on the route's flattening second leg, so a quarter of them land where nobody catches them. Both made on-time worse when fixed alone, so neither is in.
- Watched only in the numbers and in per-tick dumps, not on screen: the plaster, the undercut and the break need watching in the browser before this is called done.

# Second pass: the on-time slant (M6.6)

> On time, the slant is the high-percentage throw it is in football. The late one stays clearly worse.

Before this pass, on-time slants (thrown on the break, `ON_TIME`) completed 45% against zone and 37% against man on the called Slants concept (n 600 / 400; 56% / 59% hot-routed), with 44–58% of them picked or broken up, for 3–4 yd an attempt.

## What was wrong (per-tick dumps: `tools/sim/slantdump.ts`)

1. **Touch passes that couldn't clear anyone.** `clearLoft` counted rushers locked in blocks as throwing-lane defenders, and 72–93% of on-time slants went up as touch passes (~1.0–1.1 s in the air instead of ~0.74). With engaged rushers skipped, the ones left were still lofted: every one was a linebacker within a yard of the last tenth of the path, on the catch point, where the ball comes down to the hands whatever its arc. After four 12% steps it was still "blocked", and the code threw it into him anyway, 57% slower.
2. **The ball was led to a route he doesn't run.** `lead()` ran the route's straight legs; the receiver runs them on the movement model, and a bend he takes at speed (the slant flattening at 7 yd, ~25°, under the plant threshold) he rounds a yard wide, by his Agility. On the driven slant the meant point was 0.76 yd ahead of him and 0.79 across his run at the arrival, and a fifth of the balls landed out of his reach. It wasn't only the slant: every route with a bend (drags, crossers, digs, the in, the leak) had it, which is why the AI's drags completed 60% and its slants 46%.
3. **0.05 s of extra lead** (`T = hang + 0.05` since M5, no reason given): the ball half a yard in front of him on top of 2.
4. **Batted balls.** With the loft gone, the driven slant passes over the engaged tackle and end at their hand height, and `batAtLine` let an engaged rusher bat it as if he were free: 14% of on-time slants batted, 5.8% of the AI's attempts (the NFL runs ~1.5–2%).

## The fix

- `src/sim/passing.ts` `leadRun` (behind `lead`, ~l.49) runs his route forward tick by tick on a copy of him, with the code he runs on (`src/sim/ai.ts` `routeWant` / `stepRoute`, ~l.253 / l.327, factored out of `runRoute`, which plays exactly as before): the stem, braking into breaks, the plant, the bend rounded at his Agility, a jam held. The meant point is now within ~0.2 yd of him across his run (was 0.8). `leadFor` (~l.294): no extra 0.05 s; placement (lead, back shoulder) goes along the way he'll be running at the catch, not the way he's running at the release.
- `clearLoft` (~l.126): an engaged rusher isn't a lane defender unless he's in the QB's lap (`LAP_R`, 1.5 yd); air that doesn't clear the man after four steps isn't put on it (`return T0`): the ball is thrown on a line.
- `src/sim/play.ts` `batAtLine` (~l.513): an engaged rusher (outside `LAP_R`) bats 15% (`BAT_ENGAGED`) of what a free one would. The AI pass game now has 2.2% of its attempts batted (4.2% before, 5.8% with engaged rushers batting freely).
- `src/sim/play.ts` `runToBall` (~l.1598): once he's found the ball, a receiver paces to it: a ball a step behind his run he gathers for, instead of running on past the spot.
- **Timing** (`timingSigma`, passing.ts ~l.204). With the lead right, the only thing between the ball and the man was the QB's cone, and the AI pass game went to 74% and 9.5 yd an attempt, open men catching 95% of their targets (PFF ~80%: `tests/outcomes.test.ts`). The ~1 yd of error every bend route used to have, whoever threw it or ran it, was standing in for something real: where a running receiver is when the ball gets there. Now there's an error along his run (a step early or late): 1σ = 0.4 × (1 − 0.6 × route running) × (1 − 0.5 × chemistry) × his speed × the horizon × min(1, horizon / 2 s), the horizon being the flight plus however long he'll have been past the end of his route (running on, freelancing). Route running is the depth's (short or deep) or the all-round figure if better. On a slant on rhythm that's ~0.45 yd for Jerry Rice (97 short routes) and ~0.6 for John Taylor (74); on a 2-s deep ball, or a slant thrown a second after the route ran out, a couple of yards. Calibrated (0.4) on the AI pass game's bands. It shows in the reticle (`previewThrow`, folded into the circle) and in the throw's error data (`timing`).

## Figures

`node tools/run-ts.mjs tools/sim/slants.ts 100 --how` (called Slants, n 600 zone / 400 man a script) and `67 --hot` (n 1206 / 804). Completion, int+pbu (int), ypa, YAC, separation at the catch, hang.

| | before | after |
|---|---|---|
| zone, on time (called) | 45%, 44% (8%), 4.2, 1.6, 0.92, 1.01 s (73% touch) | **62%**, 24% (3%), 7.3, 3.7, 1.39, 0.74 s (no touch) |
| man, on time (called) | 37%, 58% (14%), 3.0, 0.8, 0.69, 1.10 s (93% touch) | **66%**, 24% (2%), 6.6, 2.4, 1.54, 0.73 s |
| zone, on time (hot) | 56%, 31% (6%), 5.6, 2.3, 1.45, 1.02 s | **72%**, 16% (2%), 8.4, 3.7, 1.88 |
| man, on time (hot) | 59%, 33% (5%), 4.9, 0.9, 1.14, 1.10 s | **67%**, 23% (2%), 6.3, 1.9, 1.52 |
| zone, late 2.0 (called) | 45%, 33% (5%), 11.1, 8.1, 1.64, 1.72 s | 34%, 29% (6%), 6.8, 5.4, 1.59, 1.68 s |
| man, late 2.0 (called) | 43%, 40% (5%), 8.9, 3.9, 1.08, 1.76 s | 27%, 36% (8%), 5.2, 3.6, 0.84, 1.72 s |
| zone, late 2.5 (called) | 51%, 35% (7%), 15.8, 6.8, 1.44, 2.26 s | 35%, 32% (6%), 9.4, 5.9, 1.47, 2.20 s |
| man, late 2.5 (called) | 36%, 50% (9%), 10.0, 3.8, 0.79, 2.31 s | 28%, 33% (7%), 7.0, 1.8, 0.89, 2.26 s |
| zone / man, late 2.0 (hot) | 51% / 50%, 30% / 36%, 9.9 / 9.0 | 36% / 33%, 31% / 34% (8% / 8%), 6.7 / 5.8 |
| zone / man, late 2.5 (hot) | 48% / 43%, 28% / 41%, 13.6 / 10.8 | 34% / 26%, 24% / 35% (7% / 9%), 7.5 / 5.5 |

Called and hot pooled, on time: ~69% against zone, ~67% against man, 6.5–8 yd an attempt. Against zone it's now the hook and curl defenders' read that decides it: of the called on-time slants, 11% are broken up, 9% tipped by a linebacker who jumped the windup, 5% dropped, 10% off (the QB's cone and the timing, not the lead). The linebackers matter more than before: in `tests/slants.test.ts`' check (on time and late, zone), Ray Lewis, Kuechly and Brooks allow ~47% against Banks, Bart Scott and Millen's ~54%; on time alone ~62% against ~74%.

Per call, called Slants (before → after; completion, int+pbu, ypa):

| call | on time | late 2.0 | late 2.5 |
|---|---|---|---|
| cover3 | 31% 53% 2.9 → 56% 31% 6.1 | 33% 37% 7.0 → 29% 37% 5.3 | 54% 32% 16.0 → 31% 35% 7.8 |
| cover1 | 32% 58% 2.4 → 65% 26% 6.1 | 38% 49% 8.8 → 26% 42% 5.3 | 34% 49% 10.6 → 25% 41% 6.5 |
| cover2 | 48% 39% 4.2 → 60% 24% 7.7 | 58% 13% 14.5 → 40% 20% 9.7 | 65% 22% 21.4 → 39% 25% 11.3 |
| cover4 | 56% 40% 5.5 → 68% 16% 8.4 | 40% 43% 9.4 → 24% 39% 4.3 | 39% 47% 11.8 → 36% 31% 9.9 |
| cover2man | 38% 60% 3.3 → 63% 22% 6.5 | 45% 37% 9.3 → 25% 34% 4.3 | 35% 53% 8.9 → 32% 33% 7.8 |
| cover1blitz | 41% 57% 3.1 → 69% 20% 6.9 | 49% 33% 9.8 → 26% 40% 5.4 | 39% 47% 11.3 → 31% 27% 7.9 |
| cover1off | 35% 57% 3.0 → 65% 29% 6.8 | 41% 42% 7.8 → 32% 29% 5.9 | 34% 51% 9.4 → 24% 32% 5.7 |
| tampa2 | 43% 45% 4.1 → 65% 24% 8.0 | 65% 17% 19.7 → 41% 18% 9.9 | 57% 25% 19.5 → 39% 23% 10.7 |
| firezone | 55% 36% 5.2 → 66% 23% 7.7 | 38% 47% 8.3 → 39% 24% 6.1 | 34% 49% 10.3 → 29% 40% 7.6 |
| simpressure | 39% 53% 3.5 → 55% 25% 5.6 | 38% 44% 7.5 → 31% 38% 5.6 | 53% 36% 15.2 → 33% 38% 9.2 |

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell), before → after: completion 66.8% → 69.3%, 8.1 → 8.3 yd an attempt, interceptions 1.7% → 2.0%, 20+ yd completions 17.5% → 16.7%, YAC 7.2 → 6.8, open men (2+ yd) catching 87.8% → 89.6%, contested (< 1 yd) 18.6% → 22.4%. Sacks 4.9% → 6.4% of dropbacks and pressure 18.2% → 20.0%: the AI's read (`openness`) uses the lead and now sees where its receivers really will be (with the old lead in its read only, sacks went back down and nothing else moved). By route (`tools/sim/batted.ts`, 12 a cell, before the timing): drags 60% → 80%, slants 46% → 61%, crossers 54% → 65%, digs 67% → 76%: the bend routes are what the lead bug held down. Without the timing error it was 74% and 9.5 yd an attempt; the timing brings it back inside the bands.

**The identity harness** (default reps): 17 → 16 of 20. DeSean/Boldin (traffic catch), Gronk/Gonzalez (YAC +0.68 against +0.8) and Gates/Lewis (top speed, as before; separation at the break now 0.19 against 0.25) fail as before. Lost at six reps: **Revis/Law**, completions allowed 60.8% against 63.7% (it needs a 6-point gap). It's the sample: at 14 reps 57.3% against 67.0%, at 20 reps 58.6% against 67.2% (the base at 20 reps: 49.1% against 57.2%, the same gap); both corners give up ~9 points more now the ball arrives on the man. Ed Reed/Kam failed one six-rep run (tackles finished) and passed the final one; at 14 reps 67.0% against 79.7%.

**Clips.** Every scripted throw plays differently now (the timing is a new draw on the throw's stream), so every recorded video with a throw needs re-recording. Re-found (`src/game/clips.ts`, the same play, call and throw): completion-rac 51 → 18 (a juke and 42 after the catch), broken-tackle 71 → 5, the slant concept 1 → 3 (11 yd, 2.9 yd of separation), go 19 → 17, post 40 → 9, back-shoulder 2 → 4, the speed pair 7 → 6, accuracy 16 → 60, coverage 20 → 67 (no seed in 1–80 has Deion's pick now: he breaks it up). The determinism golden is re-pinned. `tests/results.test.ts`' box-score check now allows for a ball thrown away (an attempt, nobody's target), which its sample now has.

## What is still wrong

- **On time against zone, the called concept is 62%**, under the 65–75% asked for (hot-routed 72%, pooled ~69%). Every slant into a hook or curl defender sitting under it is thrown (the harness doesn't read him), and the timing error costs ~3 points on time: without it the called slant was 65% against zone and 71% against man, and the AI game was out of its bands. The two pull against each other: with the ball on the man the AI completes 85% against zone (checkdowns, flats, quick outs and hitches at 89–96%), so what holds it to its band costs the slant too. The real fix for that is on the AI side (its read, its YAC) and in zone defense against its easy throws, not in the slant.
- **Man is 66–67%**, a little over 55–65. Cover 2 man is no harder on the slant than Cover 1 (63% against 65%): its corners play man with a step over the top like Cover 1's, not trail technique under it with the half safeties over, which is what makes 2-man the quick game's problem.
- **The late slant is now a throw that dies** (27–36% complete, 6–8% picked, 5–9 yd an attempt), harder than the first pass's 40–49%. The off-script horizon is most of it: a man a second past the end of his route gets ~2–3 yd of timing error. If it reads on screen as a QB who can't throw, `OFF_SCRIPT` and the horizon term are the knob; the AI pass game needs some of it (its off-script throws were 82% complete with the lead right).
- The meant point still sits ~0.3–0.45 yd ahead of him along his run at the arrival (tick order, and the chord he runs to the ball once he's found it): inside his hands, left alone.
- Not done (optional): the uncaught slant still runs on at full speed past its last point, and a backed-up QB is still rarely sacked.
- Watched only in numbers and per-tick dumps, not on screen. The bend, the ball on him and the late throw dying need watching in the browser.
