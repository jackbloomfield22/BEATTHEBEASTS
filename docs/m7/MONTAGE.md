# M7: The Beasts' possessions on screen (Playtest 1 #4)

> M7's brief: "Beasts' possessions. A sim montage in M7: three or four quick
> broadcast shots of the drive (the key play, the result, the scoreboard),
> about 10 seconds, skippable."
>
> The owner, after M7: "When we see the opponent's drive each time, just show
> their scoring play if they had one, or their turnover/turnover on
> downs/punt."

## What changed after M7 (the deciding play only)

The four-shot montage (wide establishing shot, the key play, a low reaction
shot, the video board) is cut to **the play that decided the drive, on the
broadcast camera, then a brief result graphic**: about 4–6 s instead of ~10.5.

| Drive | What's shown |
|---|---|
| TD | the scoring play (a two-point try from the 3 in the third OT on) |
| Turnover | the interception (or fumble), coming down where your drive starts |
| Turnover on downs | the failed 4th-down play, short, within 2 yd of your drive's start |
| Punt | **the punt itself** (new): their punter, the flight, the coverage and the returner under it, down where your drive starts |
| FG, missed FG | **the kick itself** (new): from where the drive ended, through the posts, or wide of an upright |
| Safety | the safety |
| A half run out with yards on it | the drive's longest gain (as before) |
| Kneel-out | the Meanwhile card only (as before) |

- **The play**: a snap cuts in 0.3 s before the snap (it was a 2.5 s look at
  the formation from the sideline) on the live broadcast camera's own logic,
  slowing to 0.5× for about half a second through a score or a pick (it was
  0.4× for over a second). A kick cuts in with the ball in the punter's hands
  (1.25 s into the operation) or at a field goal's snap.
- **The result**: on the same camera, the score bug's numbers bump to the
  new score and the "BEASTS DRIVE" lower third comes up (result, points,
  plays · yards · time, the booth's line, where your drive starts) at the
  whistle (no later than 0.75 s after the moment, so a pick's return isn't
  the story), as a punt comes down, or as a field goal reaches the posts; it
  holds 1.6 s and the drive is scored.
- **Gone**: the establishing shot, the reaction shot with the big call
  ("TOUCHDOWN"), the video board shot (the board no longer changes for a
  Beasts drive), `src/render/game/montageCam.ts`.
- **Kept**: the bumper while a snap is staged; the "Meanwhile · Beasts ball"
  tag (or "Beasts punt", "Beasts field goal try"); the skip at any moment
  (Enter / Space / Esc / Backspace, A / B, Start; the on-screen Skip is
  clickable); the Settings choice (renamed "The deciding play" / "Meanwhile
  card"); `match.ts` unchanged (the montage only shows what the resolver
  decided); nothing under `src/sim` changed.

On screen, unskipped, from `screenSecs` (`node tools/run-ts.mjs
tools/sim/montage.ts 40`, 240 drives): TD 5.8 s (4.3–7.1), turnover 6.0
(4.5–7.0), downs 5.1 (3.6–7.0), punt 6.1 (5.1–6.3), FG 5.3 (4.9–5.4), safety
2.7. The long end of a snap (7 s) is a moment that comes 4.6 s after the snap
(the search's MAX_TO_KEY, unchanged so the staging and its hit rates are
the same as M7's); the recordings add a frame or two of bumper.

## How a Beasts drive is decided (unchanged)

A Beasts possession is not played. `match.ts beastsPossession` resolves it
statistically from legacy's whole-game model turned per-possession (GDD
§7.3, §15 D1): an expectation from the Beasts' rating, the game noise and
the answer-back to your score, then one draw for the result (TD / FG / punt /
turnover / downs / safety; fitted to the half in a timed game), its plays,
yards, time of possession and where your next drive starts. Before M7 it
was shown as the "Meanwhile" card. That is still the whole truth of the
drive: the screen only *shows* what the resolver decided. The only change
to `match.ts` (M7) is a presentation field, `BeastsDrive.start` (where the
drive began), set without a draw; `tests/montage.test.ts` checks a game's
drives and score come out identical with and without the montage, and
`tests/determinism.test.ts` is unchanged and passes. No file under
`src/sim` changed.

## Staging the play (`src/game/montage.ts`)

**A snap.** `createPlay` has no notion of teams: it takes any eleven per
side, and with `setup.user = false` its offense is the sim's own AI (the QB
reads and throws, carriers run). So the play is a real snap with the Beasts
on offense; no mirroring.

