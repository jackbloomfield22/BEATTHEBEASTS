# Traits

_Generated from `src/engine/ratings/traits/` by `node tools/run-ts.mjs tools/ratings/report.ts` (part of `npm run ratings`). Do not edit by hand. Counts per position, top holders and the co-occurrence checks are in `docs/RATINGS_REPORT.md` ("Traits")._

A trait is a specific, documented way a player plays within his stint. Every trait has a gameplay effect (implemented in `sim/attributeEffects.ts` from M5, magnitudes tuned with the balance harness), an icon (`src/ui/scouting/traitIcons.tsx`, drawn in-house) and a one-line "why he earned it" with his own numbers, shown in the Scouting panel and the Ratings Explorer.

## Rules

- **Gates** are percentiles inside the position pool (all decades together; every input is already era-relative): elite traits at the top 10% of the position, standard traits at the top 25%, negative traits in the bottom 10–15%. Secondary conditions may be looser (written out per trait). Pools under 20 players with data can't gate.
- **Three kinds of signal**, so traits don't all say the same thing: *physical* (measurables and body, era-translated), *technical* (attribute thresholds) and *production* (stat signatures the attributes don't capture on their own: share of the team's catches, yards per catch, TDs per touch, attempts vs the league).
- **Up to 4 per player, at most 2 negatives.** A combination replaces its two parts and counts as one. The best trait of each facet (for a QB: arm, pocket and legs, mind, style) is shown first, then the rest by rank. Rank = how far past its gates + an elite bonus + a combination bonus + how rare the trait is among the player's peers (similar OVR at his position), so a star shows what sets him apart from the other stars.
- **Within the stint, never the career arc:** no gate reads age, experience or a count of seasons (tested).
- **The cut rules** (tested): every kept trait is held by at least 5 players; no trait's holders hold another trait 95% of the time or more (combination parts excepted); at least 40% of every position has no trait.
- **Why lines** quote the player's own numbers and where they rank ("Speed 97 (top 2% of WRs)"). Film Room hides them with the other numbers.

Badge colors: lime = elite, gold = standard, cyan = combination, red = negative.

## QB

**Arm**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Cannon | `rocket` | technical | elite | Throw Power top 10% | Bullet passes leave 2 mph faster and max air distance grows 4 yd; tight-window throws arrive before the defender closes. |
| Deep Ball Artist | `target` | technical | elite | Deep Accuracy top 10% | Placement error on throws of 30+ air yards shrinks 20%; lead-shoulder deep balls drop in stride. |
| Laser | `crosshair` | technical | standard | Mid Accuracy top 20%; Throw Power top 20% | Bullet passes over the middle (10–20 yd) keep full accuracy; no bullet-throw error penalty at that depth. |
| Quick Trigger | `stopwatch` | technical | elite | Release top 10% | Wind-up to release is 0.04 s faster than his Release rating alone; hot routes beat the blitz. |
| −Noodle Arm | `twig` | technical | negative | Throw Power bottom 10% | Max air distance −5 yd; deep outs to the far sideline hang long enough for corners to close. |

**Pocket and legs**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Escape Artist | `escape` | technical | standard | Pocket Presence top 25%; Scramble top 25% | First unblocked rusher misses the sack 20% more often when the QB is moving. |
| Dual Threat | `dual` | physical | elite | Scramble top 10%; Speed top 10% | Defenders assigned to spy him react 0.1 s later; zone defenders bail off coverage sooner when he breaks the pocket. |
| Off-Platform | `tilt` | technical | elite | Throw on the Run top 10% | Throwing on the run or off-balance costs half the usual accuracy penalty. |
| Climber | `climb` | technical | standard | Pocket Presence top 20%; Scramble bottom 40% | Steps up into the pocket instead of bailing when the edge collapses; pocket-collapse time +0.15 s when he climbs. |
| Designed Runner | `runner` | production | elite | QB rushing yards per game top 10% | Unlocks QB draws and zone-read keepers in the playbook; ball security on QB runs uses his full rating. |
| −Statue | `pillar` | physical | negative | Scramble bottom 10%; Speed bottom 15% | Can only step up or drift inside the pocket; any scramble outside the tackle box is slowed 15%. |
| −Sack Magnet | `magnet` | production | negative | Sack avoidance (sack rate vs league) bottom 10% | Holds the ball 0.2 s longer before the throw-away option appears under pressure. |
| −Happy Feet | `feet` | technical | negative | Under Pressure bottom 10% | A rusher within 2 yd widens his error cone 25% more than his Under Pressure alone. |

