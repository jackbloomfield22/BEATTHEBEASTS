# M6.6: the game clock, the play clock and kicking

Branch `m66-clock-kicking` (from `claude/m65-gameplay`). The brief: Playtest 1 decision 1 (a real game clock) and Playtest 2 "Kicking" (aim, then hold and release inside a moving window), plus "round every yardage everywhere" (a punt of 40.52 showed).

Screenshots: `docs/screenshots/m6.6/` (captured with `BTB_CLOCKKICK=1 npx playwright test -c tools/shots/playwright.config.ts`, spec `tools/shots/clockkick.spec.ts`, software GL at 1920×1080, Medium).

## 1. The game clock

**Formats.** Classic, Film Room and the Daily now play a timed game: four quarters of the Quarter length setting (Settings → Gameplay, 3/5/8/10/15 minutes, default 5; settings v8 migrates older saves to 5). The Daily always plays 5-minute quarters (`DAILY_QUARTER_MIN`, `quarterSecsFor` in `src/game/match.ts`) so every player's score that day is on the same clock. Quick Play keeps the drive count (its setting is now labelled "Quick Play length") with the M6 two-minute drill on the last drive.

**The rules** (`src/game/match.ts`, pure, whole seconds only):

| What | How |
|---|---|
| A play | The clock runs from the snap; the sim's snap-to-whistle time (sim seconds, so slow motion doesn't count) comes off, rounded to whole seconds, at least 1. |
| Stops | Incompletions, scores, turnovers and changes of possession, safeties, the sim's time-cap whistle. Out of bounds stops it only late in a half: the last 2:00 of the 2nd quarter and the last third of the 4th (the NFL's last five minutes scaled to a short quarter, never under two). Otherwise out of bounds restarts on the ready signal, which here is the same as running (NFL Rule 4-3-2). |
| Between plays | A running clock keeps running while you call the play and line up. The play clock starts at 40 after a play, 25 after an administrative stoppage (timeout, two-minute warning, new quarter, penalty). |
| The huddle | Outside the hurry-up the offense breaks the huddle with 25 on the play clock, so a running clock loses 15 s before the call comes up (NFL huddles take ~12–15 s). This is the accelerated clock a short quarter needs: without it a 5-minute quarter played in real time gives ~12 snaps a side and feels like a drill, not a game. |
| The hurry-up | No huddle (the full 40) in the last two minutes of the first half, and of the game when you're not ahead. |
| Delay of game | The play clock hits 0: the flag, 5 yards (half the distance inside the 10), the down replayed, 25 on the play clock. The play at the line is taken off the field. |
| Two-minute warning | In the 2nd and 4th: a running clock stops at 2:00 exactly; a play that runs through 2:00 stops it after the play. |
| End of a quarter | Q1/Q3: the drive carries on in the next quarter at the same spot and down; the teams change ends, so the wind turns round (`windDir0 + π` in Q2 and Q4). A touchdown at 0:00 still gets its try. |
| Halftime | Your drive ends ("End of half"). The Beasts took the opening kickoff (GDD's coin toss), so you receive the second half from your 25, three timeouts again. A halftime card shows the line score. |
| End of regulation | Final, or overtime (unchanged: college-style, untimed) when tied. |
| Timeouts | Three a half, any time a snap is due (T at the call, the 4th-down card or at the line): the clock stops, 25 on the play clock. |
| Spike / kneel | ~3 s and ~2 s of play; a kneel keeps the clock running. Victory Formation in a timed game: ahead in the 4th with no more on the clock than the kneels left can take (~42 s each). |

**The Beasts' possessions eat the clock.** Each takes 17–25 s a snap (the same accelerated pace as yours) and has to fit the half: ahead late in the game they kneel it out (the game can end on their possession, as in real football); otherwise they go to a 13-second hurry-up; if even that doesn't fit, the gun goes mid-drive (a scoring drive 60% of the way there kicks a field goal at the gun, 85%; anything else ends the half). Their scoring model is unchanged in shape: each possession aims at legacy's game total scaled by the possessions played plus the ones the clock is likely to leave (`possessionsLeft`: the game's own pace blended in over the first four rounds). Tested: 300 timed games give the Beasts legacy's points per possession within ±0.45.

