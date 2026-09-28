# M6.6 controls, prompts, kits, audio, camera and heads

Branch `m66-controls-kits` (from `claude/m65-gameplay`). Items from `docs/PLAYTEST-1.md` (controller prompts, late carrier prompts, kits, ocean ambience, head size) and `docs/PLAYTEST-2.md` (the breakaway camera, and the controller tap-to-throw). Stills are in `docs/screenshots/m6.6/`; the spec that makes them is `tools/shots/m66.spec.ts` (`BTB_M66=1`, `BTB_M66_CASE=pad|run|breakaway|lab|lineup`). They were rendered by software GL at 1280×720, where the game's fluid root font is 10.7 px, so every piece of UI is at two-thirds of its 1080p size.

## 0. A tap to throw on a controller (Playtest 2)

**Cause.** `Controls.sample()` let a receiver hold go on the first tick the button read up, whether or not the sim had counted it. The sim ignores the receiver buttons for the first 0.35 s after the snap (the ball is still coming back) and while a throw winds up (`qbThrow` in `src/sim/play.ts`). A gamepad's buttons are polled once a frame, so a pad tap is one to three ticks long, and a tap on the drop fell entirely inside that window: one tick of hold the sim ignored, then a release with nothing held. Nothing thrown. A keyboard tap usually runs longer, which is why the owner saw it on the controller.

**Fix** (`src/game/controls.ts` `holdStep`, the same idea as the kick, which times its press and release from the input events): the hold carries the button's own press and release times, and it is kept held for the sim until the sim has counted it (`PlayState.hold`, passed back to `sample()` read-only). A tap always throws, as soon as he can. If the frames dropped ticks (a long frame), the hold runs on up to 6 ticks after release to match the time the button was really down, so a tap stays a tap and a hold keeps its touch. The pad is also polled between frames (every 8 ms) so a very short press isn't missed during a long frame.

**Test** (`tests/controls-throw.test.ts`): a pad A press and release between two ticks, six ticks after the snap, through the real sim. Before: never thrown. Now: the windup starts at 0.35 s.

## 1. Controller prompts

With a pad in use, every prompt draws the pad's button as a glyph: in-house inline SVG (`src/ui/components/Glyph.tsx`): the face buttons as discs in the Xbox colours with their letter, bumpers and triggers in their shapes, the sticks with the direction arrow, the D-pad with the pressed arm lit, View and Menu. Keys stay keycaps. The mapping is pure and tested (`src/input/prompts.ts`, `tests/ui/prompts.test.ts`), and it follows rebinding.

Where it now applies: pre-snap (snap, receivers, routes, hot route), the receiver icons on the field, the pocket row (move, throw, aim, pump, throw away, scramble), the catch call, the carrier's three options and the run row, the hot-route picker, the first-play tutorial, the play art's read marks (a small button glyph under each receiver instead of his number, and the note under the art says "button"), the tab keys beside every tab row (LB and RB instead of Q and E), every `Hints` bar and `KeyCap` (menus, pause, the draft, results, history, settings), How to Play (the glyphs, and the wording: "the face buttons do the work", the receiver's button, the left stick to place the ball, the right-stick moves), the title ("Press any button"), and the Settings pad column and its rebinding help. A hint that has no pad input is left off on a pad rather than show a dash. The draft and results screens weren't edited: their written pad hints ("A", "LB RB", "Hold A") parse to glyphs through `KeyCap`, and a test checks that every pad hint written in `src/ui` parses.

The play call's timeout, spike and kneel had no pad input at all ("—"). They are now Y, X and LT on a pad (keyboard T, K, J unchanged), through a new pad-only `menu.alt3`.

**Why the owner still saw numbers with a controller.** The prompt device followed the last input, and any mouse movement at all switched it to the mouse (keyboard prompts): a nudge of the desk, the cursor settling, or a window regaining focus. Moving with the stick didn't count as using the pad either, only a button press did. Now the mouse has to travel 48 px before it takes the prompts off the pad, and the stick pushed past half-way counts as the pad. `?pad` holds the prompts on the pad (screenshots and dev).

How to Play also couldn't be scrolled with a pad (it listened for arrow keys only); it now scrolls on the D-pad and stick.

**Critique of the stills.**
- `pad-call.jpg`: the tab row reads LB … RB, the play art has A, B, X, Y and RB under the five receivers in their colours, and the hints bar is all glyphs. It reads like a console game's play call. The glyph marks in the art are small at 720p (about 12 px) but clear.
- `pad-presnap.jpg`: A SNAP, the receiver row, RT routes, Y hot route; the receiver icons carry their buttons inside the position-coloured rings. The row's glyphs were too small in these stills (the RT trigger is barely legible at 720p); they are 2.1 em now (was 1.75), and I haven't re-captured those frames.
- `pad-pocket.jpg`: the pocket row is complete, but it is long (eight prompts); on a pad it might drop Aim once the player knows it. A covered man's icon is desaturated by design, so his button's colour fades with it; the letter still reads.
- `pad-catchcall.jpg`: Y GO UP, A SECURE, X RUN with the called one lit. The order is by the call, not the pad's diamond; that's fine because the letters are there, but a diamond layout would be more natural on a pad (not done).
- `pad-carrier-catch.jpg` and `pad-carrier-0.2s.jpg`: see item 2.

## 2. Carrier move prompts show up late

**Measured** (`tools/sim/optsdelay.ts`): the sim sets the three options (`c.mem.opts`) the first time `carrierStep` runs him. After a catch that is the next tick (17 ms). On a designed run it is not until the back has finished pressing the aiming point, because `offenseRoles` steers him itself and skips `carrierStep` until then: 350 ms on zone and the draw, 550 to 750 ms on power, iso, the dive and the counter, 1.2 s on the toss. For that long the HUD showed the three buttons with no words. That is the "late" the owner saw.

**Render fix** (`src/render/game/GameScene.tsx` `placeHud`): until the sim holds a set, the HUD calls the same pure ranking the sim uses (`carrierOptions(s, c)`, read-only) and shows it at once, dimmed (`data-pending`); it lights fully once the sim holds the set and a press will make the move. The words are written every frame, so any change the sim makes shows on the next frame. At the catch (`pad-carrier-catch.jpg`, the catch tick, sim options still unset) the three options are already up under him; 0.2 s later (`pad-carrier-0.2s.jpg`) they are the sim's, with Juke lit as he makes it. The glyphs in the option chips are small at 720p (the chips are 1.55 rem, the glyph 1.4 em); readable, but they should be the first thing checked at 1080p. `run-handoff.jpg` (keyboard, two ticks after the handoff, sim options not yet set) shows 1 JUKE, 2 DIVE, 3 PROTECT dimmed under the back; `run-live.jpg` (0.3 s later, the sim's set) shows the same three at full strength.