**Mind**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Surgeon | `scalpel` | technical | elite | Short Accuracy top 10%; Mid Accuracy top 10% | Ball placement on short and intermediate throws: back-shoulder and away-from-leverage placements cost no accuracy. |
| Field General | `crown` | technical | elite | Awareness top 10% | Sees the Beasts' coverage shell pre-snap (shown on the play-call screen) and gets a fifth audible slot. |
| Game Manager | `clipboard` | production | standard | Decision Making top 25%; Passing yards per game bottom 40% | Throw-away and checkdown decisions are automatic under pressure; interception chance on forced throws −25%. |
| Ice in His Veins | `snowflake` | technical | elite | Under Pressure top 10% | Pressure widens his error cone half as much; on the final drive the crowd noise wobble is removed. |
| Pre-Snap Wizard | `eye` | production | standard | Awareness top 25%; Sack avoidance (sack rate vs league) top 25% | Blitzers are highlighted before the snap; a hot-route change costs no play-clock time. |
| Checkdown Charlie | `hook` | production | standard | Completion rate top 25%; Yards per completion bottom 25% | Throws to the back or tight end in the flat get +5% completion; his deep reads come up 0.2 s later. |

**Style**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Gunslinger | `flame` | technical | standard | Throw Power top 25%; Decision Making bottom 40% | Will fit balls into windows a step tighter: more completions against tight coverage, more interceptions. |
| Volume Passer | `stack` | production | elite | Passing yards per game top 10%; Attempts per game top 25% | No stamina or accuracy drop late in drives; the two-minute drill snaps 1 s faster. |
| Efficiency King | `percent` | production | elite | Passer rating top 10% | The coordinator AI's suggested play for him is right 10% more often (it reads his best matchups). |
| Red Zone Sniper | `flag` | production | elite | TD rate top 10% | Inside the 20, placement error on throws into the end zone shrinks 20%. |
| −Turnover Machine | `warning` | production | negative | INT avoidance (INT rate vs league) bottom 10% | Tipped and contested throws are intercepted 25% more often. |

## RB

**Speed**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Home Run Hitter | `bolt` | production | standard | Speed top 25%; Yards per carry top 25% | Once past the second level, pursuit angles on him are 10% worse: long runs finish as touchdowns. |
| Burst | `burst` | physical | elite | Acceleration top 10% | Reaches top speed 0.15 s sooner out of a cut or through the hole. |
| Big-Play Back | `star` | production | elite | Yards per carry top 10% | Breakaway chance on any run that reaches the second level +15%. |
| Freight Train | `train` | physical | standard | Weight top 25%; Speed top 25% | Momentum at full speed counts 15% more in collisions: DBs meeting him in the open field bounce off. |
| −Straight-Line Only | `rail` | physical | negative | Speed top 25%; Agility bottom 25% | Cuts sharper than 45° cost 20% more speed. |

**Power**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Battering Ram | `ram` | technical | elite | Trucking top 10% | Head-on contact knocks the tackler back: +0.8 yd after contact and a chance to run through arm tackles. |
| Stiff Arm King | `palm` | technical | elite | Stiff Arm top 10% | Stiff arm against a tackler coming from the side sheds him 20% more often. |
| Tackle Breaker | `shatter` | technical | elite | Break Tackle top 10% | The first tackle attempt of every run needs a clean wrap; glancing hits are shrugged off. |
| Low Center of Gravity | `anvil` | physical | standard | Height bottom 25%; Break Tackle top 25% | Tacklers hitting above the waist lose leverage: balance recovery after contact is 30% faster. |
| Goal Line Hammer | `anvil` | production | elite | TDs per touch top 10% | Inside the 5, contact at the goal line falls forward: +1 yd on stopped runs. |
| Grinder | `grind` | production | standard | Yards per carry bottom 25%; Carries per game top 25% | Never loses yards on inside runs: a stuffed run falls forward for 1 yd instead of a loss. |

**Moves**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Ankle Breaker | `zigzag` | technical | elite | Elusiveness top 10% | Juke success ceiling +10%; a defender who bites falls down. |
| Spin Cycle | `spiral` | physical | standard | Elusiveness top 25%; Agility top 10% | Spin moves keep 90% of his speed and can be chained twice in one run. |
| Hurdler | `hurdle` | physical | elite | Jumping top 10% | Unlocks the hurdle move against low tackles; success scales with Jumping. |
| Jump Cut | `cut` | technical | standard | Agility top 25%; Vision top 25% | Lateral jump cuts in the backfield cost no speed; bounce-outs find the edge. |
| One-Cut | `rail` | technical | standard | Acceleration top 20%; Vision top 20% | Plant-and-go cuts on zone runs lose 50% less speed; he gets downhill a step faster. |
| Patient Runner | `hourglass` | technical | elite | Vision top 10% | Blocks develop for him: the running lane highlight appears 0.2 s earlier and cutback lanes stay open longer. |
| −Dancer | `sway` | technical | negative | Elusiveness top 25%; Vision bottom 25% | Hesitates in the backfield: a 0.15 s stutter before hitting the hole unless the lane is clean. |

