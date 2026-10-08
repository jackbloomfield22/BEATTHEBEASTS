# The passing game, round 2

The owner's goal: "making sure the passing feels real all on the QB's end, the ball physics, WR's end". Round 1 (`docs/passing/PASSING.md`) left six things open; this round took them in order. Branch `wip/passing2`.

## What changed

### 1. The QB's feet

- **The drop on its rhythm** (`src/sim/pocket.ts`). The sim used to backpedal every QB at 55% of his top speed until he passed the drop's depth, whatever the drop: a gun drop got there 0.2–0.45 s before its set and he stood, and the clips played at their own pace on top. Now each drop is a profile: he builds speed over the first 30% of it (the open step and the first crossover), runs the middle steps at one pace, brakes over the last 20% into the plant, and plants on the play's set at its depth (`dropProfile`, `dropStep`). It's a trained movement, not a sprint: every QB hits his coached spot on time.
- **3-, 5- and 7-step drops from under center and their gun equivalents.** `uc3` (to 5 yd), `uc5` (7 yd), `uc7` (8.5–9 yd); from the gun `gun3` (a catch, a step back and the gather: 6.5 yd, it was two steps to 7 and he got there early), `gun5` (three steps, 8 yd), `gun7` (five: the Hail Mary). Depths from QB coaching (a 5-step plants at ~7 yd, a 7-step at ~9).
  - The PA deep shot is now a real 7-step (`uc7`).
  - A UC 3-step play joins the quick game: `singleback-quick-outs` (UC Quick Outs: the out on the plant of the third step). A slant-flat version was tried first and sacked 13% (its slants couldn't beat man and the QB held it 5 yd deep); the quick outs complete 74% and get him sacked 0.5%.
- **Turned or pedalled, by drop and rating** (`dropPlan`). A drop he can take inside his backpedal (`movement.ts BACKPEDAL`, 62% of his top speed, less a margin for balance) he pedals, square to the line; anything faster he turns and runs. A 3-step from under center is a pedal for Montana (top speed 10.1 yd/s) and a turned drop for Brady (8.4); nearly every 5- and 7-step is turned.
- **The hitch** (AI QBs). Off a 5- or 7-step he steps up 0.7 yd into the pocket over the 0.3 s the sim already held for the hitch, unless a free rusher is within 4.5 yd (then the pocket's slide or climb). The player's QB steps up with the stick: an automatic step put his scrambles a step behind his own blockers (Steve Young's scramble averaged 0 yd and the Brady/Young identity pair failed).
- **The rhythm against the routes** (`tools/sim/droprhythm.ts`, release minus the target's break, median): the slant off the gun 3-step +0.43 s, the UC quick out +0.22, the dig off the UC 5-step and hitch +0.12, the sail off the gun 3-step +0.08. The ball comes out as the man comes out of his break.
- **Shoulders and feet to the target** (`qbFace`). After the set his body turns to where his eyes are (up to ~80°), and into the windup to the man he's throwing to, so the throwing clip's stride and follow-through go at the target. (Facing changes nothing else in the sim: the QB is a circle in `contact.ts`.)
- **Climbing the pocket.** Stepping up in the pocket after the set, his legs play the carrier's traffic gaits (short, choppy, hips down, stride-matched to the sim's pace), the ball still in both hands at the numbers.
- **Clips** (`tools/blender/lib/actions_drop.py`, keyed in-house on the sim's own profile, 178/178 gates): `qb_drop_uc3/uc5/uc7/gun3/gun5/gun7` turned (the hips open 35–52° to the throwing side, the shoulders a third less, the head back to the middle of the field, the ball at the numbers), `qb_drop_uc3_pedal/gun5_pedal/gun7_pedal` square, and `qb_hitch`. The render plays the one the sim chose, at the rate that lands its plant on the set (`choreo.ts startDrop`); a play-action drop starts out of the fake.

### 2. The QB's eyes

- **Before his first read** (`pocket.ts eyesBeforeRead`, the AI and the player alike until he holds an icon): the middle of the field on the drop (the safety shell), then off a 5- or 7-step:
  - a QB who reads the field (Awareness 0.85+, the Field General range) looks the safety off: his eyes go to the far side from his first read for the last two steps and the hitch, then come back;
  - anyone else locks on to his first read from there (staring him down).
- **The deep safety reads them** (`ai.ts zoneCover`). The middle-of-the-field safety (deep middle, the halves, the Tampa runner) leans toward where the QB is looking, a read late (his reaction), up to 3 yd with nobody to carry (2 over a man), less for an aware safety (a 99 leans 60% as far as a 0). Only while the QB has the ball to throw.
- **The look-off buys a step**, rating-driven: Marino (Awareness 99) against Winston (63), the same deep throws from the same big arm, the deep safety is 7.48 yd off the man it's thrown to at the release against 6.72 (`tools/sim/passidentity.ts`).
- **The throw comes where the eyes go**: the read is where his eyes are (round 1), the windup turns his eyes and shoulders to the man.
- On screen the head follows the sim's eyes (`choreo.ts eyesFor`).

### 3. The receiver's head and hands

- **Timing routes** (slants, outs, digs, curls, crossers...): the head comes round to the QB out of the break, so the ball's on him from the release.
- **Verticals**: eyes up the field until he finds the ball (the sim's `findsBallAt`, 0.2–0.45 s after the release by his hands), then back over the shoulder for it: `lookWide` lets the upper back turn with the head (~125° in all) and the eyes go down into the hands (60°), so he tracks it all the way in (`anim/animator.ts`).
- **Hands late**: the catch clips' reach starts ~0.27 s before the ball (0.43 over the shoulder), which is late already; unchanged.
- **Defenders' eyes**: zone defenders on the QB, man defenders on their man, the ball once they've read the throw, the carrier after the catch.

### 4. The bobble and the re-catch

- **The sim** (`passing.ts resolveCatch`, `play.ts atHands`). A catch roll close to the line is a bobble: the band below it is 0.05 × (1.2 − Catching), plus 0.003 per yd/s over 22 (a bullet), plus 0.04 for a hit as it arrives. It pops up off his hands at ~2.2 yd/s, moving with him, and comes back to his hands ~0.4 s later for a second chance: 0.3 + 0.6 × Catching (Glue or Sure Hands +0.08), less 60% of a man's hit on him then. Missed, it's a drop, or knocked loose (live: anyone can play it, a pick included). The band above the line is sized so his odds over both chances are his odds before (a bobble is how the close ones look, not a new way to drop it); what changes is what can happen in the beat it's loose.
- **In the AI pass game** (`tools/sim/bobbles.ts`, 20 a cell): 2.2% of targets are juggled; 54% secured, 13% dropped, 29% knocked loose, 1% picked. John Taylor (Catching 82) bobbles 3.3% and secures 47%; Rice 1.9% and 57%.
- **The clips** (`actions_pass.py`): `catch_bobble` (the diamond meets it, it pops off the heels of the hands, the hands spring open and follow it up to the face, come back together under it: the regrab lands on the sim's second chance) and `catch_resecure` (squeezed and pulled in to the chest, then high and tight). The juggled ball tumbles end over end and bends into the hands on the regrab.

### 5. The arm on screen

- **The read and the throw on one clock** (`passing.ts throwTime`, `armTime`). The quickest an arm can get a ball `d` yd is its flat solution at its top speed with drag (a table per top speed). Short of ~30 yd it's under the driven time and changes nothing; on a long throw the arm sets the arc, and the gap between arms grows with the distance. The QB's read (`ai.ts openness`) used the driven time alone, so a 72 arm read a 46-yd seam as a 2.15-s ball and threw a 2.5-s one into the safety.
- **The fit to the arm** (`ball.ts fitArm`). `planThrow` stretched every too-fast throw by 4% at a time; past the bottom of the speed curve that only asked for more speed, so a long ball lofted over a defender came out at up to 45° and 5–6 s of hang, far faster than the arm. Now the time nearest the asked one that his arm can make.
- **By arm** (`tools/sim/ballarc.ts`):

| | 72 arm (Montana) | 96 arm (Marino) |
|---|---|---|
| Driven 25 yd | 1.04 s, 52 mph at 11° | 0.90 s, 59 mph at 8° |
| Driven 40 yd | 1.76 s, 53 mph at 21°, apex 5.4 m | 1.48 s, 60 mph at 15°, apex 4.3 m |
| Driven 55 yd | 3.04 s, 53 mph at 40°, apex 13 m | 2.16 s, 61 mph at 23°, apex 7.3 m |
| Full touch 40 yd | 2.22 s at 32°, apex 7.6 m | 1.92 s at 25°, apex 6.1 m |

- Passing identity, the same go and post: launch 56.9 vs 51.5 mph, hang 0.40 vs 0.45 s per 10 yd, **apex 4.4 vs 5.9 yd** (new check). On the recorded sideline pair the same go ball hangs 1.8 s from Marino and 2.4 s from Montana.

### 6. The 40+ completion tail

`tools/sim/deeptail.ts` (new) splits the AI's attempts by air yards at the aim (NFL reference: ~11–12% of attempts 20+ air yards, ~4–5% 30+, ~1.5–2% 40+; 40+ complete ~25%; ~3% of completions gain 40+). Before this round, 20 a cell:

| Aim (air yd) | Share | Cmp | INT | Hang |
|---|---|---|---|---|
| 20–29 | 6.0% | 35% | 3.6% | 2.07 s |
| 30–39 | 6.1% | 33% | 7.8% | 2.56 s |
| 40+ | **6.2%** | **49%** | 8.7% | **4.31 s** |

40+ completions were 7.6% of completions, air 35.8 yd and 15.9 after the catch, the ball hanging 3.4 s. Four causes, each fixed where it lives:

1. **Moon balls faster than the arm** (the fit loop above): a 60-yd "go" hung 6.3 s.
2. **Lofting over the man at the catch point** (`passing.ts clearLoft`): the trailing corner or the safety at the catch point counted as a defender under the path, so the QB put air on it until it cleared his hands, turning 20–30-yd throws into 3–5-s rainbows that everyone settled under. He isn't under the path; the ball comes down to him whatever its arc.
3. **Layering in front of a safety** (`play.ts overTheTop`). The AI layered every long ball. The coaching line: layer it over a trailer, drive it in front of a safety coming over the top (the seam "on a rope"). Now with a defender level or deeper within 9 yd across of the catch point, it's driven.
4. **The deep defenders stood in their zones** (`play.ts deepAngle`). Only the man in coverage and one rallier broke on the throw, and flow only reached defenders within 15 yd; the deep middle safety drifted to his landmark until the catch 15+ yd away, so a Cover 1 corner route caught at 20 yd went the distance ~45% of the time. Now every deep defender takes his angle once he's read the throw, to where he'd meet the receiver running on flat out after the catch. His range is his speed and his read.

Plus the arm's clock in the read (a weak arm sees the deep window tighter and throws deep less), and a bug: a fullback blocking in front of the QB could "catch" the pass 0.07 s out of the hand (`stepAir`: a teammate who isn't running a route, or in the ball's first 0.25 s, can't touch it). That removed ~200 phantom completions for losses in a 16,000-play book.

After, 30 a cell:

| Aim (air yd) | Share | Cmp | INT | Hang |
|---|---|---|---|---|
| 20–29 | 7.0% | 44% | 4.7% | 1.63 s |
| 30–39 | 4.6% | 41% | 4.5% | 2.12 s |
| 40+ | **1.7%** | **33%** | 10.4% | 3.15 s |

40+ completions **7.1% → 4.4%** of completions (the 60-a-cell book), air 29 yd and 26 after the catch. What's left is mostly corners caught at ~20 yd near the sideline against Cover 1 and running on: the free safety's range from the middle of the field doesn't reach the sideline in time, which is the corner route's point against Cover 1, and Ed Reed (Tackle 33, an arm tackler) misses some of the tackles he gets to.

## The numbers

**The AI pass game** (`tools/sim/outcomes.ts`, 60 a cell):

| | Before (round 1 + physics) | After | NFL |
|---|---|---|---|
| Completion | 65.3% | 66.5% | ~64–66% |
| Yards per attempt | 8.2 | 8.3 | ~7 |
| INT | 2.5% | 2.5% | ~2.2–2.5% |
| Sacks | 7.1% | 7.6% | ~6.5–7% |
| aDOT | 11.0 | **9.0** | ~8 |
| Completions of 20+ | 16.9% | 16.8% | ~12–14% |
| Completions of 40+ | **7.1%** | **4.4%** | ~3% |
| Completions for a loss | 567 | 357 | |
| In phase targets / caught | 25.5% / 28.1% | 21.9% / 19.9% | |
| 2+ yd open caught | 88.2% | 88.7% | ~80% |
| Time to throw (median) | 2.23 s | 2.10 s | ~2.7 |
| Pressured / first at | 23.9% / 3.08 s | 31.3% / 2.62 s | ~30–35% / ~2.5 s |

- Completion rose 1.2 points with aDOT down 2 yd: the passes are shorter, and each depth band completes at about its NFL rate (behind the line 83%, 0–9 yd 73%, 10–19 59%, 20–29 44%, 30–39 41%, 40+ 33%).
- Sacks rose 0.5: the QB now reaches his depth at the set instead of ~0.3 s early, and the AI's hitch puts him 0.7 yd nearer the rush. Pressure arrives at 2.6 s (NFL ~2.5); the outcomes test's floor moved from 2.6 to 2.4 with that note.

**Checks:**

- Passing identity 9 of 9 (two new checks: the arm's apex, the look-off).
- Identity: IDENTITY_RESULT.
- Trait audit 127 of 127 traits, 25 of 25 combinations.
- Tackling harness (`tools/sim/tackling.ts`): runs barely move (yards after first contact 3.67, driven back 11%, gang 43%, contact to whistle 0.53 s); after the catch, yards after first contact 3.59 → 2.72 and driven back 22% → 20%: the deep defenders now arrive.
- Film regenerated; golden re-pinned (600 of 920 cases); the e2e seeds re-found (stick 2, the touchdown 116); clips re-found: completion-rac, the go and back-shoulder concepts, the speed and rush identity pairs, tackle-driven-back.
- Clip gates 178 of 178.
- `npm run check`: CHECK_RESULT. The practice e2e on port 5321: E2E_RESULT.

## The videos

VIDEOS

## Watched: an honest critique

CRITIQUE

## Still open

OPEN
