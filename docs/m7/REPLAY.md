# M7: Instant replay (Playtest 1 #8)

> "After any play, a replay with orbit camera, scrub and slow-mo; big hits,
> touchdowns and turnovers auto-flagged, and the play of the game on the
> results screen plays back."

## What it is

- **After every snap** (Practice Field and a game), the result card carries
  a replay prompt: the `global.replay` binding (P / Backspace, View on a
  pad) drawn by the prompt system, clickable. The replay opens over the live
  stadium with a "REPLAY" wipe; Esc (or B, or the replay key again) goes back
  to the card, which still stands.
- **Flagged plays** (a touchdown, a turnover, a big hit) lead the card with
  the offer ("BIG HIT · Watch the replay") until it's been watched, and open
  a beat (1.5 s) before the key moment with the director's slow motion
  easing down to 0.3× through it and back up after. The existing
  *Automatic replays* setting now does what it says: by default touchdowns
  and turnovers roll by themselves 1.1 s after the card comes up ("All big
  plays" adds big hits); an automatic replay hands back to the card on its
  own 2.5 s of play after the moment unless a control is touched.
  Continue/Next play stays the focused item so Enter never lands in a replay
  by surprise.
- **The play of the game** plays back from the results screen ("Watch it",
  or the replay key): the play scene is mounted over the stadium for it, the
  game's own two elevens built from the record, and Esc returns to the
  results.
- **The deck**: a scrub bar (the snap and the key moment marked, click or
  drag), play/pause, ±1 s, ±1 frame (1/30 s), speeds 1× / ½× / ¼×, to the
  start, to the key moment (half a second before it, in the director's slow
  motion), the camera (Orbit / Broadcast / End zone) and the orbit's focus
  (the ball / the key player). It tucks down to the scrub bar after 2.6 s of
  untouched playback, so the picture is the point; any input brings it back.
  The REPLAY bug names the flag, the speed and the camera. The play's own HUD
  (icons, prompts, the score bug, clock banners) is off.

### Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Open (result card, results screen) / close | P or Backspace (Esc closes) | View (B closes) |
| Play / pause | Space | A |
| Speed 1× → ½× → ¼× | S | X |
| Back / on 1 s | A / D | LB / RB |
| Back / on a frame | Q / E | LT / RT |
| To the start | R or Home | D-pad ← |
| To the key moment | F | Y |
| Camera: Orbit / Broadcast / End zone | C | D-pad ↑ |
| Orbit the ball / the key player | Tab | R-stick click |
| Orbit | drag the field, or the arrows | right stick |
| Zoom | wheel, or + / − | left stick ↑↓ |

All are rebindable in Settings (the Replay context, which How to Play
already lists); "Invert Y" and "Mouse sensitivity" apply to the replay
camera as their descriptions always said. Any camera input on a preset
takes the orbit from where the preset was (no jump). The old unused
`replay.dof` action is gone (no DOF effect exists yet, see below).

## How it works

- **Capsule** (`src/game/record.ts`, `src/game/replay.ts capsuleOf`): the
  play's setup by name (play id, flip, the coverage call, spot, down,
  difficulty, touch-pass hold, fatigue, fresh legs, chemistry), **both
  elevens as the sim had them** (new: the depth chart's rotation and the sub
  packages change who's in a slot, and a record must replay on the ratings
  it was played on), the run-length-encoded inputs, and the state hash after
  the last input (new). `game.ts` builds the play of the game's capsule with
  `capsuleOf` (a one-line change there). Records saved before M7 have no
  players in their capsule, so their play of the game shows no replay
  button.
- **Replay** (`src/game/replay.ts ReplayPlayer`): `createPlay` with the
  recorded setup, then the recorded frames tick by tick through a
  `SimRunner` (the same driver the live play uses; `advance` gained a
  `limit` so it never steps past the last recorded input). On open it runs
  the whole play once headless to find the snap, the whistle, the key moment
  and the final hash; **a replay whose final hash doesn't match the
  original's is refused** (a record from a build whose sim has since
  changed: it would show a different play). The window runs from 1 s before
  the snap to the last recorded tick.