**Role**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Workhorse | `battery` | production | elite | Carries per game top 10%; Stamina top 25% | Stamina drain from carries halved; no fatigue fumble risk late in drives. |
| Change of Pace | `split` | production | standard | Carries per game bottom 40%; Yards per carry top 25% | Fresh legs: +3% speed on his first two touches of a drive, faster stamina drain after that. |
| Receiving Back | `hand` | technical | elite | Catching top 10%; Route Running top 25% | Runs the full receiver route tree from the backfield (wheel, option, angle). |
| Third-Down Back | `shield` | technical | standard | Pass Block top 25%; Catching top 25% | Blitz pickup and a checkdown release on the same snap: picks up the rusher, then leaks out if nobody comes. |
| Scatback | `sway` | physical | standard | Weight bottom 25%; Catches per game top 25%; Elusiveness top 25% | Lines up in the slot as a receiver; first defender in space misses 10% more often. |
| −Fumble Risk | `drop` | technical | negative | Ball Security bottom 10% | Fumble chance on big hits +40%. |
| −Liability in Protection | `turnstile` | technical | negative | Pass Block bottom 10% | Loses blitz pickups 30% more often; keep him out of max-protect calls. |

## WR

**Speed and body**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Burner | `bolt` | physical | elite | Speed top 10% | Defenders in off coverage give 2 yd more cushion; he wins even-up footraces on go routes. |
| Long Strider | `ruler` | physical | standard | Height top 25%; Speed top 25% | Top speed is reached a step later but held 10 yd longer on vertical routes. |
| Skyscraper | `tower` | physical | elite | Height top 10%; Jumping top 25% | Catch radius +6 inches at the high point; overthrows become catchable. |
| Big Body | `weight` | physical | standard | Weight top 15%; Catch in Traffic top 15% | Boxes out defenders on slants and curls: contested catches in front of the defender +10%. |
| Twitch | `spring` | physical | standard | Acceleration top 15%; Agility top 15% | Breaks on short routes are 0.05 s sharper; option routes read the defender a beat sooner. |
| Blocking WR | `blocker` | technical | elite | Run Block top 10% | Stalk blocks on outside runs and screens hold 0.4 s longer. |
| −One-Speed | `gauge` | physical | negative | Acceleration bottom 10%; Agility bottom 15% | No change of pace: comeback and curl breaks lose 0.1 s of separation. |

**Route and release**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Route Technician | `route` | technical | standard | Short Route Running top 25%; Deep Route Running top 25% | Break sharpness bonus on every route stem; defenders can't sit on one route family. |
| Release Artist | `release` | technical | elite | Release top 10% | Press jams are beaten 25% more often and never knock him off his stem. |
| Slot Weapon | `slot` | technical | standard | Short Route Running top 25%; Height bottom 30% | From the slot, option routes read the leverage of the nearest defender automatically. |
| Deep Threat | `arrowUp` | technical | standard | Deep Route Running top 25%; Speed top 25% | Safeties shade his way: the deep third over him starts 2 yd deeper. |
| Head Fake | `loop` | technical | standard | Agility top 25%; Short Route Running top 25% | Double moves freeze man defenders 0.1 s longer. |

**Hands**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Glue Hands | `glove` | technical | elite | Catching top 10% | Catch probability floor on catchable balls hit in stride +5%; no drops on routine catches. |
| Sideline Toe-Tap | `toe` | technical | standard | Catching top 25%; Awareness top 10% | Always gets both feet in on sideline catches (no out-of-bounds incompletions on catchable balls). |
| Highlight Reel | `sparkle` | technical | elite | Spectacular Catch top 10% | One-handed and diving catches succeed 15% more often. |
| Contested Catch King | `fist` | technical | elite | Catch in Traffic top 10% | Wins 50/50 balls with a defender in contact 15% more often. |
| Mismatch | `tower` | physical | standard | Jumping top 25%; Catch in Traffic top 25% | Against a smaller defender, contested catches at the high point +10%. |
| −Drops | `drop` | technical | negative | Catching bottom 10% | Routine catches carry a 4% drop chance on top of his Catching. |
| −Body Catcher | `hand` | technical | negative | Catching bottom 25%; Catch in Traffic top 25% | Balls away from his frame are caught 10% less often; high and low placements hurt him. |
| −Alligator Arms | `warning` | technical | negative | Catch in Traffic bottom 10%; Catching bottom 50% | With a defender closing, catch probability on crossing routes −10%. |

**Production**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| YAC Monster | `yac` | technical | elite | Run After Catch top 10% | The first missed tackle after the catch is 20% more likely. |
| Chain Mover | `chain` | production | standard | Catch rate top 15%; Yards per catch bottom 50% | On third down, short routes past the sticks get +5% catch probability. |
| Red Zone Threat | `flag` | production | elite | TDs per catch top 10% | Inside the 20, fade and back-shoulder catches +10%. |
| Alpha | `alpha` | production | elite | Share of the team's catches (receptions per game vs league team completions) top 10%; Receiving yards per game top 25% | The Beasts roll coverage to him (a safety shades his side); every other receiver sees softer coverage. _Target share proxy: targets exist only from 1992, so this reads receptions per game as a share of a league team's completions (plus receiving yards per game vs league team passing)._ |
| Big Play | `star` | production | elite | Yards per catch top 10% | After the catch in the open field, his first missed tackle leads to +3 yd more on average. |
| Home Run Threat | `bolt` | production | standard | TDs per catch top 25%; Yards per catch top 25% | Catches beyond 20 air yards break for the end zone: pursuit angles on him 10% worse. |

