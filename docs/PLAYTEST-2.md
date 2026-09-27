# Playtest 2 (owner's notes)

Saved verbatim from the owner's message of 2026-09-27. Run immediately after Playtest 1 (`docs/PLAYTEST-1.md`), solo, Daily Challenge, same build. Items are folded into M6.5 and M6.6 as marked; `docs/PROGRESS.md` tracks where each stands.

---

This is a second playtest, run immediately after the first one (docs/PLAYTEST-1.md), solo, Daily Challenge, same build. Fold the items below into M6.5 and M6.6 as marked.

## Data and ratings (M6.6, with the audit)
- Derrick Henry is missing from TEN 2010s. Include in the audit.
- Traits look wrong on 2020s stints: Garrett Wilson (NYJ), Davante Adams (NYJ) and Aaron Rodgers (NYJ) have no traits; Allen Lazard (NYJ) has several. Diagnose before changing anything: is it short-stint per-game math, the 2020s pool size, or the percentile gates? Report, then fix at the cause.

## Draft (M6.6)
- The best player at each position starts, regardless of draft order: RB1, WR1, TE1 are the better players, and the depth chart shows it.
- Filled positions in the pick list are struck through as well as faded, so the eye goes to the open ones.
- RB2 and TE2 get real snaps: RB2 is the change-of-pace and third-down back (about a third of carries and most screens), TE2 comes on in 12 personnel and heavy sets. The box score shows snaps.

## Post-game (M6.6)
- After the results screen, go to the main menu, not the locker room. The main menu's big button is New Draft; Last Game and History are smaller. Rename the locker room entry "My Team." No rematch with the same roster.
- The results screen auto-loads the box score after about two seconds no matter what's pressed; the score and grade animation plays at the top of it.
- Player grades are broken: 3 of 6 for 43 yards got an A+, a QB with 101 yards, no TDs and 175 rushing got a B. Base grades on production against expectation for the role and the game length, and show the reason in one line. Label every column in words a fan knows (no "SK").

## Play calling (M6.6)
- Suggested tab shows 10 plays, mixed runs and passes, ranked.
- Audibles at the line: a small set (quick pass, run, PA shot, screen) on a key with prompts.
- Hot route picker: 12 routes including drag, corner, wheel and post; it draws as a grid so navigate it as a grid.
- Play action should be readable after the snap: the fake, the linebackers biting, a prompt that says PA.
- Slants are an exploit: backing up and throwing is always open. Coverage on quick game has to squeeze it; part of the zone work.

## Gameplay (M6.5)
- Throw on the run is a core skill in this game because the QB is always moving; a good QB should be accurate on the move within a reasonable window, with the penalty scaling by how far outside the pocket and how fast he's moving.
- A tap to throw sometimes didn't fire on a controller. Same fix as the kick: time from the button event.
- Scrambles on deep plays are too easy; contain and pursuit have to punish it.
- Ragdoll and the spot: the tackle resolves first (drive, fight, break), then the ragdoll fires only on the fall, tuned so the carrier lands within a yard or two of contact; the ball is spotted where it is when he hits the turf; fumbles come only from true big hits, not every launch.
- Breakaway camera: stay a bit wider on a breakaway and ease the swing so it doesn't distract. It can push in a little closer than now on normal plays.

## Kicking (M6.6)
- Replace the pull-back. Aim first with the stick or arrows (a marker on the field shows the target line and the wind), then hold to charge power and release inside a moving accuracy window. Same for PATs and field goals. Make it feel good, not just correct.

Keep the rules card and the pre-game "press to kick off" from playtest 1.

## Standing principle

Added to CLAUDE.md under "Football is art":

Every player is himself. The ratings and traits aren't a stat sheet; they're the player. Tyreek Hill runs away from everyone, Gronk boxes out and catches through contact, Barry Sanders makes a man miss in a phone booth, Montana puts it on the hands, Marino gets it out before the rush arrives, Reggie White runs through the tackle, Deion shuts down half the field. If two players with different ratings and traits move, decide and produce the same way on the field, the mapping is broken, whatever the harness averages say. Every attribute and every trait must have a visible, feelable effect in play, and the gap between a 75 and a 95 must be obvious to a fan watching, not only to the harness.

Build the test for it in M6.5 and run it every milestone after: an identity harness. Take twenty pairs of well-known players at the same position with clear real-world contrasts (Tyreek vs a possession receiver, Barry vs Bettis, Marino vs a scrambler, Deion vs a run-stuffing safety) and run the same plays with each. Report the on-field differences in numbers a fan would recognize: top speed reached, separation at the break, yards after contact, time to throw, catch rate in traffic, tackles broken. A pair fails if the differences are small or in the wrong direction. Then record five of those pairs side by side from the broadcast camera and watch them: if you can't tell who's who from the motion alone, it isn't done.