**Who plays.** The Beasts are an all-time *defense*; the game has no Beasts
offense and no Contenders defense (BRIEF §5: "the Beasts' offense is
abstracted"). The sim needs real men to move, so once per game each side is
drawn from the ratings snapshot with legacy's weighted pick (the Beasts' own
draw: weight ∝ max(1, OVR − 70)³ + 1, `engine/legacy/beasts
makePickWeighted`), leaving out by person everyone really on the field (your
drafted men and the thirteen Beasts), an OL that blocks together (a unit),
and the defense in the Beasts' shape (DE DT DT DE / LB×3 / CB S S CB + the
nickel and dime). They play **anonymously**: their ratings drive the snap,
the screen shows kits and numbers and no nameplates, because the game has no
Beasts offense to name. The Beasts wear their black and crimson on offense;
the defense wears your kit.

**What the play is**, by the drive's result:

| Result | Play | Must end |
|---|---|---|
| TD | the scoring play: 35% from 1–4 yd (goal-line runs and red-zone concepts), 45% from 5–16, 20% from 17–34; never longer than the drive | a touchdown |
| Two-point try (3rd OT on) | from the 3 | good: a touchdown; failed: short of it, no return |
| Turnover | a throw into coverage, from pairs that get hands on the ball | intercepted (no pick-six), the ball down within 10 yd of where your drive starts |
| Downs | 4th & 1–3 | short, within 2 yd of the spot your drive starts from |
| Safety | from the 1 or 2 | a safety |
| Punt | the kick (below) | down where your drive starts |
| FG, missed FG | the kick (below) | through, or wide |
| A half run out with yards on it (or a field goal that won't stage) | the drive's longest gain | a gain between the drive's average + 2 and 40 yd, no score |
| A kneel-out (no yards) | none | the Meanwhile card |

**The search** runs snaps headless (plays from the book for the situation,
calls the Contenders could play, a flip, a hash, a seed: all drawn from the
stream `montage:<round>-<ot>` of the game seed) until one ends that way and
its moment comes within 4.6 s of the snap. A pick that comes down too far
from your drive's start is retried once from a line moved by the difference.
The tries are **counted, not timed** (`MAX_TRIES` = 64), so the same game
seed stages the same snap on any machine; if none fits, the card is shown,
never a play that contradicts the drive. Every try runs the exact recorded
input sequence (150 ticks set at the line, the snap, nothing after: the AI
plays it) so the snap shown is the snap found. (A punt drive's third-down
stop, which M7 staged, is no longer searched for.)

**A kick** (`stageKick`) needs no search: the kicking game's own flight
(`src/game/kick.ts`, the model your punts and field goals fly on) is solved
for, from the same stream.

- *Punt*: from the line the drive ended on (start + yards), the punter 13.5
  yd deep; it must come down where your drive starts (100 − nextStart in the
  Beasts' frame: fielded there). The leg (power 0.3–1.08) is found by
  bisection on the carry, in the match's wind, aimed up to 2.3° off straight.
  When the carry that needs is outside a punter's 30–56 yd, the line moves up
  or back to fit (the resolver nets its punts 40–70 yd from where the drive
  ended, so a long one is kicked from a few yards farther up: the drive's
  yards and the punt's line can disagree by that much; the ball always lands
  where your drive starts).
- *Field goal*: from where the drive ended, no farther than 55 yd (a drive
  cut short by the gun can end farther out), the hold 7 yd behind the line
  (`fgDistance`). A make is struck clean at full leg (1.04, 1.08 if the wind
  needs it) on `aimFor`'s line through the middle; a miss is pushed wide of an
  upright (to a side drawn from the stream), a little wider each try until the
  flight really misses wide (never short). The Beasts' kicker has a 58-yd
  range (anonymous, a strong NFL leg). If it won't come out the way the drive
  did, the longest gain is staged instead (in 240 drives it never happened).
- The twenty-two who line up: the same anonymous elevens, by body (a
  two-receiver set so the gunners are wideouts; the return team's base).

Hit rates (`node tools/run-ts.mjs tools/sim/montage.ts 40`, 240 drives, this
container, loaded): TD 60/60 (3.6 tries), punt 76/76 (kicked, ~1 ms), FG
65/65 (kicked, ~1 ms), downs 10/10, safety 1/1, **turnover 25/28** (15 tries,
~0.65 s average, 2 s worst; the three misses fall back to the card).

## On screen (`src/game/montageSession.ts`, `src/ui/game/MontageHud.tsx`)

A snap is staged a try at a time over the frames (≤ 6 ms of a frame) under
the **bumper** ("MEANWHILE · BEASTS BALL"), then the replay player (M7)
plays it in the live stadium (`GameScene` draws it like a replay) from 0.3 s
before the snap. A kick has nothing to stage: it sets the **kick view**
(`render/game/kickView.ts`, the one your kicks use) with the flight already
struck and `team: 'bst'`, and `GameScene` sets the kick's look with the
Beasts' anonymous unit in black and your eleven in your kit; `KickBall` dresses
its specialists (snapper, punter, holder, kicker) in the Beasts' kit and
starts their clips from where the kick is when it cuts in; the punt's
coverage is caught up to that moment.

The camera is the broadcast camera: a snap's is the live camera's own logic
(behind the offense, riding the throw, following the carrier); a field goal's
is the kick view's (behind the holder, the posts square in the frame). The
Beasts' punt has its own (new): **the broadcast's punt shot**, high (11 m)
and 22 yd behind the play, travelling downfield with the ball's track on the
turf and looking ahead to where it comes down, so the protection, the
gunners, the returner and the catch share the frame. Your own punt's camera
(behind the punter, the lens riding the ball up) is unchanged; see the
critique.

The shots are `play` and `result` (the store changes twice); the camera cuts
once, onto the play. The match scores the drive when the result has held
1.6 s (or at a skip). The crowd is the Beasts' home crowd: a Beasts score
brings the bowl up, a pick or a sack sits it down; a field goal gets the
kicking game's roar or groan, every kick the thump at contact.

**Determinism**: the elevens, the play, every input and every kick's flight
come from the game seed and the match's wind; the clock is the scene's frame
step (real seconds; a recorded video's game time), never the wall clock; the
drive and the score are the resolver's either way.

**Perf**: a snap's frame is a live-play frame (the same single sim advance
and per-body pass the replay uses); a kick's frame is your kick's frame (the
kick view's twenty-two plus KickBall's five, no sim). No React per frame
(two store changes). The search is sliced as before; a kick is staged in ~1
ms (two dozen flights of the bisection). Not measured on the target GPU
(none here).

## Tests

- `tests/montage.test.ts`: the elevens (seeded, nobody really on the field,
  positions); a snap is the same for the same seed and agrees with each kind
  of drive (TD, failed fourth down, turnover, longest gain), and replays to
  the same hash; **a punt is kicked from where the drive ended and comes down
  where your drive starts (within 0.5 yd, in still air and in wind), the line
  moving up for a long one**; **a field goal goes through from 45, a missed
  one really flies wide, one from too far out is kicked from 55**; **every
  kind is 3.1–7.5 s on screen**; the drives and score are identical with and
  without the montage; the slow-motion profile (0.5×).
- `e2e/montage.spec.ts`: a Quick Play game kicked off; the opening drive (a
  TD) goes straight to the play (no establishing shot, cut in no more than
  0.3 s before the snap), then the result (the lower third says Touchdown,
  the bug's Beasts score bumps), then on to your drive by itself, the drive
  scored; a punt drive handed to the montage plays the punt through the kick
  view with the Beasts' unit (`team: 'bst'`), and Esc skips it and puts the
  kick view away; with the setting on the card, the card instead.
- `e2e/game.spec.ts` answers the Meanwhile stage with Enter, which skips it.

## Video and stills

`BTB_MONTAGE=1 BTB_PORT=5333 BTB_MONTAGE_SEED=<n> npx playwright test -c tools/shots/playwright.config.ts`
(`tools/shots/montage.spec.ts`; `BTB_MONTAGE_FPS`, `_W`, `_DRIVES`; it writes
`docs/m7/montage-<seed>-<n>.mp4`, renamed below). Recorded on the
frame-true clock (`?video=30`: every frame is 1/30 s of game time), 960×540,
Low, SwiftShader, so the look is judged on the stills and the timing on the
videos. Vite on its own port, restarted before the recording.

| | |
|---|---|
| `docs/m7/montage-td.mp4` (6.8 s) | Draft seed 5: the Beasts' opening drive, TD, 10 plays, 75 yd, 4:05. 2nd & 10 at the CON 31: a throw down the right side, caught at the goal line in traffic, into the end zone; TOUCHDOWN +7, the bug to BST 7, "Your ball on the CON 25" |
| `docs/m7/montage-punt.mp4` (6.4 s) | Draft seed 7: punt, 6 plays, 9 yd, 2:05. 4th & 8 at the BST 35: the punter's steps and the kick, the coverage down both sidelines, the returner under it at your 23 with a gunner arriving; PUNT, "The Beasts go nowhere and punt it away" |
| `docs/m7/shots/montage-{td,punt}-{search,play,result}.png` | a still of the bumper, 1.3 s into the play, and the result |
| `docs/m7/shots/montage-{td,punt}-sheet.png` | every 12th / 13th frame of each video |

The old four-shot stills (`-establish`, `-reaction`, `-board`) are deleted.

## Critique (honest)

What works:

- **It's the drive's moment and nothing else.** The TD recording is a
  31-yard throw on the broadcast camera, the lens riding the ball down the
  sideline to the receiver at the goal line with a defender on his hip, a
  half-second of 0.5× as he catches it, then the plate. 6.8 s with the
  bumper; M7's version of the same drive was ~11. A fan would recognize it as
  the highlight a broadcast cuts to between your series.
- **The punt is a punt now.** M7 showed a third-down incompletion for a punt
  drive and let the lower third say "Punt"; now it's their punter in their
  black, the protection, the gunners releasing down both sidelines and the
  returner settling under the ball, which comes down where your drive
  starts. The first recording used the kick view's own punt camera (behind
  the punter, the lens riding the ball up): half the punt was the stands and
  the video board with the ball a speck, so the Beasts' punt got the
  broadcast's high follow (re-recorded; your own punt is unchanged).
- **The result is quick and readable.** The bug's Beasts score bumps and the
  lower third (TOUCHDOWN +7 · 10 plays · 75 yd · 4:05 · the booth's line ·
  your ball on the CON 25) answers "what happened, what's the score, where am
  I" in one frame without a cut, and the crowd is already up in it.

What's rough:

- **The punt's ball leaves the frame** at the top of its flight (about 1.5 s
  of the 4 s hang): the camera keeps the field and the returner rather than
  tilting up after it, and at 960 px a real-size ball 40 m away is a few
  pixels anyway. A broadcast would tilt with it; a second, wider lens or the
  live game's larger-than-life ball scale (GameScene's BALL_GROW, not used by
  KickBall) would help. No return is run: the returner fields it and stands
  (as on your punts; the resolver's "returned" yardage is in the next spot,
  not on screen).
- **Your own punt has the problem the Beasts' had**: the kicker's-eye camera
  that tilts up into the stands. Not changed here (out of scope, and the
  owner tuned that view); the Beasts' rig could be offered for it.
- **The result's framing is loose.** After the TD the camera holds on the
  dead ball as the sim leaves it: the scorer is small in the end zone and
  team-mates jog through. The M7 reaction shot tried to fix this and was the
  weakest shot; the honest fix is the celebration system playing a short
  Beasts celebration under the plate.
- **The long end is 7 s.** A play whose moment comes 4.6 s after the snap
  (a deep drop, a long run) is 6.5–7 s with the plate; the average is
  5.3–6.1 by kind. Lowering the search's MAX_TO_KEY would cap it but changes
  the staging and lowers the turnover hit rate (25/28).
- **The punt's line of scrimmage can disagree with the drive's yards** by up
  to ~15 yd when the resolver's net is longer than a punter's carry (see
  Staging); the spot where your drive starts is always right.
- **Field goals were checked in tests and the tool, not recorded**: no seed
  in the two recordings is a FG drive. The kick view's FG camera (behind the
  holder, the posts square) is the one your field goals use and was watched
  in M6.6; the Beasts' unit is dressed the same way as on the punt.
- Turnovers still stage ~90% of the time (25/28 here); the rest, and
  kneel-outs, show the Meanwhile card.
- Not measured on the target hardware (no GPU here). The frame cost is the
  live play's or your kick's.

Harness note: the montage spec starts no server of its own when one is up
on `BTB_PORT`; restart Vite before a recording (a page that loaded two copies
of an edited module draws wrong). Kill it by the node process's PID, not the
`npx` wrapper's: the wrapper's PID dies and leaves the server running.