## TE

**Receiving**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Seam Stretcher | `arrowUp` | physical | standard | Speed top 25%; Deep Route Running top 25% | Linebackers can't carry him up the seam: separation on seam routes +0.15 s. |
| Move TE | `slot` | technical | standard | Short Route Running top 25%; Run Block bottom 40% | Can align in the slot or out wide; runs WR route concepts. |
| Big Slot | `weight` | physical | standard | Short Route Running top 25%; Height top 25% | Against nickel corners, catches in traffic +10%. |
| YAC Monster | `yac` | technical | elite | Run After Catch top 10% | The first missed tackle after the catch is 20% more likely. |
| Volume TE | `stack` | production | elite | Share of the team's catches (receptions per game vs league team completions) top 10% | First read on the coordinator AI's suggested plays; the QB's progression starts with him. |
| Red Zone Threat | `flag` | production | elite | TDs per catch top 10% | Inside the 20, fade and back-shoulder catches +10%. |

**Hands**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Sure Hands | `glove` | technical | elite | Catching top 10% | Catch probability floor over the middle +5%; hits after the catch never cause drops. |
| Safety Blanket | `chain` | production | standard | Catch rate top 25%; Yards per catch bottom 50% | When the QB is under pressure, he breaks open toward the QB 0.2 s sooner. |
| Mismatch | `tower` | physical | standard | Jumping top 25%; Catch in Traffic top 25% | Against a smaller defender, contested catches at the high point +10%. |
| −Drops | `drop` | technical | negative | Catching bottom 10% | Routine catches carry a 4% drop chance on top of his Catching. |

**Blocking**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Sixth Lineman | `wall` | technical | elite | Run Block top 10% | Seals the edge on runs to his side: the defender he blocks is removed from the play 0.3 s longer. |
| Complete TE | `combo` | technical | standard | Short Route Running top 25%; Run Block top 25% | Run and pass plays from the same look: defenders can't key on his alignment (play-action fools them 0.1 s longer). |
| Pass Pro TE | `shield` | technical | elite | Pass Block top 10% | Chip-and-release or full protection against an edge rusher: delays the rush 0.3 s. |
| Lead Blocker | `plow` | technical | elite | Impact Block top 10% | As an H-back or wing, his lead block on the linebacker pancakes 20% more often. |
| H-Back | `swing` | technical | standard | Pass Block top 25%; Catching top 25% | Aligns in the backfield: can lead-block, chip or run swing routes from there. |
| −Liability Blocker | `turnstile` | technical | negative | Run Block bottom 10% | Edge defenders shed his blocks 30% faster; runs to his side lose the edge. |

**Body**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Basketball Body | `tower` | physical | standard | Height top 25%; Jumping top 25% | Posts up defenders in the end zone: jump-ball catch radius +4 inches. |
| Bruiser | `boulder` | physical | standard | Weight top 25%; Run After Catch top 25% | After the catch, DBs tackling him alone lose the collision 20% more often. |
| Athlete | `spring` | physical | standard | Speed top 25%; Agility top 25% | Moves like a receiver: route breaks use his Agility without the tight-end size penalty. |
| −Stone Feet | `pillar` | physical | negative | Speed bottom 15%; Agility bottom 25% | Route breaks lose 0.1 s of separation; linebackers carry him in man. |

## DE

**Pass rush**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Speed Rusher | `bolt` | technical | standard | Finesse Moves top 25%; Speed top 25% | Wins around the edge earlier against slow-footed tackles: speed-rush time-to-win −0.3 s against Pass Block Finesse below his. |
| Power Rusher | `ram` | technical | standard | Power Moves top 25%; Strength top 25% | Bull rush collapses the pocket faster against weak anchors: pocket depth shrinks 1 yd sooner. |
| Edge Bender | `spiral` | physical | standard | Agility top 25%; Acceleration top 25% | Dips under the tackle's punch: turning the corner costs 30% less speed. |
| Sack Artist | `sack` | production | elite | Sacks per game top 10% | When he wins, he finishes: a win becomes a sack instead of a pressure 20% more often. |
| Strip-Sack Specialist | `punch` | production | standard | Forced fumbles per game top 20%; Sacks per game top 20% | Sacks from the blind side jar the ball loose 25% more often. |
| Relentless Motor | `motor` | physical | standard | Stamina top 25%; Pursuit top 25% | Keeps rushing after the first move fails: a second-effort win chance late in the down. |

**Run defense**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Run Stuffer | `anvil` | technical | standard | Tackle top 25%; Block Shedding top 25% | Holds the point of attack: fewer yards before contact on runs at him. |
| −Undersized | `twig` | physical | negative | Weight bottom 15%; Strength bottom 25% | Double teams wash him out of the play; runs at him gain 0.5 yd more. |

**Hitting**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Ball Punch | `punch` | production | elite | Forced fumbles per game top 10% | Every tackle he makes carries a punch-out attempt: fumble chance +30%. |

