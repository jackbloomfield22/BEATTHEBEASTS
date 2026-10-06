# M7: the broadcast overlay and commentary

GDD §11.4 (broadcast overlay) and §11.7 (commentary), with the Meanwhile lower third of §7.3.
Stills: `docs/m7/shots/overlay-*` (after) and `docs/m7/shots/overlay-before-*` (the branch before this work), each at 1920×1080 and 2560×1440.
Capture: `BTB_OVERLAY=1 BTB_PORT=<port> npx playwright test -c tools/shots/playwright.config.ts` (`tools/shots/overlay.spec.ts`).

## Audit against GDD §11.4 and §11.7 (before this work)

| Item | Before | After |
|---|---|---|
| Score bug: CON vs BST | Present, with the full names ("CONTENDERS", "BEASTS") in a two-row box | One bar: **CON** and **BST**, each with its team rule (lime, crimson) |
| Quarter, game clock, play clock | Present ("Q1 5:00", the play clock in an amber box, red under 5) | Kept: "1st 5:00"; the play clock dim, amber in the last ten, red and pulsing in the last five |
| Possession | **Missing** | A small football by the team with the ball; the down cell reads "Beasts ball" on their possessions |
| Timeouts | Present (three bars) with a live clock only | Kept, as three bars along the bottom of the CON cell |
| Down and distance | Present on a second row ("1st & 10  Own 25") | In the bar: "3rd & 4 · BST 32" (the broadcast's spot, as the montage said it), amber on third and fourth, "2-pt try", "FG 42 yd", "Extra point", "Final" |
| Drive strip | **Missing** | Under the bug: a pip a possession, lime for your scores, crimson for theirs, dim for stops; the one on now outlined in its team colour; in Quick Play's drive count the ones to come, faint |
| Lower thirds for big plays | **Missing** (the result card names the play at the top; the Meanwhile card and the montage's board shot were lower-third shaped but each its own style) | Built: number, name, position, team and decade, a trait badge, a tag ("34-yd TD catch", "Sack · −9 yd", "Interception"), and the booth's line. The Meanwhile card and the montage board use the same plate |
| First-down line and line of scrimmage on the turf | Present (`render/game/fieldMarks.ts`: blue line of scrimmage, yellow line to gain, unlit, faded at the sidelines) | Unchanged; checked in the stills |
| Wind flag on kicks | **Weak**: an arrow glyph and words on the kick card, the wind always on the score bug, drifting chevrons on the turf | A pennant on a dial (up is the posts; longer and stiffer as it blows), the mph and the words, on the kick card and on the cards that offer a kick (fourth down with a field goal in range, the try); off the bug |
| Commentary: caption bar | **Missing** (legacy's `captionFor` was not ported) | Built: the caption bar, bottom left, and the line under a big play's lower third |
| Commentary: line bank keyed by event, situation and traits; variety | **Missing** | `src/game/commentary.ts`: about 250 lines over 47 events, situation and trait tags, no repeats within 12 lines (nor the last 4 of its event) |
| Legacy L8 ("Intercepted by null!") | The result card would print "Intercepted by " with an empty name | Every name slot has a fallback ("the defense"); the result card too |
| Settings | "Caption size" stored, unused; "HUD scale" stored, unused | Commentary captions: Off / Small / Medium / Large. HUD scale sizes the whole overlay |

## Design

**One package.** Every graphic the "network" puts over the game is drawn from the same parts (`src/ui/game/Broadcast.tsx`, `src/ui/styles/broadcast.css`):

- crisp near-black plates (90% opaque, no blur, no rounded corners, no pills);
- one team-coloured rule as the only accent: lime for the Contenders, crimson for the Beasts;
- Bungee only for numerals (scores, the clock, a jersey number) and for the name on a lower third; Barlow Semi Condensed, uppercase and tracked, for labels; Barlow, sentence case, for the booth's sentences;
- sizes in `em` off the HUD scale setting, which was stored but did nothing before. `1rem` already follows the window height, so 1080p and 1440p are the same layout at 1.33×.

**Where things live.** The top centre is the score bug and nothing else. The bottom left is the lower-third zone: a big play's man, the caption bar, the Meanwhile card and the montage's board shot all come up in the same place on the same plate. The bottom centre stays with the prompts (snap, throws, the catch call, the celebration), the bottom right with the hints and Skip. Nothing of the overlay is up during a live play: the line before the snap goes at the snap, and the next one comes at the whistle.

**The score bug** is one bar, left to right: CON and its score, BST and its score (the ball by whichever has it; your three timeouts along the bottom of CON's cell when the clock is live), the quarter and clock (the game clock lime while it runs; the play clock in its own box, amber in the last ten and red in the last five), then down and distance with the spot. The spot is said the way a broadcast says it, CON 25, BST 32, 50, and the montage now says it the same way (it said "BEA"). Third and fourth down turn the cell amber; the Beasts' possessions read "Beasts ball" in crimson; a kick reads "FG 42 yd", "Extra point" or "Punt".

**The drive strip** hangs under the bug (legacy's progress strip, `ProgressDots`, revived): one pip a possession in the order they happened (a new presentation-only `seq` on each drive in `match.ts`), lime where you scored, crimson where they did (a pick-six on your drive counts as theirs, a safety on theirs as yours), dim for the stops. The possession on now is outlined in its team's colour; in Quick Play's drive count the possessions still to come are faint outlines, so the strip is also the game's progress. A timed game doesn't know how many there will be, so it shows only what's been played. Before the first possession ends there's no strip.

**The lower third** (big plays only): a tag in the team colour ("41-yd catch", "8-yd TD run", "Sack · −9 yd", "Interception", "Pick-six", "Forced fumble", "Big hit", "Safety", "Two-point try"), a number block, the name, then position, team and decade ("WR · SF · 1980s") and a trait badge, and under the plate the booth's line. Big plays are touchdowns, turnovers, sacks, big hits, safeties, completions of 20+ and runs or scrambles of 15+ (a broadcast's "explosive" thresholds). The trait badge is the one the line was picked for when it was picked for this man's trait (Speed Rusher on "Smith bends the edge and gets to Montana"), else his headline trait. Your men's lower thirds are lime, the Beasts' crimson.

**Touchdowns and the celebration.** The celebration prompt owns the bottom of the screen while it's up, so nothing of the overlay shows then. The touchdown's lower third waits for the prompt to be answered (or to run out, or be skipped) and comes up with the celebration itself, bottom left, while the prompt's Skip sits bottom right. The result card follows the celebration as before; the lower third stays with it for the rest of its 6.5 s.

**The caption bar** is the same line on its own plate when there's no one to name: the call after the whistle (6 s) and, before the snap, a situation worth a line (4.8 s, or until the snap). Most snaps say nothing before the ball is snapped; a line comes only for the two-minute drill, fourth down, goal to go, third and long or short, the red zone and the start of a drive, and the once-a-drive ones (the drive, the red zone, first and goal, the two-minute drill) only once.

**The wind flag** is a pennant on a dial: up is the posts you're kicking at, it points where the wind blows, longer and stiffer the harder it blows (limp at calm, full at 20 mph), with the mph and the words ("in your face, left to right"). It's on the kick card and on the two cards that offer a kick (fourth down with a field goal in range, the try). The wind left the score bug, where it sat all game.

## Commentary

`src/game/commentary.ts` is a pure bank of about 250 lines over 47 events: your snaps (touchdowns, big and ordinary completions and runs, stuffs, scrambles, incompletions, drops, breakups, batted balls, throwaways, catches out of bounds, sacks, strip sacks, interceptions, pick-sixes, fumbles, big hits, safeties, turnovers on downs, two-point tries, kneels and spikes), kicks (field goals, extra points, punts), the Beasts' possessions (every result the resolver gives) and the situations before a snap. Legacy's `captionFor` lines are all in it ("{passer} finds {receiver} for a {yards}-yard touchdown.", "Intercepted by {defender}!", "The Beasts punch in a touchdown.", "The Beasts strike first with a touchdown.", …).

- **Keys.** A line can ask for situation tags (third down, fourth down, first down, short of the sticks, red zone, goal line, deep, yards after the catch, contested, under pressure, on the run, sailed, short-hopped, play action, screen, a broken tackle, the move the carrier made, takes the lead, ties it, late and close, the opening score, an answer, three and out) and for trait tags on a named man ("receiver: Contested Catch King or Jump Ball King", "rusher: Speed Rusher or Edge Bender", "defender: Ballhawk", "passer: Statue", "runner: Fumble Risk"). The reader (`src/game/broadcast.ts`) gets the tags from the sim's own events and the players' trait ids, so "Smith bends the edge" is only said of a man who has the trait, after a sack he made.
- **Every slot has a fallback** (legacy bug L8). A name the sim can't give reads "the quarterback", "the receiver", "the ball carrier", "the defense", "the rush", "the defender", capitalised at the start of a sentence. A line that needs a number, a spot or a clock is only said when it has one, and every event has a line that needs nothing. "a 8-yard" becomes "an 8-yard". The result card's turnover headline has the same fallback now.
- **Variety.** No line twice within 12 lines, nor within the last 4 lines of its own event (so a touchdown a quarter later isn't the same words). When everything eligible was said lately, the one said longest ago comes back. A line with requirements weighs 1 + 2 per requirement, so the specific line usually wins when it fits and the game still sounds different from drive to drive.
- **Deterministic.** The commentator draws from `deriveStream(seed, 'commentary')`, never `Math.random`; the same game seed and the same events give the same lines. It reads the sim and never writes to it (no file under `src/sim` changed; the determinism goldens are untouched).
- **Settings.** Accessibility → Commentary captions: Off, Small, Medium (default), Large. Off hides the caption bar and the line under a lower third; the lower third itself stays.

`tests/commentary.test.ts` (15 tests): every line filled with every slot, and with every name missing in each way the sim can miss one (null, undefined, empty, "null", blank) never prints null, undefined, NaN or a brace; every event has a line that needs nothing; every line is reachable through its tags; no repeat inside the windows over 50 calls of one event and 200 of a mixed game; a trait line is preferred when it fits; the same seed says the same 60 lines and another seed doesn't; 90 real sim snaps read and said cleanly, every touchdown and turnover with a hero; the Beasts' possessions, kicks and punts; the situation rules; the drive strip's colours and order.

## Before and after

Stills in `docs/m7/shots/`. "Before" is the branch at `95b898a`; for the kick and the play call, M6.6's stills (`docs/screenshots/m6.6/01-call-scorebug.jpg`, `02-presnap-playclock.jpg`, `06-fg-aim.jpg`) show the same HUD.

| State | Before | After |
|---|---|---|
| Pre-game | `overlay-before-01-pregame-*`: a two-row box, "CONTENDERS 0 / BEASTS 0 / Q1 5:00", "1ST QUARTER" and the wind on a second row | `overlay-01-pregame-*`: one bar, "CON 0 · BST 0 (ball) · 1ST 5:00 · BEASTS BALL" |
| Beasts' possession | `overlay-before-02-montage-play-*`: two bugs saying "Beasts ball" (the montage's and the score bug's wind row) | `overlay-02-meanwhile-card-*`: the Meanwhile card as a lower third ("MEANWHILE" tag, BST block, PUNT, 6 plays · 9 yd · 2:05, "The Beasts go nowhere and punt it away.", "Your ball on the CON 23"); the montage's key play now sits on the score bug's down cell (not re-captured, see below) |
| Play call | M6.6 `01-call-scorebug.jpg` | `overlay-04-playcall-*`: the bar with the play clock, timeouts and the drive strip over the call screen |
| Pre-snap | M6.6 `02-presnap-playclock.jpg` | `overlay-05-presnap-*`: "1ST & 10 · CON 23", the play clock, and the caption "Here we go: the Contenders' first snap." |
| A big play | (no lower thirds) | `overlay-06-result-completion-rac-72-*`: "26-YD CATCH", 85, WESLEY WALLS, TE · CAR · 1990s · SURE HANDS, "Allen airs it out... caught by Walls! 26 yards." |
| An ordinary snap | (no captions) | `overlay-06-result-go-60-*`: the result card and the caption "Diggs gets a hand in there. Incomplete." |
| Touchdown | the celebration prompt alone | `overlay-07-td-prompt-*`: the bottom left stays empty while the prompt is up; `overlay-08-td-lowerthird-*`: with the celebration, "15-YD TD CATCH … Allen threads it through the window. Walls, touchdown.", the bug "CON 6 · EXTRA POINT" |
| Fourth down | M6.6 `05-fourth-card.jpg` | `overlay-10-fourth-card-*`: the bug's down cell "4TH & 4 · BST 30" in amber; the card carries the wind flag under its head because a field goal is on offer |
| Kick | M6.6 `06-fg-aim.jpg`: an arrow glyph and "Wind 11 mph, right to left" | `overlay-11-kick-aim-*`: the bug reads "FG 47 YD · BST 30"; the kick card has the wind flag (dial, 5 MPH, RIGHT TO LEFT) |
| After the kick | (the Meanwhile card) | `overlay-13-meanwhile-after-kick-*`: the next Beasts possession, "The Contenders' defense holds. The Beasts punt.", the drive strip with three pips (two stops, the Beasts' possession on now outlined in crimson) |

## Honest critique

What works:

- **The lower third is the best part.** "85 / WESLEY WALLS / TE · CAR · 1990s · SURE HANDS" over "Allen threads it through the window. Walls, touchdown." with the scorer mid-celebration reads like a broadcast ID, and it comes up only after the celebration prompt is answered, so the prompt and the plate never share the screen (`07` vs `08`). At 1440p it's the same picture at 1.33×: nothing reflows.
- **The bug is quieter and says more.** One bar instead of two rows, the abbreviations the GDD asks for, a possession ball, the spot the way a broadcast says it. It no longer carries the wind all game.
- **The booth reads the play.** The lines name the right men and fit what happened: "Diggs gets a hand in there" on a breakup by Trevon Diggs, "Campbell for 3, Williams makes the stop", "Allen airs it out... caught by Walls! 26 yards" on a 26-yard throw. Trait lines only fire for men who have the trait, after the thing the trait is about.
- **Restraint.** Most snaps say nothing before the ball is snapped; nothing of the overlay is up during a live play; the Meanwhile card, the montage board and the big-play plate are one plate in one place.

What's weak or unfinished:

- **The caption repeats the result card.** On an ordinary snap the card says "Incomplete / Broken up by Trevon Diggs." and the caption says "Diggs gets a hand in there. Incomplete." It's the booth's voice over the graphic, as on TV, but it's the same fact twice on one screen. The card is a menu (Continue, Replay) and can't go; a later pass could let the caption carry the detail and the card keep only the headline, or hold the caption until the card is dismissed.
- **The score bug updates late on a touchdown.** At the celebration prompt (`07`) it still reads "0 · 1ST & 10 · BST 15": the game hears a result after the 1.6 s dead-ball hold and the prompt opens at 0.5 s. A broadcast bug flips to 6 at the whistle. Fixing it means scoring the play at the whistle (the game layer's timing), not the overlay; left alone here.
- **The drive strip is small.** Pips of 1.35 × 0.34 em under a 2.6 em bar read as a progress hint more than a drive chart; whose possession a dim pip was is only in its tooltip. It is legacy's strip as asked, but on a TV screen at three metres a fan won't parse it. A second lane (yours above, theirs below) would be the next try.
- **Two vocabularies for the spot.** The bug, the montage and the lower thirds say "CON 23 / BST 15"; the play call, the result card and the fourth-down card still say "Own 23 / Opp 15" (the coach's words, `situation.ts spotLabel`). Both read, but it's one broadcast.
- **Two small things fixed after the last capture, not re-shot:** the decade read "1990S" under the uppercase meta line (now `1990s`), and the plate was narrower than a long line under it, so the lower third's right edge was ragged (the plate now spans the line). Both are CSS only.
- **The kick's call is not on a still.** The capture's frames are slow and the kick card's reveal and its end run on real-time timers, so by the time the screenshot after the strike was taken the kick had come down (no good, from the score), the card was gone and the next Beasts possession was up (`13`). The field goal and extra-point lines are covered by the unit tests, not seen on screen.
- **The wind flag is too small at low wind.** At 5 mph (`10`, `11`) the pennant is a short blob inside a 3.1 em dial; "5 MPH / RIGHT TO LEFT" carries it. The pennant needs a longer minimum and the dial more size before it reads at a glance; the turf chevrons from M6.6 remain the in-world cue.
- **The kick still shows the wide camera.** In `11` the kick view hadn't cut to its behind-the-kicker angle in the 20 frames the capture gives it (M6.6's `06-fg-aim.jpg` shows the intended angle). That's the capture, not the overlay.
- **Not re-captured after the final change:** the montage with the key play on the score bug's down cell. The montage capture is the slowest part of the run (thousands of frames on this machine) and was cut by the two-hour limit twice. The change is small (the montage's own tag now reads "Meanwhile · Key play" and the down cell shows its down, distance and spot) and the montage e2e spec passes, but nobody has looked at it on screen.
- **Lines on the 1440p pre-snap still** came out over a black canvas: the scene didn't draw in the two frames after the viewport resize on this software renderer. The overlay itself is correct in it; the 1080p still has the scene.
- **Commentary limits.** No voice (out of scope). It reads the sim's events, not the pictures, so it can't say "over the middle" or "to the corner". The "deep" tag is air yards ≥ 20 from the throw, so "airs it out" can be said of a 21-yard seam. Some lines presume history ("That's been the knock on him" for a Drops receiver) without checking this game's drops. Kickers aren't named (the Contenders' kicker is generated and unnamed).
- **60 fps on Medium is not measured.** The overlay is plain DOM, re-rendered on events only (a whistle, a line, the clock's seconds), with no backdrop blur and two small CSS animations (the plate's wipe, the "now" pip's glow, off with reduced motion). It should be free, but there is no measurement on the target hardware.
- **Fonts in the harness.** The worktree's `node_modules` is a symlink outside the worktree, so vite refused to serve the bundled fonts and every capture fell back to system fonts (M6.6's stills show the same). The captures here were run with the shared `node_modules` on vite's allow list; the game itself is unaffected.

## Checks (after merging `claude/m7-presentation` at `0860f5c`)

- `npm run check`, split so the shared machine's load can't time a whole-book run out: typecheck, lint and the data checks pass; all 70 test files pass when each is run on its own (`tests/commentary.test.ts`: 15).
- e2e, one spec at a time against this worktree's own dev server (port 5295, not the shared 5174): `celebrate` 2 passed, `montage` 1 passed, `game` 1 passed (the full six-round Quick Play game to the results screen). `practice`: 4 passed, 3 failed (a full play, the catch call, the touchdown run). The same three fail on the branch before this work (`95b898a`, run on its own server), so they predate the overlay: they expect the three-key catch call and older sim outcomes.