**Sim changes needed** (not made here; `src/sim` belongs to another session):
1. Set `c.mem.opts = carrierOptions(s, c).join(',')` at the moment a user's carrier gets the ball: the handoff and the toss in `qbBeforeThrow`, the sneak, the catch in the ball step, a scramble crossing the line, a recovery. Today it waits for the first `carrierStep`.
2. During the designed run's press (the branch in `offenseRoles` that steers the back to the aiming point), keep the options current and honour an option press (buffer it with `bufferedMove` as `carrierStep` does), or end the press on any option or move press. Today a 1/2/3 (X/Y/B) pressed while he presses the hole does nothing.
3. The 12-tick re-read (`OPTIONS_EVERY`, 200 ms) can lag the picture by up to 0.2 s. Re-read every tick, but only change the held set when the new top option has been the top for 3 ticks, or when the threat (`threatOf`) changes identity. That keeps the prompts steady enough to read and makes them follow a new tackler within 50 ms.

## 3. Kits (Decision 5)

- **The Contenders' default is White Lime** (`src/render/players/kits.ts`): white helmet, jersey and pants, lime `#9ee600` trim, stripe and number keyline, black numbers, matte black facemask, black socks and cleats. It's the default in a game and on the Practice Field (which was Royal, navy). Blackout Lime stays a preset.
- **The Beasts** keep black and crimson, unchanged.
- **Never two dark kits:** `kitAgainst(kit, opponent)` changes a dark Contenders kit (jersey luminance under 0.18: black, charcoal, navy, oxblood) to White Lime against a dark opponent, and the game scene dresses the offense through it. Light presets (Arctic, Heritage) are kept as picked. Tested in `tests/kits.test.ts`, with the number contrast on white (WCAG ratio over 12:1).
- There is no kit designer UI yet (GDD §12.5 lists it; it isn't built). When it lands, it should call `kitAgainst` too.

**Critique.** `pad-presnap.jpg`, `lineup-heads.jpg` and `lab-heads.jpg`: the two teams now separate at a glance from the broadcast camera, which was the playtest's complaint. Black numbers with the lime keyline are crisp on the chest and back at the lab's distance and readable from the broadcast camera. Under the golden-hour grade the white reads warm cream on the field, which is right for that light. Close up (the Animation Lab at arm's length) the jersey's mesh texture shows as a field of small dark dots on white; on black it never showed. At broadcast distance it disappears, but a close replay camera (M7) will see it; the mesh pattern's contrast should scale with the jersey's brightness. The black socks under white pants are a deliberate classic look; if the owner wants all-white, it's one line.

Not changed (other sessions own them): the kicker in the kick panel (`src/render/game/KickBall.tsx`) and the locker-room hologram (`src/render/locker/hologram.ts`) still dress in Blackout Lime; both should use `CONTENDERS_DEFAULT_KIT`.

## 4. Ocean ambience

**Cause.** The surf was low-passed noise at 0.22 gain swelling by ±0.14 (up to 0.36) on the SFX bus: in the menus, where nothing else plays, it was the loudest thing, and the only way to turn it down was the SFX slider, while the Crowd slider's description said it covered "ambience".

**Fix** (`src/audio/audio.ts`): the surf and wind now sit on their own Ambience bus with a slider (Settings, Audio, Ambience, default 60%), at 0.1 and 0.025 with a gentler swell. At the default volumes that is 12 dB down (0.036 against 0.14 before). The crowd murmur stays on Crowd, and the Crowd slider now says "The stadium crowd". Not verified by ear here (no audio in this environment); the owner should listen to the menu bed at the default and at 100%.

## 5. Breakaway camera (Playtest 2)

**Before.** The broadcast camera cut to a sideline pose (24 yd off him, square to his run, 40° fov) the frame he crossed 18 yd past the line at 6.5 yd/s: a 90° swing, driven only by the camera springs. It swung back the moment he slowed for a cut or the whistle blew, and it changed sides if he crossed the middle.

**Now** (`src/render/game/GameCamera.tsx`): a breakaway blend eases in over about 1.1 s through a smoothstep once he's 15 yd past the line at 6.3 yd/s, and out over 0.9 s only when he slows below 4.6 yd/s; it holds through the whistle, picks its side once, and ends at a higher, wider three-quarter angle: 40° off his run from the side he's farther from, about 25 yd from him and 11 m up, 46° fov, looking further ahead of him. The normal carrier follow is a little closer: 11 yd back and 6 m up (was 13 and 6.8), 50° fov (was 52).

**Critique** (`breakaway-sheet.jpg`: the broken-tackle clip, the one scripted clip with a long breakaway (`tools/sim/findbreak.ts`), a frame every 0.6 s from just before the catch; `breakaway-1.jpg` and `breakaway-4.jpg` full size). The first two frames are the catch push-in and the closer carrier follow. From there the camera rises and steps out to the side over about a second and a half; between frames there's no jump and no swing across the field, and it never comes back when he slows or at the whistle. The end frame shows the whole chase: the carrier, the pursuit angles, the open field and the goal posts ahead of him, which is the breakaway's story. Honestly, it's wider than it needs to be: at 720p the carrier is about 25 px tall at the end, and the three option prompts under him are larger than he is. I'd tighten the end pose by about a fifth (15 yd back, 12 to the side, 9 m up) after the owner has watched it move; the stills can't judge the ease itself, and I haven't recorded video here (software GL takes seconds a frame, and the cores are shared).

## 6. Player heads

**Measured** on the built player (`tools/reports/head-size.mjs`, reading `public/assets/characters/player.glb`): the base body stands 1.914 m to the helmet's crown with a 0.260 m head (crown to the facemask's chin): **7.37 heads**, inside the 7 to 7.5 of a real player in pads and helmet, but at the small-head end. Two things make it read smaller:

- The whole body scaled with stature, helmet included, so a 5'9" corner's helmet was 7% smaller than a 6'2" receiver's. Real adult helmets vary a few percent.
- The heavy and pads shapes spread a lineman's shoulders to 0.74 m across the pads (2.9 helmet widths; a skill player's are 0.53 m, 2.1), where a real lineman is nearer 2.5. Next to those shoulders any helmet looks small.

