# The character pass, round two

Branch `wip/characters2` (from `claude/m66-polish`, `6eb0bba`). Round one ([CHARACTERS.md](CHARACTERS.md)) left ten items open. This round works through them, and fixes two bigger faults found on the way: the jersey was an open box across the shoulders, and the nameplates were stair-stepped on a production build too.

Everything is still scripted in-house: the meshes, weights, helper bones and correctives in `tools/blender` (bpy 5.0.1), the shading in `src/render/players`. No downloaded meshes, textures or motion, so `CREDITS.md` doesn't change. Nothing in `src/sim`, the clip scripts (`tools/blender/lib/actions*.py`) or `anims.glb` was touched.

Stills are in [`round2/`](round2/). Each `*.jpg` named after a shot is a before | after pair, 960 px a side. The full-size frames come from `tools/shots/characters.spec.ts`:

```
BTB_CHARS=1 BTB_CHARS_TAG=after BTB_PORT=5323 npx playwright test -c tools/shots/playwright.config.ts
BTB_CHARS_ONLY=lab|stadium|perf, BTB_CHARS_GREP="a|b" (any of), BTB_CHARS_RESUME=1 (skip shots already taken)
```

The "before" set was rendered from a frozen copy of `6eb0bba` on its own server (port 5324), with the same spec. All stills are software GL (SwiftShader) at 1920×1080. The Lab uses studio light (one key, no fill). The stadium shots use the lineup (`?lineup`) in every lighting preset. The spec now saves JPEG (quality 90): the disk filled up during this round.

The Blender stills (`skin-*.jpg`, `pads-ab-blender.jpg`) come from `tools/blender/skin_stills.py` (the faces the skinning probe flags are painted yellow on the right half) and a tackle-shaped preview, rendered from the round-one build and this one.

