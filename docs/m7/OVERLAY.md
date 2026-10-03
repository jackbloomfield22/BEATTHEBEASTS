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

PLACEHOLDER
