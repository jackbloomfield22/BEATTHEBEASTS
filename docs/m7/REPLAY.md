# M7: Instant replay (Playtest 1 #8)

> M7's brief: "After any play, a replay with orbit camera, scrub and
> slow-mo; big hits, touchdowns and turnovers auto-flagged, and the play of
> the game on the results screen plays back."
>
> The owner, after M7: "When we see a replay, just make it a quick replay
> that the player can't control beyond pressing space to skip or holding
> shift to speed up."

## What it is now (the quick replay)

- **After every snap** (Practice Field and a game), the result card carries
  a replay prompt: the `global.replay` binding (P / Backspace, View on a
  pad), clickable. Flagged plays (a touchdown, a turnover, a big hit) lead
  the card with the offer until it's been watched, and by default touchdowns
  and turnovers roll by themselves 1.1 s after the card comes up (the
  *Automatic replays* setting; "All big plays" adds big hits).
- **It plays itself, once**, from one angle, and hands back to the card on
  its own:
  - a flagged play opens 1.5 s before its key moment, eases into **0.35×**
    for about half a second through the moment (the catch, the plane, the
    pick, the hit), and closes 1.5 s of play after it: **~4 s on screen**
    (3–5 s; `tests/replay.test.ts` plays one through);
  - any other play runs from 0.4 s before the snap to 0.75 s after the whistle,
    at 1×.
- **Space** (A on a pad) **skips** it at once: the hand-back to the card is
  the same as at its end. Esc, B and the replay key itself skip it too (a
  PC game's way back out). **Holding Shift** (RT on a pad) runs it at
  **3×**, slow motion included (0.35× becomes ~1×); let go and it's back to
  1×. **I chose 3×**: a 4 s replay goes by in under 1.5 s, still followable;
  2× barely felt quicker through the slow motion, where it only reaches 0.7×.
- **The angle** is the one M7's automatic replays played on (the orbit's
  opening pose, the best of the auto angles in M7's critique), now fixed and
  the only one: high three-quarter from the offense's side, 15 m from the
  ball and ~24° down, 0.7 rad off straight downfield, following the ball on
  tight springs. The live broadcast camera sits behind the play; this one is
  off its shoulder, so the replay is a second look, not the same shot again.
- **The HUD**: the "REPLAY" wipe as it opens, the bug top left (REPLAY, the
  flag's name; "3×" while it's sped up), and two prompts bottom right:
  `[L-Shift] Hold: 3× speed` and `[Space] Skip` (pad glyphs on a pad, the
  rebound keys if rebound). Both are buttons: click Skip; press and hold the
  speed-up with the mouse. Nothing else: the play's own HUD (icons, prompts,
  the score bug) is off.
