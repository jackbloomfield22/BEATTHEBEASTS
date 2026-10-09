# The passing game, round 4: when to throw, the late out, the deep ball, the catch

The owner's standing complaint: "Passing game is still by far the biggest issue. QB doesn't lead receivers, timing is all messed up, receivers give up on their routes halfway through or while the ball is in the air, catches don't feel natural and don't look right." Round 3 (`PASSING3.md`) fixed the receivers giving up on their routes, the windup on the key, the settle routes and the hands to the ball, and left five things open. This round took them in the order the lead set. Branch `wip/passing4`, from `68dd2a4` (the tip of `claude/m66-polish`).

## How it was diagnosed

- **The player's throws, pressed on the cue** (`tools/sim/cuecheck.ts`, `cuetick.ts`): the key pressed the first tick the new throw-timing cue lights, on eight routes, four coverages and four seeds, for three QBs (Joe Montana, Dan Marino's quick release, Jameis Winston's long one); the ball's release against the man's real break.
- **The late out** (`tools/sim/lateout.ts`): the out (hot-routed on Doubles Curls, and the Quick Outs' quick out) thrown a third and two-thirds of a second after the break, and where the man was and which way he was going on his last tick before the ball got to him.
- **The deep ball** (`tools/sim/deepball.ts`): the go (two receivers), the post, the seam and the fade thrown by the player on the cue, a tap and a held touch, four coverages and eight seeds, for Joe Montana and for a weak arm (Chad Pennington: Throw Power 59, range 42 yd, Deep Accuracy 75): where the ball came down against where the man would be, the defender nearest him, and what happened.
- **The player's throws in numbers** (`tools/sim/passing3.ts`, unchanged from round 3) and **tick traces** (`tools/sim/p3trace.ts`).
- **Video**, the same scripted keys on the tree before this round (a frozen copy of `68dd2a4`) and on this branch, recorded on the frame-true clock (`tools/shots/video.spec.ts`, `BTB_PASSING4=1`; `src/game/clips.ts` `PASSING4`) and read as contact sheets and full-resolution crops.

{{BODY}}
