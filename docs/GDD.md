# Beat the Beasts 3D: Game Design Document

Status: **approved 2026-09-22** (all proposed changes in §15 accepted). Architecture, stack, assets and milestones are in `docs/TECH_PLAN.md`. §15 lists every place I think the brief is wrong, ambiguous or unworkable, with a proposed fix. Please read that section even if you skim the rest.

---

## 1. The game in one paragraph

You scout the Beasts, an 11-man all-time defense, as they walk out of a fog-filled tunnel at golden hour in their cliff-top stadium above the ocean. You draft an all-time offense through the slot machine on the video board, and each pick materializes on the field in 3D. Then you play every offensive snap yourself: call the play, read the coverage, drop back with Montana, and throw Rice a back-shoulder ball against Deion, or hand it to Barry Sanders and make Ray Lewis miss in the hole. The Beasts' offense is abstracted into short broadcast cut-ins. You get a set number of possessions to outscore them. Big plays trigger slow-mo and instant replay. At the end you get a dominance grade, a box score and a shareable card.

### Design pillars

1. **It's a game you bought, not a website.** Launch sequence, full-screen menus over a live 3D stadium, controller support, a real settings menu. Nothing scrolls. Nothing looks like a form.
2. **Who you drafted changes how it plays.** Ratings trace back to real stats and become speed, arm strength, break sharpness, catch radius and pass-rush timing. Montana-to-Rice has to feel different from a 1970s ground attack.
3. **The Beasts are smart, fast and hit hard.** The difficulty comes from AI quality and elite personnel, never from cheating the ratings.
4. **Broadcast readability.** From the default camera you can always tell who is open, where the pocket is breaking down and where the ball is going.
5. **Fast to replay.** Everything is skippable. Quick Play is under 45 seconds to kickoff.

---

## 2. Session flow and timing budgets

```
Studio intro (skippable, ≤8 s)
 → Title: "PRESS ANY KEY" over a slow flyover (requests fullscreen, unlocks audio)
 → Main Menu
    ├ Play ─► Classic | Film Room ─► Beasts Reveal ─► Draft ─► Pre-game ─► Game ─► Results
    ├ Daily Challenge ─► (same, seeded; skips hidden; no Auto-Draft) ─► Results + Perfect Team
    ├ Quick Play ─► auto-draft + short reveal ─► Kickoff (≤45 s from click)
    ├ Practice Field ─► Drills | Free Play vs Beasts
    ├ How to Play (interactive tutorial + reference pages)
    ├ Settings
    └ History / Share
```

| Path | Budget | How |
|---|---|---|
| First launch → first snap | < 3 min | First launch goes straight into the tutorial's first drill, and the first snap happens in under 60 s. A normal Play run takes about 2.5 min with the reveal and draft at normal speed |
| Quick Play → kickoff | < 45 s | Auto-draft (perfect team for a random sequence, as legacy Auto-Draft), a 6 s reveal highlight, a 5 s pre-game |
| Repeat player → kickoff | ~75 s | Every cinematic skippable with one key. "Skip intro" and "Fast reveal" settings |

Transitions between states are camera moves in the same persistent 3D scene (tunnel → field → video board → broadcast camera), never a blank loading screen after the first load.

---

## 3. Front end

### 3.1 Launch
- **Studio intro:** a short logo sting over the ocean at dawn, with audio starting after the first input (browsers block audio until then).
- **Title:** "BEAT THE BEASTS" in Bungee, "PRESS ANY KEY" pulsing, and the stadium flyover. Any key, click or pad button requests fullscreen and unlocks audio, then goes to the main menu.
- **Desktop gate:** on phones and tablets, a single styled screen: *"Beat the Beasts is built for keyboard and mouse or a controller. Open it on a desktop or laptop."* There's a small "continue anyway" link for touch laptops.