## DT

**Pass rush**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Power Rusher | `ram` | technical | standard | Power Moves top 25%; Strength top 25% | Bull rush collapses the pocket faster against weak anchors: pocket depth shrinks 1 yd sooner. |
| Interior Wrecker | `claw` | technical | standard | Block Shedding top 25%; Sacks per game top 25% | Interior pass rush wins 0.25 s quicker against guards and centers. |
| Sack Artist | `sack` | production | elite | Sacks per game top 10% | When he wins, he finishes: a win becomes a sack instead of a pressure 20% more often. |
| Strip-Sack Specialist | `punch` | production | standard | Forced fumbles per game top 20%; Sacks per game top 20% | Sacks from the blind side jar the ball loose 25% more often. |
| Relentless Motor | `motor` | physical | standard | Stamina top 25%; Pursuit top 25% | Keeps rushing after the first move fails: a second-effort win chance late in the down. |

**Run defense**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Run Stuffer | `anvil` | technical | standard | Tackle top 25%; Block Shedding top 25% | Holds the point of attack: fewer yards before contact on runs at him. |
| Space Eater | `boulder` | physical | standard | Weight top 25%; Strength top 25% | Draws a double team on every run: one extra blocker is assigned to him. |
| −Undersized | `twig` | physical | negative | Weight bottom 15%; Strength bottom 25% | Double teams wash him out of the play; runs at him gain 0.5 yd more. |

**Hitting**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Ball Punch | `punch` | production | elite | Forced fumbles per game top 10% | Every tackle he makes carries a punch-out attempt: fumble chance +30%. |

## LB

**Pass rush**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Speed Rusher | `bolt` | technical | standard | Finesse Moves top 25%; Speed top 25% | Wins around the edge earlier against slow-footed tackles: speed-rush time-to-win −0.3 s against Pass Block Finesse below his. |
| Sack Artist | `sack` | production | elite | Sacks per game top 10% | When he wins, he finishes: a win becomes a sack instead of a pressure 20% more often. |
| Strip-Sack Specialist | `punch` | production | standard | Forced fumbles per game top 20%; Sacks per game top 20% | Sacks from the blind side jar the ball loose 25% more often. |

**Coverage**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Ballhawk | `hawk` | technical | elite | Ball Skills top 10% | Breaks on the ball earlier and turns 25% more breakups into interceptions. |
| Pick-Six Threat | `pick` | production | standard | Defensive TDs per game top 25%; INTs per game top 25% | After an interception his return pursuit angles are 15% worse for the offense: returns score more often. |
| Coverage Linebacker | `net` | technical | standard | Zone Coverage top 25%; Man Coverage top 25% | Can carry tight ends and backs in man and match vertical routes in zone. |
| −Liability in Space | `turnstile` | technical | negative | Man Coverage bottom 10% | In man against backs and tight ends he trails 0.1 s late. |

**Run defense**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Run Stuffer | `anvil` | technical | standard | Tackle top 25%; Block Shedding top 25% | Holds the point of attack: fewer yards before contact on runs at him. |
| Sideline to Sideline | `rail` | technical | elite | Pursuit top 10%; Speed top 40% | Better pursuit angles on outside runs and screens. |
| Tackling Machine | `net` | production | standard | Tackles per game top 25% | Always in on the tackle: assists count as full wraps (no broken tackles against a pile). |

**Hitting**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Enforcer | `fist` | technical | elite | Hit Power top 10%; Tackle top 50% | Big-hit chance and fumble pressure raised; receivers he hits drop the next contested ball 5% more often. |
| Downhill Thumper | `boulder` | physical | standard | Hit Power top 20%; Weight top 20% | Meets the back in the hole: runs between the tackles lose 0.5 yd after contact. |
| Ball Punch | `punch` | production | elite | Forced fumbles per game top 10% | Every tackle he makes carries a punch-out attempt: fumble chance +30%. |

## CB

**Coverage**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Ballhawk | `hawk` | technical | elite | Ball Skills top 10% | Breaks on the ball earlier and turns 25% more breakups into interceptions. |
| Pick-Six Threat | `pick` | production | standard | Defensive TDs per game top 25%; INTs per game top 25% | After an interception his return pursuit angles are 15% worse for the offense: returns score more often. |
| Shutdown Corner | `lock` | technical | elite | Man Coverage top 10%; Press top 50% | Tighter trail in man; the coordinator AI stops suggesting throws his way. |
| Jam Artist | `palm` | technical | standard | Press top 25%; Strength top 25% | Press jams delay the receiver's release 0.15 s. |
| Zone Reader | `eyeRadar` | technical | standard | Zone Coverage top 20%; Play Recognition top 20% | In zone he breaks on the QB's eyes: reaction delay −0.08 s on throws into his area. |
| Breakup Machine | `net` | production | standard | Passes defensed per game top 25% | Contested catches against him: the ball is knocked away 10% more often. |
| −Gambler | `dice` | technical | negative | Ball Skills top 25%; Man Coverage bottom 40% | Jumps routes: double moves beat him 20% more often, but he undercuts more throws. |
| −Stiff Hips | `pillar` | physical | negative | Agility bottom 10% | Hip flip on in-breaking routes costs an extra 0.08 s. |