- **The play of the game** on the results screen plays the same way (the
  record's own elevens, the same angle, Space skips back to the results).

### Removed

The orbit (drag, wheel, arrows, sticks), the scrub bar and its keys (±1 s,
±1 frame, to the start, to the key moment), the speeds (1× / ½× / ¼×),
play/pause, the camera presets (broadcast, end zone), the orbit's focus
(ball / player), the tucking deck, and the replay clock. In `GameCamera`:
`orbitPose`, `endzonePose`, `replayFocus`, `orbitInput`, `orbitBy`,
`orbitFrom` and the canvas's pointer handlers. In Settings: the Controls
rows *Mouse sensitivity* and *Invert Y*, which only ever drove the replay's
camera (nothing else read them; the fields stay in the saved settings so they
round-trip).

### Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Open (result card, results screen) | P or Backspace, or click the prompt | View |
| Skip | Space (Esc, P, Backspace too), or click Skip | A (B, View too) |
| Speed up (hold) | Shift, or hold the prompt down | RT |

**Bindings**: the Replay context is now `replay.skip` (Space / A),
`replay.fast` (Shift / RT, held) and `replay.close` (B: "Skip the replay
(back)"); all rebindable in Settings, listed in How to Play's Controls page,
and How to Play's "On the Field" page gained an *Instant replay* paragraph
(and one on the Beasts' drives). **Settings v11** migrates cleanly: the
seventeen removed actions' bindings (default or rebound) are dropped and the
new ones come in on their defaults (a rebound play/pause key doesn't carry
over: it was a different action). `tests/ui/settings-input.test.ts` covers
it; `tests/ui/prompts.test.ts` draws Space / L-Shift and A / RT.

## How it works

- **Capsule** (`src/game/record.ts`, `src/game/replay.ts capsuleOf`):
  unchanged from M7. The play's setup by name (play id, flip, the coverage
  call, spot, down, difficulty, touch-pass hold, fatigue, fresh legs,
  chemistry), both elevens as the sim had them, the run-length-encoded
  inputs, and the state hash after the last input. Records saved before M7
  have no players in their capsule, so their play of the game shows no
  replay button.
- **Replay** (`src/game/replay.ts ReplayPlayer`): unchanged. `createPlay`
  with the recorded setup, then the recorded frames tick by tick through a
  `SimRunner`; on open it runs the whole play once headless to find the
  snap, the whistle, the key moment and the final hash, and **a replay whose
  final hash doesn't match the original's is refused**. New: `quickWindow`
  (where it opens and where it closes by itself), `KEY_TAIL`, `PLAIN_LEAD`,
  `PLAIN_TAIL`, `FAST`, and `boost` (a multiplier on the speed: held Shift).
  The director's slow motion is lighter (0.35× held from 8 ticks before the
  moment to 22 after, eased over 30 / 24; it was 0.3× from 10 to 48).
  The player keeps its seek and transport methods: the session seeks to
  open and to hand back, and the determinism tests drive every path.
- **Determinism** (unchanged): `tests/replay.test.ts` asserts the replay's
  final state hash equals the original's for a live source, for capsules
  round-tripped through JSON with every game extra, for a run play, and after
  scrubbing back and forth, playing at half speed and stepping frames.
  `e2e/replay.spec.ts` now asserts it on the quick replay's own way out: the
  replay that closed by itself (and the one skipped with Space) ended on the
  live play's hash (`__btbReplayStats.lastHash`). `tests/determinism.test.ts`
  is unchanged; no file under `src/sim` changed.
- **Key moments** (`keyMoment`): unchanged.
- **Opening and the hand-back**: the open seeks from the window's start to
  1.5 s before the moment; `GameScene.catchUp` animates the way under the
  wipe (12 / 4 / 2 ticks a step, ≤ 7 ms a frame; at once in the capture
  harness and the browser tests). Closing (at its end or on a skip) runs a
  snap's replay on to the last recorded tick, the state the live play is
  frozen at, and the scene carries on drawing the live play with the bodies
  exactly as the replay left them. The camera cuts to the replay angle on
  the first frame after the catch-up.
- **No per-frame React**: the store changes when the replay opens, closes,
  or the speed-up is pressed or let go. `replayDom` (the scrub bar's DOM
  writes) is gone.

## Perf

- Playback costs what live play costs: a replay frame runs the same single
  sim advance and per-body pass as a live frame; held at 3× it steps three
  ticks a frame (the sim is ~0.04 ms a tick in Node; the animation pass is
  per frame, not per tick, so 3× costs about what 1× does). Not measured on
  the target GPU (none here).
- The only seek left is the open (to 1.5 s before the moment: ~300–400 ticks
  of catch-up, ~0.2–0.4 s of 7 ms slices on a desktop CPU by M7's numbers,
  under the 0.78 s wipe) and the hand-back's run-on (40 ms slices).

## Video and stills

`BTB_REPLAY=1 BTB_REPLAY_VIDEO=1 BTB_REPLAY_ONLY=td BTB_PORT=5333 npx playwright test -c tools/shots/playwright.config.ts`
(`tools/shots/replay.spec.ts`; the frame-true clock, `?video=30`; 960×540,
Low; `BTB_REPLAY_CLIP` picks the clip, default `touchdown`). Without
`BTB_REPLAY_VIDEO` it writes stills instead (the touchdown's moment, held
Shift, the hand-back; a big hit with pad prompts; the results screen; rewritten for the quick replay but not run in this pass: the stills below are frames of the video).

| | |
|---|---|
| `docs/m7/replay-quick.mp4` | The Practice Field's catch-and-run touchdown (seed 8, four verticals against Cover 2), opened with P on its card: the replay angle from 1.5 s before the ball crosses, the touch of slow motion through the plane, Shift held for a beat (the bug says 3×), then Space skips it just short of its own end and hands back to the TOUCHDOWN card on the live play |
| `docs/m7/replay-quick-full.mp4` | The same replay left to play (Shift held longer): it runs to its own end at 3× and hands back by itself |
| `docs/m7/shots/replay-key.png`, `replay-fast.png`, `replay-back-to-card.png` | frames of the first: at the plane, at 3×, back on the card |

The old offer / orbit / broadcast / end-zone / scrub stills (`docs/m7/shots/01`–`14`)
and `replay-td.mp4` showed the removed deck and are deleted.

## Critique (honest)

What works:

- **It's quick and it gets out of the way.** The touchdown's replay is about
  four seconds: the run-in from 1.5 s out, a half-second at 0.35× as he
  crosses, a beat after, and it hands back to the card with the bodies as the
  replay left them (no pop). Space at any point drops you on the card at
  once; Shift skims it at 3× and the bug says so. Nothing to learn, nothing
  to fiddle with: the owner's brief.
- **The angle is a real second look.** High off the offense's right
  shoulder, it shows the pursuit angles and the end zone paint the broadcast
  angle (behind the play) can't, and it's the angle M7's critique already
  called the best of the replay.
- **Determinism is untouched**: the replay is still the play re-run from its
  inputs, refused if it doesn't reach the recorded hash, and the browser test
  checks both ways out (its own end, and a skip) land on the live play's hash.

What's rough:

- **A long catch-and-run touchdown replays only its end.** The key moment of
  a touchdown caught more than 1.5 s before the plane is the plane, so the
  70-yard catch and run in the video is the last ~20 yards; the catch and
  the juke that made it aren't in it. Opening such a replay at the catch
  (and letting it run longer) would show the play; it would also make it
  longer than "quick". A judgement call left for the owner.
- **The angle follows the ball, so on a run it's a step behind the man**:
  the carrier is mid-frame, the pursuit trails out of the bottom. A director
  would lead him. On a big hit (the ball pops loose) it can swing.
- **Shift is also the pocket's scramble and the carrier's sprint**; it can't
  collide (the replay has its own input context), but a player holding
  Shift to sprint through the whistle and pressing P while still holding it
  starts the replay at 3×. Harmless, and visible (the bug's 3×).
- **The wipe isn't in the recordings** (the capture turns CSS animation off);
  it's the M7 band, 0.78 s, over the open's catch-up.
- **No depth of field or motion blur** (GDD §11.5, the Graphics settings
  "Replay depth of field" / "Replay motion blur"): still not built, for the
  same reason as in M7 (unmeasured on the target GPU). Those two settings
  still do nothing.
- Slow motion doesn't pitch the sound down; hits replay, the crowd doesn't
  react twice.
- Old records (before M7) show no replay; a record whose replay no longer
  reaches its hash says so. Other agents' sim changes retire saved replays
  (the passing work merging in will).