### 3.2 Main menu
Full-screen and left-aligned, over a live cinematic camera that changes per focused item (focusing "Daily" swings to the video board, "Practice" to the practice end zone). Items: **Play**, **Daily Challenge** (with today's date and status: Not Played / Final Score), **Quick Play**, **Practice Field**, **How to Play**, **Settings**, **History**. The skin-tone editor (§12.6) lives in Settings → Gameplay.

### 3.3 Navigation rules for every menu
- Mouse hover and click, keyboard (arrows, Tab / Shift+Tab, Enter, Esc = back), and gamepad (D-pad or left stick, A = select, B = back, LB/RB = tabs).
- A visible focus state on everything, hover and select sounds, and 150–250 ms animated transitions.
- No browser-default controls: custom sliders, toggles, selectors and key-capture fields.
- No page scroll. Long lists (draft pool, history, rebinding) scroll inside their panel with the wheel, keys or stick.

### 3.4 Settings

| Tab | Options |
|---|---|
| Display | Fullscreen, Resolution scale (50–100% + Dynamic), Frame cap (30/60/120/144/Unlimited), VSync (where the browser allows it; otherwise hidden), Field of view (broadcast camera ±10°), HUD scale, Safe-area (ultrawide) |
| Graphics | Preset (Low/Medium/High/Ultra/Custom, auto-detected on first launch), Shadows, Ambient occlusion, Crowd density, Grass detail, Post effects (bloom, vignette), Replay depth of field and motion blur, Weather particles |
| Controls | Rebinding per context (keyboard/mouse and gamepad), Mouse sensitivity, Invert Y (replay camera), Placement reticle sensitivity, Touch-pass hold threshold, Ball-in-air control (Off / Assist / Full) |
| Audio | Master, Music, SFX, Crowd, UI. Mute when unfocused |
| Gameplay | Difficulty (Rookie/Pro/Legend/Beast), Game length (Quick 4 / Standard 6 / Full 10 drives), Default camera (Broadcast/All-22/Field Level), Lighting (Golden Hour default, Night, Overcast, Rain, Snow, Random), Skip intros, Fast reveal, Auto-replay (On / Big plays only / Off) |
| Accessibility | Colorblind receiver icons (shapes + numbers, three palettes), Commentary captions size, Reduce camera shake, Reduce flashing (pyro, strobes, bloom pulses), Hold-to-toggle for sprint and protect, UI scale |

---

## 4. Modes

| Mode | What it is |
|---|---|
| **Classic** | Stats visible during the draft (OVR, key attributes, traits, Scouting panel). Same draft rules as legacy |
| **Film Room** | All numbers hidden during the draft (no OVR, no attributes, no stats, no unit stat blurbs; names, team, decade and position only). Numbers are revealed after the final whistle, as legacy does in the box score |
| **Daily Challenge** | Same Beasts and same team+decade sequence for everyone on a given local date (legacy seeding, unchanged). Film Room rules. No skips, no Auto-Draft (§15 D8). Score = final margin. After the game: the Perfect Team comparison. One scored attempt per date; replays are allowed but unscored |
| **Quick Play** | Auto-draft, a short reveal, kickoff. For "I just want to play" |
| **Quick Sim** | An option on the Pre-game screen: sim the game with the legacy engine (through the ratings adapter) and a legacy-style replay presentation, rebuilt in 3D as broadcast highlight cut-ins. Not available for the Daily's scored attempt |
| **Practice Field** | Drills (Pocket Passing, Route Timing, Open-Field Running, Kicking) with scoring medals, plus Free Play against the Beasts with no score, any down and distance, any play, and repeatable |
| **Tutorial** | Guided first-launch sequence: movement → snap and handoff → reading one receiver → placement → a full play against a soft coverage → a live drive. It can be re-run from How to Play |
| **History** | Local record of games and dailies: score, grade, roster, highlight thumbnails. Share cards can be regenerated from history |

---

## 5. The Beasts

### 5.1 Assembly
- **Base 11:** the legacy `assembleBeasts` logic, unchanged in structure: 2 DE, 2 DT, 3 LB, 2 CB, 2 S, drawn from `DEFENSE` with the legacy weighting, re-rolled until the unit clears the strength bar, seeded from the game seed (Daily: the legacy `getDailyChallenge` streams).
- **Sub package (new):** +1 CB and +1 S, drawn **after** the base 11 from the same stream. Nickel and dime need them, and appending them leaves the base 11 identical to legacy for any seed (§15 D7).
- When ratings move to the new system (M2), the weighting input switches from `imp` to OVR and the strength bar is recalibrated (TECH_PLAN §17 R2/R3).

### 5.2 Presentation
- **Threat level** is carried forward from legacy: NIGHTMARE / BRUTAL / STOUT / BEATABLE (thresholds recalibrated to the new rating scale), shown with the Defense Rating and projected points allowed.
- **Reveal (§11.2):** tunnel walkout, a lower-third per Beast (name, position, team+decade, 2–3 key stats, trait badge), with the legacy slot-lock reveal running on the video board above.

---

## 6. Draft

### 6.1 Rules (legacy behavior preserved exactly)
1. 9 rounds. Roster slots: QB, RB, RB2, WR1, WR2, WR3, TE, TE2, OL.
2. Each round the slot machine lands on a random **team + decade** pair drawn from the valid pairs: those with at least one unused, not-already-rostered player at a position you still have open.
3. You may fill **any open position** from that pair's pool. RB fills RB, then RB2; WR fills WR1, then WR2, then WR3; TE fills TE, then TE2 (auto-assigned, as legacy).
4. **One Team Skip** (keep the decade, re-roll the team) and **one Era Skip** (keep the team, re-roll the decade) per game. Hidden in the Daily.
5. **No duplicate players:** a player already on your roster can't be drafted again from another team or decade. (Legacy checks names; the new game checks person ids so different people who share a name don't block each other. §15 D9.)
6. **At most one 1970s player.** As in legacy, this counts players you drafted, not pairs rolled: you can roll the 1970s several times, but once you've drafted from the 1970s, no more 1970s pairs are rolled.
7. OL is picked as a team+decade **unit**. In the 3D game it becomes five individual linemen (named from the unit's key list, the rest generated around the unit's level; see the ratings spec).
8. Daily: the sequence is fixed per date (`buildDailySequence`, unchanged). If a Daily round ever offers no legal pick (theoretically possible through the duplicate-player rule), the round advances to a deterministic backup pair derived from the same date seed (§15 D8).

### 6.2 Presentation
- The slot machine runs on the stadium's main video board: team and decade reels with the legacy flicker timing (~950 ms), then a lock with light and sound.
- The draft UI is a full-screen overlay styled like a sports game's team-select screen:
  - **Left:** the pool for this pair, grouped by position, with search and position filter tabs (All/QB/RB/WR/TE/OL; tabs for filled positions are dimmed, as legacy).
  - **Center:** the focused player's card: name, team+decade in `TEAM_COLORS` accents, OVR, the 4–6 key attributes for his position, trait badges. In Classic there's a **Scouting** tab: "how we got these numbers", with the contribution breakdown from real stats and confidence flags.
  - **Right:** your roster on a mini formation (the 3D field behind shows the same thing live).
  - **Skips** sit on the reels, and there's a Film Room indicator.
- **Pick → materialize:** the camera cuts to the field. The player forms up at his position in the formation in the Contenders kit (particle and light resolve, not a pop-in), with a short signature animation chosen from his traits (QB: a drop-back and throw motion; Bruiser RB: a lowered-shoulder hit on a sled; Deep Threat WR: a burst into a go route and a catch over the shoulder), and a crowd reaction scaled to OVR.
- **Auto-Draft** (Classic, Film Room, Quick Play only) fills the remaining slots from the best available assignment for a random sequence, as legacy did. Unlike legacy, it doesn't discard picks you've already made.