**Speed**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Track Speed | `bolt` | physical | elite | Speed top 10% | Recovers from a lost step on vertical routes: closing speed +5% when trailing. |

**Hitting**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Missile | `missile` | physical | standard | Hit Power top 25%; Speed top 50% | Arrives at full speed: hits on receivers at the catch point dislodge the ball 15% more often. |
| −Arm Tackler | `warning` | technical | negative | Tackle bottom 10% | Tackles in space miss 20% more often against ball carriers with Break Tackle above his Tackle. |
| Ball Punch | `punch` | production | elite | Forced fumbles per game top 10% | Every tackle he makes carries a punch-out attempt: fumble chance +30%. |

## S

**Coverage**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Ballhawk | `hawk` | technical | elite | Ball Skills top 10% | Breaks on the ball earlier and turns 25% more breakups into interceptions. |
| Pick-Six Threat | `pick` | production | standard | Defensive TDs per game top 25%; INTs per game top 25% | After an interception his return pursuit angles are 15% worse for the offense: returns score more often. |
| Zone Reader | `eyeRadar` | technical | standard | Zone Coverage top 20%; Play Recognition top 20% | In zone he breaks on the QB's eyes: reaction delay −0.08 s on throws into his area. |
| Breakup Machine | `net` | production | standard | Passes defensed per game top 25% | Contested catches against him: the ball is knocked away 10% more often. |
| Center Fielder | `eye` | technical | standard | Zone Coverage top 25%; Speed top 40% | In single-high he covers sideline to sideline: deep-ball break range +3 yd. |
| −Gambler | `dice` | technical | negative | Ball Skills top 25%; Man Coverage bottom 40% | Jumps routes: double moves beat him 20% more often, but he undercuts more throws. |
| −Stiff Hips | `pillar` | physical | negative | Agility bottom 10% | Hip flip on in-breaking routes costs an extra 0.08 s. |

**Run defense**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Sideline to Sideline | `rail` | technical | elite | Pursuit top 10%; Speed top 40% | Better pursuit angles on outside runs and screens. |
| Tackling Machine | `net` | production | standard | Tackles per game top 25% | Always in on the tackle: assists count as full wraps (no broken tackles against a pile). |

**Hitting**

| Trait | Icon | Kind | Tier | Gates | Gameplay effect |
|---|---|---|---|---|---|
| Enforcer | `fist` | technical | elite | Hit Power top 10%; Tackle top 50% | Big-hit chance and fumble pressure raised; receivers he hits drop the next contested ball 5% more often. |
| Missile | `missile` | physical | standard | Hit Power top 25%; Speed top 50% | Arrives at full speed: hits on receivers at the catch point dislodge the ball 15% more often. |
| −Arm Tackler | `warning` | technical | negative | Tackle bottom 10% | Tackles in space miss 20% more often against ball carriers with Break Tackle above his Tackle. |
| Ball Punch | `punch` | production | elite | Forced fumbles per game top 10% | Every tackle he makes carries a punch-out attempt: fumble chance +30%. |

## Combinations

When a player earns both parts, the combination shows as one badge instead of the pair.