**Real time and determinism.** The game session (`src/game/game.ts`) runs a rAF loop that adds real time only while a snap is due and the game isn't paused (the call, the 4th-down card, the offense at the line), and hands the match one tick per whole second (`tickClock`). The match never sees the wall clock: given the same sequence of ticks and plays it is the same game, and the sim's golden hashes are untouched (no sim file changed). Snap detection is the sim's `snapT` through the existing `onTick` hook. The Daily's challenge per date (draft sequence, Beasts, seeds, quarter length) is unchanged and fixed.

**Pace.** With the default 5-minute quarters a steady offense gets ~3–4 possessions and the Beasts ~3–4 (`tests/clock.test.ts` checks 3–8 on a scripted game); 8-minute quarters give ~5–6, close to the old 6-round Standard; 15 minutes is a full game. Honest note: 5 minutes is on the short side for this game's pacing (the Beasts' possessions are real time off a short clock); it's the owner's default, and the setting is there.

**Grades and the record.** A timed game is graded on the table nearest the regulation rounds it actually played (≤5 → the 4-round table, ≤8 → 6, else 10). The record keeps `quarterSecs` and the points by quarter; the results screen shows the line score under the score and "5-minute quarters" in the header; the drive chart labels a timed game's drives by quarter (Q1…Q4, OT) and the play of the game by its clock ("Q3 4:12"). Quick Play records are as before.

**The scoreboard.** The score bug now carries the quarter, the game clock (lime while it runs between plays, white when stopped, tabular figures) and the play clock in its own amber box that turns red and pulses in the last five seconds (with a dry tick each second), plus the timeout pips beside your score. A strip under the bug announces the two-minute warning and the end of a quarter.

## 2. Kicking

**The scheme** (`src/game/kickMeter.ts`, `src/ui/screens/GameScreen.tsx` KickPanel), the same for PATs, field goals and punts:
1. **Aim first**: arrows / A-D, the D-pad, the left stick (analog) or the mouse. On the field (`src/render/game/KickAim.tsx`) a dashed lime line runs from the ball along your aim, crawling toward the target: to the posts on a field goal with a ring hanging in the goal mouth, ~45 yd downfield on a punt with a landing ring. Pale blue chevrons drift across the turf the way the wind blows, one to three by its strength. The line shows where you aim, not where the ball goes: the wind is yours to read. The panel says it in words too ("Wind 11 mph, right to left", "Aim: 2.6° right").
2. **Hold to charge** (Space / Enter / the mouse button, A on a pad). Power fills linearly to full leg (1.3 s at Pro) and on into an overcooked band (a slice).
3. **Release inside the green window**, which slides up and down the same meter. Inside it the strike is clean ("Pure"); outside, the kick is hooked left (released under the window) or pushed right (over it), more the farther out (0.1 of the meter out is ~0.07 rad, about 3 yd by the posts from 40 yd). A white "leg" mark shows how much power this kick needs in this wind.

So a PAT is easy (the window passes low power often, and a small miss still goes in), a 50-yarder asks you to time the press so the fill meets the window near the top, and holding too long gets you the slice. The window is 18% of the meter and turns every ~2.2 s at Rookie, 9% and ~1.3 s at Beast. The panel counts the steps (1 · Aim, 2 · Hold, 3 · Release in the green), names the strike, and the result lands as the ball gets there, with a thump on contact and the crowd's roar or groan.