---

## 7. Game format and rules

### 7.1 Structure
- **Possession rounds.** A game is N rounds (Quick 4, Standard 6 (default), Full 10). Each round is **a Beasts possession ("Meanwhile" cut) followed by your drive.** You always have the last word (§15 D2). The coin toss is presentational: "The Beasts win the toss and elect to receive."
- **Your drive** starts at your own 25, except:
  - after a Beasts possession ending in a **turnover**: your drive starts at a seeded spot between your own 40 and the Beasts' 45 (a short field);
  - after a Beasts **punt**: the spot is seeded between your own 12 and 30.
- **Presentational game clock.** Quarter and clock advance per round (N rounds spread over 60 minutes). The exception is the final drive (§7.4).

### 7.2 Inside a drive
- 4 downs, 10 yards to gain, standard spotting, out of bounds and incompletions.
- **Scoring:** TD 6 → PAT kick (kick mechanic) or 2-point try (one live play from the 3). FG 3 (kick mechanic). Safety: +2 Beasts, and your drive ends.
- **4th down:** a decision card before the play call: Go For It / Punt / Field Goal (FG shown when in range, with the estimated make % from the kicker's leg and the wind). Punts are auto-simulated with a quick broadcast cut (distance and return from the punt model) and end the drive.
- **Turnovers** end the drive. An INT or fumble can be returned live: the Beasts return it and you control the nearest Contender to make the tackle. Scoring returns (pick-six, scoop-and-score) add **7** to the Beasts.
- **Downs, sacks, incompletions and penalties:** no penalties at launch (a scope decision: they'd slow the flow and need officials' AI).

### 7.3 Beasts possessions ("Meanwhile")
- **5 to 10 seconds:** the score bug updates, a lower-third names the scorer or the stop (for example "MEANWHILE… THE BEASTS: 11 plays, 75 yds, TD"), a video-board replay flash, and a crowd reaction. Skippable.
- **Outcome model:** derived from the legacy Beasts scoring model, converted from a whole-game total to per-possession outcomes (TD / FG / Punt / Turnover, plus a rare safety or defensive score). The expected points and spread over a game match legacy, scaled to game length. The legacy "answer-back" term (the Beasts score more in shootouts) becomes a per-possession modifier driven by your running score. Everything is seeded deterministically from the game seed (§15 D1).
- The Beasts' 2-point decisions follow the score situation (a simple chart).

### 7.4 Final drive and two-minute drill
- If you are **trailing or tied** when your last drive starts, the clock goes live: **2:00 on the clock, 3 timeouts** (T), clock stops on incompletions, out of bounds, timeouts and scores. Spike (`K` / pad `Back`+`X`) and kneel (`J` / pad `Back`+`B`). A running 40-second play clock between plays; its auto-hurry can be toggled in settings. When time expires, the drive ends after the snap in progress.
- If you are **leading**, the clock stays presentational and **Victory Formation** (kneel) becomes available when kneeling can run out the clock.

### 7.5 Overtime
Tied after regulation: college-style rounds from the 25. The Beasts possess first (abstract), then you (live), so you always know what you need. Rounds repeat until someone leads after a pair of possessions. From the 3rd OT on, each possession is a single 2-point try (current college rule), so it can't go on forever (§15 D5).

### 7.6 Dominance grade
Legacy thresholds (margin: A+ ≥21 "Total Domination", A ≥11 "Statement Win", B ≥4 "Solid Win", C ≥1 "Nailbiter Win", L ≥−10 "Tough Loss", L- below that "Beatdown") were tuned for a 10-drive game. They're scaled by `drives / 10` and rounded up to football-meaningful numbers:

| Grade | Full (10) | Standard (6) | Quick (4) |
|---|---|---|---|
| Total Domination | ≥ 21 | ≥ 13 | ≥ 9 |
| Statement Win | ≥ 11 | ≥ 7 | ≥ 5 |
| Solid Win | ≥ 4 | ≥ 3 | ≥ 2 |
| Nailbiter Win | ≥ 1 | ≥ 1 | ≥ 1 |
| Tough Loss | ≥ −10 | ≥ −6 | ≥ −4 |
| Beatdown | < −10 | < −6 | < −4 |

Per-player grades (A+ to F) keep the legacy `gradeQB`/`gradeRush`/`gradeRec` formulas, with their yardage terms scaled to game length.

---

## 8. Controls

All bindings can be rebound per context. The gamepad has Madden-style defaults. The input context changes automatically with the game state, so reused keys never collide inside one context.

### 8.1 Keyboard and mouse

| Context | Action | Key |
|---|---|---|
| **Play call** | Navigate / select / back | Mouse, arrows, Enter, Esc |
| | Play-type tabs (Quick, Intermediate, Shots, Screens and play action, Runs) / Suggested tab | `Q`/`E` (LB/RB), `G` = Suggested |
| **Pre-snap** | Snap | `Space` |
| | Show every route | Hold `Tab` |
| | Hot route | `H`, then the receiver's number, then the route's number (or arrows and `Enter`) |
| | Audible (4 presets, set on the play-call screen) | `Z`, then `1`–`4` |
| | Motion | `M` (then `A`/`D` for direction) |
| | Flip play | `F` |
| | Show receiver reads / coverage shell | Hold `Alt` |
| **Pocket (QB)** | Move (step up, drift, roll out), camera-relative | Arrow keys (the left hand stays on `1`–`5`) |
| | Throw to receiver | `1`–`5` or left-click the receiver icon. **Tap = driven ball (flat, fast), hold = touch** (the ring fills with the loft); he lofts a driven ball over a defender in the lane on his own |
| | Placement | Mouse offset from the icon while choosing: a small reticle sets lead / back shoulder / high / low |
| | Pump fake | Right-click (or `Shift`+number) |
| | Throw it away (outside the pocket) | `Q` |
| | Scramble: tuck it and run | `R`. He can still throw on the run (`1`–`5`) until he crosses the line; past it he's a ball carrier |
| **Ball in air** (setting: Off / Assist / Full) | Switch to the targeted receiver | Automatic in Full; `Tab` in Assist |
| | Go up and get it (aggressive) / secure it and go down (possession) / catch and run | `1` / `2` / `3` (prompts appear the moment the ball is thrown; the called catch lights up) |
| **Ball carrier** | Run | Arrow keys (a direction only). Speed follows the context: flat out in space, controlled with a tackler close, a jog while protecting. No sprint key: he bursts on his own out of a cut or into open field (Acceleration, stamina) |
| | Juke | `1` or `Q`: toward the side you're steering, else away from the nearest tackler (gamepad: flick the right stick left / right) |
| | Stiff arm / spin | `2` or `W` / `3` or `E` |
| | Truck / dive (a QB slides: down where the slide began, and he can't be hit) / protect ball | `4` or `R` / `5` or `F` / hold `6` or `C` |
| **Kick (FG/PAT)** | Aim and power | Press and drag the mouse back, release. Direction = aim, drag length = power. Wind flag on screen |
| **Global** | Pause | `Esc` (§15 D6 for fullscreen behavior) |
| | Instant replay after the whistle | `P` or `Backspace` |
| | Camera (Broadcast / All-22 / Field level) | `F1` / `F2` / `F3` |
| **Replay** | Orbit / zoom | Mouse drag / wheel |
| | Scrub / slow-mo / play-pause | `A`/`D` or the scrub bar / `S` / `Space` |
| | Depth of field on/off | `F` |

### 8.2 Gamepad defaults (Xbox labels)

| Context | Action | Button |
|---|---|---|
| Pre-snap | Snap / hot route / audible / motion / flip | A / Y then a receiver button / X then preset / left stick when in motion menu / RB |
| Pocket | Move | Left stick |
| | Throw | Receiver buttons A, B, X, Y, RB. Tap = driven, hold = touch |
| | Placement | Left stick direction while pressing |
| | Pump fake / throw away | LB / RS click |
| Ball in air | Aggressive / RAC / possession catch | Y / X / A |
| Pocket | Scramble | RT |
| | Juke / spin / stiff arm / truck / dive / protect | RS left/right / B / X / RS up / A / LB |
| Kick | Aim and power | RS pull back, flick forward |
| Global | Pause / replay | Menu / View |

Rumble on hits, sacks and catches in traffic. Colorblind receiver shapes follow the button colors: A ▼ green, B ● red, X ■ blue, Y ▲ yellow, RB ◆.

### 8.3 Receiver icons
- Icons float above each eligible receiver, colored with the legacy position palette: QB gold `#ffd400`, RB pink `#ff2a6d`, WR cyan `#00e5ff`, TE purple `#bd6bff`, with the number key (1–5) or gamepad glyph inside.
- In colorblind mode, each position also gets a unique shape.
- A thin ring shows the **openness read** after the break (a pressure-free QB with high Awareness sees it earlier; this is part of how ratings feel). It never shows exact probabilities.

---

## 9. On-field systems

Everything here is driven by `sim/attributeEffects.ts` (ratings → physical and skill parameters, all monotonic). The numbers are the brief's starting values and get tuned with the harness.

### 9.1 Passing
- **Drop:** the play sets the drop (quick, 3-, 5- or 7-step, shotgun catch, play-action). Release time comes from the Release attribute (0.45 s at 70 → 0.30 s at 99).
- **Velocity:** the throw's hang time is set by distance and arm: a driven ball (the default) reaches 10 yd in ~0.6 s and 20 yd in ~0.9 s from a 90 arm, longer for a weaker one; touch stretches it 15–35%, and a defender under the path makes the QB loft it. Throw Power sets the maximum speed (52 → 62 mph) and range (55 → 75 yards).
- **Placement error:** a cone that widens with distance. Short, Mid and Deep Accuracy pick the base size (about 1 yard at 20 yards for a 70, a third of that for a 99), multiplied by throwing on the run (Throw on the Run), pressure (Under Pressure), and footwork (set feet vs off-platform).
- **Pressure** is physical: defenders within a radius and closing, not a hidden roll. Pocket Presence gives earlier awareness cues (the QB's head check and a subtle HUD edge glow) and a better auto step-up.
- **Pump fakes** move defenders whose read is QB eyes and shoulders. Play Recognition sets how long they stay fooled.

### 9.2 Catching
- The catch probability combines base Catching, ball velocity, placement error, defender proximity at the catch point (Catch in Traffic), and catch type:
  - **Aggressive:** higher contested-catch odds, no run after catch.
  - **RAC:** lower catch odds in traffic, the receiver keeps his speed.
  - **Possession:** best in traffic, and it secures the sideline toe-tap.
- Spectacular Catch raises the ceiling on high, diving and one-handed windows.
- Outcomes: catch, drop, deflection (live ball), or interception.

### 9.3 Running
- Movement uses top speed, acceleration and turn rate from Speed, Acceleration and Agility. Cuts cost speed; the cost goes down with Agility. Stamina drains while sprinting and recovers between plays.
- **Moves** (juke, spin, stiff arm, truck, dive, protect):
  - Each has an animation commitment and a cooldown.
  - Success depends on the carrier's move attribute (Elusiveness, Stiff Arm, Trucking, Break Tackle), his momentum and the angle, against the defender's Tackle, Hit Power and Pursuit.
  - Spamming fails: back-to-back moves lose effectiveness, and a mistimed juke on a squared-up tackler is a loss.
- Ball Security vs Hit Power sets the fumble chance on contact. Protect lowers it at the cost of speed.

### 9.4 Blocking and the pocket
- **OL/TE vs rushers** are engagement pairs whose leverage evolves every tick: the rusher's Power and Finesse Moves and Block Shedding against Pass Block Power, Pass Block Finesse and Anchor. That gives a time-to-win distribution per matchup.
- The pocket collapses visibly (edge rushers arc around; bull rushes push the depth of the pocket back). Play-action and rollouts change the geometry.
- Run blocking uses zone, gap and pull schemes defined per play. Pull and Move, and Run Block Power or Finesse, decide whether the hole opens.

### 9.5 Tackling
Defenders take pursuit angles from their speed. A tackle is an approach + a resolution: form tackle, arm tackle (a chance to break it), dive, or a big hit. That depends on Tackle and Hit Power vs Break Tackle, Trucking and Stiff Arm, plus mass, speed and angle. Gang tackles add. Big hits trigger hit-stop, camera shake scaled to force, an audio duck and rumble, and blend into a physics ragdoll for the fall (visual only: the sim has already decided the result).

### 9.6 Kicking
- **FG and PAT** use the drag mechanic. The kicker's leg (a generated "Contenders kicker" whose rating is fixed per difficulty; there are no kickers in the data) sets maximum distance. Wind speed and direction per game (the legacy WindChip concept, 2–12 mph, stronger in weather presets) bends the flight.
- **Punts** are auto-simulated.

---

## 10. Playbook, play calling and AI

### 10.1 Play-call screen
- A full-screen overlay (not blocking the stadium view) with formation groups, play art on a mini field (routes, blocking, the reads in order) and a **Suggested** tab.
- **Suggested** comes from a simple offensive coordinator AI that reads down, distance and field position, the Beasts' tendencies so far this game (for example, how often they've blitzed on 3rd and long), and your personnel strengths (a Deep Threat plus a 7-step-capable QB → it suggests shots).
- **Audibles:** set 4 presets per game on this screen.

### 10.2 Formations and plays (≥ 6 formations, ≥ 30 plays at launch)
The roster has 2 RB, 3 WR and 2 TE, so personnel groupings drive the formations:

| Formation | Personnel | Sample plays |
|---|---|---|
| Shotgun Trips | 11 | Mesh, Stick, Smash, Four Verticals, Y-Cross, Bubble screen, RB draw |
| Shotgun Doubles | 11 | Curl-Flat, Dagger, Slants, Hitch-Seam, Zone read (mobile QB), Hail Mary |
| Singleback Ace | 12 | Inside zone, Outside zone, PA Crossers, TE Seam, Counter |
| I-Form Pro | 21 | Power O, Iso, Toss, PA Deep Shot, Fullback flat |
| Pistol | 11/12 | Stretch, PA Boot, RPO Glance (auto-read) |
| Heavy / Goal Line | 22 | QB Sneak, Dive, Power, PA TE Leak |
| Empty | 1-3-1 (RB split out) | Quick game, Spot, Levels |

Special calls: Spike, Kneel, Victory Formation, Hail Mary, FG/PAT, 2-point set.

### 10.3 Your teammates' AI
- Routes come from a route tree with timing tied to the QB's drop.
- **Option routes** convert against coverage (sit vs zone, break away vs man).
- OL and TE blocking follows each play's protection or run scheme. The RB picks up blitzes (Pass Block) or checks down.
- Downfield blocking after the catch or on runs: WRs stalk-block their man, with Run Block driving the outcome.

### 10.4 The Beasts' defensive AI
- **Personnel:** base 4-3 (2 DE, 2 DT, 3 LB, 2 CB, 2 S). **Nickel** (one LB out, the sub CB in) and **Dime** (the sub S in as well), by situation and your personnel.
- **Coverages:** Man (press and off), Cover 1, Cover 2, Cover 3, Cover 4, Tampa 2, zone blitzes, and simulated pressure.
  - Zone defenders drop to landmarks, read the QB's eyes and shoulders (so pump fakes move them) and pass off crossing routes.
  - Man defenders trail or undercut according to Man Coverage and Press.
- **Pass rush:** each rusher has a move set from his traits (speed rush, bull rush, spin, club, long arm), resolved against the OL over time.
- **Run defense:** gap assignments, a force defender on the edge, block shedding against run blocking, and pursuit angles.
- **Coordinator:** picks the call from down, distance, field position and score, plus **tendency learning within the game**. If you keep throwing the same concept to the same receiver, it brackets him (a safety shades, a lurking LB). Disguise before the snap at higher difficulties (the shell rotates at the snap).
- **Stars play like themselves:**
  - A **Ballhawk** jumps routes when he reads the throw early.
  - A **Shutdown Corner** travels with your best receiver.
  - A **Speed Rusher** wins around the edge.
  - An **Enforcer** hunts big hits on crossers.
  - A **Run Stuffer** sheds and fills.
  - A **Sideline to Sideline** LB closes cutbacks.
- **Difficulty** changes AI reaction latency, read quality (how early they diagnose play-action or read your eyes), how often the DC exploits your tendencies, and disguise. **Never** player ratings.

| | Rookie | Pro | Legend | Beast |
|---|---|---|---|---|
| Read latency add | +0.25 s | +0.10 s | +0.03 s | 0 |
| Tendency learning | off | slow | normal | aggressive |
| Disguise | none | light | frequent | frequent + simulated pressure |
| Pump-fake bite (by Play Recognition) | ×1.4 | ×1.0 | ×0.8 | ×0.7 |

---

## 11. Presentation

### 11.1 Cameras
- **Broadcast (default):** behind the QB, matching ref-02's lens height and framing. It pulls up and back smoothly on pass plays and follows the carrier with look-ahead on runs. On long runs it switches to a high sideline angle.
- **Alternatives:** All-22 and a tighter "Field Level".
- **Cinematic cameras** for the reveal, the draft, touchdowns, replays and the Meanwhile cuts.

### 11.2 Beasts reveal (tunnel walkout)
Fog, pyro and a crowd roar. Beasts emerge one at a time with lower-thirds (name, position, team+decade, key stats, trait badge), and the legacy slot-lock animation runs on the video board, locking each Beast in as he appears. It ends on the full defense lined up, with the Threat Level card. The fast version is 12 s, the normal one about 35 s.

### 11.3 Pre-game
Coin toss, both lineups, the matchup preview from the legacy `buildMatchups` logic ("Your WR1 vs their best corner", "Your OL vs their pass rush", the run front), and the Beasts' Defense Rating. The Quick Sim option lives here.

### 11.4 Broadcast overlay
- **Score bug:** CON vs BST, quarter, clock, possession, timeouts.
- **Down and distance.**
- **Drive strip** (the legacy drive progress strip, revived: lime for your scores, magenta for Beasts scores, dim for stops).
- **Lower-thirds** for players in big plays.
- **The first-down line and line of scrimmage** are drawn on the turf.
- A **wind flag** on kicks.

### 11.5 Replays and slow-mo
- **Auto replay** for touchdowns, turnovers and big hits: a "REPLAY" wipe, 2–3 broadcast angles, depth of field and motion blur.
- **Manual replay** gives a free orbit, a scrub bar and slow-mo.
- **Slow motion** triggers on contested catches, one-handed catches, near-interceptions and the first frame of a breakaway (subtle, about 0.35× for 0.6 s, and it can be disabled).

### 11.6 Celebrations and moments
- **TDs:** a short celebration (ball handed to the ref, a spike, team celebration in the end zone, pointing to the crowd, helmet taps), a crowd eruption, confetti or pyro, and a pulse of the stadium lights.
- **Game-winning drives** get the full version.
- **A Beasts pick-six** gets the Beasts' own celebration: a menacing crimson light pulse and the home crowd going wild.

### 11.7 Commentary
A text ticker and caption bar. The legacy caption templates are kept and expanded into a line bank keyed by event, situation and player traits, with variety rules (no repeats within N plays). Examples carried forward: "{passer} finds {receiver} for a {n}-yard touchdown.", "Intercepted by {defender}!", "The Beasts punch in a touchdown." Voiced commentary is out of scope.

---

## 12. Art direction

### 12.1 Signature location: "Blackcliff"
The Beasts' home is an open-air bowl on a sea cliff. Three sides are steep, dense stands under a cantilevered roof lip. The **south end zone opens onto the ocean** with a low terrace and a glass rail, and beyond it only the sea and the coastline headlands fading into haze. The tunnel is cut into the rock under the north stands.

### 12.2 Light and the sun (a correction to the brief's framing)
- Putting the sun straight behind the open end zone means that whenever the broadcast camera looks toward the ocean it shoots directly into the sun. Players become flat silhouettes, which breaks the readability ref-02 requires.
- **Proposal:** the sun sets over the water about **35° off the field axis**, visible from the broadcast camera in the upper corner of the frame when attacking toward the ocean. That gives:
  - warm raking side and rim light on the players;
  - long diagonal shadows across the mowing stripes;
  - a glitter path on the ocean past the open end;
  - the ref-01 horizon glow.
- Your drives always attack toward the ocean (there is no field-side switching in a possession game), so the signature view is the default gameplay view.

### 12.3 Lighting presets
| Preset | Look |
|---|---|
| **Golden Hour** (default) | Low warm sun, clean sky gradient, glowing horizon haze, long soft shadows |
| **Night** | Stadium lights, bloom, light haze, Beasts helmet stripes glowing, a moonlit sea |
| **Overcast** | Soft top light, cool grey-green grade, heavier aerial perspective |
| **Rain** | Wet-field reflections, streaks in the lights, a darker sea |
| **Snow** | Accumulation between the numbers, breath vapor, a muted palette |

Each is a data preset (sun, sky, fog, LUT, bloom, wetness, particles), not a separate level.

### 12.4 Color and detail targets (from the references)
- **ref-02:** tight broadcast framing, glossy helmets with real environment reflections, fabric jerseys with folds, bright sharp grass with mowing stripes, a dense crowd with color noise and a slight depth softness.
- **ref-03:** saturated but natural color, turquoise shallows at the cliff base, crisp high-frequency detail in the foreground, haze in the distance.
- **ref-01:** warm sky gradient, gentle long-period swell with a sun glint path.
- *Note:* ref-02 contains real NFL uniforms and logos, and ref-03 is a midday tropical scene. Both are used for mood, rendering quality and camera language only.

### 12.5 Uniforms and identity
- **Contenders:** a kit designer with strong presets:
  - **Blackout Lime** (default): black shell, neon lime `#aaff00` trim, matte black facemask.
  - **Arctic**: white, ice blue, silver.
  - **Royal**: navy, gold.
  - **Ember**: charcoal, orange.
  - **Heritage**: cream, oxblood, brown.
  - Custom: helmet, jersey, pants and trim colors, facemask color, stripe style.
  - None of these resemble a real NFL team.
- **Beasts** (fixed): black and deep crimson, with a subtle emissive crimson helmet stripe that glows at night, and dark smoked visors on a few stars.
- **No NFL logos, wordmarks or team names** on uniforms, helmets, field or stadium. The stadium is the Beasts' home: a stylized claw mark at midfield, "BEASTS" in both end zones and Beasts branding on the video board. "Blackcliff" is the venue name, used only on the intro title card. Draft cards and the draft room use `TEAM_COLORS` for team+decade accents.

### 12.6 Players' bodies and skin tone
- Height and weight from the ratings data drive each body. Linemen are visibly different from corners.
- Skin tone comes from the characterization data (5 tones, legacy `SKIN_TONES`). The editor is kept, rebuilt as a game menu, and actually reachable (in legacy it was unreachable dead code). Players with no assignment use the legacy neutral default (§15 D13).

### 12.7 UI style
- Brand identity kept but more restrained: Bungee for display and scoreboard numerals only, a clean sans for body text, dark translucent surfaces with blur, neon lime `#aaff00` as the single accent, and the position palette used only for position coding.
- Thin rules instead of boxes, generous negative space, motion on focus. No pills, no card grids.
- Madden/2K-style front end, not a web dashboard.

---

## 13. Audio
- **Crowd:** a layered bed that reacts live: murmur → anticipation swell while a deep ball is in the air → roar or groan; home-crowd noise on 3rd down; a hush at the Beasts' red-zone stands.
- **Field:** pads and helmet collisions scaled by impact, cleats on turf (wet variants), ball spiral whoosh, whistle, the QB cadence at the snap ("Set… hut"), PA announcer stings.
- **Music:** menu and draft tracks, plus a distinct Beasts reveal cue. The music ducks during play.
- Spatial audio for on-field sounds. Buses for Master, Music, SFX, Crowd and UI.
- CC0 or properly licensed only, logged in `CREDITS.md` (TECH_PLAN §14 has the sourcing constraint).

---

## 14. Results, sharing and meta

### Results screen
- **Headline:** final score (counting up), a win or loss banner, the dominance grade.
- **Box score:** legacy categories, with per-player grades.
- **Key matchups** (legacy callout logic). The verdict reads "REC WON / DEF WON / EVEN" so it's correct for TEs and safeties too.
- **Trenches:** pass pro vs rush, sacks, run block vs front.
- **Drive summary** strip.
- **Game analysis:** the legacy `generateBeatdownAnalysis` templates, with thresholds scaled to game length.
- **Highlight reel** of auto-captured replays.
- **Daily:** the Perfect Team comparison ("✓ you" on matches).

### Share card
The legacy recap concept, upgraded:
- a 3D render of your best play as the hero image (rendered offscreen from the replay snapshot at a hero camera);
- score, grade and date (the Daily's date key, not "today");
- the **full 9-man lineup** (legacy showed only 4);
- PNG download plus copy to clipboard.

Legacy's `ReactDOM` bug and its career-rating "QB RATING" are fixed: the card shows this game's QB line.

### History and leaderboard
- **History:** local games and dailies (score, grade, roster, date), with share cards regenerable.
- **Leaderboard (stretch):** a global daily leaderboard with an anonymous handle and rate limiting. Scores can be verified by re-simulating the submitted input log (TECH_PLAN §4.5).

---

## 15. Brief review: issues and proposed fixes

| # | Issue in the brief | Proposed fix |
|---|---|---|
| **D1** | The legacy Beasts score is **one whole-game number**, computed after all your drives and partly dependent on your final score (the "answer-back" term). The brief wants a per-possession outcome between drives | Convert it to a per-possession outcome distribution (TD/FG/punt/turnover) whose expected total and spread match legacy for the same Beasts rating, scaled to game length. The answer-back becomes a live modifier based on your running score. Legacy's "+7 per INT at 16%" goes away because pick-sixes now happen live. Validated in the harness against the legacy distribution |
| **D2** | Possession order isn't specified. If the Beasts possess last, the two-minute drill loses its meaning | The Beasts possess first each round, so you always have the last word. The coin toss is presentational |
| **D3** | Legacy `forceWin` guarantees a win for a perfect Daily draft. That can't exist in a game you play | Drop it for live play. In the Daily, "perfect draft" becomes an achievement and a comparison, not a guarantee. Quick Sim keeps legacy behavior but isn't allowed for the Daily's scored attempt |
| **D4** | "Grades use existing thresholds, scaled to game length" doesn't say how | Scale by drives/10 and round up to football-meaningful margins (table in §7.6) |
| **D5** | "One overtime possession each" doesn't say what happens on a second tie | Repeat college-style rounds; 2-point tries only from the 3rd OT on |
| **D6** | Browsers reserve **Esc** to exit fullscreen, so "Esc: pause" can't work as written in fullscreen, and Safari has no workaround | Chromium: Keyboard Lock makes Esc pause in fullscreen. Everywhere: leaving fullscreen auto-pauses, and Resume re-enters fullscreen. Keys reused across contexts (Space, Q, Tab, right-click) are fine because contexts don't overlap. The binding UI checks conflicts per context |
| **D7** | "Nickel and dime packages" need 12–13 defenders, but the Beasts are exactly 11 | Draw a seeded **sub package** (+1 CB, +1 S) after the base 11 from the same stream. The base 11 stays identical to legacy for any seed |
| **D8** | Legacy Daily lets **Auto-Draft** load the perfect team, which triggered `forceWin`: a one-click guaranteed win. Legacy Daily also hides skips, so a round with no legal pick has no way out | No Auto-Draft in the Daily. A deterministic backup pair from the date seed covers the (rare) no-legal-pick case |
| **D9** | "No duplicate player names" is implemented on names, so homonyms block each other (for example, three different Mike Williamses) | Enforce "no duplicate **person**" with a person-id map built by name and corrected by hand. It's the same rule for real duplicates and fixes the false positives |
| **D10** | "Each drive starts at your own 25 unless a turnover rule says otherwise" doesn't say which rule | A Beasts turnover gives a short field (your 40 to their 45, seeded). A Beasts punt gives your 12–30. Otherwise your 25 |
| **D11** | Film Room in legacy leaked information (the OL unit blurbs, the Beast stats in the Daily) | Film Room hides all numbers and stat blurbs during the draft. Names, team, decade, position and trait **names** stay visible (the brief says "hides all numbers"). Beasts stats are shown in every mode, since scouting the opponent is part of the game. All numbers are revealed after the game |
| **D12** | "At most one 1970s pull": does that mean rolls or picks? | Keep the legacy behavior: picks. You can roll the 1970s repeatedly until you draft one |
| **D13** | "Skin tone comes from the existing characterization editor data", but that data isn't in the file (legacy stored it in a Claude-artifact storage API, and the editor was unreachable) | Please export `btb_characterization_v1` if you have it. Otherwise all players start at the legacy default tone and I'll make the editor reachable so the tones can be set |
| **D14** | 4th-down punts are "auto-simulated", but there's no 4th-down decision specified | A 4th-down decision card: Go / Punt / FG |
| **D15** | Kickoffs aren't mentioned | No live kickoffs. Drives start per D10 (touchback convention), which keeps the flow fast |
| **D16** | "Every animation authored in-house" at the full library size is the biggest schedule risk | Authored base clips + procedural variants + a runtime layer (TECH_PLAN §17 T8). The quality bar stays |
| **D17** | Kickers aren't in the data, so FG and PAT ratings have nothing to come from | A generated Contenders kicker with a fixed average-good rating, the same at every difficulty. Kicking skill is the player's execution of the drag mechanic |
| **D18** | Anchor list: bands are "position-relative", but physical attributes must be absolute to drive physics | Physical attributes are absolute; the listed physical anchors still hold as absolute values. Skill anchors stay position-relative (TECH_PLAN §17 R1) |
| **D19** | Switching the Daily's Beasts weighting and perfect team to the new OVR (and every later correction) changes past and current dailies | Pin a ratings version per date, activated at midnight, and freeze the pair universe (TECH_PLAN §17 R2) |

---

## 16. Scope: what gets cut first if quality is at risk

Per the brief's rule "trade scope before quality", in order. Nothing here is cut now; this is the order I'd propose if a milestone runs long.

0. Animation variants and celebration/official extras (per the approval note: base technique clips are never cut).
1. Snow preset (Rain covers the weather tech).
2. Global leaderboard (already a stretch goal).
3. Hot routes and motion. Audibles and flip stay.
4. Full ball-in-air receiver takeover (Assist mode stays: the automatic catch type is chosen from the situation).
5. Officials beyond the referee plus two wing officials.
6. Kit designer custom mode (the presets stay).
7. The 3D hero render on the share card (fall back to the best highlight's framed screenshot).
8. Sideline cast density.

**Not negotiable:** position-specific technique animation (drops, route breaks, kick-slide, pass-rush moves, backpedal and hip flip, form tackles), the broadcast camera look, the lighting and atmosphere, player materials and silhouettes, core technique animations, Beasts AI quality, controls feel, determinism of the Daily.

---

## 17. Ratings (design summary)

The full spec is the brief's Player ratings section, which I'll follow. The TECH_PLAN §7 covers implementation. Design points that affect the player:

- **One 0–99 scale.** 99 = the best the position has ever produced at that skill; 90+ All-Pro; 80s Pro Bowl; 70s solid starter; 60s role player; under 50 a liability. Physical attributes are absolute.
- **What the player sees:**
  - **Classic draft cards:** OVR + 4–6 position-key attributes + traits.
  - **The Scouting tab:** where every number came from.
  - **Film Room:** names and trait names only.
- **Traits and their effects** (each maps to a documented modifier in `attributeEffects`):

| Trait | Gameplay effect |
|---|---|
| Deep Threat | Extra top-end burst after 12+ yards on vertical routes; bonus on over-the-shoulder catches |
| Route Technician | Sharper breaks: a larger separation window at the break vs man |
| Possession | Fewer drops on short and intermediate routes; secure catches on contact |
| Contested Catch | Wins more 50/50 balls against tight coverage |
| YAC Monster | Less speed loss on the catch transition; first-contact break-tackle bonus after the catch |
| Elusive | Higher ceiling on juke and spin success; less speed lost on cuts |
| Bruiser | Truck and break-tackle bonus; head-on arm tackles fail more |
| Workhorse | Lower stamina drain; no late-drive fatigue penalty |
| Receiving Back | Sharper routes from the backfield; better hands on swings and wheels |
| Pocket Passer | Smaller accuracy penalty from pressure when his feet are set; better automatic step-ups |
| Gunslinger | Higher bullet velocity, tighter-window throws; slightly larger misses when off-platform |
| Scrambler | Smaller throw-on-the-run penalty; faster transition from pocket to scramble |
| Field General | Pre-snap coverage hint (shell shown for longer); an extra audible slot; faster hot-route reads |
| Speed Rusher | Faster time-to-win around the edge against finesse blocking |
| Power Rusher | Bull rush pushes the pocket back and shrinks the step-up lane |
| Interior Wrecker | Interior pressure appears earlier and collapses the step-up lane |
| Ballhawk | Reads throws earlier, jumps routes, higher INT chance on underthrows |
| Shutdown Corner | Shadows your best receiver; tighter trail and recovery speed |
| Enforcer | Big-hit chance up; forces drops and fumbles on crossers |
| Run Stuffer | Sheds run blocks faster; fills gaps more reliably |
| Sideline to Sideline | Better pursuit angles and speed; closes cutback lanes |
| Coverage Linebacker | Deeper zone drops; better man coverage on TEs and RBs |

---

## 18. Balance targets (from the brief, restated as tests)
- At Pro, an average human who drafts well wins about 50%.
- A perfect draft (the new-OVR `computePerfectTeam`) played well is a clear favorite (~70%+).
- A weak draft needs great play to win (~25%).
- Legacy scoring calibration holds in Quick Sim and the adapter: average offense ~21 PPG, all-time ~36, poor ~14 (per 10 drives).
- **Sensitivity:** a 10-point gap in any attribute produces a measurable difference in the harness (catch rate, separation, sack time, yards after contact). Otherwise the mapping gets fixed or the attribute is cut.
- **Skill beats ratings:** the harness runs a "strong player" bot and a "weak player" bot across drafts. A strong bot with a mediocre draft must beat a weak bot with an elite draft more often than not.