| Combination | Icon | Parts | Positions | Gameplay effect |
|---|---|---|---|---|
| Bomb Squad | `bomb` | Cannon + Deep Ball Artist | QB | Both parts, and deep balls can be thrown from the far hash to the far sideline without losing accuracy. |
| Backyard Ball | `house` | Escape Artist + Off-Platform | QB | Both parts, and receivers convert to scramble-drill routes the moment he leaves the pocket. |
| Riverboat Gambler | `dice` | Gunslinger + Turnover Machine | QB | Both parts: the tightest windows in the game, and the most interceptions. |
| Maestro | `baton` | Surgeon + Field General | QB | Both parts, and his hot-route changes also adjust the protection. |
| Unflappable | `snowflake` | Quick Trigger + Ice in His Veins | QB | Both parts: the blitz gets home a beat late and changes nothing about his throw. |
| Run-Pass Nightmare | `dual` | Dual Threat + Designed Runner | QB | Both parts, and read-option keepers freeze the edge defender 0.1 s longer. |
| Air Raid | `stack` | Volume Passer + Red Zone Sniper | QB | Both parts, and no-huddle snaps keep the Beasts in their base personnel. |
| Short-Yardage Nightmare | `ram` | Battering Ram + Goal Line Hammer | RB | Both parts: on 3rd/4th and 1 he converts unless met in the backfield. |
| Human Joystick | `zigzag` | Ankle Breaker + Jump Cut | RB | Both parts, and moves can be chained with no recovery time. |
| Bell Cow | `battery` | Workhorse + Tackle Breaker | RB | Both parts: gets stronger late in drives (Break Tackle +2 after his tenth carry). |
| Swiss Army Knife | `combo` | Receiving Back + Big-Play Back | RB | Both parts: a threat from the backfield, the slot or the flat on every snap. |
| Lightning in a Bottle | `burst` | Burst + Home Run Hitter | RB | Both parts: through the hole at full speed, gone at the second level. |
| Human Highlight | `sparkle` | Burner + Highlight Reel | WR | Both parts, and a catch beyond 30 air yards triggers the slow-mo replay. |
| Jump Ball King | `crown` | Skyscraper + Contested Catch King | WR | Both parts: an underthrown or overthrown ball in his radius is his. |
| Go-To Guy | `alpha` | Alpha + Glue Hands | WR | Both parts: first read on third down and in the red zone, and he catches it. |
| Mr. Reliable | `glove` | Route Technician + Glue Hands | WR | Both parts: on-time throws to him are never dropped. |
| Vertical Nightmare | `arrowUp` | Deep Threat + Big Play | WR | Both parts: a single-high safety must choose between him and everyone else. |
| Open-Field Menace | `yac` | YAC Monster + Twitch | WR | Both parts: every catch in space is a potential touchdown. |
| Matchup Nightmare | `tower` | Seam Stretcher + Mismatch | TE | Both parts: too fast for linebackers, too big for safeties. |
| Dual-Threat TE | `combo` | Sixth Lineman + Sure Hands | TE | Both parts: every-down tight end, no tells in his alignment. |
| Blindside Assassin | `claw` | Speed Rusher + Sack Artist | DE, LB | Both parts: from the blind side his wins are sacks. |
| No-Fly Zone | `lock` | Shutdown Corner + Zone Reader | CB | Both parts: man or zone, the coordinator AI never suggests a throw into his area. |
| Wrecking Ball | `boulder` | Power Rusher + Run Stuffer | DE, DT | Both parts: wins against the run and the pass from the same bull rush. |
| Bone Crusher | `fist` | Enforcer + Ball Punch | S, LB | Both parts: his big hits force a fumble 10% more often. |
| Every-Down Backer | `rail` | Run Stuffer + Coverage Linebacker | LB | Both parts: never subbed out; the Beasts keep base personnel against spread sets. |

## OL unit traits

OL units are rated as five linemen; unit traits read the unit's mean (pass block = Pass Block Power, Pass Block Finesse and Anchor; run block = Run Block Power and Finesse) or the unit's own results, as percentiles of the 184 units.

| Unit trait | Icon | Gates | Gameplay effect |
|---|---|---|---|
| Road Graders | `plow` | Run block (unit mean) top 25% | Inside runs gain 0.3 yd before contact; double teams move the defensive tackle off the ball. |
| Pass-Pro Wall | `wall` | Pass block (unit mean) top 25% | Pocket-collapse time +0.2 s against a four-man rush. |
| Athletic Line | `swing` | Pull and Move (unit mean) top 25% | Pulls and screens: pulling linemen arrive 0.15 s sooner; outside zone reaches the edge. |
| Smart Line | `brain` | Awareness (unit mean) top 10% | Stunts and blitzes are picked up correctly 20% more often. |
| Ground and Pound | `grind` | Unit rushing yards per game top 10% | Late in drives the Beasts' front tires faster against the run (their stamina drain +10%). |
| −Turnstile | `turnstile` | Pass block (unit mean) bottom 10% | Pocket-collapse time −0.2 s. |
| −Sack-Prone | `magnet` | Unit sack avoidance (sacks allowed vs league) bottom 10% | Free rushers come through untouched 10% more often on blitzes. |

## Roster synergies

Detected over a drafted roster by `detectSynergies` (pure). The effect is data: the sim adds `value` (in `unit`) to `key` for that pair only. Limits per synergy: 5%, 0.15 s, 0.5 yd.