- **Determinism**: `tests/replay.test.ts` asserts the replay's final state
  hash equals the original's for a live source, for capsules round-tripped
  through JSON (with every game extra: difficulty, tapMax, fatigue, legs,
  chemistry), for a run play, and after scrubbing back and forth, playing at
  half speed and stepping frames. `e2e/replay.spec.ts` asserts the same in
  the browser (the replay run to its end hashes the same as the live play it
  replaced). `tests/determinism.test.ts` is unchanged and passes; no file
  under `src/sim` changed.
- **Key moments** (`keyMoment`): a turnover (the interception, or the strip
  on a lost fumble), a touchdown (the catch if the ball was caught within
  1.5 s of the score, else the ball breaking the plane), else the hardest
  big hit (focus: the man who took it).
- **Scrubbing**: forward steps the replay on from where it is. Back rebuilds
  the play at the window's start (the sim re-runs the pre-snap ticks: ~0.04
  ms a tick in Node) and steps it forward to the target. I chose
  re-simulation over TECH_PLAN §4.5's snapshot ring buffer because the drawn
  bodies carry state a sim snapshot can't restore: a clip part-way through
  its blend, a fall under way, a catch in the hands, a man lying where the
  tackle left him, the contact offsets. Stepping the window through the
  scene's own animation pass restores all of it. `GameScene.catchUp` does
  that: 8 ticks a step far from the target, a broadcast frame (2 ticks) over
  its last second, at most 7 ms of a frame and the rest on the next (the
  camera holds while it runs, then cuts to where it lands; at open it's
  under the wipe). The capture harness and the browser tests (`?video`,
  `?shot`) do it in one frame.
- **Hand-back**: a snap's replay, closing, runs on to the last recorded tick
  (the state the live play is frozen at), then the scene carries on drawing
  the live play with the bodies exactly as the replay left them: no
  re-stance, no pop under the result card.
- **Scene and camera**: `GameScene` draws whichever runner is on (the live
  play's or the replay's); its per-body pass moved into `animate()` so the
  catch-up can run it per step. `GameCamera` adds the orbit (field-frame
  spherical coords around the ball or the key player, tight springs so it
  answers at once), the broadcast angle (the live camera's own logic run on
  the replay) and the end zone (from the stands behind the end line the play
  is heading for, beside the posts, on a lens that keeps ~20 yd of field
  across). Mouse drag and wheel are the canvas's own pointer events, so the
  deck's buttons and scrub bar take their own clicks.
- **No per-frame React**: the store (`useReplay`) changes only when the
  transport does; the scrub bar's fill, head and clock are written straight
  to the DOM from the frame (`replayDom`).

## Perf

- **Playback costs what live play costs.** A replay frame runs the same
  single sim-advance and the same per-body animation pass as a live frame
  (it *is* the live path, fed recorded inputs); the replay's own per-frame
  work is a few comparisons and three DOM style writes. No React renders per
  frame: the store changes on transport changes only. So it holds Medium's
  60 fps wherever live play does. Not measured on the target hardware (this
  container has no GPU; SwiftShader draws a frame in seconds).
- **Seeking is the cost**, and it's bounded and sliced. Measured here
  (`__btbReplayStats`, the 70-yard touchdown clip, 588 ticks; JS time, with
  SwiftShader eating the same CPU): the sim rebuild to the window's start
  1.2 ms; an animation step for 22 bodies ~6–10 ms here (the same pass a
  live frame runs once). Opening the flagged replay (catch-up 401 ticks) was
  72 steps / 0.70 s of JS at the first step sizes; the worst back-scrub (to
  the last second, 528 ticks) 87 steps / 0.64 s; a 1 s step back near the
  end 81 steps / 0.50 s. The step sizes are now 12 / 4 / 2 ticks, ~30% fewer
  steps (~60 for the worst scrub). On a desktop CPU the pass is a fraction
  of that (live play runs it every frame inside its 16.7 ms with rendering),
  so a full back-scrub should land in roughly 0.2–0.4 s of 7 ms slices: the
  frame rate holds, the seek isn't instant. Node: a 321-tick play
  re-simulated twice (analysis plus a seek) in 14 ms.
- Sim snapshots would make the *sim* half of a seek instant, but that half is
  already ~1 ms; the animation is the cost and a sim snapshot can't skip it
  (see How it works). If seeks need to be instant later: keep a pose
  snapshot of each body every second (bone quaternions are ~1.5 KB a body)
  and catch up from the nearest one.

