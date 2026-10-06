# M7: The tunnel reveal

> GDD §6.2: "After the ninth stall the camera pulls back down the row and
> walks out the tunnel into the stadium, and the game kicks off (the M7
> tunnel reveal grows from this)." BRIEF: "Fog, pyro, crowd roar."

It grows from the M6 walk-out. The room's camera still pulls back down the
row and walks the corridor into the white of daylight; at the white it now
hands over to a real tunnel in the stadium, and the reveal takes it from
there to the pre-game card.

## The shots

| # | Shot | Camera | What happens | Graphics | Normal | Fast |
|---|---|---|---|---|---|---|
| 0 | Room walk-out (M6, unchanged) | the room's camera down the row and the corridor | the exposure blooms to white | Skip | 6.9 s | 6.9 s |
| 1 | **Run-out** | a Steadicam 1.8 m up behind the pack in the tunnel, walking pace; out of the mouth it goes up on the skycam wire (to 11.5 m) and pushes over the team, the lens widening from the backs to the bowl | the white resolves like an eye adjusting; the eleven run out of the dark at their own pace, smoke rolls out of the mouth, two gerbs go up either side, the QB throws both arms up as he hits the light, the bowl comes up | LIVE · Blackcliff bug; at 3.7 s "Take the field · The Contenders · *QB* leads them out" | 7.4 s | 5.6 s |
| 2 | **The Beasts** | cut: low (1.3 m) and long (26° to 22°), a dolly from the north-west across their line, ending on a full-length portrait of their best man right of centre | the Beasts stand in a line facing the tunnel; the stadium horn, the home crowd at its loudest | "The home side · The Beasts · Defense 93 · BRUTAL", then his lower third: position, team and decade, name, OVR, headline trait | 4.8 s | — |
| 3 | **Face-off** | cut: over the Contenders' shoulders from behind their line (3 m up, 42° to 39°), a slow push | the two lines face each other across midfield, the sea and the sun past the Beasts | "Contenders vs The Beasts" band across the top | 3.4 s | 2.6 s |
| 4 | Pre-game (M6.6, unchanged) | the play camera, a cut | the teams set at the spot; the press to kick off | the score bug and the pre-game card | — | — |

The stadium part is 15.6 s (normal) or 8.2 s (fast: Quick Play, or
Settings › Gameplay › Fast reveal); with the room's walk, 22.5 s and 15.1 s.
The GDD's budgets are ~35 s normal and 12 s fast for the whole reveal; Quick
Play's "6 s reveal highlight" is the fast stadium part plus the room.