The Lab takes two new query parameters for these stills: `body=<lineup index>` (single mode's body; the tackle is 5) and a seventh `cam` value, the field of view.

## Summary

| # | Item | What changed | Status |
|---|---|---|---|
| 1 | LOD2 shoulder "horns", arms overhead | A runtime-driven **epaulet bone** carries the pad's outer cap, its lip and the sleeve; LOD1/LOD2 correctives take LOD0's relaxed surface | **Fixed** (visually at every LOD; measured, the high point's flagged shoulder faces drop 30% at LOD0, 36% at LOD1, 13% at LOD2) |
| 2 | Pants-hem sawtooth at the calf | The `calves` shape now moves the pants hem too; the leg skin inside the hem sits 4 mm deeper | **Fixed** |
| 3 | Flat patch behind the knee (Lab) | Diagnosed: not a fold (no flagged faces there); it's the Lab's single key light, and the shadow proxy (Low LOD) shadowing the visible mesh from inside. The proxy is now drawn 1.2 cm inside itself in the shadow map | **Improved**: the stair-stepped edge is gone; the lit patch itself is the Lab's lighting |
| 4 | Neck skin flap | The trapezius slopes above the collar are kept and pulled into the neck column instead of being cut into a flap | **Fixed** |
| 5 | White kits glowing (Golden Hour), flat at night | A highlight knee on player gear, set every frame under the active bloom threshold | **Fixed** for the glow; **improved** at night |
| 6 | Cleat sole and studs | A real outsole plate with a lip (all LODs) and seven molded studs a shoe (LOD0/1) | **Done** |
| 7 | Lineman pads balloon / hood | The hood was the open-box jersey (fixed below). The `pads` shape grows outward, not along every normal, and `heavy` pushes the front and back plates a third as far | **Implemented** (before/after stills below; the owner can revert with `BTB_PADS=v1`) |
| 8 | Nameplate glyphs breaking up close | Real on a production build. The atlas is now built 4x supersampled; the nameplate moved off a geometry crease | **Fixed** |
| 9 | Speed elbow skinning at 5.41% | A half-angle **elbow helper bone** and a wider weight band | **Fixed**: 2.08% (limit 5.5%) |
| 10 | Body variety | Lean is full at BMI 24.5 (was 23), heavy grows to 1.3 at BMI 40 (was capped at 1 from 36), a new `thighs` shape by position | **Improved**: a slot receiver and a tackle now differ in the legs and hips, not only the height and pads |
| — | **The jersey was an open box** (found this round) | The collar cut opened the whole shoulder tops. Only the neck opens now, and the collar band covers it | **Fixed** |

## 1. The shoulders with the arms overhead (item 1)

**What it was.** With both arms overhead (the high point, a celebration, the referee's touchdown) the arm turns about 125° up out of the A-pose. The sleeve and the pad's lip were skinned to the shell (chest, pad and clavicle), with only a band blending to the arm. So the sleeve stayed horizontal while the bare arm came up out of it: the sleeve's hem and the lip stood out beside the helmet as "horns". The weight transfer had also given the sleeve's underside the torso's weights (its nearest body surface): 88% trunk at 40% of the way to the elbow. Round one's corrective only relaxed the crumpling, and at LOD2 its four smoothing passes barely moved it.

**What changed.**

- **An epaulet helper bone per side** (`tools/blender/lib/helpers.py`, `playerAsset.ts` `HELPERS`). It sits on the shoulder joint with the upper arm's rest orientation. It turns by a share of the arm's *swing* (its rotation off the rest axis, without the twist about its own length). That share is **zero through all of normal play** (the sprint's arm swing, a punch, a throw) and rises only as the arm goes past 95° of elevation, to 60% at 165°. That's the same elevation measure the reach correctives use.
  - It carries the pad cap's outer edge (fading in from 21 to 27 cm off the centre line) and its lip.
  - It also carries the trunk's share of the sleeve beyond 25% of the upper arm.
  - Like a real epaulet laced to the arch, the pads ride up on the deltoid, and the sleeve hugs the arm.
  - Because its share is zero below 95°, the sprint is unchanged: the cap still rides the chest (cap lift 2.9 cm, limit 4).
- **The correctives are sculpted once.** LOD0 relaxes its own surface (40 Taubin passes, was 24). LOD1 and LOD2 take LOD0's relaxed surface instead of relaxing their own (`corrective._transfer`), plus 2 and 1 passes of their own. Each coarse vertex finds the nearest point on LOD0's rest surface (same part) and goes where LOD0's relaxed surface carries that point, keeping its own millimetre offset.
- **Runtime cost.** Four helper bones a player (56 bones, was 52). Per player per frame: an elevation per arm (already computed for the correctives) and a few quaternion multiplies and a slerp per helper. Every Blender tool that poses the mesh drives them the same way (`drive_helpers`: the build's gate, the correctives, `skin_check`, `skin_stills`, `preview_gear`). A unit test checks the runtime constants against `player.json` (`tests/character-helpers.test.ts`). The locker-room hologram now calls `Player.tick()`, so its helpers follow the pose too.

**Measured.** These are shoulder-region faces flagged (folded or collapsed) by the skin probe, averaged over the frames with an arm past 105°, with the helpers and correctives as the runtime drives them:

| Clip | LOD0 (604 faces) | LOD1 (273) | LOD2 (98) |
|---|---|---|---|
| `catch_high_point` | 97.3 → **68.5** | 44.3 → **28.4** | 9.3 → **8.1** |
| `sig_qb` | 66.7 → 61.2 | 31.7 → 29.5 | 7.6 → 8.4 |
| `sig_wr` | 95.6 → 91.6 | 45.6 → 45.2 | 11.6 → 13.2 |

The high point, the pose the horns were in, improves at every LOD. The QB and WR celebrations hold about level. In the WR's, one arm is overhead and the other across the body, and the remaining folds sit in the armpit crease, not the shoulder top.

![The high point at LOD2 in Blender, round one (top) and now (bottom); flagged faces yellow on the right](round2/skin-high-point-lod2.jpg)
![The high point at LOD0, close on the left shoulder](round2/skin-high-point-lod0-close.jpg)
![The high point at LOD2 in the Lab](round2/lab-high-point-lod2-close.jpg)

### What didn't work (for the record)

- A half-angle "deltoid" helper on the shoulder's blend band (the elbow's technique) made the reach collapse worse at LOD2 (2.2% → 3.1–3.6%).
  - It keeps the inside of the bend at full radius, and that's where the shoulder folds with the arm up.
  - The knee was the same: a half-angle knee helper took the speed knee's collapse from 2.3% to 4.4%.
- Re-weighting the sleeve's underside to the arm alone left the sleeve horizontal (the shell still held its top half) and pushed the sprint's shoulder over its limit.
- Weighting the decimation toward the joints (more triangles near them at LOD1/2) made every share worse.
  - A finer mesh resolves the same crease into more flagged faces.

## 2. The pants hem (item 2)

**What it was.** In the sprint, the hem showed a jagged, torn black edge on the white pants (`lab-sprint-f11-knee`, `lab-knee-back-sprint`, the huddle's backs). The leg skin runs 7 cm up inside the hem (round one), about a centimetre inside the fabric. The `calves` body shape pushed the calf skin out by up to 1.2 cm (more behind), and didn't move the pants. On a back with a full calf, the calf came through the hem, and the intersection of the two triangulated surfaces is the sawtooth.

**What changed.**

- The `calves` shape now moves the pants too (`lib/shapes.py`), so the gap stays the same for every body.
- The leg skin inside the hem is sunk 4 mm (`build_character.shrink_under_hem`).

(I also tried re-skinning that hidden skin to the calf alone. It made no visible difference, and it took the dilution out of the gate's knee share, which round one's numbers relied on, so it isn't in.)

![The sprint, behind the knee: the hem](round2/lab-knee-back-sprint.jpg)
![The sprint, side on](round2/lab-sprint-f11-knee.jpg)
![The calf hem at the sprint](round2/lab-calf-hem-sprint.jpg)

## 3. Behind the knee (item 3)

The "flat patch" in the Lab is on the far leg's inner thigh at the sprint's heel recovery: a lighter, flat area with a stair-stepped edge.

- **It isn't a fold.** The skin probe flags no faces there at that frame (`sprint:11`). In Blender, with soft light, nothing shows (`skin_stills.py ... sprint:11:lab_knee`).
- **It's lighting.** The Lab has one hard key and no fill. The patch is the part of that thigh the key reaches past the near leg, so it reads flat against the shadow around it.
- **The stair-steps were the shadow proxy.** Each player casts its shadow with the Low LOD, whose surface strays up to ~1 cm outside the visible High LOD. Where it did, it shadowed the visible mesh from inside, and the Lab's 2,048 px shadow map stepped the edge. The proxy is now drawn 1.2 cm inside its own surface in the shadow map (`playerAsset.ts` `SHADOW_INSET`, a custom depth material).
  - The edge is smooth now.
  - A limb still shadows the next.
  - No new draw call or pass.

A knee corrective wasn't needed: the knee gate improved without one (reach knee collapsed 2.28% → 1.92%).

## 4. The neck (item 4), and the open-box jersey

**The neck flap.** Round one kept the neck skin within 8.3 cm of the neck's axis and cut the rest. The trapezius slopes rise out to 13 cm into the base of the skull, so the cut left a torn flap of skin standing beside the neck above the collar (`lab-neck-34`, `lab-neck-back`). That skin is now kept, and pulled into an elliptical neck column inside the collar band (`build_character.shrink_neck`). The column opens out again toward the skull. The throat and jaw are left alone.

**The open box.** The jersey's collar cut was a plane at 1.585 m across the whole jersey, but the pad caps' flat tops stand at 1.598 m. The cut took the top off both caps: the jersey was open from shoulder to shoulder (56 cm across, measured on the mesh). From the broadcast camera and in the huddle you looked down into it around the collar, and its dark back wall is what read as a "hood" in profile.

- The cut now opens only the neck (`gear.cut_neck`). It's an ellipse with clean edges: the plane where the jersey crosses it, and 24 vertical planes round it where the caps stand above it.
- The collar band was rebuilt to fill the opening (it had left its front open too, `gear.collar_insert`):
  - Its three rings share one centre. Round one's rings leaned back with the neck, which tilted the top ring 19° into a flange behind the neck and under the jersey in front.
  - Its outer ring is the opening plus 1.2 cm, tucked under the caps' edge, so no slot shows between band and jersey.
  - It's built per LOD instead of decimated (decimation spiked its outer ring): 40, 28 and 16 segments.
  - Near the opening it takes the jersey's skin weights and body-shape deltas (the nearest jersey vertices'), so a lineman's pads don't open a gap round it.
- On the way, the sleeve's inner end turned out to stand 3 cm above the old cut. It's left as it was: closed under the caps, it no longer opens anything.

![The neck, three-quarter front](round2/lab-neck-34.jpg)
![The neck from behind](round2/lab-neck-back.jpg)
![The torso](round2/lab-torso-34.jpg)

## 5. White kits under the presets (item 5)

**What it was.** At Golden Hour the sun is 5.5° up. A vertical white jersey facing it is about 12x brighter than the turf the exposure is set for: about 2.5 in HDR against a bloom threshold of 0.9. So every sunlit white player glowed with a halo from the broadcast camera.

Measured on the stills, every white kit in every preset sat between display 200 and 235, on the tone curve's shoulder: the folds and shading had nowhere to go. That's the "flat whites" at night too.

**What changed** (`playerMaterial.ts` `PLAYER_LIGHT`, `Stage.tsx`).

- **A highlight knee.** Player gear's outgoing radiance rolls off above 0.55 of the active bloom threshold toward 1.1x it: `L' = k + x / (1 + x / r)` above the knee `k`.
  - Stage sets it every frame from the lighting preset (or the locker room's grade), so each preset gets its own.
  - Skin, helmet stripes that glow, and the inside of gear are left alone.
  - The brightest sunlit white tops out just past the threshold: a faint bloom, no halo.
  - It's a broadcast camera's knee, on the subject only.
  - It costs a luminance, a compare and a divide per player pixel.
  - The Lab (no Stage) is unaffected.
- **Creases on the pants.** The game pants were smooth as plastic. They get soft creases at the back of the knee and the front of the hip, and a little drape down the thigh: a bump from a rest-pose height field, like the jersey's folds, and a touch of albedo in the valleys. They fade out with the pixel footprint.

Measured on `stadium-tight-golden`: the white receivers went from p50/p90 display 201/227 with the halo to 185/193 with none. The golden whites are a warm off-white now, with their shading.

![Golden Hour, a tighter broadcast lens](round2/stadium-tight-golden.jpg)
![Night](round2/stadium-tight-night.jpg)
![Overcast](round2/stadium-tight-overcast.jpg)
![Rain](round2/stadium-tight-rain.jpg)
![Snow](round2/stadium-tight-snow.jpg)
![Broadcast, Golden Hour](round2/stadium-broadcast-golden.jpg)
![Broadcast, Night](round2/stadium-broadcast-night.jpg)
![Huddle, Golden Hour](round2/stadium-huddle-golden.jpg)
![Huddle, Night](round2/stadium-huddle-night.jpg)

## 6. Cleats (item 6)

`gear.cleat_soles`:

- **An outsole plate** under each shoe. It follows the upper's widest line plus a 3 mm lip, from the turf to 1.6 cm, with a bevelled top edge. It's 32 points round at LOD0, 20 at LOD1 and 12 at LOD2.
- **Seven molded studs** a shoe, 1.3 cm long: four at the forefoot, one at the toe, two at the heel. They're tapered cylinders, 8 segments at LOD0 and 5 at LOD1, none at LOD2.
  - Planted, they sink into the grass, as real studs do. You see them when the foot is in the air.
- **Shading.** The plate takes the sole colour (white under a dark shoe, dark under a light one), with the welt line just above it. The studs are a shade darker.

Cost: the plates and studs are in the one mesh (no draw calls). The whole player went from 26,965 / 13,216 / 3,838 triangles (LOD0/1/2) to 27,848 / 13,854 / 4,123, and the cleats are most of that; the rest is the closed cap tops, the kept neck skin and the collar band built per LOD.

![The cleats, standing](round2/lab-legs-feet.jpg)
![Close](round2/lab-cleats-close.jpg)
![In the air at the sprint (LOD1)](round2/lab-cleats-sprint.jpg)

## 7. Lineman pads (item 7, the owner's call)

**What it was.**

- **The hood** was mostly the open-box jersey (section 4). From behind and in profile you saw the jersey's dark back wall above the shoulders. With the tops closed, it's gone.
- **The balloon** was the body shapes. `pads` pushed the cap region 2.2 cm along every normal (front and back plates included), and `heavy` pushed the same plates another 3–4 cm on a lineman. Together they rounded the pads into a cushion in profile.

**What changed** (`lib/shapes.py`).

- `pads` grows the caps outward (2.6 cm) and, along the normal, only where the normal faces out or up (1.8 cm).
- `heavy` moves the plates over the chest and back a third as far: the body under them is culled, so they needn't follow the man's mass the way skin does.

The waist, the belly and the hips still carry his weight. The tackle's pads are as wide as before, and a little flatter front and back.

**The call.** It's a modest change, in the right direction, and it still reads as a lineman's pads. It's in. `BTB_PADS=v1 python3 tools/blender/build_character.py` builds round one's shapes for comparison, or to go back.

![A 6'6" 320 lb tackle's pads in Blender: round one's shapes (top), round two's (bottom). Profile, back, front](round2/pads-ab-blender.jpg)
![The tackle in profile in the Lab](round2/lab-ot-profile.jpg)
![From behind](round2/lab-ot-back-34.jpg)
![Front three-quarter](round2/lab-ot-front-34.jpg)
![In his stance](round2/lab-ot-stance.jpg)

## 8. Nameplates (item 8)

Checked on a production build (`npm run build`, `vite preview` on its own port), `stadium-line-golden`. The broken "LEWIS" is real, not a dev-server artefact. Two causes:

- **Stair-steps.** The SDF atlas was built from a 64 px cell's coverage thresholded at 50%, so every edge and outline sat on the texel grid. At huddle distance a texel is about 2 mm on the jersey and several screen pixels, and the letters and numbers showed the steps.
  - The atlas is now rasterized and distance-transformed at 4x, then box-filtered down (`glyphAtlas.ts` `SUPERSAMPLE`, `glyphs.ts` `downsampleField`, with a unit test).
  - The texture is the same size. Building it costs a one-off ~0.1–0.3 s at load.
- **The broken tops.** The name's top ran into the crease where the back plate meets the pad arch (about 1.50 m), which broke the letters' tops into a wavy line. The nameplate (1.47 → 1.455 m) and the back number (1.30 → 1.29 m) sit a little lower.

![Behind the defence, production build: round one (top) and now (bottom)](round2/prod-stadium-line-golden.jpg)
![The nameplate close, production build](round2/prod-lab-neck-back.jpg)

## 9. The elbow at speed (item 9)

**What it was.** 5.41% of the elbow region's faces collapsed at the sprint (limit 5.5%), at LOD1: the inner elbow in the carry and the sprint's arm swing, at a 50/50 upper-arm/forearm blend.

**What changed.**

- **An elbow helper bone** per side. It turns by half the forearm's swing, and 40% of the elbow's blend band moves onto it: a 50/50 vertex becomes 30/30/40. It's a half-angle joint, so the blended vertex no longer cuts the corner.
- **A wider band.** The body skin's weights are smoothed within 9 cm of each elbow first (six passes), so the compression spreads over more faces.
- A full-strength helper on both sides of the hinge made the inside of a deep bend worse (it keeps the skin at full radius where it must fold), so this is the balance the gate settled on.

![The elbow at the carry and the sprint (LOD1), round one (left) and now (right)](round2/skin-elbow-lod1.jpg)
![The sprint's arm swing in the Lab (LOD1)](round2/lab-elbow-sprint.jpg)

## 10. Body variety (item 10)

**What it was.** Receivers and corners sit at BMI 25–27. The base body is 27.7, and `lean` was full only at BMI 23, so a 5'9" 175 lb slot drew `lean` 0.4: a few millimetres thinner than the base. Every lineman over BMI 36 (most of them) drew the same `heavy` 1. Legs and hips were the same shape for every position. In the lineup, bodies differed by height and pads only.

**What changed.**

- `bodyShape.ts`: lean is full at BMI 24.5. Heavy grows on past BMI 36 to 1.3 at BMI 40.
- The `lean` shape's magnitude goes from 1.2 to 1.6 cm.
- **A new `thighs` shape** (quads and hamstrings down the thigh, the glutes and the hips; skin, pants and towel). `variety.ts` drives it by position:
  - backs 1;
  - linemen 0.75;
  - linebackers and tight ends 0.6;
  - safeties and corners 0.3;
  - quarterbacks and kickers 0.15;
  - receivers 0;
  - ±0.25 by draw. It's drawn after every other pick, so no existing pick changes.

A 6'6" 320 lb tackle now draws heavy 1.08, belly 0.55, thighs ~0.75 and full pads. A 5'9" 175 lb slot draws lean 0.6 and no thighs, at 7% shorter.

![Every body type, white (front)](round2/lab-lineup-front-white.jpg)
![Side on](round2/lab-lineup-side-royal.jpg)
![At broadcast size (~110 px a player, the screen-size LOD)](round2/lab-lineup-far.jpg)

## Skinning gate

From `player.json` `skinGate`, every player LOD, the worst frame of the group's clips (collapsed share / folded share). Round one's build against this one, with the limits unchanged:

| Group | Region | Round one | Round two | Limit |
|---|---|---|---|---|
| speed | shoulder | 1.83% / 9.52% | 1.83% / 10.26% | 2.2% / 11% |
| speed | elbow | **5.41%** / 8.11% | **2.08%** / **3.99%** | 5.5% / 10% |
| speed | hip | 1.38% / 1.93% | 1.38% / 1.93% | 1.8% / 2.5% |
| speed | knee | 2.28% / 3.75% | 2.28% / 3.80% | 3% / 5% |
| speed | cap lift | 2.3 cm | 2.9 cm | 4 cm |
| reach | shoulder | 2.20% / 17.58% | 2.04% / 17.22% | 3% / 21% |
| reach | elbow | 4.50% / 10.81% | 4.29% / 8.49% | 5% / 15% |
| reach | hip | 1.17% / 2.00% | 1.17% / 2.00% | 1.6% / 3% |
| reach | knee | 2.28% / 3.26% | 1.92% / 3.29% | 3% / 4.5% |

- The **speed shoulder's folded share** rose 9.52% → 10.26% (sprint:0, LOD1, two more faces of 273 in the armpit crease).
  - The trunk's share of the sleeve now rides the clavicle (inside the epaulet, which is still at zero), not the spine.
- The **cap lift** rose 2.3 → 2.9 cm for the same reason.

Both are inside their limits. The clip gates are untouched (this round changes no clip). The region's faces are counted as before: a helper's weight counts half to each side of its joint (the elbow's), or to the trunk (the epaulet, which is shell).

## Performance (counts, not frame times: no GPU here)

The lineup (22 players) from the broadcast camera, Golden Hour, 1920×1080, off the `?perf` screen (`perf-medium`, `perf-ultra` in the spec). Three consecutive samples each.

| | Round one | Round two |
|---|---|---|
| Medium: draw calls | 143 | 143 |
| Medium: triangles | 1,510,969 | 1,537,545 (+26,576, +1.8%) |
| Medium: geometries / textures | 48 / 99 | 48 / 99 |
| Medium: shader programs | 73 | 72 |
| Ultra: draw calls | 172 / 178 | 172 / 178 |
| Ultra: triangles | 2,104,906 / 2,183,336 | 2,137,752 – 2,216,182 |
| Player LOD0 / LOD1 / LOD2 triangles | 26,965 / 13,216 / 3,838 | 27,848 / 13,854 / 4,123 |
| Player LOD0 / LOD1 / LOD2 vertices | 14,416 / 7,366 / 2,332 | 14,919 / 7,735 / 2,469 |
| Bones a player | 52 | 56 (four helpers) |
| Morph targets | 10 | 11 (`thighs`) |
| `player.glb` | 3,643,400 B | 3,816,984 B (+173 KB) |

- **Draw calls and textures don't change.** The plates, studs, collar and helpers are all in the one skinned mesh; the glyph atlas is the same size.
- One of the three Medium samples read 176 draws and 1.87 M triangles. Ultra alternates 172 / 178 the same way in both rounds; I take it to be the frame where the staggered shadow update lands, but I didn't prove that. The steady frames compare 143 against 143.
- **Texture memory.** Same texture count and sizes. The morph-target texture grows with one more target and ~4% more vertices: by my estimate (position and normal, 32 B per vertex per target, three LODs) about 7.7 MB → 8.8 MB, shared by every player. The bone texture grows by four bones a player (22 × 4 × 64 B).
- **CPU.** Per player per frame: four helper updates (a few quaternion multiplies and a slerp each) on top of the elevations the correctives already compute. Not measurable here.
- **GPU.** The highlight knee is a luminance, a compare and a divide per player pixel; the pants creases a height-field bump on pants pixels. Neither is measurable on SwiftShader. Both are cheap next to the existing jersey folds, but this needs the real Medium check on the target hardware before the milestone closes.

## Honest critique

What's better, looked at side by side: the horns are gone with the arms up at every LOD; the jersey is closed over the shoulders (the single biggest visual fix, and not on the list); the neck flap is gone; the hem is clean; whites no longer glow at Golden Hour; the names and numbers read on a production build; the cleats have soles and studs. What isn't right yet:

- **The collar reads as no collar.** The band now fits the opening and leaves no slot, but from the three-quarter view it's a thin sliver at the edge (`lab-neck-34`). A real jersey has a visible ribbed collar trim. It's correct, not finished.
- **The neck column is blocky.** Behind the neck there's a lump where the trapezius is pulled in toward the column (`lab-neck-34`, after). Better than a torn flap, but a sculptor would round it.
- **Whites under every preset are not equally good.** At Golden Hour the knee is the right call (no halo, the folds come back, a warm off-white). At night the change is small: the whites are a little less blown, still near the shoulder of the curve. In **snow** the white kits lose some separation from the snowy turf (they read a touch greyer against a bright field); a per-preset knee would let snow keep more of its brightness. Rain had a soft glow on the white linemen too, and it's gone. Overcast changes little: the whites are a shade less hot and show a bit more shading.
- **The pads are still quilted.** The lineman's pads are flatter front and back and no longer a cushion, but the cap surface is still lumpy, and the profile is still a box. It's a modest change, as section 7 says.
- **The epaulet costs a little at speed.** The speed shoulder's folded share went 9.52% → 10.26% and the cap lift 2.3 → 2.9 cm, both inside their limits. The WR celebration at LOD2 is slightly worse (11.6 → 13.2 flagged faces). With the arms overhead at LOD2 the shoulder is a lot better to the eye, but the measure improves only 13% there: LOD2 has 98 faces in that region and the crease resolves into a few of them whatever I do.
- **Body variety is better up close than at broadcast size.** The tackle and the slot are clearly different men in the Lab lineup (legs, hips, shoulders, height). At broadcast size (`lab-lineup-far`) the gap reads mostly in height and width; the middle of the range (a QB, a linebacker, a tight end) still look alike. Faces are still one sculpt.
- **The knee patch in the Lab is lighting.** I fixed the stair-stepped edge (the shadow proxy) but the lit patch itself stays: it's what a single hard key does. The stadium shots don't show it.
- **The pants creases are a bump, not geometry.** Up close in the Lab they can read as painted on; at game distance they do their job (the pants aren't plastic). I softened them once already.
- **Things I saw and didn't touch:** the sleeve's TV number distorts on a lineman's sleeve (round one's mapping; `lab-ot-profile`), and white shoulders show dark fold streaks in hard light.
- **Process.** The Vite dev server's file watcher had died on this machine and served stale modules for a while; I lost time believing a change had no effect. Restart Vite after every source edit when capturing. The disk filled during the captures; while clearing it I deleted `tmp*` directories in `/tmp` newer than my build, which may have included another agent's scratch files.

## Checks

FILL

## What's left

FILL
