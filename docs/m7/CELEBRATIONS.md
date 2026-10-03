# M7: Touchdown celebrations (Playtest 1 #7)

> "On a score, a three-choice prompt (1/2/3 or A/B/X): three authored
> celebrations drawn from a pool of a dozen, nothing that copies a named
> real-world dance. If nothing is pressed within about two seconds, one
> plays on its own. Camera and crowd sell it."

## What it is

- **A user touchdown** (Practice Field and a game; not a pick-six) brings up
  a prompt half a second after the whistle, low on the screen so the end
  zone stays the picture: TOUCHDOWN, the scorer's name, and three
  celebrations with their keys (1, 2, 3; A, B, X on a pad), drawn by the
  prompt system and clickable. A bar runs out over two seconds; nothing
  pressed and the first (the best fit of the three) plays by itself. Skip
  (Enter / Space, Y) goes straight to the result card.
- **The three** are drawn from a pool of twelve, seeded by the play (the
  same play always offers the same three), weighted by who scored: a
  receiver plays to the crowd, a back spikes it and pumps a fist, a big man
  (a lineman, or anyone 280 lb and up) flexes, bumps chests or shrugs it
  off. What played on the last few scores is down-weighted so a session
  doesn't see the same three twice running. The chest bump is only offered
  when a team-mate is close enough to come over.
- **On the field**: the scorer pulls up, turns to whatever the celebration
  plays to (the stands behind the end line, the nearest official, his
  team-mate) and plays the clip, travelling where it travels (the leap, the
  walk). Up to two team-mates within 28 yd at the whistle run over from the
  moment the prompt is up, set behind him on either side, point at him and
  clap; when he's done the first of them comes in for a high five (the
  scorer slaps with his free hand if he still has the ball). The ball is his
  until the clip lets it go: a spike comes back up off the turf end over end
  and rolls; a flip carries to the official's chest and he has it; a drop
  rolls away. Then the result card, and the automatic replay after it.
- **Camera**: the celebration camera comes on with the prompt: low (chest
  height, 1.35 m), tight (7.4 m out, a 34° lens), in front of him and to one
  side; over the celebration it arcs ~30° toward his front and pushes in to
  5 m as the lens closes to 29°. It picks the side that keeps it on the
  field (never in the stands or the bench area).
- **Crowd**: the touchdown lifts the bowl at the score; the clip starting
  lifts it again (a new `celebration` reaction, which rises from where the
  energy stands instead of dipping to ambient first) and a long synthesized
  roar swells. The spike and the drop thud on the turf; pads crack on the
  chest bump.
- **Render-only**: everything happens after the whistle; the scene stops
  drawing the scorer and the team-mates from the sim and drives them itself
  while the sim's dead ball carries on untouched. Nothing under `src/sim`
  changed; the determinism golden passes unchanged.

### Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| First / second / third celebration | 1 / 2 / 3, or click | A / B / X |
| Skip (to the result card) | Enter or Space | Y |

They're a new input context (Touchdown Celebration), rebindable in
Settings and listed in How to Play; `tests/ui/prompts.test.ts` checks they
draw as 1/2/3 on the keys and as pad glyphs (A/B/X) on a controller.

## The pool

All keyed in-house in `tools/blender/lib/actions_m7_cel.py` (the existing
pipeline: key poses solved with IK, feet on the footstep planner so planted
feet stay put, baked to FK by `build_anims.py`). None is a named dance; each
is something football players do in an end zone, with original timing.

