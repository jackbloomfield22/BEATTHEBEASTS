# Beat the Beasts 3D: Build Brief for Claude Code

## Read this first

You are turning `beat-the-beasts.jsx` (in this repo's `legacy/` folder) into a real-time, playable 3D football game that runs in the browser and deploys to Vercel. Today it is a single-file React draft-and-sim game: you draft an all-time offense, then a text/SVG simulation plays it out against "The Beasts," an 11-man all-time defense. The new version keeps the draft and turns the matchup into a game you play yourself with keyboard and mouse.

This is a complete visual and gameplay overhaul. The only things that carry over are the data, the rating math, the sim engine, and the draft rules. Every screen, every visual, and the whole way the game plays is new. That said, don't rewrite code you don't have to: reuse and extend the legacy logic wherever it already does the job, and only rebuild what the new game actually needs.

The quality bar is a premium PC game, not a web demo and not a mobile web app. Think Madden's broadcast presentation and on-field readability, with the lighting and atmosphere of the reference images in `docs/reference/`. This applies from the very first build: there is no phase where the game is a 2D or card-based web app that gets "upgraded" later. Every decision below should serve that bar. When you have to trade something off, trade scope before quality: a smaller game that looks and feels incredible beats a bigger one that looks like a tech demo.

Before writing any code:

1. Read the entire legacy file. It is about 9,800 lines. Most of it is data and a carefully tuned engine, and both are the product of a lot of audit work.
2. Look at the three reference images in `docs/reference/`.
3. Write `docs/GDD.md` (game design doc) and `docs/TECH_PLAN.md` (architecture, stack, asset plan, milestone breakdown) based on this brief. Flag anything in this brief you think is wrong or unworkable and propose the fix.
4. Stop and show me both docs. After I approve, work autonomously through the milestones. The only other planned stop is the ratings review in milestone 2. Otherwise, only stop if you need me to do something only I can do (an account login or a purchase decision).

## What already exists and must be preserved

The legacy file contains:

- `PLAYERS`: about 3,000 offensive player entries, each a player in a specific team+decade with per-game stats (`s`), an impact rating (`imp`), and an era-adjusted rating (`ea`). Positions: QB, RB, WR, TE.
- `UNITS`: offensive lines as team+decade units with run/pass-block stats and key names.
- `DEFENSE`: about 330 all-time defenders (DE, DT, LB, CB, S) with sacks, INTs, forced fumbles, All-Pro and Pro Bowl counts, impact.
- `YEAR_DEFENSES`, `ERA_BASE`, `DEF_ERA_BASE`: era normalization tables.
- `deriveProfile`, `rateOffense`, `rateDefenders`, `rateBeasts`, `buildMatchups`: turn raw stats into era-normalized sub-ratings (QB arm, accuracy, ball security, explosiveness, legs; receiver separation; defender rush, cover, run defense, tackling).
- `simulateBeatdown`: a deterministic, seeded single-game sim (10 drives) that produces scores, box scores, matchup notes, and a dominance grade.
- Daily Challenge: Wordle-style, seeded from the date. Same Beasts and same team+decade draft sequence for everyone. `computePerfectTeam` and `computeTopLineups` solve the best possible draft for that day.
- Draft rules: 9 rounds (QB, RB, RB2, WR1, WR2, WR3, TE, TE2, OL). Each round a slot machine spins a random team and decade and you fill any open slot from that pool. One Team Skip and one Era Skip per game. No duplicate player names. At most one 1970s pull.
- Modes: Classic (stats visible) and Film Room (stats hidden, draft from memory).
- Presentation pieces worth carrying forward in spirit: the Beasts slot-lock reveal, broadcast lower-thirds, drive progress strip, dominance grades (Total Domination down to Beatdown), the Share Results recap card with PNG download, and the skin-tone characterization editor.

Rules for the port:

- Move data into typed TypeScript modules without changing a single value. Write a test that asserts entry counts and spot-checks a sample of entries against the legacy file so drift is caught. Fixes happen only through the corrections layer described under Player ratings.
- Port the sim functions faithfully into a pure, framework-free `engine/` package with unit tests. Port the legacy rating functions too, but only as a reference and comparison baseline. The new ratings system (see Player ratings) replaces them as the source of truth.
- Do not port the Odds Lab (`LAB_*`, `runLabBatch`, `SHOW_ODDS_LAB`). Leave it in `legacy/` only.
- Do not port the legacy UI or SVG scenes. Reuse their logic where it helps (caption text, grade thresholds, recap card content, the draft flow), but every screen is rebuilt as a PC game front end.

## A PC game from the first build

- Desktop only. Designed for a 16:9 screen at 1080p and up, scaling cleanly to 1440p, 4K, and ultrawide. On phones and tablets, show a single styled screen that says the game is built for keyboard and mouse or a controller.
- The game launches like a PC title: a short studio-style intro, a "Press any key" title screen, then the main menu. Entering the game requests fullscreen and unlocks audio.
- Menus are full-screen game menus over a live 3D scene, not scrolling web pages. No page scroll anywhere, no browser-default form controls, no card grids or pill buttons that read as a mobile app. Every menu is navigable with mouse, keyboard (arrows, Enter, Esc, Tab), and controller, with clear focus states, hover and select sounds, and animated transitions.
- A full PC settings menu: display (fullscreen, resolution scale, frame cap, vsync where the browser allows, field of view), graphics (preset plus individual toggles for shadows, AO, crowd density, grass detail, post effects), controls (rebinding, mouse sensitivity, invert), audio, gameplay (difficulty, game length, camera), accessibility.
- HUD elements are sized and placed for a monitor at arm's length, like a console or PC sports game, not a phone.
- Right-click and browser shortcuts that would break play (context menu, accidental back navigation, space scrolling) are captured during gameplay.

## The vision in one paragraph

You scout the Beasts as they walk out of a fog-filled tunnel at golden hour. You draft your all-time offense through the slot machine, each pick materializing on the field in 3D. Then you take the field and play: call a play, read the defense, drop back with Joe Montana, throw a back-shoulder ball to Jerry Rice against Deion Sanders, or hand it to Barry Sanders and juke Ray Lewis in the hole. Who you drafted changes how the game plays. The Beasts are smart, fast, and hit hard. You get a set number of possessions to outscore them. Big plays trigger slow-mo and instant replay. At the end you get your grade, a box score, and a shareable card.

## Art direction

References in `docs/reference/` (use them for look and mood only, never as textures or assets):

- `ref-01-golden-hour-ocean.png`: warm low sun, long soft shadows, glowing horizon haze, calm reflective water, clean sky gradient.
- `ref-02-broadcast-football.png`: the on-field target. Broadcast camera behind the QB, readable silhouettes, glossy helmets with real reflections, fabric jerseys with folds, a dense crowd with color variation, sharp grass with mowing stripes.
- `ref-03-open-world-coast.png`: saturated but natural color, deep atmospheric perspective, crisp high-frequency detail in the foreground, soft haze in the distance.
- `ref-04-locker-room-wide.jpg` (M6, the draft room): a dark room shot from low, the lockers backlit and the only real light, a lit ceiling, a mark in the carpet.
- `ref-05-locker-detail.jpg` (M6): one locker: nameplate, helmet on a lit shelf, jersey hung facing out, colored underlight.
- `ref-06-locker-row.jpg` (M6, the third photo sent with them): a row of dressed lockers with screens and nameplates above, helmets and pads on the shelf.

The locker photos are for look and mood only: no logo, wordmark or team branding from them. The draft room is the Contenders' side of the Beasts stadium, in the Contenders' black and lime.

Direction:

- The Beasts' home stadium is an open-air bowl on a coastal cliff. One end zone opens onto the ocean, so golden-hour sun sets over water behind the stadium. This ties all three references together and gives the game a signature look. Menus and loading screens use slow cinematic flyovers of the stadium, water, and coastline.
- Time of day options: Golden Hour (default), Night (stadium lights, light bloom, light haze), Overcast, and weather (rain with wet-field reflections, snow). Each is a lighting preset, not a separate level.
- Realistic 3D world. The UI keeps the existing brand identity (Bungee display font, neon lime accent, dark surfaces) but more restrained and premium, closer to a modern sports game front end than an arcade.
- The Contenders get a kit designer with a handful of strong presets (default: black and neon lime). The Beasts have a fixed menacing identity: black and deep crimson with subtle emissive accents on the helmet stripe that glow at night.
- No NFL logos, wordmarks, or team names on uniforms, helmets, or the field. Player names and team+decade labels in the UI are fine. Uniform colors from the existing `TEAM_COLORS` can be used in draft cards and the draft-room presentation.

Visual quality targets (the renderer must deliver these on the High preset):

- Physically based materials throughout. Helmets use clearcoat with environment reflections. Jerseys have a fabric normal map and sheen. Numbers and names are generated per player (canvas or SDF text into a decal or atlas).
- Grass shader with mowing stripes, a detail normal, subtle color variation, and real blades near the camera fading into shader-only grass in the distance. Painted yard lines and hash marks with slight wear.
- HDRI-based image lighting plus a directional sun with cascaded shadow maps. Contact shadows or ambient occlusion under players.
- Post-processing: filmic tone mapping (AgX or ACES), bloom, SSAO (N8AO or equivalent), anti-aliasing (SMAA or TAA), color grading LUT per lighting preset, vignette, depth of field and motion blur only in replays and cinematics.
- Crowd of 30,000+ using instanced impostors or low-poly instanced meshes with vertex-animation, color variation, and reactions tied to game events (stand, jump, wave, deflate).
- Sky: physical sky or HDRI with animated clouds. Ocean: a proper water shader with sun glint and reflection, visible from the broadcast camera past the open end zone.
- Particles: turf kick-up on cuts, dust on big hits, confetti or pyro on touchdowns, breath vapor on cold nights, rain splashes.

## Game structure and flow

1. **Title / Home**: cinematic stadium flyover behind the menu. Options: Play (Classic or Film Room), Daily Challenge, Quick Play (auto-draft, straight to kickoff), Practice Field, How to Play, Settings, Share/History.
2. **Beasts Reveal**: tunnel walkout. Fog, pyro, crowd roar. Each Beast gets a lower-third card as they emerge (name, position, team+decade, key stats, a derived trait badge). Camera ends on the full defense lined up. The existing slot-lock reveal can live on the jumbotron above.
3. **Draft**: a 3D draft presentation with the slot machine on the stadium video board. The draft UI is a game-style overlay (search, position filters, player stat panels, skips) built like a sports game's draft or team-select screen, fully navigable by mouse, keyboard, and controller. When you pick a player, he appears on the field in 3D at his position in the formation, in the Contenders kit, with a short signature animation. Keep every existing draft rule.
4. **Pre-game**: short cinematic: coin toss, team lineups, the matchup preview (your best receiver vs their best corner, your OL vs their pass rush) using the existing `buildMatchups` logic, and the Beasts' defense rating.
5. **Game**: you play every offensive snap (details below). The Beasts' offense is abstracted.
6. **Results**: final score, dominance grade, box score, key matchup outcomes, a highlight reel of your top plays (auto-captured replays), Share card (keep the existing SVG/PNG recap concept, upgraded with a real 3D render of your best play as the hero image), and for the Daily, how your draft compared to the perfect team.

The whole flow must be skippable and fast for repeat players. First-time path from landing to the first snap under 3 minutes. Quick Play under 45 seconds.

## Game format and rules

- The game is possession-based. You get a set number of offensive drives. Default is 6 (Quick 4, Full 10). Each drive starts at your own 25 unless a turnover rule says otherwise.
- Between your drives, the Beasts' offense has a possession. Its result (TD, FG, punt, turnover) comes from the ported sim's Beasts scoring model, scaled to the selected game length and seeded deterministically. Present it as a 5 to 10 second "Meanwhile" broadcast cut: a scoreboard update, a lower-third, crowd reaction. No gameplay.
- Standard football inside a drive: 4 downs, first downs at 10 yards, sacks, incompletions, interceptions, fumbles, safeties, touchdowns, PAT or 2-point try, field goals with a kick mechanic, punts (auto-simulated with a quick cut). Turnovers end the drive. A pick-six or scoop-and-score adds 7 to the Beasts.
- A game clock is presentational only (quarter and clock advance per drive) except for the final drive: if you are trailing or tied on the last possession, it becomes a real two-minute drill with a live clock, timeouts, spike (key) and kneel.
- Ties at the end go to one overtime possession each, college style from the 25.
- Grades use the existing margin thresholds, scaled to game length.

## Controls (keyboard and mouse, fully rebindable)

Pre-snap:

- Play calling: a full-screen play-call overlay with formation groups and play art (routes drawn over a mini field), navigated by mouse. Include a "Suggested" tab from a simple coordinator AI that reads down, distance, and the Beasts' tendencies.
- `Space`: snap. `H` then click a receiver: hot route menu. `Z`: audible to one of 4 preset plays. `M`: motion. `Tab`: flip play.

Passing (QB behind the line):

- `W A S D`: move in the pocket (step up, drift, roll out). Camera-relative.
- Receiver icons appear over each eligible receiver, color-coded using the existing position palette (QB gold, RB pink, WR cyan, TE purple).
- `1` to `5` or left-click a receiver to throw. Tap for touch/lob, hold for bullet (a subtle power ring fills).
- Placement: while choosing, the mouse offset from the receiver icon sets ball placement (lead, back shoulder, high, low) through a small reticle. Accuracy variance comes from the QB's `acc` rating and pressure.
- Right-click: pump fake. `Q`: throw it away (outside the pocket). Crossing the line of scrimmage turns the QB into a ball carrier.

Ball in the air (optional advanced control):

- The camera tracks the ball and you can take over the targeted receiver. Left-click: aggressive catch. Right-click: run-after-catch catch. `Space`: possession catch. Each trades catch probability against yards after catch.

Ball carrier:

- `W A S D`: run. `Shift`: sprint (stamina bar that recovers between plays).
- `Q` / `E`: juke left / right. `Space`: spin. `F`: stiff arm. `R`: truck. `C`: dive (or QB slide). `V`: protect the ball (lower fumble risk, lower speed).
- Move success depends on the player's derived attributes, momentum, and the defender's tackle rating. Moves have cooldowns and animation commitment so spamming fails.

Kicking:

- Field goals and PATs: click and drag back for power, release, with mouse direction for aim. Wind affects flight (reuse the wind concept from the legacy `WindChip`).

General:

- `Esc`: pause. `P` or `Backspace` after a play: instant replay with free orbit camera (mouse drag), scrub bar, slow-mo, and DOF.
- Full gamepad support through the Gamepad API with Madden-style defaults. It is cheap to add and makes the game feel like a real PC release.
- Interactive tutorial on first launch and a Practice Field mode with drills (pocket passing, route timing, open-field running).

## Player ratings: the core of the game

Ratings decide who is worth drafting, how each player moves and performs on the field, and whether beating the Beasts feels earned. In the legacy game they were the loosest part of the system. Treat this section as the spec for rebuilding them. They get their own milestone and their own review gate before any balancing depends on them.

### What is wrong with the legacy ratings

I audited the legacy data and formulas. Confirm each of these yourself, then fix them.

1. **`imp` does almost all the work.** Every legacy sub-rating adds a slice of `imp` on top of the stat terms. `imp` is a hand-set 60 to 99 number with no documented method. About 60% of values are even and they cluster at 68, 70, 72, 73, 78, 80 and 84. It correlates 0.95 with WR yards per game and 0.89 with RB yards per game, so it mostly measures volume. That volume then gets counted a second time through the stat terms.
2. **`ea` barely adjusts anything.** It sits between 1 below and 4 above `imp` for every player. The real era adjustment lives in `ERA_BASE`, a hand-tuned table of decade averages that only covers per-game yards, TDs, passer rating and INTs.
3. **Stats are coarse per-game estimates with no sample size.** 982 of 992 WR yards-per-game values are multiples of 5. No entry records seasons or games played in that stint, so a two-game cameo and a ten-year peak count the same.
4. **Yards per target and catch % before 1992 are estimates.** The NFL did not track targets until 1992, yet 279 WR entries from the 1970s and 1980s have both fields.
5. **Schema errors inflate or break specific players:**
   - Seven 2020s WRs have what looks like season receptions in the catch % field (`c` of 86 to 129): Puka Nacua, Ja'Marr Chase, Jaxon Smith-Njigba, Amon-Ra St. Brown, Chris Olave, George Pickens and Zay Flowers. That pins their separation and hands at the cap.
   - Carl Garrett (RB, 1970s LV) carries WR fields, so his catch % of 54 is read as 54 yards per carry.
   - Larry Centers (RB) and Anthony Miller (WR) carry TE block grades and are missing their position stats.
   - `UNITS` mixes 184 OL units with 71 team-defense units that use a different schema (`pa`, `ya`, `to`, `sk`). Any code that reads OL fields without filtering by position gets NaN.
6. **Defense uses decade totals, not rates.** Rush and coverage divide career totals by an assumed 8 seasons, which punishes short stints and the unfinished 2020s. 2020s DEs average 47 sacks against 72 for the 2010s. Deion Sanders' 1989 Falcons entry (8 INT in one season) rates as a weak cover corner.
7. **Coverage is INTs only.** Shutdown corners who don't get thrown at rate as poor coverage players: Sauce Gardner has 4 INT, Patrick Surtain II has 8. Passes defensed, targets allowed and accolades are ignored.
8. **Run defense and tackling have no stat input at all.** They are `imp` plus a position bonus.
9. **The OL is a single unit with four numbers,** two of them undocumented (`pb` looks like a hand-set pass-block grade and `pbl` like a Pro Bowl linemen count). The TE block grade `b` is also hand-set with no source.
10. **There is no physical data anywhere:** no speed, size or age. A 4.3 deep threat and a 4.6 possession receiver would move identically.
11. **Scales are inconsistent.** Offensive sub-ratings clamp at 97, defensive coverage at 90 and pass rush at 92. Matchups like separation minus coverage are tilted by construction, and players pile up at the caps.

### Principles for the new system

- **Traceable:** every attribute has a documented formula, and for any player you can show exactly which inputs produced it and by how much.
- **Stats first, reputation second:** `imp` becomes one bounded input, a legacy reputation score worth no more than 20% of any attribute. It is never added on top of everything.
- **Rates, not totals:** per-game and per-play rates with sample size attached. Small samples are shrunk toward the position-and-era average in proportion to games played.
- **Dominance over era, not raw volume:** compare each player to league averages for the seasons he actually played, the way Rate+ or ERA+ work (100 = league average). A 1970s receiver at 60 yards per game in a 44-yard league is as dominant as a 2010s receiver at 80 in a 58-yard league.
- **The time-machine rule:** every player is translated into a modern athlete of equivalent dominance. Physical attributes describe how a player ranked against his own era's peers at his position, mapped onto the modern scale. Where modern measured data exists (combine times, height and weight), use it directly.
- **One scale for everyone:** 0 to 99, same meaning on offense and defense, so matchups compare like with like.
  - 99: the best the position has ever produced at that skill.
  - 90+: All-Pro level.
  - 80s: Pro Bowl level or a high-end starter.
  - 70s: solid starter.
  - 60s: role player.
  - Under 50: a liability.
- **Honest confidence:** every input carries a source and a confidence level. Low-confidence inputs are shrunk toward the prior and never override a verified value.

### Data: port, correct, augment

- **Port the legacy data unchanged,** then run a validation pass that flags schema mismatches, impossible values (catch % over 100, yards per carry over 10), missing fields and duplicate people in `key` lists.
- **Never edit legacy values in place.** Fixes go in `data/corrections.json`: entry id, field, old value, new value, reason and source. The loader applies them, and the ratings report lists every one for my review. Start with the issues above.
- **Add a separate, sourced augmentation layer** (`data/augment/`) with these fields:
  - Every entry: seasons and games played in the stint, birth year (for aging across stints), height, weight, and a 40-yard time where one was measured.
  - QB: completion %, yards per attempt, sack rate.
  - RB: receptions, fumbles per touch.
  - WR/TE: receptions per game, yards per reception, targets (1992 on).
  - Defense: games, passes defensed (1999 on), tackles where officially tracked, forced fumbles, and whether sacks are official (1982 on) or unofficial.
  - OL: individual linemen with their All-Pro and Pro Bowl counts for the stint.
- **Every augmented value carries `src` and `conf`:**
  - `verified`: from an open dataset.
  - `reference`: from a cited public source.
  - `estimated`: from your own knowledge.
- **Sources:**
  - Use open datasets such as nflverse for 1999 onward (stats, combine results, rosters with height, weight and birth date).
  - Only use sources whose terms allow this use; check before pulling anything, and do not scrape sites that restrict automated access.
  - Record every dataset and its license in `CREDITS.md`.
  - For pre-1999 players, estimated values are acceptable for well-documented facts (height, weight, birth year, games played), but they stay flagged.
- **Era baselines** come from real league-wide averages by season (passer rating, completion %, yards per attempt, INT %, sack %, rushing yards per carry, points per game, receiving yards per target from 1992). Save them to `data/era_baselines.json` with sources. A player's baseline is the average over the seasons in his stint, not his decade.

### The attribute set

Every attribute listed here must drive something in gameplay. If an attribute has no gameplay effect, cut it.

- **Everyone:**
  - Physical: Speed, Acceleration, Agility, Strength, Stamina.
  - Mental: Awareness.
  - Body: height and weight, used for the character model and contact physics.
- **QB:** Throw Power, Short Accuracy, Mid Accuracy, Deep Accuracy, Throw on the Run, Under Pressure, Release, Decision Making (interception avoidance), Pocket Presence, Scramble.
- **RB:** Vision, Elusiveness (juke and spin), Break Tackle, Trucking, Stiff Arm, Ball Security, Catching, Route Running, Pass Block.
- **WR:** Release (beating press), Short Route Running, Deep Route Running, Catching, Catch in Traffic, Spectacular Catch, Jumping, Run After Catch, Ball Security, Run Block.
- **TE:** everything on the WR list plus Run Block, Pass Block and Impact Block.
- **OL** (the unit becomes five individual linemen, named from the unit's `key` list where available, the rest generated around the unit's level): Pass Block Power, Pass Block Finesse, Run Block Power, Run Block Finesse, Anchor, Pull and Move, Awareness (stunts and blitz pickup).
- **Defense:** Tackle, Hit Power, Pursuit, Play Recognition, Block Shedding, Power Moves, Finesse Moves, Man Coverage, Zone Coverage, Press, Ball Skills.

### How each attribute is derived

Build this as a pure module (`engine/ratings/`) with one function per attribute. Each function takes the player plus era baselines and returns the value, its confidence, and a list of contributions (for example "+6 from completion % index"). Starting guidance:

- **QB accuracy (short and mid):** era index of completion %, INT rate and passer rating. **Deep Accuracy:** era index of yards per attempt and TD rate. **Throw Power:** yards per attempt index plus the deep share of production, with reputation used to separate true cannons. **Decision Making:** era-adjusted INT rate and TD:INT ratio. **Under Pressure and Pocket Presence:** era-adjusted sack rate plus accolades. **Scramble and Speed:** rushing yards per game, with measured 40 times where available.
- **RB Vision and Break Tackle:** yards per carry index weighted by volume. **Elusiveness vs Trucking:** split by body type (weight and height), yards per carry and reputation. A 200-pound, 5.0 yards-per-carry back leans Elusive; a 245-pound back leans Trucking. **Ball Security:** fumbles per touch. **Catching and Route Running:** receptions and receiving yards index.
- **WR Catching:** catch % where targets exist (1992 on). Before that, lean on receptions per game and accolades at low confidence. **Deep Route Running and Speed:** yards per reception and yards per target index. **Short Route Running:** catch rate, reception volume and short-area role. **Catch in Traffic and Jumping:** height, TD rate (red-zone usage) and reputation. **Run After Catch:** yards per reception relative to depth of role, plus agility.
- **Defense:**
  - Accolades per season (AP First-Team All-Pro weighted heaviest, then Pro Bowl, then DPOY) are the backbone for every defender. They are the most era-neutral signal we have.
  - Pass rush uses sacks per game against the era rate, with unofficial pre-1982 sacks at reduced confidence.
  - For DBs, Ball Skills comes from INT and passes defensed per game. Man Coverage and Press come mostly from accolades and reputation, **not** INTs. That fixes the shutdown-corner problem.
  - Run defense and tackling use accolades, role and tackles where officially tracked, at lower confidence where the data is thin.
- **OL:** each lineman's accolade rate, plus the unit's era-adjusted sack rate allowed (pass pro) and rushing yards per carry (run block).
- **Physical attributes:** measured data first. Otherwise a position-archetype prior adjusted by production signatures (deep yards for speed, weight for strength) and reputation, flagged `estimated`.
- **Aging across stints:** the same player's physical attributes stay consistent across his stints except for a position-specific aging curve. Jerry Rice with the 2000s Raiders is slower than Jerry Rice with the 1980s 49ers. His route running is not.

### Overall rating and traits

- **Position-specific OVR:** a weighted blend of the attributes that matter for the position, weights documented in one file. OVR replaces `imp` everywhere the player sees a number: draft cards, lower-thirds, the perfect-team solver and the Daily difficulty adjustment (`diffAdj` is currently built on `imp`). Recalibrate both with the balance harness. The Daily's seeded Beasts and draft sequence must stay the same for everyone on a given date.
- **Draft screen display:** OVR, the 4 to 6 attributes that matter most for the position, the player's traits, and a "Scouting" panel showing how the ratings were derived from his real stats. Film Room hides all numbers as it does today.
- **Traits** come from attribute thresholds and stat signatures, not from `imp`. Each trait has a specific, documented gameplay effect.
  - Offense: Deep Threat, Route Technician, Possession, Contested Catch, YAC Monster, Elusive, Bruiser, Workhorse, Receiving Back, Pocket Passer, Gunslinger, Scrambler, Field General.
  - Defense: Speed Rusher, Power Rusher, Interior Wrecker, Ballhawk, Shutdown Corner, Enforcer, Run Stuffer, Sideline to Sideline, Coverage Linebacker.
  - Keep the legacy archetype logic in `deriveProfile` as a reference and cross-check.

### How ratings drive gameplay

One documented mapping module (`sim/attributeEffects.ts`). The values below are starting points to tune with the balance harness. Keep every mapping monotonic.

- **Speed to top speed:** about 0.125 mph per point, so 99 ≈ 22.5 mph, 90 ≈ 21.3, 80 ≈ 20.0, 70 ≈ 18.8, 60 ≈ 17.5. Linemen mostly land in the 50s and 60s.
- **Acceleration:** time to 95% of top speed runs from about 1.6 s at 99 to 2.3 s at 70.
- **Agility:** turn rate, how much speed a cut costs, and the ceiling on juke and spin success.
- **Throw Power:** release velocity from about 52 mph at 70 to 62 mph at 99. Max air distance from about 55 to 75 yards.
- **Release:** wind-up to release from about 0.45 s at 70 to 0.30 s at 99.
- **Accuracy:** a placement error cone that widens with distance, throwing on the run (Throw on the Run), pressure (Under Pressure) and bullet vs touch. About 1 yard of error at 20 yards for a 70, a third of that for a 99.
- **Catching:** base catch probability, adjusted for ball velocity, placement error, defender proximity (Catch in Traffic) and catch type (Spectacular Catch).
- **Route running:** break sharpness and the separation window created at the break, contested by the defender's Man or Zone Coverage and reaction time.
- **Coverage:** reaction delay from about 0.12 s at 99 to 0.45 s at 50, plus cushion discipline and break-on-ball speed. Play Recognition sets how long pump fakes and play action fool a defender.
- **Pass rush:** each rusher's Power and Finesse Moves plus Block Shedding against each lineman's Pass Block Power, Pass Block Finesse and Anchor. The result is a time-to-win distribution per snap, so the pocket collapses believably and differently by matchup.
- **Contact:** Break Tackle, Trucking and Stiff Arm against Tackle and Hit Power, with speed, mass and angle. Ball Security against Hit Power sets fumble chance.
- **Stamina:** sprint drain and recovery between plays.

**Sensitivity rule:** a 10-point gap in any attribute must produce a measurable, noticeable difference in the harness (catch rate, separation, sack time, yards after contact). If an attribute doesn't move outcomes, fix the mapping or cut the attribute.

### Validation: prove the ratings are right

Build these as automated tests and a report, not one-off checks.

- **Anchor tests.** A calibration set of players with expected attribute bands. If a formula puts an anchor outside its band, the formula is wrong, not the anchor. Here is my starter set (bands are position-relative). I'll review and extend it at the ratings gate:
  - Joe Montana (1980s SF): short and mid accuracy 95+, Under Pressure 95+, Throw Power below 88.
  - Dan Marino (1980s MIA): Release 99, Throw Power 95+, Scramble in the bottom 10% of QBs.
  - Peyton Manning (2000s IND): Awareness and Decision Making 97+, Scramble in the bottom 10%.
  - Tom Brady (2010s NE): Decision Making 97+, short and mid accuracy 95+, Speed in the bottom 10% of QBs.
  - Patrick Mahomes (KC): Throw on the Run 97+, Throw Power 95+.
  - Brett Favre (1990s GB): Throw Power 97+, Decision Making clearly below elite.
  - Michael Vick (2000s ATL) and Lamar Jackson (BAL): QB Speed 97+, with Vick's accuracy well below elite.
  - Barry Sanders (1990s DET): Elusiveness and Agility 99, Trucking below 80.
  - Earl Campbell (1970s TEN) and Derrick Henry (2020s TEN): Trucking 97+.
  - Jerome Bettis (1990s PIT): Trucking 95+, Speed below 85.
  - Walter Payton (CHI): Stiff Arm and Break Tackle 95+.
  - Eric Dickerson (1980s LAR): Speed 95+.
  - Marshall Faulk (LAR) and Christian McCaffrey (2020s SF): top-5 RB Catching and Route Running.
  - Jerry Rice (1980s and 1990s SF): Short and Deep Route Running 99, Catching 95+, Speed below the top WR tier.
  - Randy Moss (2000s NE): Speed 97+, Spectacular Catch and Jumping 99.
  - Calvin Johnson (2010s DET): Catch in Traffic 99, height and Jumping at the top of the WR pool.
  - Tyreek Hill (2020s MIA): Speed and Acceleration 99.
  - Larry Fitzgerald (2000s ARI) and Cris Carter (1990s MIN): Catch in Traffic 97+, Speed below 88.
  - Wes Welker (NE) and Antonio Brown (2010s PIT): Short Route Running 97+.
  - Tony Gonzalez (2000s KC) and Travis Kelce (KC): TE Catching and Route Running 95+.
  - Rob Gronkowski (2010s NE): TE Run Block 90+, Catch in Traffic 95+.
  - Lawrence Taylor (1980s NYG): Finesse Moves and Pursuit 99.
  - Reggie White (PHI and GB) and Bruce Smith (1990s BUF): Power Moves 97+.
  - Aaron Donald (2010s LAR): Block Shedding 99, top interior pass rush.
  - Deacon Jones (1960s LAR): Finesse Moves 97+, with his unofficial sacks at reduced confidence.
  - Deion Sanders (1990s DAL): Man Coverage and Speed 99, Tackle below 70.
  - Darrelle Revis (NYJ): Man Coverage and Press 97+ despite modest INT totals.
  - Sauce Gardner (2020s NYJ) and Patrick Surtain II (2020s DEN): Man Coverage 90+ despite low INT totals.
  - Mel Blount (1970s PIT): Press 97+.
  - Ed Reed (2000s BAL): Ball Skills and Zone Coverage 99.
  - Ray Lewis (2000s BAL), Dick Butkus (1960s CHI) and Mike Singletary (1980s CHI): Tackle, Pursuit and Play Recognition 95+. Butkus also gets Hit Power 99.
  - Ronnie Lott (1980s SF): Hit Power 97+.
- **Era parity:** no decade is systematically favored. Compare the top 10 per position in each decade and flag any decade whose top-10 average OVR differs from the all-decade average by more than 3.
- **Monotonicity:** within the same era and position, clearly better production can't produce a lower rating.
- **No cap pileups:** no more than a handful of players at 99 in any attribute, and a smooth distribution below it.
- **Cross-stint consistency:** a player's physical attributes differ between stints only by the aging curve.
- **Legacy comparison:** Spearman correlation between new OVR and legacy `imp` should be high (about 0.75 to 0.9). If it's near 1.0, stats aren't doing anything. If it's low, something is broken. List the 50 biggest movers in each direction with the reason for each.

### Tools for reviewing ratings

- **Ratings Explorer** (dev page, and a trimmed version as the in-game Scouting panel):
  - Search any player and stint and see every attribute, OVR, traits, confidence, and a contribution breakdown for each attribute.
  - See the underlying real stats, the era baseline used, and the player's percentile within his position all-time and within his era.
  - Compare any two players side by side, and filter and sort the full pool by any attribute.
  - Export to CSV.
- **`docs/RATINGS_REPORT.md`**, regenerated by a script:
  - Anchor pass/fail, era parity table, distribution charts per attribute, and the top 25 per attribute and per OVR.
  - The biggest movers against legacy, every correction applied, and every low-confidence rating among the top 200 players by OVR.

### Ratings in the rest of the game

- The ratings module is the single source of truth for everything: real-time gameplay, the Beasts' strength rating and Beasts assembly (the 88+ bar gets recalibrated on the new scale), the perfect-team solver, Quick Sim, and the Beasts' offensive scoring between drives.
- The legacy sim is fed through an adapter from the new attributes. Keep its score distributions as calibration targets: roughly 21 points per game for an average offense, about 36 for an all-time offense, about 14 for a poor one, and the legacy win-rate bands against the Beasts. Recalibrate until they match within tolerance.
- Skin tone comes from the existing characterization editor data. Keep the editor. Height and weight from the ratings data drive the character model's body.
- Difficulty (Rookie, Pro, Legend, Beast) changes AI reaction time, read quality and disguise, never player ratings. The ratings stay true to the data at every difficulty.

## The Beasts: defensive AI

This is what makes or breaks the gameplay. Build it properly.

- Formation: 4-3 base with nickel and dime packages by situation. Keep the legacy layout (2 DE, 2 DT, 3 LB, 2 CB, 2 S) as base personnel.
- Coverage: man (press and off), Cover 1, Cover 2, Cover 3, Cover 4, Tampa 2, and zone blitzes. Zone defenders use landmark drops, read the QB's eyes and shoulders (your pump fakes should move them), and pass off crossing routes.
- Pass rush: each rusher has a move set driven by traits (speed, power, spin) resolved against the OL's pass-block rating over time. Pocket collapse should be visible and readable, not dice rolls.
- Run defense: gap assignments, block shedding against OL run-block, pursuit angles based on speed, a force defender on the edge.
- Tackling: approach, form tackle or dive, with success from tackle rating vs the carrier's break-tackle, momentum, and angle. Gang tackles and big hits blend into ragdoll physics.
- Play calling: a defensive coordinator that reads down, distance, field position, and learns your tendencies within a game (if you keep throwing the same route to the same receiver, the Beasts bracket him). Pre-snap disguise at higher difficulties.
- Star Beasts should visibly play like themselves: a Ballhawk jumps routes, a Shutdown Corner shadows your best receiver, a Speed Rusher wins around the edge.

Your teammates (AI when you are not controlling them): precise route running from a real route tree with timing tied to the QB's drop, option routes that adjust to coverage, blocking assignments for OL and TE, RB pass protection and check-downs, downfield blocking after the catch.

## Game feel and presentation

- Camera: broadcast behind-the-QB default (match `ref-02`), smoothly pulls up on pass plays, follows the carrier on runs with look-ahead, switches to a high sideline angle on long runs. Alternative cameras: All-22 and a tighter "field level."
- Impact: hit-stop on big hits, camera shake scaled to force, audio compression, gamepad rumble.
- Slow motion on contested catches, one-handed catches, near-interceptions, and the first frame of a breakaway.
- Automatic instant replay for touchdowns, turnovers, and big hits, with broadcast-style angles and a "REPLAY" wipe.
- Broadcast overlay: score bug, down and distance, drive strip (carry forward the legacy drive progress strip), lower-thirds for players involved in big plays, a first-down line and line-of-scrimmage line drawn on the field.
- Touchdown and game-winning moments get short celebration animations, crowd eruption, confetti or pyro, and a stadium lighting pulse.
- Text commentary: short, varied broadcast lines in a ticker or caption bar, reusing and expanding the legacy caption logic. Voiced commentary is out of scope.

## Audio

- Layered crowd ambience that reacts in real time (anticipation swell on deep throws, groan on drops, roar on scores).
- Pads and helmet collisions scaled by impact, cleats on turf, ball spiral whoosh, whistle, QB cadence at the snap, PA announcer stings.
- Menu and draft music with a distinct Beasts reveal cue.
- Spatial audio for on-field sounds. Separate volume sliders for master, music, SFX, crowd.
- Use CC0 or properly licensed audio only. Log every source in `CREDITS.md`.

## Modes and meta

- Classic and Film Room: same as legacy.
- Daily Challenge: same Beasts and same draft sequence for everyone, as today. Your final margin is your score. Show the perfect-team comparison afterward. Add a global daily leaderboard as a stretch goal (Vercel-integrated storage such as Upstash Redis or Supabase, anonymous handle, simple rate limiting).
- Quick Sim: an option on the pre-game screen to sim the game with the legacy engine and the legacy-style cinematic, for players who want the original experience.
- Practice Field: drills and a free-play mode against the Beasts with no score.
- History: local record of past games and dailies (localStorage with try/catch).

## Tech stack and architecture

Recommended starting point. Evaluate it and change what should change, with reasoning in `TECH_PLAN.md`.

- Vite + React + TypeScript. Static SPA, deployed to Vercel.
- Three.js through React Three Fiber, drei, and the postprocessing library. Evaluate three's WebGPU renderer (with TSL shaders) against WebGL2 for our needs. Use WebGPU only if it gives a real visual or performance win with a reliable automatic WebGL2 fallback. Safari and Chrome on Mac must both work.
- Physics: Rapier (via @react-three/rapier or direct) for ball flight collisions, ragdolls, and debris. Player movement uses kinematic controllers driven by the game simulation, not free physics bodies.
- State: Zustand for UI and meta state.
- Architecture rule: the game simulation is a pure TypeScript layer running at a fixed 60 Hz timestep with a seeded RNG, separate from rendering. The renderer interpolates. This gives determinism for the Daily, input-recorded replays, headless testing, and the balance harness. React never drives per-frame game logic.
- Animation: see the Animation section below. Every clip is authored by you from scratch.
- Debug tools behind a dev flag: performance overlay, Leva panel for tuning, AI visualizers (coverage zones, pursuit targets, route paths), a play-by-play log.

Suggested layout:

```
/src
  /engine        pure TS: data, ratings, attributes, legacy sim, rules, RNG
  /sim           real-time game simulation: players, ball, AI, plays
  /render        R3F scene: stadium, field, characters, crowd, VFX, cameras, post
  /ui            React overlays: menus, draft, play call, HUD, results
  /audio
  /assets        manifests and loaders
/data            typed player/defense/unit data ported from legacy
/public/assets   compressed runtime assets
/tools           asset pipeline scripts, balance harness, screenshot tooling
/docs            GDD, tech plan, progress log, reference images
/legacy          original beat-the-beasts.jsx, untouched
```

## Assets

Character art and animation are the biggest risk to the quality bar. Plan for it explicitly.

- Characters: start from a well-topologized CC0 rigged humanoid base (for example Quaternius or similar CC0 sources), then build football gear on top: helmet, facemask, shoulder pads, jersey, pants, socks, cleats, gloves. Use Blender in headless mode with Python scripts for modeling, fitting, UVs, and baking where that beats building geometry in code. Uniform colors, numbers, and names are applied at runtime through shaders and generated textures so one base mesh serves every player. Body type variation (lineman, back, receiver, QB) through blend shapes or bone scaling.
- Animations: no third-party animation libraries or mocap packs. You author every clip yourself (see the Animation section).
- Environment: stadium bowl, seating, light towers, video boards, tunnel, coastline, and cliffs can be built procedurally or modeled via Blender scripts. PBR textures and HDRIs from CC0 sources such as Poly Haven and ambientCG.
- If a paid model or texture asset would significantly raise quality (for example a character base mesh or stadium kit), list it in `ASSETS_NEEDED.md` with price, license terms for web games, and the expected gain. Do not buy anything.

## Animation (built from scratch)

Every animation in the game is authored by you. No Mixamo, no mocap packs, no downloaded clips. The goal is traditional, authentic football movement that reads correctly from the broadcast camera: the right stances, footwork, and technique for each position, with real weight and timing.

### How to build it

- **One custom rig** shared by every player: a humanoid skeleton with enough joints for football (spine chain, neck, clavicles, full arms and hands with a simple finger setup for gripping the ball, hips, legs, feet with toe joints). Build it in Blender via Python, with IK controls for hands and feet and a center-of-mass control, then bake to FK and export to glTF.
- **Author in Blender headless with Python.** Define a pose library (named key poses stored as control transforms), then build each clip from key poses with explicit timing and custom F-curve easing. Apply the classic principles every time: anticipation, weight shift over the support foot, contact/down/passing/up poses in every locomotion cycle, overlapping action in arms and torso, follow-through, and settle. Bake and export as glTF clips.
- **Runtime layer** in the game, on top of the authored clips:
  - Locomotion blend spaces by speed and direction (walk, jog, run, sprint, strafe, backpedal, shuffle) with stride matching so feet never slide.
  - Foot IK that plants feet on the turf and hand IK that puts hands on the actual ball (carry, catch, handoff, throw release).
  - Head and eye look-at toward the ball, the QB, or the assigned man.
  - Procedural lean into acceleration and cuts, momentum-aware turns, and small spring-based secondary motion.
  - Contact: tackles and blocks use paired authored clips where possible, blended into an active ragdoll (Rapier, powered joints) for big hits and pile-ups, then a scripted get-up.
- **Animation Lab**: a dev-only page where you can load any clip on a player in full gear, scrub, loop, slow down, orbit, onion-skin, compare two clips side by side, and see foot-contact markers and a foot-slide readout. Use Playwright to render contact sheets (8 to 12 frames per clip from side and broadcast angles) and review them yourself.
- **Quality gates for every clip:** no visible foot sliding, no limb or ball intersection with the body, center of mass believably over the base of support, clean loop points on cycles, readable silhouette from the broadcast camera, and a correct technique check against the descriptions below. Log each clip's status in `docs/ANIMATION.md`.

### The library

Build all of these. Each item may need several variants (left/right, speeds, under pressure vs clean) to avoid repetition.

- **Everyone:** huddle, break the huddle, jog to the line, get set, pre-snap motion (jog and shift), idle breathing and fidgets between plays, walk back to huddle, help a teammate up, react to a big play (positive and negative).
- **QB:** under-center stance and cadence (head turns, hand signals, leg lift for motion), snap exchange, shotgun stance and catch, 3-, 5-, and 7-step drops with a proper hitch, play-action fake, handoff (left and right, with RB mesh point), pitch, set feet and throw (short, intermediate, deep, touch lob), throw on the run left and right, pump fake, climb the pocket, step-up, scramble, feet slide, throw-away, spike, kneel, take a sack.
- **RB:** two-point and three-point stance, take the handoff with a proper pocket, press the hole, jump cut, plant-and-cut, juke, spin, stiff arm, truck/lower shoulder, dive forward for extra yardage, ball switch to the outside arm, pass protection set and cut block, chip and release, swing and wheel routes.
- **WR/TE:** split-end stance, slot stance, TE three-point stance, release off the line (free release, press release with swim and rip), route stems and breaks (speed cut, plant-and-drive on outs and curls, sharp break on posts and corners, crossing routes), look back for the ball, catches (hands catch at chest, high, low, over the shoulder, back-shoulder, diving, one-handed, toe-tap on the sideline), secure and tuck, TE in-line run block, stalk block, drop a pass.
- **OL:** three-point stance, pass set with kick-slide, anchor against bull rush, mirror, run block drive, down block, pull and lead, second-level block, get beat and recover.
- **DL:** three- and four-point stance, get-off at the snap, swim, rip, bull rush, spin, club, long arm, bat a pass, engage and shed a block, pursue.
- **LB:** two-point stance with pre-snap reads and point-outs, read step, fill a gap, zone drop, blitz, cover a back or TE, scrape across.
- **DB:** press stance, off-coverage stance, backpedal, hip flip and turn-and-run, T-step and break on the ball, trail technique, press jam, jump ball, interception, pass breakup, deep safety rotation.
- **Tackling:** form tackle (wrap and drive), shoulder hit, arm tackle (broken tackle variant), low tackle and ankle tackle, diving tackle, gang tackle and pile, strip attempt, fall and get up.
- **Ball events:** fumble pop-out, scramble for a loose ball, recovery and scoop.
- **Kicking:** long snap, holder catch and spot, kicker approach and kick, punter catch and punt, follow-through and reactions.
- **Scoring and emotion:** traditional celebrations (hand the ball to the ref, ball spike, team celebration in the end zone, pointing to the crowd, helmet taps), dejection on a missed chance.
- **Officials:** ready for play, spot the ball, touchdown signal, first down signal, incomplete, timeout, flag throw.
- Pipeline: every runtime model goes through gltf-transform (Draco or meshopt geometry compression, KTX2/Basis textures, texture resizing per quality tier). Log every third-party asset and its license in `CREDITS.md`.

## Performance

- Target 60 fps at 1080p on an M1/M2 MacBook Air on the Medium preset, and on a mid-range Windows laptop with integrated or entry-level GPU. High and Ultra presets for strong GPUs.
- Graphics presets (Low, Medium, High, Ultra) with auto-detection on first launch, plus dynamic resolution scaling to hold frame rate during gameplay.
- Instancing for the crowd and repeated stadium geometry, LODs for players and crowd, frustum culling, texture atlases, and a draw-call budget documented in `TECH_PLAN.md`.
- Load fast: a playable menu within a few seconds on a good connection, with gameplay assets streaming behind the menu and draft. Show a real progress bar. Cache assets with a service worker so repeat visits load almost instantly.
- Check Vercel's current static asset and deployment size limits before choosing where assets live. If we exceed them, move large assets to Vercel Blob or another CDN and document it.

## Balance

- Build a headless balance harness in `/tools`: AI plays the Contenders' offense against the Beasts across thousands of drives using the real-time simulation at accelerated speed.
- Targets: at Pro difficulty, an average human drafting well should win roughly half their games. A perfectly drafted team (from `computePerfectTeam`, now run on the new OVR) played well should be a clear favorite. A weak draft should need great play to win. Use the legacy sim's outcome distribution as the reference for what "fair" looks like, and report the harness results in `docs/BALANCE.md`.
- Ratings must matter but skill must matter more. A strong player with a mediocre draft can win. A weak player with an elite draft still has to execute.

## Repo and deployment

- Create the repo on my GitHub account (`jackbloomfield22`) as `beat-the-beasts-3d`, private. Use the `gh` CLI. If `gh` is not authenticated, tell me the exact command to run.
- Connect it to Vercel so every push to `main` deploys to production and every branch gets a preview URL. If the Vercel CLI needs login, tell me the exact command.
- Commit in small, meaningful steps. Work on a branch per milestone and merge to `main` when the milestone passes its checks.

## How to work

- Keep a `CLAUDE.md` at the repo root with the non-negotiables from this brief (legacy data is never edited in place and fixes go through the corrections file, every rating is traceable to its inputs, reuse legacy logic instead of rewriting it, sim is pure and deterministic, PC game not web app, every animation authored in-house, no logos, quality over scope, verify visually) so they survive across sessions.
- Keep `docs/PROGRESS.md` updated at the end of every work session: what is done, what is next, known issues, and screenshots of the current state.
- Use subagents in parallel where work is independent (for example asset research, the AI system, and the render pipeline).
- **Verify visually, every milestone.** Set up Playwright screenshot tooling that captures the running game at fixed camera positions and states (menu, draft, pre-snap, mid-pass, tackle, touchdown, results) in each lighting preset. Look at the screenshots yourself and compare them to the reference images. Write an honest critique in `PROGRESS.md` of where it falls short of the references (lighting, materials, silhouettes, crowd, color) and fix the biggest gap before moving on. Do not declare a visual milestone done from the code alone.
- Verify gameplay with automated play-throughs in the headless sim plus scripted input tests in the browser (snap, throw, catch, tackle, score, drive ends, game ends).
- Never leave `main` broken. Every production deploy must load and be playable end to end.

## Milestones

Each milestone ends with: tests passing, screenshots captured and critiqued, a Vercel preview URL, and `PROGRESS.md` updated.

1. **Foundation**: repo, Vite/React/TS app, data and engine ported headless with tests. The app boots like a PC game: intro, "Press any key" title screen over a live 3D scene, a full-screen main menu and settings menu, fullscreen and audio unlock, and the desktop-only gate for phones. No 2D stand-in screens, not even temporarily. Deployed to Vercel.
2. **Ratings**: data validation and the corrections file, the sourced augmentation layer, era baselines, the full attribute set and derivations, OVR and traits, the Ratings Explorer, the automated validation tests, and `docs/RATINGS_REPORT.md`. **Stop for my review.** While I review, continue with milestone 3, which doesn't depend on ratings. Don't start balance tuning or attribute-to-gameplay calibration until I sign off.
3. **The look**: coastal stadium, field, grass, sky, ocean, lighting presets, post-processing, crowd, quality presets and auto-detection. A free camera flythrough that already looks like a premium game. Hit the reference images hard here before any gameplay.
4. **Characters and animation system**: football player model with gear, runtime uniforms/numbers/names, body types driven by each player's height and weight, the custom rig, the Blender authoring pipeline, the Animation Lab, runtime blending with foot and hand IK, plus the first authored set: all stances, locomotion, huddle and line-up.
5. **Core play**: one play from snap to whistle. Passing with receiver selection and placement, running with moves, basic man and zone coverage, pass rush vs OL, tackling with ragdoll blend, all driven by the attribute mapping module. Authored animation for QB, RB, WR/TE, tackling, and ball events. Practice Field mode.
6. **Full game**: downs, drives, play calling with a real playbook (at least 30 plays across 6 or more formations), full Beasts AI (coverages, blitzes, tendencies, difficulty), Beasts possessions between drives, scoring, kicking, turnovers, two-minute drill, overtime, results screen. Authored animation for OL and DL line play, LB, DB, and kicking.
7. **Presentation**: Beasts tunnel reveal, 3D draft presentation with the Scouting panel, pre-game, broadcast overlay, replays and slow-mo, celebrations, officials, commentary captions, full audio. The animation library is complete and every clip has passed its quality gates.
8. **Polish and ship**: balance harness and tuning (including the attribute sensitivity checks), performance pass against targets, accessibility (colorblind-safe receiver icons, subtitles), gamepad, tutorial, Daily Challenge, share card with 3D hero render, history, optional leaderboard.

## Definition of done

- A new player can open the Vercel URL, learn the controls in the tutorial, draft a team, and play a full game against the Beasts with no bugs or dead ends.
- Nothing about it feels like a website or a mobile app. It launches, navigates, and plays like a game you bought on Steam.
- Every animation is authored in-house, passes its quality gates, and reads as correct football technique from the broadcast camera.
- Screenshots in every lighting preset hold up next to the reference images.
- Holds 60 fps on the Medium preset on the target Mac hardware.
- Drafting Montana and Rice plays noticeably differently from drafting a 1970s run-first offense, and the Beasts you face change how you have to attack.
- The Daily Challenge is identical for every player on a given date.
- Every rating passes its anchor, era parity, monotonicity and sensitivity tests, and any player's ratings can be traced back to real stats in the Ratings Explorer.
- `CREDITS.md` covers every third-party asset and its license.

Start by reading the legacy file and the reference images, then write `docs/GDD.md` and `docs/TECH_PLAN.md` and show them to me.