**Fix** (a scale parameter, no Blender rebuild; Blender isn't installed here anyway): the head bone's scale (the helmet, facemask and visor ride on it; the clips key no bone scale). `headScale()` in `src/render/players/bodyShape.ts`: 1.06 at the base body, and the head grows with only the square root of stature. Now **7.00 heads** at 6'2", 6.79 for a 5'9" back, 7.13 for a 6'5" tackle; helmets are 0.265 to 0.28 m tall across the roster. I tried 1.05 first: side by side at field level it was hard to see. `?oldheads` shows the old size for A/B checks.

**Critique** (`heads-ab.jpg`: top old, bottom new, every body type front on, 2× crop). The short back (#2) and the receivers gain the most and look like football players in helmets now rather than pinheads. On the linemen (#75, #90) the helmet is still small against the pad shoulders: that's the pads, not the head. Pulling the linemen's shoulders in (the `pads` morph is 1.0 on every lineman plus a 1.2 cm per side skeleton widening in `variety.ts`) would finish the job, but it changes the linemen's silhouette, which is their identity on the field, so I've left it for the owner to call. A bigger head than 1.06 would push the base body under 7 heads.

## Tests added

- `tests/controls-throw.test.ts`: the tap latch, and a pad tap in the drop through the real sim.
- `tests/ui/prompts.test.ts`: every prompted action draws as a pad glyph on a pad and never a number; the number row on a keyboard; rebinding; glyph shapes; hint parsing; every written pad hint in `src/ui` parses.
- `tests/kits.test.ts`: the default, the black preset kept, number contrast, the clash guard.
- `tests/head-size.test.ts`: heads-tall at the base, helmet size across statures.

## Left to do

- The sim changes in item 2.
- Box score and last-game tab keys (`src/ui/results/GameReport.tsx`) still print Q and E; that screen belongs to the box-score session. `TabKey` from `src/ui/components/Glyph.tsx` is the drop-in.
- The kicker and the locker hologram kits (item 3).
- Linemen's pad width (item 6), the jersey mesh on white (item 3).
- A pad layout for the catch call (the diamond) is a nice-to-have.
- Listen to the ambience bed (item 4).