| | Clip | What it is | Ball | Plays to | Frames |
|---|---|---|---|---|---|
| 1 | `cel_spike` | A step at it, the ball up overhead with the back arched and the eyes on the spot, the whole body whips it into the turf (release f18), then up roaring at the stands, chest out, arms bowed | spiked | as he is | 87 |
| 2 | `cel_spin_spike` | The ball up, a full pivot to the left on the ball of the left foot (the right knee up, the free arm out), lands square and spikes it out of the turn (f32), both index fingers to the sky | spiked | as he is | 93 |
| 3 | `cel_flip_official` | A step toward the official, an underhand flip (f19), the index finger at him with the left hand on the hip, a nod, two claps | to the official | the official | 78 |
| 4 | `cel_point_crowd` | The right foot out wide, the ball held up by the shoulder, the left index finger at the stands sweeping left to right with two jabs, eyes along it | kept | the stands | 96 |
| 5 | `cel_leap_wall` | Three accelerating steps at the wall, a one-foot takeoff with the right knee driving and the ball overhead, a two-foot landing, then the lean into the front row with the arms spread (3.6 m) | kept | the stands | 99 |
| 6 | `cel_flex` | Lets the ball fall (f5), widens his base a foot at a time, a front double biceps with a pulse, then the crunch into a most-muscular with a shout | dropped | as he is | 90 |
| 7 | `cel_salute` | The ball into the left hand (f12), heels together at attention, a crisp salute to the brow, held, cut down, a nod | left hand | the stands | 87 |
| 8 | `cel_kneel` | Steps back onto the right knee, the ball on the left knee under his hand, head bowed: a moment; then eyes up and the left index finger to the sky; rises | kept | as he is | 114 |
| 9 | `cel_ball_high` | Four slow steps (~80 a minute) with the ball straight up in the right hand, chin up, the hips rolling over each stance foot (1.2 m) | kept | the stands | 120 |
| 10 | `cel_chest_bump` | Two steps in, a two-foot jump with the chest thrown forward and the arms back; chests meet at the top (f21); land, a fist pulled down. Two-man: the team-mate plays it facing him | kept | his team-mate | 60 |
| 11 | `cel_jump_fist` | A dip, straight up with the knees tucked and the left fist punched at the sky (the ball stays tucked), two pulls of the fist down ("yes") | kept | as he is | 69 |
| 12 | `cel_shrug` | The ball held out at arm's length, looked at and let go (f14), eyes following it down; the big shrug (shoulders to the ears, palms up, head tilted, a hip out), a smaller one | dropped | as he is | 78 |
| | `cel_mate_point` | A team-mate set beside him: both index fingers at the scorer, a bounce on the toes, two claps | | | 66 |
| | `cel_five_r` / `cel_five_l` | A step in and a high five on the centre line between two men ~1.15 m apart (f17); the left-handed one for a scorer with the ball in his right | | | 48 |

### Gates

