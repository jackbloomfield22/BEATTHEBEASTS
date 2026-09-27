# Playtest 1 (owner's notes and decisions)

Saved verbatim from the owner's message of 2026-09-27. This is the plan of record for the M6.5 additions, M6.6 and the M7 items below; `docs/PROGRESS.md` tracks where each item stands.

---

Playtest notes from a live session with a player on an Xbox controller, Classic mode, plus decisions. Fold the gameplay items into M6.5 where they overlap with the 11-point brief; the rest is a new pass, M6.6, on its own branch after M6.5. Same rule as before: diagnose in the sim before fixing, report the cause.

## Decisions

1. Game clock. Replace the drive count with a real game: four quarters, a game clock that runs on plays and stops on incompletions, out of bounds and scores, a 40-second play clock with a delay of game, and the Beasts' possessions consuming time. Quarter length is a setting (default 5 minutes). The drive-count format stays as Quick Play only. The Daily uses a fixed quarter length so scores compare.

2. Sprint. Add hold-to-sprint on RT and on Shift. Sprint drains stamina and the carrier still cuts sharper at controlled speed near defenders. Without the button held he runs at the context pace, and the context pace must never look like jogging in space: every player, with or without the ball, moves in a way that makes sense for where he is on the field and what's around him. No foot glitching or feet lagging the body at speed; find the cause.

3. O-line in the draft. Numbers stay hidden. Show the five linemen by name with their All-Pro and Pro Bowl counts as stickers, and one word for the unit: Elite, Strong, Solid or Weak.

4. Beasts' possessions. A sim montage in M7: three or four quick broadcast shots of the drive (the key play, the result, the scoreboard), about 10 seconds, skippable. Full defense mode goes on the stretch list.

5. Kits. Beasts keep black and crimson. The Contenders' default kit becomes white with lime trim and black numbers; black stays in the kit designer. Never two dark kits on the field.

6. Data audit. Check 2020s completeness through the 2025 season (Diggs, AJ Brown, Davante Adams GB 2020s were missing) and skim every other decade for notable missing stints. Add through the sourced added-stints path, no rewrites, and list every addition in the report.

7. Touchdown celebrations. On a score, a three-choice prompt (1/2/3 or A/B/X): three authored celebrations drawn from a pool of a dozen, nothing that copies a named real-world dance. If nothing is pressed within about two seconds, one plays on its own. Camera and crowd sell it.

8. Instant replay. M7: after any play, a replay with orbit camera, scrub and slow-mo; big hits, touchdowns and turnovers auto-flagged, and the play of the game on the results screen plays back.

Box score. Undo the tabbed version. One screen that looks like a standard broadcast box score: passing line, rushing lines, receiving lines, the Beasts' defensive line, a drive chart, big hits. Only the stats that matter, no scrolling within tabs. It was right in the earlier build; get back to that and keep the Last Game and History entries pointing at it.

## Playtest findings

### Draft and locker room
- One font everywhere. Bring in a second typeface for body text and numbers; the display font is for headlines only.
- The spin readout is too bright; bloom makes the team and year hard to read. Cut the glow on text.
- The Beasts panel overflows its border.
- Only the first two trait stickers populate under a locker.
- Player heads are too small on the models. Check head size against the body across the body types.
- A short rules card at the start of every draft: how the spin works, what a team skip and era skip are, that a slot shows WR2 because WR1 is filled. Clearer slot labels.
- After the walk-out, cut to a pre-game moment (the field, the Beasts, the scoreboard) and wait for an explicit "press to kick off." He pressed a button and accidentally ran the first play.

### Controls and UI
- With a controller connected, every prompt shows the button (A/B/X/Y, triggers), never a number.
- Carrier move prompts show up late. They should be on screen the moment he has the ball and update instantly.
- Round every yardage everywhere. A punt of 40.52 showed.
- Ocean ambience is too loud in the menus.

### Passing (worst area; add to M6.5 items 1 to 7)
- Throws lead the receiver far more than intended and the aim is locked at the press with no leeway. Aim should stay live while the ball is being thrown: a tap is a ball on the receiver, a hold leads him, and the stick or mouse offset moves the placement until release.
- The ball is slow and floaty and bounces like a beach ball off helmets and hands. Fix the ball's mass, gravity and drag so it arrives with velocity and dies on contact; a bullet pass should look like one.
- Receivers don't react to the ball: no leap, no adjustment. The catch call and the ball's position drive the catch animation, and the receiver's body meets the ball.
- Tyreek clipped through a defender on a catch. Contested catches need contact between the two bodies, not overlap.
- Receivers still stop mid-route and come back. Keenan Allen on an out route turned around wide open.
- Screens: mark the target receiver on a screen at the play call and pre-snap.

### Running and QB (add to M6.5 items 8 to 11)
- Scrambling is too easy. Montana leaked out for 14 and walked in. Contain and pursuit should punish a slow QB; a mobile one earns his yards.
- Ratings don't show on the field. Tyreek should be visibly the fastest man out there; a 1990s tight end shouldn't. Audit that the ratings-to-physics mapping produces visible differences, and add a harness check comparing top speed across the roster.

### Tackling and physics (new M6.5 item 12)
- Collision volumes don't match the models and the mesh deforms in fast movement. Fix the capsules per body type and the skinning weights at speed.
- A sack registered with no contact. Tackles trigger on touch and end instantly, spotted where the touch happened rather than where the carrier goes down. Rework contact: a tackle attempt starts on contact, then a resolution over several frames where the carrier keeps moving (drive, drag, spin off, break) and the spot is where the ball is when a knee is down. Break-tackle vs tackle ratings decide it, and a good defender still has to finish. Being touched is not being tackled.
- The ragdoll launches on big hits stay as designed.

### Presentation
- Both teams in black on the field. Fixed by decision 5.

## Order

M6.5 first with the passing, running, carrier and tackling items merged in. Then M6.6 for the clock, sprint, kits, draft fixes, controller prompts, box score and data audit. M7 takes the montage, celebrations and replay. Videos and honest critique at each gate as before.
