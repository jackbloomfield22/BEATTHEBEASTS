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