`python3 tools/blender/build_anims.py`: **181 of 181 clips pass**
(`docs/ANIMATION.md`), the fifteen new ones included: foot slide on planted
frames ≤ 0.5 cm (worst: the walk, 0.24 cm), ankles and knees ≥ 7 cm apart
on every frame (worst: the salute's heels together, 9.0 cm). A new
joint-limit gate runs on the celebrations (`build_anims.py`, cited there):
peak knee flexion ≤ 150° (worst: the kneel, 124°), peak elbow flexion ≤
150° (worst: the jump's fist pull, 144°), and every IK foot target reached
within 1.5 cm (no leg locked straight short of its plant; all ≤ 0.01 cm
after two fixes: the kneel's back foot landed before the hips had come
down, 5.8 cm; the walk's stride was too long for its hip height, 5.9 cm).
The existing clips bake to identical metadata (the `anims.json` diff is
additions only).

Skinning (`python3 tools/blender/skin_check.py --clips cel_…`, the shipped
mesh at all three LODs, measured against the build's "reach" group limits,
which is where overhead and outstretched arms belong): hips and knees are
well inside (worst hip 1.1% collapsed, knee 5.4% against 1.6% / 6.5%), and
so are the elbows (worst 4.7% against 5%). The shoulders are at the limit:
2–3% on most clips (catch_high_point, in the gate, measures 2.6%), the far
LOD2 mesh sits at 3.06% on several (flex, salute, the five) against 3.0%,
and the leap measured 3.7% on LOD1 in the frame its arms come down from
the lean to the sides (eased once: the overhead arms 172° → 160° and the
lean's shoulder girdle back from 10° to 4° of protraction; that frame
stayed). These clips aren't in the build's skin gate (it runs on the speed
and reach clips); a fold of the armpit crease at a distance, not a visible
tear in the stills.

### File size

`public/assets/characters/anims.glb` 7,068,564 → 8,100,828 bytes
(**+1.03 MB, +14.6%**) for 1,233 frames of new clips (the build samples
every bone every frame); `anims.json` +2,050 lines. It loads with the rest
of the library at the play screens. If it matters later, the celebrations
could go in a second GLB loaded after the first snap.

## How it works

- `src/game/celebration.ts`: the pool (clip, label, what happens to the
  ball, what he turns to, the fit per kind of scorer), `roleOf` and
  `pickChoices` (pure, seeded mulberry32), and the session: it watches for a
  user touchdown's whistle each frame, picks the scorer (the carrier) and
  up to two team-mates (nearest first, not down, within 28 yd), pushes the
  `celebrate` input context, counts the two seconds, and holds the phase
  (`off → choose → play → done`) in a small zustand store React reads.
  Its clock is the frame's step (so `?video` and `?shot` captures are
  deterministic) and holds while the game is paused.
- `src/render/game/celebrate.ts`: the scene side. Once the prompt is up it
  takes over the team-mates (run, face, react, idle); once the choice is
  made, the scorer (pull up at 9 m/s², turn at ≤ 5 rad/s, play the clip,
  move the root by its `travel`, fire its events) and the ball (in the
  palm; released with a velocity per clip; a bouncing ballistic body with a
  tumble, damped on each bounce, at rest on its side). GameScene skips the
  bodies it owns in its sim-driven pass, runs it after, and lets it place
  the ball. A replay opening releases them for good (the replay hands back
  to the play's own end).
- `src/ui/game/CelebrationPrompt.tsx`: the prompt (React renders on phase
  changes only; the bar is a CSS animation). The Practice and game result
  cards wait while it's on.
- `src/game/replaySession.ts`: the automatic replay's 1.1 s beat counts
  from the card coming up after the celebration, so it's celebration,
  card, replay.
- `src/render/game/GameCamera.tsx`: `celebPose()`, and in `?video` the
  celebration's camera moves in frame time (the dead ball's sim stops
  advancing 5.6 s after the whistle).
- `src/render/crowd/reactions.ts`: the `celebration` reaction, and every
  reaction now rises from the energy at the moment it comes in.
- Tests: `tests/celebration.test.ts` (the pool's clips exist in the
  library and passed their gates; three distinct, deterministic per seed;
  the fit by role; the bump only with a mate; recent ones down-weighted),
  `tests/crowd-reactions.test.ts` (the rise from the current energy),
  `tests/ui/prompts.test.ts` (the bindings), `e2e/celebrate.spec.ts` (score
  in Practice, three choices in the celebrate context and no card, pick the
  second on its key, it plays out, the card; and the timeout's auto pick and
  the skip). The e2e test draws its frames on demand, each a tenth of a
  second of game time at 640×360: software rendering here draws a frame in
  seconds, and a celebration at 60 frames a second took longer than the
  test's budget.

## Screenshots and video

`BTB_CELEB=1 BTB_PORT=5210 npx playwright test -c tools/shots/playwright.config.ts`
(`tools/shots/celebrate.spec.ts`; the scripted 70-yard touchdown,
`completion-rac`, Medium, each drawn frame a tenth of a second of game
time) writes `docs/m7/shots/celeb-*` (`BTB_CELEB_PAD=1` for the pad
prompt, `BTB_CELEB_ONLY=` to limit the gallery). The gallery forces each
celebration into the three on offer and picks it.

| | |
|---|---|
| `celeb-01-prompt-pad` | The prompt on a controller: A, B, X, Y to skip; the scorer still pulling up, the low camera already on him |
| `celeb-02-prompt-keys` | The same on the keys: 1, 2, 3, Enter |
| `celeb-spike-0.9 / 1.5 / 2.4` | The spike into the turf, the ball coming back up end over end, at rest; a team-mate set behind him |
| `celeb-leap-1.4 / 1.9 / 2.6` | The leap at the wall (ball overhead at the top), the lean into the front row |
| `celeb-03-after-card` | The result card after it, the camera easing back under it |
| `celeb-flex-1.4 / 2.2` | The double biceps (the ball dropped at his feet), the crunch |
| `celeb-chestBump-1.0 / 1.4 / 2.0` | The partner come round in front, the jump, from the side |
| `celeb-kneel-1.8 / 2.9` | Down on a knee, head bowed; the finger to the sky |
| `celeb-flip-0.9 / 1.5 / 2.2` | The flip to the official, the point at him |
| `celeb-point-1.0 / 2.0` | Pointing up at the stands, sweeping |
| `celeb-salute-1.4 / 1.9` | At attention with the ball in the left hand; the salute |
| `celeb-spinSpike-0.7 / 1.4` | The ball up through the pivot; the spike out of it |
| `celeb-ballHigh-1.5` | The slow walk with it held high |
| `celeb-jumpFist-0.9` | The fist at the sky at the top of the jump |
| `celeb-shrug-0.8 / 1.4` | The ball let go at arm's length; the shrug |
| `celeb-clips-1 / 2 / -mates` | Blender contact sheets of every clip (`tools/blender/preview_clips.py … --frames 8 --view tall_three`) |

`BTB_CELEB_VIDEO=1` records the whole beat (the end of the run, the
whistle, the prompt left to run out so the first plays by itself, the
celebration, the team-mates and the five, the card) to
`docs/m7/celebration-td.mp4` (30 fps of game time).

## Critique (honest)

What works:

- **The low camera is the best of it.** Cut in at chest height with the
  prompt, the scorer pulling up in the end zone with the bowl standing
  behind him (`celeb-01`, `celeb-spike-*`, `celeb-leap-1.4`) is a broadcast
  celebration shot, not a game camera, and the push-in over the clip gives
  it a pulse. Holding its own bearing between cuts (it doesn't swing round
  with him) and cutting again when the celebration starts reads like an
  operator on the field.
- **The spike and the leap sell it.** The ball whipped into the turf and
  coming back up off its point end over end, then lying on its side, is
  the moment; the leap's takeoff with the ball overhead against the stands
  (`celeb-leap-1.4`) is the frame you'd put on the box. The kneel's held
  beat (`celeb-kneel-1.8`) is the quiet one the set needed.
- **They read as football players**, not mannequins: weight on the front
  foot through the spike, the back heel up, knees absorbing every landing,
  the hips rolling over each stance foot in the slow walk, the shrug's hip
  out. Every clip passes the build's foot-contact and clearance gates and
  the new joint limits.
- **The flow is clean**: the prompt sits low and out of the picture, a
  choice is one key or button, it runs out on its own in two seconds, skip
  is always there, the card waits for it and the automatic replay waits
  for the card. Team-mates run over from the moment of the score, which is
  what real ones do.

What's rough:

- **Team-mates are simple.** They run straight to a spot behind him
  (ignoring anyone in the way, including the Beasts walking off), point
  and clap, and the first one comes in for a five. No one jumps on him, no
  helmet slaps, no group; in a game the rest of the offense just stands
  where the dead ball left them. Their approach can cut across the lens:
  the camera now keeps to the side away from them and goes side-on for the
  two-man moments, but a late arrival can still walk through the shot.
- **The chest bump depends on a team-mate in range** (it's only offered
  then) and on him getting round in front; if he's slow the scorer waits up
  to three seconds standing, then goes alone (a bump with nobody). The two
  clips meet at the right time but the bodies don't collide: chests come
  within a few centimetres by construction, not by contact.
- **The flip to the official**: the ball carries to the nearest official's
  chest and stays there in front of him; he doesn't raise his hands or
  move (the officials have no catch clip). It reads from the broadcast
  distance, not up close.
- **The salute and the pointing** are the weakest of the twelve at the
  camera's angles: a hand at the brow or a pointed finger is small at 5–7 m
  and the camera picks its side before it knows which arm he'll use.
- **No variety within a clip**: the same celebration plays the same way
  for every scorer (scaled to his body). A big man's flex and a receiver's
  are the same keys; per-player personality (a trait that picks or flavours
  one) is not done.
- **The shoulder skinning** is at the limit on a few frames (see Gates):
  the leap's arms coming down, LOD2 overhead.
- **Not measured on the target hardware.** The celebration adds no
  rendering (the same bodies, the same ball) and its per-frame work is a
  few bodies' animator updates the sim pass would have done anyway; it
  should hold Medium's 60 fps wherever live play does, but this container
  has no GPU (software rendering draws a frame in seconds), so that is
  reasoning, not a measurement. The +1.03 MB animation file is the real
  cost.
- **Captures**: the stills turn CSS animation off, so the prompt's
  two-second bar shows empty in them; the bar is a CSS keyframe. The shots
  were taken with this machine under heavy load from other sessions, each
  frame a tenth of a second of game time, so the stills are a sampling, not
  every beat; the video is the honest look at the motion.
