# M7: The Beasts' possessions as a broadcast montage (Playtest 1 #4)

> "Beasts' possessions. A sim montage in M7: three or four quick broadcast
> shots of the drive (the key play, the result, the scoreboard), about 10
> seconds, skippable."

## How a Beasts drive is decided (unchanged)

A Beasts possession is not played. `match.ts beastsPossession` resolves it
statistically from legacy's whole-game model turned per-possession (GDD
§7.3, §15 D1): an expectation from the Beasts' rating, the game noise and
the answer-back to your score, then one draw for the result (TD / FG / punt /
turnover / downs / safety; fitted to the half in a timed game), its plays,
yards, time of possession and where your next drive starts. Before M7 it
was shown as the "Meanwhile" card. That is still the whole truth of the
drive: the montage only *shows* what the resolver decided. The only change
to `match.ts` is a presentation field, `BeastsDrive.start` (where the drive
began), set without a draw; `tests/montage.test.ts` checks a game's drives
and score come out identical with and without the montage, and
`tests/determinism.test.ts` is unchanged and passes. No file under
`src/sim` changed.

## Staging the key play (`src/game/montage.ts`)

`createPlay` has no notion of teams: it takes any eleven per side, and with
`setup.user = false` its offense is the sim's own AI (the QB reads and
throws, carriers run). So the key play is a real snap with the Beasts on
offense; no mirroring.

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

**What the key play is**, by the drive's result:

| Result | Key play | Must end |
|---|---|---|
| TD | the scoring play: 35% from 1–4 yd (goal-line runs and red-zone concepts), 45% from 5–16, 20% from 17–34; never longer than the drive | a touchdown |
| Two-point try (3rd OT on) | from the 3 | good: a touchdown; failed: short of it, no return |
| Turnover | a throw into coverage, from pairs that get hands on the ball | intercepted (no pick-six), the ball down within 10 yd of where your drive starts |
| Punt | 3rd & 2–9 where the drive ended | short of the sticks (an incompletion, a sack, a stuff) |
| Downs | 4th & 1–3 | short, within 2 yd of the spot your drive starts from |
| Safety | from the 1 or 2 | a safety |
| FG, missed FG, a half run out | the drive's longest gain | a gain between the drive's average + 2 and 40 yd, no score |
| A kneel-out (no yards) | none | the Meanwhile card |

**The search** runs snaps headless (plays from the book for the situation,
calls the Contenders could play, a flip, a hash, a seed: all drawn from the
stream `montage:<round>-<ot>` of the game seed) until one ends that way and
its moment comes within 4.6 s of the snap (so the montage stays ~10 s). A
pick that comes down too far from your drive's start is retried once from a
line moved by the difference. The tries are **counted, not timed**
(`MAX_TRIES` = 64), so the same game seed stages the same snap on any
machine; if none fits, the card is shown, never a play that contradicts the
drive. Every try runs the exact recorded input sequence (150 ticks set at the
line, the snap, nothing after: the AI plays it) so the snap shown is the snap
found.

Hit rates (`node tools/run-ts.mjs tools/sim/montage.ts 40`, 240 drives, this
container, unloaded): TD 60/60 (3.7 tries, ~50 ms), punt 76/76 (3.2, ~50
ms), FG 65/65 (5.6, ~70 ms), downs 10/10, safety 1/1, **turnover 22/28**
(21 tries, ~0.6 s average, 2.7 s worst for the six that fall back to the
card). The moment lands 2.9–3.8 s after the snap on average.

## On screen (`src/game/montageSession.ts`, `src/render/game/montageCam.ts`, `src/ui/game/MontageHud.tsx`)

The staging runs a try at a time over the frames (≤ 6 ms of a frame; a try
is 5–30 ms here, so a frame can run one try over) under a **bumper** ("MEANWHILE · BEASTS
BALL", a crimson band). The replay player (M7) then plays the staged snap in
the live stadium (`GameScene` draws it like a replay; `ReplayPlayer` took an
optional `lead` for the longer pre-snap window), and the director cuts:

| Shot | Camera | Length |
|---|---|---|
| 1. Establish | high and wide from the offense's left sideline (the sun behind the lens), 42 yd off the ball, 15 m up, a slow drift; the bug top left: BEASTS BALL · 3rd & 8 · BEA 34 · Q1 5:00 | the offense set, to 0.6 s before the snap (~1.8 s) |
| 2. The play | the live broadcast camera's own logic (behind the offense, rides the throw, follows the carrier, the breakaway angle) | to just past the whistle; a score or a pick eases into 0.4× through the moment and back (~3–5 s) |
| 3. Reaction | low (1.5 m) and tight (26° lens, 8 yd) on the man the play was about (the scorer, the interceptor, the sacker, the defender at the incompletion, the tackler, the carrier), the call big on screen ("TOUCHDOWN" in crimson, "INTERCEPTED" / "INCOMPLETE" in lime) | 1.8 s |
| 4. The board | from high over the south end, down the bowl to the north stands and the video board, which shows BEASTS / CONTENDERS and the new score with the call; the score bug's numbers jump to the new score; the "BEASTS DRIVE" lower third: result, points, plays · yards · time, where your drive starts | 2.6 s |

Cuts, never swoops: the camera snaps to each shot's first pose and springs
within it. The crowd is the Beasts' home crowd: a Beasts score brings the
bowl up, a pick or a sack sits it down; hits sound. The match scores the
drive when the montage ends (or is skipped).

**Skip** at any moment, including under the bumper: the confirm or back
binding (Enter / Space / Esc / Backspace; pad A / B) or Start, and the
on-screen "[Enter] Skip" (the confirm binding's glyph, A on a pad; clickable).
The pause menu doesn't come up over a ten-second cut.

**Setting:** Settings → Gameplay → *Beasts' possessions*: Broadcast montage
(default) or Meanwhile card.

**Determinism:** the elevens, the key play and every input come from the
game seed; the clock of the cuts is the scene's frame step (real seconds; a
recorded video's game time), never the wall clock; the drive and the score
are the resolver's either way.

**Perf:** a montage frame is a live-play frame (the same single sim advance
and per-body pass the replay uses; no React per frame: the store changes on
the six cuts). The costs are the staging (time-sliced, see above) and the
replay player's build a frame after the search (one more run of the snap to
check it, ~10–30 ms here) under the bumper, and the video board's one
canvas repaint at the board cut. Not measured on the target GPU (none here).

## Tests

- `tests/montage.test.ts`: the elevens (seeded, nobody really on the field,
  positions), the staged snap is the same for the same seed and agrees with
  each kind of drive, replays to the same hash through the replay player,
  the drives and score are identical with and without the montage, the slow
  motion profile.
- `tests/ui/prompts.test.ts`: the skip's bindings draw as A / B, Enter / Esc.
- `e2e/montage.spec.ts`: a Quick Play game kicked off, the montage staged and
  playing in the stadium (the bug and the skip prompt up, the play shot
  reached, the drive not yet scored), Enter skips it (scored, on to your
  drive); with the setting on the card, the card instead.
- `e2e/game.spec.ts` already answers the Meanwhile stage with Enter, which
  now skips the montage (the full game passes through it unchanged).

## Video and stills

`BTB_MONTAGE=1 BTB_PORT=5220 npx playwright test -c tools/shots/playwright.config.ts`
(`tools/shots/montage.spec.ts`; `BTB_MONTAGE_SEED`, `_FPS`, `_W`).

CRITIQUE_PLACEHOLDER
