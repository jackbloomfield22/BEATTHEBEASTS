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