## Screenshots

`npm run shots` with `BTB_REPLAY=1` (`tools/shots/replay.spec.ts`; every
drawn frame is 1/30 s of game time, `?video=30`) writes `docs/m7/shots/`:

| | |
|---|---|
| `01-td-result-offer` | The touchdown's result card: "TOUCHDOWN · P Watch the replay" leads it |
| `02-td-key-orbit` | The director's cut a few ticks before the plane, the orbit's opening angle, slow-mo |
| `03-td-key-broadcast` | The same moment from the broadcast angle (the live camera's logic) |
| `04-td-key-endzone` | The end-zone angle from the stands |
| `05-td-key-orbit-low-player` | The orbit swung round, low and tight on the scorer |
| `06-td-start` | Scrubbed back to the start: the camera holds through the catch-up and cuts to the formation |
| `07-td-quarter-speed` | ¼× through the snap; the deck tucked to the scrub bar while it plays untouched |
| `08-td-back-to-card` | Esc: the hand-back to the card on the live play's own state (the official still signalling) |
| `09-hit-result-offer-pad` | A big hit's card with pad glyphs (View) |
| `10-hit-key-orbit-pad` | The hit's moment, the deck in pad glyphs |
| `11-hit-key-orbit-tight` | Tight on the man about to take it |
| `12-results-offer` | The results screen: "Play of the game … P Watch it" |
| `13-results-replay` | The play of the game playing back over the stadium (deck tucked) |
| `14-results-after` | Back to the results |

`BTB_REPLAY_VIDEO=1` records the touchdown's automatic replay (the director
cut, from a beat before the moment to the hand-back) to
`docs/m7/replay-td.mp4` (960×540, Low, 30 fps of game time).

## Critique (honest)

What works:

- The orbit is the best of it. Low and tight on the scorer at the goal line
  (`05`) or on Rice as Deion arrives (`11`) is the broadcast's super-slow
  replay angle, and with the animation exact to the play (the same clips,
  catches and falls as live, not a re-pose) it reads as the play you just
  made. The director's ease into 0.3× through the moment and back out feels
  like a replay operator, not a speed switch.
- The hand-back is invisible: the card comes back over the same bodies in
  the same poses. Scrubbing back cuts cleanly to the formation (`06`).
- The REPLAY bug and the tucked deck keep the picture clean once it plays.

What's rough:

- **The end-zone angle** (`04`) is better than its first two versions but
  still not a broadcast end-zone shot: from 30 yd back and 14–18 m up the
  near upright still crosses the frame and the lens is wider than a real
  one. A proper rig wants a fixed pole height above the posts' tops and a
  tighter lens that follows the ball's depth; tune it watching it move.
- **The broadcast angle** on a goal-line moment (`03`) is the live
  follow-cam, behind and above the carrier: fine, but it's the shot you
  already saw. A second broadcast preset (the high sideline) would serve
  replays better.
- **No wipe in the captures**: the stills turn CSS animation off (frames take
  seconds here), so the REPLAY sting is unverified in pictures. It's a CSS
  keyframe band, 0.78 s.
- **The scrub bar's key label** sits at the bar's right end on long plays and
  can crowd the end of the track.
- **Seeks aren't instant** (see Perf): a back-scrub is a fast-forward of a
  few tenths of a second (the camera holds), not a jump.
- **No depth of field or motion blur.** GDD §11.5 and the Graphics settings
  ("Replay depth of field", "Replay motion blur") promise them; neither
  effect exists in the post chain yet, and the 60 fps-on-Medium rule says
  they wait until they can be measured on the target GPU. The settings still
  do nothing. 2–3 automatic broadcast angles per auto replay (GDD §11.5) are
  also not done: an automatic replay plays one angle (the orbit).
- Hit sounds replay; the crowd doesn't react twice. Slow motion doesn't pitch
  the sound down.
- Old records (before M7) have no players in their capsule and show no
  replay button; a record whose replay no longer reaches its hash (the sim
  changed since) says so instead of playing a different play. Other agents'
  sim changes will retire every saved replay; that's the price of exact
  replays without a snapshot store.