**Timed from the event, not the frame.** The press time is the keydown's / mousedown's `timeStamp` (the pad's own `timestamp` when fresh, else its poll); the release is the new `Input.onRelease` (keyup / mouseup / the pad poll that saw it up). The meter is drawn per frame straight to the DOM, but the strike is computed only from the two event times (`KickControl`), so a tap between two frames counts as exactly what it was: `tests/kick-meter.test.ts` taps for 5.7 ms between frames at 60 and at 24 fps and gets the same strike. A press left over from the card before (the A that chose "Field goal") doesn't start the charge. A hold past 2.6 s kicks it at the cap.

**The flight.** Field goals keep the M6 physics (`src/game/kick.ts`: the sim's drag and gravity, wind, NFL posts). Punts are new: `puntFlight` launches a 60° spiral from knee height with a leg that carries 52 yd at full power in still air and hangs 4.2 s (the NFL average hang is ~4.3 s; a flatter launch came down in 3.5 s, a line drive), the wind bends it, and it's out of bounds where it crosses the sideline. `resolvePunt` turns the landing into the Beasts' ball: a touchback (their 20), out of bounds (no return, the coffin corner: aim up to ±34°), inside their 10 it bounces and rolls 2–8 yd (maybe into the end zone), or a fair catch (likelier the longer it hangs) or a return of ~9 yd (NFL average), shorter the longer it hung. All in whole yards. A missed field goal now gives the Beasts the spot of the kick or their 20 (NFL Rule 11-4-3). Field-goal tries and punts take their time off a timed clock.

**The picture.** A punt now has its own look (`PUNT_SET` in `GameScene.tsx`): the spread punt (two-point line, wings, a personal protector, gunners at the numbers), the Beasts with a vise on each gunner and a returner 42 yd deep; the snapper and the punter (the in-house `ks_punt` clip: catch, drop, contact at frame 42) are KickBall's. After the snap the gunners and the vise run at the landing spot and the returner settles under it. The camera starts behind the punter and rides the ball.

**No sim change.** The kick physics live in `src/game`, so `src/sim` is untouched and the determinism golden passes as pinned (not re-pinned).

## 3. Yardage

The punt's "40.52" came from the old auto-punt: net yards off a fractional line of scrimmage (the sim spots the ball where it died). Every yardage the game layer produces is now whole at the source (the punt's gross, return, net and the Beasts' start; the Beasts' drive yards, also when the gun cuts a drive short; the delay-of-game walk-off), and every place that shows a yardage was checked: the kick and punt cards, the 4th-down card, the Meanwhile line, the result card (`describe.ts` already rounded), the drive chart and box score (already rounded; averages like 7.4 Y/A stay one decimal, as on any box score). `tests/clock.test.ts` checks the Beasts' drives and punts from fractional spots are whole.

## Tests

- `tests/clock.test.ts` (19): the quarter and the Beasts' time; the play clock and the huddle; stops by rule; whole-second play durations; delay of game (and inside the 10); timeouts; the two-minute warning (between plays and through a play); end of the 1st quarter (the drive carries on, the wind turns); halftime; a TD at 0:00 gets its try; final vs overtime, and running the clock out at the line; the Beasts fitting the half and kneeling out a lead; punts and FG tries taking time and the missed-FG spot; victory formation and kneels; the Daily's fixed length and the formats; a whole deterministic timed game; the Beasts' points per possession against legacy; whole yardages; the timed record (line score, grade).
- `tests/kick-meter.test.ts` (8): the meter; clean/hooked/pushed; the event timing (a 5.7 ms tap between frames, same at 60 and 24 fps); the leftover press; the hold cap; aim rate, clamp and lock; a clean strike into the wind goes through and a late one is pushed wide; punts (distance, the coffin corner out of bounds, a touchback, whole yards).
- `tests/ui/settings-input.test.ts`: the v7 → v8 migration and the new kick bindings. `tests/results.test.ts`: its punt helper uses the new punt.

## Critique (honest, from the stills in `docs/screenshots/m6.6/`)

The stills are software-rendered (SwiftShader: a frame takes seconds, so the capture waits for the canvas to catch up with a change), and the moments were set up through the dev globals rather than played, so they show layout and state, not motion. The clock shots (01–05) and the kick shots (06–12) come from two runs of the spec, so the score and quarter differ between them. The kick's flight, the punt's coverage and the camera following the ball could not be judged here and need a look on real hardware.

- **The score bug** (`01-call-scorebug`, `02-presnap-playclock`) now reads like a broadcast bug: CON 0, BST 3, Q1 3:03 and the play clock in its own box. The amber `:25` is clear at a glance and the red `:04` at the line is the loudest thing on screen, which is right for the last five seconds. Weaker: the game clock turns lime while it runs between plays and white when stopped. It's a real cue, but a fan won't know it without being told; broadcast bugs don't do this. The timeout pips sit as three stacked yellow bars beside your score and read like a menu icon (≡); they should be a row of short bars under the name.
- **Delay of game** (`03`): the card is clear and the situation has already moved (1st & 15 at the Own 20, the play clock back at `:25`). The yellow "flag" graphic reads more like a sticky note than a thrown flag. It needs a tail or a weighted knot to read as a flag.
- **Two-minute warning** (`04`): the yellow strip under the bug is the right broadcast language, but on the play call it sits across the tab row (PLAY ACTION / SCREENS). It's readable but crowded. The play call's header should drop a line while a banner is up, or the banner should live inside the bug.
- **Fourth-down card** (`05`): the play clock keeps running on the decision, as it should. "FIELD GOAL: 44 YD" wraps onto two lines; the sub-line should be shorter.
- **The field goal** (`06-fg-aim`, `07-fg-charge`, `08-fg-result`): this is the best of the set. From behind the holder the dashed aim line, the ring in the goal mouth and the blue wind chevrons tell you what you're doing before you read any text, and the panel says it in words ("Wind 11 mph, right to left", "Aim: 2.6° right"). The meter reads: the red overcooked band, the white "leg" mark, the green window and the fill. Weaker: the chevrons are pale on the grass and partly hidden behind the line of scrimmage at this camera height; a second set in the air by the posts would read better. The aim line stays up through the charge (it's locked by then); it could dim to show that.
- **The punt** (`10-punt-aim`, `11-punt-result`): aimed 16° right for the sideline, the dashed line angles off toward the landing ring by the far numbers with the wind chevrons across it. That's the coffin-corner idea, readable without text. The spread punt reads as a punt: the punter 15 deep, the personal protector, the gunners split wide (cut off at the frame edges from this camera; it should be a little wider), the returner deep. The result line ("34-yard punt · Returned 13 yards · Beasts' ball on their 44 · net 21") is whole yards and readable now that it has a backing. The ball in the air and the gunners' release don't show in a software still.
- **Halftime** (`09-halftime`): the line score by quarter and the second-half kickoff line are the right beat. It's plain but clean.
- **Results** (`12-results`): the line score sits in the header beside the final, "Classic · 5-minute quarters" replaces the rounds, and the drive chart labels drives by quarter. The harness game had no real snaps, so its box score is empty.
- **Pace, honestly:** 5-minute quarters give each side about 3–4 possessions. That's a short game and about the old Quick format. It's the owner's default; 8 minutes plays like the old Standard.

## What's left

- Fix what the stills showed: the timeout pips as a row; the banner clearing the play-call tabs; a flag that reads as a flag; the 4th-down FG label wrapping; wind chevrons in the air near the posts; the punt camera a touch wider for the gunners.
- A look on real hardware at the moving parts: the ball's flight on field goals and punts, the punter's catch-drop-swing timing against the ball, the gunners' and returner's movement, and the punt camera's follow.
- An end-to-end browser run of a whole timed Classic game (`e2e/results.spec.ts` plays Classic, which is now timed; its loops already answer the new `penalty` and `break` stages). It wasn't run here because the container is shared and a full software-rendered game takes over an hour.
- The Beasts' possessions ignore field position (a coffin-corner punt only changes their start line, not their scoring odds); that's a scoring-model change for M7 or later.
- No live kickoffs (GDD D15) and untimed overtime (GDD §7.5), both unchanged.
- The pad's press time is its poll's (or its own `timestamp` when the browser gives a fresh one). A tap shorter than one poll can still be missed on a pad; no browser offers button events for gamepads.