Why these shots: the run-out is the shot every broadcast opens on (the
Steadicam behind the team in the tunnel, the light at the end of it), and
the rise turns it into the reveal of the place: the bowl, the sea past the
open end and the Beasts already waiting in front of it, small and dark. The
Beasts shot is the "meet the defense" insert, low and long so the black
jerseys stack into a wall, and it ends on one man: the best of them, named.
The face-off is the picture the BRIEF asks the reveal to end on ("the full
defense lined up"), over our shoulders so it's our side looking at theirs.
Cuts between shots, never swoops (the montage's grammar, M7).

### Every player is himself, even jogging out

Each Contender's jog-out pace comes from his own 40 (the sim's, from his
Speed rating): 6.0 m/s for a 4.50 man, 3.2 m/s slower per second of 40,
clamped to 4.3–7.2 m/s, reached on his own acceleration constant (the sim's
`tau`). A share of top speed was tried first and bunched them: the fitted
top speeds of a 4.30 man and a 5.17 man are only ~12% apart (9.8 against 8.7
m/s), because the 40 is mostly acceleration. Now a 4.30 receiver runs out at
6.6 m/s and a 5.2 lineman at 4.3, ~4 s apart over the ~48 m. The pack is
ordered fastest at the front, so the receivers and backs break away out of
the mouth and the linemen come out last and arrive last. They run on
curves that leave the tunnel straight and fan out to their spot on a line
across their side of midfield (z = -18.5 m), keep the pack's left-to-right
order (so nobody crosses through anybody), brake over the last strides at
2.4 m/s² and turn square to the Beasts.

## Systems reused, and what's new

- **Stadium tunnel** (`src/render/stadium/tunnel.ts`, new): a covered
  portal out of the north stands onto the apron, east of the goalposts
  (x = 12 m, from the field wall at z = -70 to the mouth at z = -61), built
  like the room's corridor so the hand-over is seamless: graphite lining,
  four ceiling strips, a lime rule down the floor and a lime frame round the
  opening (the visitors' colour; no marks). Four meshes, ~130 triangles;
  only the concrete shell casts a shadow, which puts the inside in shade.
  The room's door still shows a still of the stadium, now taken from this
  mouth (`TUNNEL_POSE`).
- **Player rigs and clips**: the game scene's own twenty-two bodies
  (`GameScene` builds them as for any snap), the existing gaits (walk, jog,
  run) blended by speed through the animator with its foot locking, the
  stance idle, and for the hype the officials' `ref_touchdown` signal played
  as an overlay on the arms only. **No new clip was keyed**: the run gait at
  4.5–6 m/s is a jog-out, and the arms-up signal is ours already.
- **Crowd**: two new reactions in the crowd-energy envelope, `walkout` (to
  0.75, the visitors in the Beasts' house) and `beastsRoar` (to 1.0), and one
  fix to the envelope: a new reaction now rises from the energy it finds
  instead of dropping to ambient first (a roar over a roar used to dip the
  bowl for a beat). Tested.
- **Audio**: `Audio.crowdRoar(level, attack, dur)`, a synthesized swell, and
  the existing stadium horn (`titleSting`) as the Beasts' cue.
- **VFX**: the existing `pyro` gerbs; a new `smoke` preset (a thin stage
  smoke, alpha 0.09) rolled out from the mouth's sides.
- **Lighting**: the lighting preset's grade throughout; the reveal drives
  only the exposure multiplier the walk-out already used (white at the
  hand-over resolving over ~1 s, a touch open while still inside the tunnel,
  1.35× on the Beasts shot).

## Flow, skipping and input

- `LockerCamera` arms the reveal at the white (`reveal.arm`, with the Beasts'
  best man, rating, threat word and your QB from the draft) and calls the
  walk-out's end, which starts the game under it. The reveal **holds in the
  white** until the game scene's bodies are built and the pre-game lineup is
  up (`ready`), then runs. If that takes over 20 s it gives up and goes
  straight to the pre-game card.
- A game started any other way (`finishWalkout` from a harness, a browser
  test, the Skip) never arms it, so the montage, replay and results specs
  are unchanged.
- **Skip**, at any moment of the walk-out or the reveal: confirm or back
  (Enter / Space / Esc / Backspace, A / B on a pad), Start, or a click on
  the on-screen Skip (the confirm binding's glyph). In the room's walk it
  goes straight to the game; in the reveal, to the pre-game card. The
  pre-game card's own 0.9 s arming means the press that skipped can never
  kick off.
- The pause menu doesn't come up over it.
- Determinism: the reveal is render-only. It reads the rosters and never
  touches the match, the sim or a stream; its clock is the scene's frame
  step (a recording's game time). `tests/tunnel-reveal.test.ts` covers the
  hold, the shot order (normal and fast), the beats, the skip, the give-up
  and the crowd's rise. `e2e/tunnel.spec.ts` plays it in the browser by the
  keyboard: a Classic Auto-Draft, Walk out, the room's walk handing over to
  the reveal in the stadium (the HUD up, the pre-game card held back),
  Enter to skip to the card without kicking off, Enter to kick off; and
  Enter during the room's walk going straight to the game with no reveal
  (both pass, 14.6 min on the software renderer).

## Cost

Measured on this container (SwiftShader, Medium, 640 × 360, `?video=10`
frame-stepped through the real walk-out from a full draft, seed 7; draw
calls and triangles from `gl.info` via the dev handle `__btbPerfStats`, the
JS from `__btbRevealStats`):

| | Draw calls (mean / max) | Triangles (mean / max) | Programs |
|---|---|---|---|
| Room walk-out | 129 / 378 | 46 k / 131 k | 102 |
| Reveal: run-out | 179 / 203 | 1.53 M / 1.73 M | 106 |
| Reveal: the Beasts | 153 / 166 | 1.59 M / 1.76 M | 106 |
| Reveal: face-off | 157 / 182 | 1.44 M / 1.81 M | 106 |
| Pre-game picture (for comparison) | 234 / 271 | 1.61 M / 1.88 M | 107 |

- **GPU**: every reveal shot draws fewer calls than the pre-game picture
  that follows it and about the same triangles (the same twenty-two bodies;
  no officials, ball or field marks). The tunnel adds 4 draw calls and ~130
  triangles to every stadium frame (plus the shell in the shadow pass), and
  4 programs. The smoke and pyro go through the existing particle pool (one
  draw). So the reveal sits inside the in-game Medium budget the M6 perf
  gate already closed (88 fps at Ultra on the M1 Pro mid-game).
- **CPU**: the reveal's body pass (22 animators, the curves, the vfx) is
  9.4 ms a frame mean here and 98 ms worst, the worst being the first frame
  (the set-up, 34 ms, and the first animator updates), which lands under the
  white of the hand-over. That's the same animator work a live snap does
  every frame, with no sim stepping. This container's CPU is shared with the
  software rasterizer and other jobs, so the absolute numbers overstate a
  desktop by several times; **not measured on the target GPU** (none here).

## Media

- `docs/m7/tunnel.mp4` (25.2 s): the full row for half a second, the
  walk-out and the reveal to the pre-game card, Medium, 960 × 540, 24 fps,
  frame-true (every frame is 1/24 s of game time; 1.2 h to record here).
- The fast version (Quick Play) is **not recorded**: it is the same run-out
  on squeezed camera keys and the face-off, covered by the unit test only.
- Stills (`docs/m7/shots/tunnel-*.png`): the room, the light at the start of
  the run-out, the run-out with its lower third, the Beasts' card and the
  best man's, the face-off, the pre-game card (960 × 540, from the same run).

Re-record: `BTB_TUNNEL=1 BTB_PORT=5293 BTB_TUNNEL_W=960 BTB_TUNNEL_FPS=24 npx playwright test -c tools/shots/playwright.config.ts`
(`BTB_TUNNEL_MODE=quick` for the fast version).

## Critique (honest)

Watched frame by frame (contact sheets at 2 fps and the stills).

**What works**
- *The run-out is the moment.* The eleven standing in the dark tunnel as
  the white resolves, silhouetted against the opening, then going out into
  the light past the gerbs, is the image a broadcast opens on. The
  hand-over from the room's corridor is invisible: the same graphite walls,
  strip lights and lime rule continue, and the white hides the cut.
- *The rise sells the place.* Coming up over the team as it spreads onto the
  field, the frame opens to both stands, the roof lip, the sun low over the
  sea past the open end and the Beasts' dark line waiting in front of it.
  It's the best establishing shot of Blackcliff in the game so far.
- *Speed reads.* The receivers and backs are gone out of the mouth while
  the linemen are still lumbering through it, and the big men are still
  jogging in to their spots at the face-off. Nobody would mistake the order.
- *The Beasts shot ends on a man.* The dolly across the black jerseys
  settling on a full-length Rod Woodson, right of centre with his lower third
  (CB · PIT 1990s, 98, No-Fly Zone) clear of him, is a real "meet the
  defense" insert, front-lit now (the first pass, straight on into the sun,
  was all silhouettes).

**What's weak**
- *The Beasts stand like mannequins.* Every one plays the same stance idle:
  arms held a little out from the sides, square, still. In a portrait that
  close it's the weakest frame of the reveal. They want a waiting
  repertoire (hands on hips, a bounce on the toes, a helmet slap, arms
  folded): new in-house clips in `tools/blender`, deliberately not keyed
  here because the celebrations agent is regenerating the same clip
  library in parallel and `anims.glb` can't be merged.
- *The hype is hard to see.* The QB's arms-up (the officials' touchdown
  signal on the arms) happens as he crosses the mouth, which on this seed
  is behind three linemen in the Steadicam's view. Real teams run out
  bouncing, jumping, slapping hands; ours run out in clean gaits.
- *The tunnel's inside is plain.* Flat grey lining with four strips, lit by
  a faint self-light, reads as an untextured box at 960 wide. It needs the
  room's materials (ribbed panels, a rubber floor with texture, a sign-free
  graphic band) and some fog hanging in it.
- *The face-off is far.* The lines are 24 m apart and spaced 3 m (ours) and
  2.2 m (theirs), so over the shoulders it's a scattered row of white in
  front of a thin black line on the horizon, with the slow linemen still
  walking in. Real teams don't line up facing each other, either; a
  director would more likely cut to the Beasts' sideline or the captains.
  It's pretty (the sun and the sea) but not yet a confrontation.
- *The smoke and pyro are small.* The gerbs read as sparks at the mouth
  for a second; the smoke is a thin roll that the camera passes through as
  two soft blobs near the lens. Bigger was worse (the first pass filled the
  frame with a beige wall), so this is a floor, not a design.
- *Sound* is a synthesized swell and the title horn, unheard in this
  container (no audio in the recordings).
- *Numbers*: Film Room hides the OVR and the rating; the threat word stays,
  as the Beasts' lineup on the wall does.
- *Not verified on a GPU.* The look and the budget are from SwiftShader.