| Synergy | Icon | Side A | Side B | Effect | Sim key |
|---|---|---|---|---|---|
| Moonball | `rocket` | QB: Deep Ball Artist, Cannon | WR/TE: Burner, Deep Threat, Long Strider, Seam Stretcher, Big Play, Home Run Threat | Deep balls (20+ air yards) to this receiver: placement error −5%. | `pass.deepError` -5 pct |
| Timing Offense | `metronome` | QB: Quick Trigger, Surgeon | WR/TE: Route Technician, Slot Weapon, Head Fake, Twitch | On routes under 15 yd thrown on the last step of the drop: +0.05 s of separation at the break. | `route.breakSeparation` +0.05 s |
| Red Zone Connection | `flag` | QB: Red Zone Sniper | WR/TE: Red Zone Threat, Contested Catch King, Basketball Body | Inside the 20: catch probability +4% on throws to this receiver. | `catch.redZone` +4 pct |
| Throw It Up | `tower` | QB: Gunslinger, Cannon | WR/TE: Contested Catch King, Skyscraper, Mismatch, Big Body | Contested catches on his throws to this receiver +4%. | `catch.contested` +4 pct |
| Scramble Drill | `house` | QB: Escape Artist, Off-Platform, Dual Threat | WR/TE: Sideline Toe-Tap, Twitch, Head Fake, Athlete | When the QB leaves the pocket this receiver converts his route 0.1 s sooner. | `route.scrambleConvert` -0.1 s |
| Security Blanket | `hook` | QB: Checkdown Charlie, Game Manager | TE/RB: Safety Blanket, Sure Hands, Receiving Back, Third-Down Back, H-Back | Under pressure, short throws to this target +4% completion. | `catch.shortUnderPressure` +4 pct |
| Pitch and Catch | `chain` | QB: Surgeon, Efficiency King | WR/TE: Chain Mover, Glue Hands, Sure Hands | On third down, throws to this receiver past the sticks +3% catch probability. | `catch.thirdDown` +3 pct |
| Read Option | `dual` | QB: Dual Threat, Designed Runner | RB: Burst, One-Cut, Home Run Hitter, Big-Play Back | On option plays the edge defender reads the mesh 0.1 s later. | `run.meshRead` +0.1 s |
| Follow the Convoy | `hourglass` | RB: Patient Runner | OL unit: Road Graders, Ground and Pound | Running lanes behind this line stay open 0.1 s longer for him. | `run.laneHold` +0.1 s |
| Downhill | `plow` | RB: Battering Ram, Tackle Breaker, Goal Line Hammer, Grinder | OL unit: Road Graders | Inside runs: +0.3 yd before contact. | `run.yardsBeforeContact` +0.3 yd |
| Outside Zone | `swing` | RB: One-Cut, Burst, Home Run Hitter | OL unit: Athletic Line | Stretch runs reach the edge 0.1 s sooner. | `run.edgeReach` -0.1 s |
| Screen Game | `hand` | RB: Receiving Back, Scatback | OL unit: Athletic Line | On screens the lead blockers arrive 0.1 s sooner. | `screen.blockArrival` -0.1 s |
| Clean Pocket | `wall` | QB: Climber, Pre-Snap Wizard, Field General | OL unit: Pass-Pro Wall, Smart Line | Pocket-collapse time +0.1 s. | `pocket.collapseTime` +0.1 s |
| −Sitting Duck | `warning` | QB: Statue, Sack Magnet, Happy Feet | OL unit: Turnstile, Sack-Prone | A clash: pocket-collapse time −0.1 s. | `pocket.collapseTime` -0.1 s |

## Cut

- **Touch Passer** (QB): Fewer than five: 7 QBs passed the gates (Deep Accuracy top 25%, Throw Power bottom 60%) and only 1 kept it after the four-trait cap. Deep Accuracy and Throw Power both read yards per attempt and per completion, so a top deep passer with a modest arm barely exists in the data.
- **Small but Mighty** (WR): Fewer than five: 11 receivers passed (bottom 25% height, top Catch in Traffic), 2 kept it. Catch in Traffic reads height (20% of its formula), so short receivers rarely reach the top of it.
- **Point Guard (Quick Trigger + Rhythm Passer)** (QB): Combination removed with Rhythm Passer (below). Unflappable (Quick Trigger + Ice in His Veins) takes its place.
- **Separator** (WR): Always alongside another: 97% of Separators (both route ratings in the top 15%) were also Route Technicians (both in the top 25%). It was a stricter copy of Route Technician.
- **Rhythm Passer** (QB): Always alongside another: 95% of Ice in His Veins holders were also Rhythm Passers, because Release and Under Pressure both come from sack rate and honors. One of the pair had to go; Ice in His Veins says more (pressure), and Quick Trigger (Release) and Surgeon (Short Accuracy) already cover Rhythm Passer's two halves.
- **Edge Setter** (DE): Always alongside another: all 8 holders (Strength and Tackle in the top 25%) also held Wrecking Ball (Power Rusher + Run Stuffer), which reads the same strength and tackling.
- **Volume Target** (WR): Same signal as Alpha (receptions per game as a share of a league team's completions), so it would always appear alongside it. Merged into Alpha.
- **Return Man** (RB, WR): No gameplay to attach it to: every drive starts at the 25 and punts are auto-simulated (BRIEF "Game format and rules"). The data is also one-sided: sourced kick and punt return stats exist only from 1999 (nflverse weekly stats, not in the augmentation layer), so no pre-1999 player could earn it.
- **Iron Man, Late Bloomer, Ageless** (QB, RB, WR, TE): Career-arc traits. Players exist as era stints, so a trait describes how he plays within the stint, never his durability or the shape of his career. Never built; no gate reads age, experience or a count of seasons (tested).

Combinations redefined while tuning:

- **Go-To Guy**: was Alpha + Red Zone Threat, now Alpha + Glue Hands. Only 3 receivers held both.
- **No-Fly Zone**: was Shutdown Corner + Ballhawk, now Shutdown Corner + Zone Reader. Only 4 corners held both.
- **Every-Down Backer**: was Sideline to Sideline + Coverage Linebacker, now Run Stuffer + Coverage Linebacker. All 6 holders were also Speed Rushers (always alongside another).
- **Open-Field Menace**: was YAC Monster + Twitch (WR and TE), now WR only. Twitch is a receiver trait; no tight end could hold both.
