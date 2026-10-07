import * as THREE from 'three';
import { patchMaterial } from '../sky/atmosphere';
import type { Kit } from './kits';
import { glyphAtlas, CAP, CELL, PAD, SPREAD } from './glyphAtlas';
import { ATLAS_COLS, ATLAS_ROWS, layoutText, MAX_NAME, MAX_NUMBER } from './glyphs';
import type { GearColor, Variety } from './variety';

// One material styles a whole player (one draw call): each vertex carries a
// part id (tools/blender/build_character.py writes it to TEXCOORD_0.x, the
// loader renames it aPart), and the shader picks the part's color and
// finish. Trim (collar, sleeve bands, pants stripe, helmet stripe) is drawn
// from the rest pose (`position` before skinning), so it follows the body
// through every animation without textures.

// Part ids: tools/blender/lib/gear.py PARTS. The official (M6) wears the
// shirt and the cap; his pants, shoes and bare skin are pants, cleat, skin.
export const PART = {
  skin: 0, glove: 1, sock: 2, cleat: 3, jersey: 4, pants: 5, helmet: 6,
  maskSkill: 7, maskCage: 8, maskQb: 9, maskLow: 10, visor: 11, strap: 12, towel: 13, collar: 14,
  shirt: 15, cap: 16, helmetTrim: 17,
} as const;
const PART_SCALE = 16; // must match tools/blender/lib/gear.py PART_SCALE
const N = 18;
const MASKS = [PART.maskSkill, PART.maskCage, PART.maskQb, PART.maskLow];

// Finish per part: roughness, metalness. Skin ~0.6 (matte, varied per
// fragment in the shader); fabric rough; helmet shell a glossy clear-coated
// plastic (~0.2); facemasks powder-coated steel; the visor a smoked,
// polished polycarbonate; the chin strap a satin plastic cup; the
// official's shirt a matte knit and his cap cotton twill; the helmet's
// rubber edging and mask clips a satin rubber. The character pass took the
// shell from 0.2 to 0.14: a painted, clear-coated shell throws a tight
// highlight and a sharp sky reflection (a clear coat's own roughness is
// ~0.05-0.1; the base under it shows through as the colour).
const ROUGH = [0.62, 0.62, 0.85, 0.45, 0.72, 0.68, 0.14, 0.35, 0.35, 0.35, 0.35, 0.06, 0.4, 0.92, 0.75, 0.8, 0.86, 0.55];
const METAL = [0, 0, 0, 0, 0, 0, 0.05, 0.55, 0.55, 0.55, 0.55, 0.25, 0, 0, 0, 0, 0, 0];
const GEAR_COLORS: Record<Exclude<GearColor, 'kit' | 'trim'>, string> = { black: '#121314', white: '#ecedef' };

// Lettering on the jersey (sizes from the NFL uniform rules: back numbers
// 10-12 in, front 8-10 in; nameplate letters about 2.5-3 in). Heights are cap
// heights in m; centers are rest-pose y. The back sits over the pad arch
// (tools/blender/lib/gear.py), the front over the chest plate.
// Numbers are condensed (athletic block numerals are narrower than Bungee),
// which keeps two digits inside the back's width over the pads.
const BACK_NUMBER = { cap: 0.235, y: 1.3 };
const FRONT_NUMBER = { cap: 0.19, y: 1.31 };
const NUMBER_CONDENSE = 0.84;
const NAME = { cap: 0.066, y: 1.47, maxWidth: 0.34 };
// Sleeve ("TV") numbers on the outside of each sleeve, 4 in tall.
const SLEEVE_NUMBER = { cap: 0.085, t: 0.3 };
// The official's shirt: vertical black-and-white stripes, each 2 in wide
// (the pro officials' shirt), a black crew collar and sleeve hems; the
// sleeve ends at 0.52 of the upper arm (tools/blender/lib/gear.py).
const OFFICIAL_STRIPE = 0.0508;
const OFFICIAL_SLEEVE_END = 0.52;
/** Outline width, m. */
const OUTLINE = 0.009;
/** Letter spacing on the nameplate, em. */
const NAME_TRACKING = 0.06;

// Rest-pose landmarks (glTF space: +X left, +Y up, +Z forward), mirroring
// tools/blender/lib/skeleton.py and gear.py.
const GLSL = /* glsl */ `
uniform sampler2D uGlyphs;
uniform float uNumIdx[${MAX_NUMBER}];
uniform float uNumX[${MAX_NUMBER}];
uniform float uNumW;
uniform float uNameIdx[${MAX_NAME}];
uniform float uNameX[${MAX_NAME}];
uniform float uNameW;
uniform float uNameSqueeze;
uniform vec3 uNumColor;
uniform vec3 uNumOutline;
uniform vec3 uNameColor;
// Signed distance (em, + inside) of one glyph cell at q (em; y 0..1 up the cell).
float glyphSd(float idx, vec2 q) {
  // Outside a cell: the field's own floor, so there's no jump at cell edges.
  if (idx < 0.0 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return ${(-SPREAD / CELL).toFixed(5)};
  float col = mod(idx, ${ATLAS_COLS.toFixed(1)});
  float row = floor(idx / ${ATLAS_COLS.toFixed(1)});
  vec2 uv = vec2((col + q.x) / ${ATLAS_COLS.toFixed(1)}, (row + 1.0 - q.y) / ${ATLAS_ROWS.toFixed(1)});
  float t = texture2D(uGlyphs, uv).r;
  return (t * 255.0 - 128.0) / 127.0 * ${(SPREAD / CELL).toFixed(5)};
}
// q: em from the text's left edge (x) and cell bottom (y).
float numberSd(vec2 q) {
  float d = ${(-SPREAD / CELL).toFixed(5)};
  for (int i = 0; i < ${MAX_NUMBER}; i++) d = max(d, glyphSd(uNumIdx[i], vec2(q.x - uNumX[i] + ${(PAD / CELL).toFixed(5)}, q.y)));
  return d;
}
float nameSd(vec2 q) {
  float d = ${(-SPREAD / CELL).toFixed(5)};
  for (int i = 0; i < ${MAX_NAME}; i++) d = max(d, glyphSd(uNameIdx[i], vec2(q.x - uNameX[i] + ${(PAD / CELL).toFixed(5)}, q.y)));
  return d;
}
// Paint one line of lettering from its signed distance (em), antialiased
// over aa (em per pixel, from the text coordinates rather than the field, so
// the cell edges can't widen it).
vec3 letter(vec3 c, float sd, float aa, float emM, vec3 fill, vec3 outline) {
  float o = ${OUTLINE.toFixed(4)} / emM;
  c = mix(c, outline, smoothstep(-aa, aa, sd + o));
  return mix(c, fill, smoothstep(-aa, aa, sd));
}
vec3 lettering(vec3 c, vec3 p) {
  if (abs(p.x) > 0.21) return c;
  if (p.z < -0.03) {
    // Back: seen from behind, the text runs from the player's left (+x) to right.
    // The nameplate stays on the back itself (the pad arch curves over the
    // shoulders above ~1.52 m, where it would show from the front).
    float u = -p.x;
    float em = ${BACK_NUMBER.cap.toFixed(3)} / ${CAP.toFixed(3)};
    vec2 q = vec2(u / (em * ${NUMBER_CONDENSE.toFixed(3)}) + uNumW * 0.5, (p.y - ${BACK_NUMBER.y.toFixed(3)}) / em + 0.5);
    float aa = length(fwidth(q)) * 0.6;
    if (uNumW > 0.0 && q.y > -0.1 && q.y < 1.1) c = letter(c, numberSd(q), aa, em, uNumColor, uNumOutline);
    em = ${NAME.cap.toFixed(3)} / ${CAP.toFixed(3)};
    q = vec2(u / (em * uNameSqueeze) + uNameW * 0.5, (p.y - ${NAME.y.toFixed(3)}) / em + 0.5);
    aa = length(fwidth(q)) * 0.6;
    if (uNameW > 0.0 && q.y > -0.1 && q.y < 1.1) c = mix(c, uNameColor, smoothstep(-aa, aa, nameSd(q)));
  } else if (p.z > 0.03) {
    float u = p.x;
    float em = ${FRONT_NUMBER.cap.toFixed(3)} / ${CAP.toFixed(3)};
    vec2 q = vec2(u / (em * ${NUMBER_CONDENSE.toFixed(3)}) + uNumW * 0.5, (p.y - ${FRONT_NUMBER.y.toFixed(3)}) / em + 0.5);
    float aa = length(fwidth(q)) * 0.6;
    if (uNumW > 0.0 && q.y > -0.1 && q.y < 1.1) c = letter(c, numberSd(q), aa, em, uNumColor, uNumOutline);
  }
  return c;
}
// Arm frames in the rest pose (skeleton.py: A-pose, arms 45 deg down,
// upper arm 0.32 m, forearm 0.28 m).
const vec3 ARM_DIR = vec3(0.7071, -0.7071, 0.0);
vec3 armDir(vec3 p) { return vec3(sign(p.x) * ARM_DIR.x, ARM_DIR.y, 0.0); }
// Along the forearm, 0 at the elbow and 1 at the wrist.
float forearmT(vec3 p) {
  vec3 el = vec3(sign(p.x) * 0.4213, 1.2787, -0.035);
  return dot(p - el, armDir(p)) / 0.28;
}
// Cheap value noise for skin variation.
float pHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float pNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(pHash(i), pHash(i + vec3(1, 0, 0)), f.x), mix(pHash(i + vec3(0, 1, 0)), pHash(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(pHash(i + vec3(0, 0, 1)), pHash(i + vec3(1, 0, 1)), f.x), mix(pHash(i + vec3(0, 1, 1)), pHash(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float gauss(float x, float c, float w) { float d = (x - c) / w; return exp(-d * d); }
// Muscle relief on the bare arm (m of height): deltoid cap, biceps in front,
// triceps behind, the forearm flexor mass below the elbow; the grooves
// between them read in the light as the height field's slope.
float muscleHeight(vec3 p) {
  if (abs(p.x) < 0.2) return 0.0;
  vec3 d = armDir(p);
  vec3 sh = vec3(sign(p.x) * 0.195, 1.505, -0.015);
  float t = dot(p - sh, d) / 0.32;
  vec3 r = p - sh - d * dot(p - sh, d);
  float front = r.z, lateral = dot(r, normalize(vec3(sign(p.x) * 0.7071, 0.7071, 0.0)));
  float h = 0.0035 * gauss(t, 0.18, 0.12) * smoothstep(-0.02, 0.03, lateral);
  h += 0.003 * gauss(t, 0.58, 0.16) * smoothstep(0.0, 0.03, front);
  h += 0.0025 * gauss(t, 0.55, 0.2) * smoothstep(0.0, 0.03, -front);
  float tf = forearmT(p);
  // Forearm: the flexor-extensor mass swelling below the elbow, the
  // brachioradialis ridge along the thumb side, and tendons toward the wrist
  // (the M4.5 forearms read as smooth tubes under a flat light).
  vec3 ft = normalize(vec3(sign(p.x) * 0.7071, 0.7071, 0.0));
  vec3 rf = p - vec3(sign(p.x) * 0.4213, 1.2787, -0.035) - d * (tf * 0.28);
  float top = dot(normalize(rf + 1e-5), ft);
  h += 0.0042 * gauss(tf, 0.22, 0.16);
  h += 0.0022 * gauss(tf, 0.3, 0.2) * smoothstep(0.2, 0.8, top);
  float ang = atan(rf.z, dot(rf, ft));
  h += 0.0007 * smoothstep(0.55, 0.8, tf) * (1.0 - smoothstep(0.84, 0.9, tf)) * pow(abs(sin(ang * 3.0)), 6.0);
  return h;
}
uniform vec3 uPartColor[${N}];
uniform float uPartRough[${N}];
uniform float uPartMetal[${N}];
uniform vec3 uTrim;
uniform vec3 uHelmetStripe;
uniform float uStripeGlow;
uniform vec3 uPantsStripe;
uniform vec3 uSleeveColor;
uniform vec2 uSleeves; // left, right: compression sleeve on
uniform float uTape;
uniform float uSockStripes;
uniform float uSkinVar;
uniform float uKnit;
uniform float uEyeBlack;
uniform vec3 uSole;
// Turf wear (the character pass): legs (knees, shins, the front of the
// thighs), torso front, torso back (and the seat), helmet scuffs. 0 clean,
// 1 a whole game spent on the ground. Player.updateWear raises it each time
// he goes down.
uniform vec4 uWear;
uniform float uKitKnee;
uniform float uKitRange;
varying float vPart;
varying vec3 vRest;
int playerPart() { return int(floor(vPart + 0.001)); }
float sleeveT(vec3 p) {
  vec3 sh = vec3(sign(p.x) * 0.195, 1.505, -0.015);
  vec3 dir = normalize(vec3(sign(p.x) * 0.7071, -0.7071, 0.0));
  return dot(p - sh, dir) / 0.32;
}
// Knit athletic mesh on the jersey: a lattice of small holes (a 3D pattern,
// so it needs no UVs), faded out before it can shimmer (fp: world size of a
// pixel), and soft folds where the fabric bunches (the tuck at the waist,
// the sleeve), less over the chest and back where the pads hold it taut.
// uKnit scales the mesh holes by the jersey's brightness (the character
// pass, from the M6.6 critique: on white the holes read as a field of dark
// dots at arm's length; on black they never showed).
float fabricHeight(vec3 p, float fp) {
  float k = 6.2832 / 0.0045;
  float lat = cos(k * p.x) + cos(k * p.y) + cos(k * p.z);
  float knit = smoothstep(0.8, 2.2, lat) * (1.0 - smoothstep(0.0008, 0.0022, fp)) * uKnit;
  float n = pNoise(vec3(p.x * 9.0, p.y * 34.0, p.z * 9.0));
  float ridge = 1.0 - abs(2.0 * n - 1.0);
  float st = sleeveT(p);
  float bunch = (1.0 - smoothstep(1.12, 1.32, p.y)) + step(0.24, abs(p.x)) * smoothstep(0.2, 0.42, st) * 0.8 + 0.25;
  return -0.00035 * knit + 0.0022 * ridge * ridge * bunch;
}
// Sleeve (TV) number on the outside of the sleeve (arm frame, rest pose).
vec3 sleeveNumber(vec3 c, vec3 p) {
  if (abs(p.x) < 0.24) return c;
  vec3 d = armDir(p);
  vec3 sh = vec3(sign(p.x) * 0.195, 1.505, -0.015);
  vec3 lat = normalize(vec3(sign(p.x) * 0.7071, 0.7071, 0.0));
  vec3 center = sh + d * (0.32 * ${SLEEVE_NUMBER.t.toFixed(2)});
  if (dot(p - center, lat) < 0.02) return c; // the outer face only
  float em = ${SLEEVE_NUMBER.cap.toFixed(3)} / ${CAP.toFixed(3)};
  // Read from the side: front to back across, shoulder to elbow down.
  float u = -sign(p.x) * (p.z - center.z);
  vec2 q = vec2(u / (em * ${NUMBER_CONDENSE.toFixed(3)}) + uNumW * 0.5, dot(p - center, -d) / em + 0.5);
  float aa = length(fwidth(q)) * 0.6;
  if (uNumW > 0.0 && q.y > -0.1 && q.y < 1.1) c = letter(c, numberSd(q), aa, em, uNumColor, uNumOutline);
  return c;
}
// Turf stains: blotches that spread as t (amount x region) grows (0 none,
// 1 soaked), soil brown with streaks of grass green. Linear colours near
// the field's soil and grass, darkened for fabric that's been ground into
// it. Dried soil is lighter than a black jersey, so on dark kits it reads
// as dust.
const vec3 SOIL = vec3(0.15, 0.105, 0.065);
const vec3 TURF = vec3(0.065, 0.12, 0.03);
vec3 stain(vec3 c, vec3 p, float t, inout float rough) {
  if (t <= 0.001) return c;
  float n = pNoise(p * 34.0) * 0.6 + pNoise(p * 105.0) * 0.4;
  float cover = smoothstep(0.62, 0.86, n * 0.5 + t * 0.62);
  float g = smoothstep(0.45, 0.75, pNoise(p * vec3(8.0, 30.0, 8.0) + 7.0));
  rough = mix(rough, 0.92, cover);
  return mix(c, mix(SOIL, TURF, g * 0.8), cover * 0.78);
}
// Game pants (round two): stretch fabric over thigh and knee pads, smooth
// as plastic until now. Soft creases bunch round the back of the knee and
// the front of the hip, a little drape down the thigh; faded out with the
// pixel footprint so they can't shimmer at broadcast distance.
float pantsHeight(vec3 p, float fp) {
  float knee = exp(-pow((p.y - 0.53) / 0.07, 2.0)) * (0.35 + 0.65 * smoothstep(-0.02, 0.06, -p.z));
  float hip = exp(-pow((p.y - 0.97) / 0.07, 2.0)) * smoothstep(0.0, 0.08, p.z);
  float n1 = pNoise(vec3(p.x * 30.0, p.y * 85.0, p.z * 30.0));
  float n2 = pNoise(vec3(p.x * 22.0, p.y * 9.0, p.z * 22.0) + 3.0);
  float crease = 1.0 - abs(2.0 * n1 - 1.0);
  float drape = 1.0 - abs(2.0 * n2 - 1.0);
  float h = 0.0018 * crease * crease * (knee + hip * 0.8) + 0.0009 * drape * drape * smoothstep(0.55, 0.7, p.y) * (1.0 - smoothstep(1.0, 1.08, p.y));
  return h * (1.0 - smoothstep(0.0012, 0.003, fp));
}
// Ribbed sock knit: a height field around the leg (rest pose, the shin's
// axis near |x| 0.11), faded out before it can shimmer.
float sockHeight(vec3 p, float fp) {
  float a = atan(p.z + 0.01, abs(p.x) - 0.11);
  return 0.00035 * cos(a * 64.0) * (1.0 - smoothstep(0.0006, 0.0016, fp));
}
// The part's color with its trim, a trim mask for the emissive stripe, and
// the fragment's roughness. front: the fragment faces the camera (the
// inside of the helmet is its padding).
vec3 playerAlbedo(int part, vec3 p, bool front, out float stripe, out float rough) {
  vec3 c = uPartColor[part];
  stripe = 0.0;
  rough = uPartRough[part];
  if (part == ${PART.skin}) {
    // Skin: a little tone and roughness variation (pores, sweat, oil), never
    // a uniform plastic sheen; darker in the creases between muscles.
    float n = pNoise(p * 60.0) * 0.6 + pNoise(p * 190.0) * 0.4;
    c *= 1.0 + (n - 0.5) * 0.10 * uSkinVar;
    rough = 0.52 + 0.18 * n;
    float side = sign(p.x);
    bool arm = abs(p.x) > 0.22;
    vec3 d = armDir(p);
    vec3 sh = vec3(side * 0.195, 1.505, -0.015);
    float t = dot(p - sh, d) / 0.32;
    float tf = forearmT(p);
    // Compression sleeve from under the jersey sleeve to the glove cuff.
    // Grooves between the muscles sit a touch darker (they read under flat light, where relief alone doesn't).
    if (arm) c *= mix(0.9, 1.0, smoothstep(0.0, 0.0035, muscleHeight(p)));
    float on = side > 0.0 ? uSleeves.x : uSleeves.y;
    if (arm && on > 0.5 && (t > 0.45 && tf < 0.84)) {
      c = uSleeveColor;
      rough = 0.7;
    } else if (arm && uTape > 0.5 && tf > 0.72 && tf < 0.84) {
      // Tape above the glove.
      c = vec3(0.86, 0.86, 0.84);
      rough = 0.8;
    }
    if (arm) c = stain(c, p, uWear.y * 0.45 * smoothstep(0.1, 0.4, tf), rough);
    if (p.y > 1.7 && p.z > 0.04) {
      // The face (rest pose; seen through the facemask): the eye sockets
      // shadowed under the brow so the face isn't a smooth egg, and eye
      // black on the cheekbones for the players who wear it.
      float ex = abs(p.x) - 0.032;
      c *= 1.0 - 0.45 * exp(-(ex * ex) / 0.00022 - pow(p.y - 1.776, 2.0) / 0.00012);
      float eb = pow((abs(p.x) - 0.035) / 0.017, 2.0) + pow((p.y - 1.757) / 0.0068, 2.0);
      float black = uEyeBlack * (1.0 - smoothstep(0.75, 1.0, eb)) * step(0.06, p.z);
      c = mix(c, vec3(0.012), black);
      rough = mix(rough, 0.88, black);
    }
  } else if (part == ${PART.sock}) {
    // Stripes around the sock (trim color).
    float s1 = smoothstep(0.305, 0.31, p.y) * (1.0 - smoothstep(0.33, 0.335, p.y));
    float s2 = smoothstep(0.35, 0.355, p.y) * (1.0 - smoothstep(0.375, 0.38, p.y));
    c = mix(c, uTrim, s1 * step(0.5, uSockStripes) + s2 * step(1.5, uSockStripes));
    c = stain(c, p, uWear.x * 0.7 * smoothstep(-0.02, 0.05, p.z), rough);
  } else if (part == ${PART.cleat}) {
    // Two-tone: the outsole plate (its top at 1.6 cm, gear.SOLE_TOP; round
    // two made it real geometry with a lip and studs), a welt line just
    // above it, the laces down the instep. The studs a shade darker.
    float sole = 1.0 - smoothstep(0.0158, 0.0168, p.y);
    float welt = smoothstep(0.0168, 0.0175, p.y) * (1.0 - smoothstep(0.0195, 0.0205, p.y));
    float lx = abs(abs(p.x) - 0.116);
    float lace = (1.0 - smoothstep(0.009, 0.011, lx)) * smoothstep(-0.005, 0.0, p.z) * (1.0 - smoothstep(0.1, 0.105, p.z)) * step(0.058 - 0.2 * p.z, p.y) * step(0.5, fract(p.z / 0.0125));
    c = mix(c, uSole, max(sole, lace * 0.85));
    c *= 1.0 - 0.45 * welt;
    c *= 1.0 - 0.4 * (1.0 - smoothstep(0.0015, 0.0025, p.y));
    rough = mix(rough, 0.7, sole);
    c = stain(c, p, uWear.x * 0.8 * (1.0 - smoothstep(0.03, 0.07, p.y)), rough);
  } else if (part == ${PART.glove}) {
    // Two-tone gloves: the back in the glove color, a darker grip palm, and
    // a trim-colored cuff, so a hand reads as a hand at mid distance.
    vec3 d = armDir(p);
    vec3 ft = normalize(vec3(sign(p.x) * 0.7071, 0.7071, 0.0));
    float tf = forearmT(p);
    vec3 wr = vec3(sign(p.x) * 0.619, 1.081, -0.02);
    float back = dot(p - wr - d * dot(p - wr, d), ft);
    c = mix(c * 0.42 + vec3(0.03), c, smoothstep(-0.006, 0.006, back));
    c = mix(c, uTrim, smoothstep(0.86, 0.87, tf) * (1.0 - smoothstep(0.93, 0.94, tf)));
    c = stain(c, p, uWear.y * 0.6, rough);
  } else if (part == ${PART.collar}) {
    c = uTrim;
  } else if (part == ${PART.towel}) {
    // Terry cloth: matte, a little uneven.
    float n = pNoise(p * 260.0);
    c *= 0.9 + 0.1 * n;
    rough = 0.96;
    c = stain(c, p, uWear.x * 0.5, rough);
  } else if (part == ${PART.helmet}) {
    if (!front) {
      // The inside: black foam padding.
      rough = 0.9;
      return vec3(0.02);
    }
    // Center stripe over the crown, front to back.
    float s = 1.0 - smoothstep(0.011, 0.014, abs(p.x));
    s *= step(1.70, p.y);
    stripe = s;
    c = mix(c, uHelmetStripe, s);
    // The ear hole (over the ear, tools/blender/lib/body.py) and its ring.
    float e = length(vec2(p.y - 1.762, p.z + 0.012));
    if (abs(p.x) > 0.1) c *= mix(0.08, 1.0, smoothstep(0.0095, 0.011, e)) * mix(0.75, 1.0, smoothstep(0.013, 0.015, e));
    // Scuffs: paint transfer from other helmets and the turf, streaked
    // front to back over the shell's front and sides.
    float sc = smoothstep(0.86, 0.96, pNoise(p * vec3(140.0, 520.0, 40.0)) * 0.7 + pNoise(p * 37.0) * 0.3 + uWear.w * 0.12) * min(1.0, uWear.w * 1.5) * smoothstep(-0.05, 0.08, p.z);
    c = mix(c, mix(vec3(0.55), c * 0.5, step(0.4, dot(c, vec3(0.33)))), sc * 0.6);
    rough = mix(rough, 0.45, sc);
  } else if (part == ${PART.jersey}) {
    // Collar: a ring at the neck opening only (neck axis at z ≈ -0.016).
    float collar = smoothstep(1.55, 1.56, p.y) * (1.0 - smoothstep(0.10, 0.11, length(p.xz - vec2(0.0, -0.016))));
    float t = sleeveT(p);
    // (A soft edge across |x|: a hard step at 0.24 ran along the sleeve's
    // inner face near the armpit and drew the band's end ragged.)
    float band = smoothstep(0.232, 0.248, abs(p.x)) * smoothstep(0.40, 0.41, t) * (1.0 - smoothstep(0.47, 0.48, t));
    c = mix(c, uTrim, max(collar, band));
    // Mesh holes and fold valleys a little darker than the knit around them.
    float fp = length(fwidth(p));
    c *= 1.0 + fabricHeight(p, fp) * 28.0;
    c = lettering(c, p);
    c = sleeveNumber(c, p);
    // Wear: down the front (the belly, a slide), the back (from the
    // shoulders to the tuck) and the elbows.
    float wf = smoothstep(0.02, 0.08, p.z) * (1.0 - smoothstep(1.32, 1.45, p.y));
    float wb = smoothstep(-0.02, -0.08, p.z) * (1.0 - smoothstep(1.45, 1.55, p.y));
    float we = step(0.24, abs(p.x)) * smoothstep(0.3, 0.5, t) * 0.6;
    c = stain(c, p, max(max(uWear.y * wf, uWear.z * wb), (uWear.y + uWear.z) * 0.5 * we), rough);
  } else if (part == ${PART.shirt}) {
    // Stripes run down the body and down each sleeve: the arc length around
    // the torso's vertical axis (radius ~0.165 m) or the arm's axis
    // (~0.068 m), in stripe widths; antialiased from the pixel footprint.
    float u;
    float st = sleeveT(p);
    if (abs(p.x) > 0.21 && st > 0.08) {
      vec3 d = armDir(p);
      vec3 sh = vec3(sign(p.x) * 0.195, 1.505, -0.015);
      vec3 r = p - sh - d * dot(p - sh, d);
      vec3 lat = normalize(vec3(sign(p.x) * 0.7071, 0.7071, 0.0));
      u = atan(r.z, dot(r, lat)) * 0.068;
    } else {
      // (0.1617 m = 5 stripe pairs per half turn: the stripes meet at the back seam.)
      u = atan(p.x, p.z + 0.01) * 0.1617;
    }
    float w = u / ${(2 * OFFICIAL_STRIPE).toFixed(4)};
    float tri = abs(fract(w) - 0.5) * 2.0;
    // The pixel footprint from the rest position (w itself jumps at the back seam).
    float aa = max(length(fwidth(p)) / ${(2 * OFFICIAL_STRIPE).toFixed(4)} * 2.0, 1e-3);
    c = mix(c, uTrim, smoothstep(0.5 - aa, 0.5 + aa, tri));
    // Black crew collar and sleeve hems.
    float collar = smoothstep(1.572, 1.58, p.y) * (1.0 - smoothstep(0.108, 0.114, length(p.xz - vec2(0.0, -0.02))));
    float hem = step(0.21, abs(p.x)) * smoothstep(${(OFFICIAL_SLEEVE_END - 0.07).toFixed(3)}, ${(OFFICIAL_SLEEVE_END - 0.065).toFixed(3)}, st);
    c = mix(c, uTrim, max(collar, hem));
  } else if (part == ${PART.pants}) {
    // The creases' valleys a little darker (pantsHeight; the bump does the rest).
    c *= 1.0 + (pantsHeight(p, length(fwidth(p))) - 0.0012) * 40.0;
    float side = step(0.12, abs(p.x)) * (1.0 - smoothstep(0.011, 0.015, abs(p.z + 0.005))) * step(p.y, 1.05);
    c = mix(c, uPantsStripe, side);
    // The belt in the jersey's colour at the waistband (the pants top is at
    // 1.13 m, gear.PANTS_TOP_Z), with a stitched edge under it.
    float belt = smoothstep(1.098, 1.101, p.y);
    c = mix(c, uPartColor[${PART.jersey}], belt);
    c *= 1.0 - 0.25 * (smoothstep(1.092, 1.094, p.y) * (1.0 - smoothstep(1.096, 1.098, p.y)));
    rough = mix(rough, 0.55, belt);
    // Wear: the knees and the front of the thighs, the seat, the outer hip.
    float knees = exp(-pow((p.y - 0.53) / 0.075, 2.0)) * smoothstep(-0.03, 0.04, p.z);
    float thighs = smoothstep(0.58, 0.72, p.y) * (1.0 - smoothstep(0.86, 0.95, p.y)) * smoothstep(0.0, 0.06, p.z) * 0.65;
    float seat = exp(-pow((p.y - 0.95) / 0.1, 2.0)) * smoothstep(0.02, -0.06, p.z);
    float hip = smoothstep(0.13, 0.17, abs(p.x)) * (1.0 - smoothstep(0.95, 1.05, p.y)) * 0.5;
    c = stain(c, p, max(max(uWear.x * max(knees, thighs), uWear.z * seat), (uWear.y + uWear.z) * 0.5 * hip), rough);
  }
  return c;
}
`;

/**
 * The kit's highlight knee (round two, docs/characters/CHARACTERS2.md),
 * shared by every player material and set each frame from the lighting
 * (Stage.tsx: a share of the active bloom threshold; 0 turns it off, as in
 * the Lab). A white kit facing the golden-hour sun is ~12x brighter than
 * the grazing-lit turf, so it rode far over the bloom threshold and glowed
 * with a halo, and every white sat on the tone curve's shoulder (display
 * 200-235 in every preset: the folds and shading had nowhere to go). Gear
 * radiance above uKitKnee rolls off toward uKitKnee + uKitRange, about the
 * threshold: a broadcast camera's knee, on the subject only.
 */
export const PLAYER_LIGHT = { uKitKnee: { value: 0 }, uKitRange: { value: 1 } };
export const KIT_KNEE = 0.55; // of the bloom threshold
export const KIT_RANGE = 0.55; // of it: the brightest sunlit white tops out at ~1.1x the threshold (a faint bloom, no halo)

export interface PlayerLook {
  kit: Kit;
  skin: string;
  /** Jersey number (0-99); none if omitted. */
  number?: number;
  /** Nameplate text (usually jerseyName(fullName)); none if omitted. */
  name?: string;
  /** Gear picks (variety.ts); the defaults are a skill player's plain kit. */
  variety?: Variety;
}

function linear(hex: string): THREE.Color {
  return new THREE.Color(hex); // three converts sRGB hex to the linear working space
}

export function createPlayerMaterial(look: PlayerLook): THREE.MeshStandardMaterial {
  // Double-sided: a look down the collar or up a sleeve sees the fabric's
  // inside, not through the player (the covered body is culled at build).
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  // Players dress for the weather through their kit, not snow caps on helmets.
  mat.userData.noWeather = true;
  const uniforms = {
    uPartColor: { value: Array.from({ length: N }, () => new THREE.Color()) },
    uPartRough: { value: ROUGH.slice() },
    uPartMetal: { value: METAL.slice() },
    uTrim: { value: new THREE.Color() },
    uHelmetStripe: { value: new THREE.Color() },
    uStripeGlow: { value: 0 },
    uPantsStripe: { value: new THREE.Color() },
    uGlyphs: { value: glyphAtlas().texture },
    uNumIdx: { value: new Array<number>(MAX_NUMBER).fill(-1) },
    uNumX: { value: new Array<number>(MAX_NUMBER).fill(0) },
    uNumW: { value: 0 },
    uNameIdx: { value: new Array<number>(MAX_NAME).fill(-1) },
    uNameX: { value: new Array<number>(MAX_NAME).fill(0) },
    uNameW: { value: 0 },
    uNameSqueeze: { value: 1 },
    uNumColor: { value: new THREE.Color() },
    uNumOutline: { value: new THREE.Color() },
    uNameColor: { value: new THREE.Color() },
    uPartShow: { value: new Array<number>(N).fill(1) },
    uSleeveColor: { value: new THREE.Color() },
    uSleeves: { value: new THREE.Vector2() },
    uTape: { value: 0 },
    uSockStripes: { value: 0 },
    uSkinVar: { value: 1 },
    uKnit: { value: 1 },
    uEyeBlack: { value: 0 },
    uSole: { value: new THREE.Color() },
    uWear: { value: new THREE.Vector4(0, 0, 0, 0) }, // (Vector4 defaults w to 1)
  };
  mat.userData.player = uniforms;
  setPlayerLook(mat, look);
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, uniforms, PLAYER_LIGHT);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec2 aPart;\nvarying float vPart;\nvarying vec3 vRest;\nuniform float uPartShow[${N}];`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPart = aPart.x * ${PART_SCALE.toFixed(1)};\nvRest = position;`)
        // Gear this player doesn't wear (other facemask styles, visor,
        // towel): collapsed out of the clip volume here rather than discarded
        // per pixel (discard defeats hidden-surface removal on tile GPUs).
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>\nif (uPartShow[int(floor(vPart))] < 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          int pPart = playerPart();
          float pStripe;
          float pRough;
          diffuseColor.rgb = playerAlbedo(pPart, vRest, gl_FrontFacing, pStripe, pRough);
          // Real cloth and paint, not the hex: a white jersey or shell
          // reflects ~70-80% (it blew out into a glowing blob under the
          // golden-hour key and its bloom), and black fabric ~2-4% (at the
          // hex's 0.6% the Beasts read as silhouettes with no folds or
          // pads). The character pass; skin and the deliberate blacks (eye
          // black, the helmet's inside) are left alone.
          if (pPart != ${PART.skin} && gl_FrontFacing) diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.022), vec3(0.72));`,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (pPart == ${PART.skin} || pPart == ${PART.jersey} || pPart == ${PART.sock} || pPart == ${PART.pants}) {
            // Relief as a bump from a rest-pose height field: muscles on
            // skin, the knit and its folds on the jersey, the sock's ribs,
            // the creases in the pants.
            float fpx = length(fwidth(vRest));
            float mh = pPart == ${PART.skin} ? muscleHeight(vRest) : pPart == ${PART.jersey} ? fabricHeight(vRest, fpx) : pPart == ${PART.pants} ? pantsHeight(vRest, fpx) : sockHeight(vRest, fpx);
            vec3 dpx = dFdx(vViewPosition), dpy = dFdy(vViewPosition);
            float dhx = dFdx(mh), dhy = dFdy(mh);
            vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
          }
          {
            // Cloth sheen and skin: knit fabric brightens toward grazing
            // angles (fibres scatter light forward: the rim a broadcast
            // shows on jerseys and pants), and skin picks up a warm rim
            // (light scattered under it). A cheap stand-in for a sheen lobe
            // and subsurface scattering: one multiply per fragment, no extra
            // light loop (MeshPhysicalMaterial's sheen would add one).
            float rim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            bool cloth = pPart == ${PART.jersey} || pPart == ${PART.pants} || pPart == ${PART.sock} || pPart == ${PART.towel} || pPart == ${PART.shirt} || pPart == ${PART.collar};
            if (cloth) diffuseColor.rgb *= 1.0 + 0.4 * rim * rim * rim;
            else if (pPart == ${PART.skin}) diffuseColor.rgb *= 1.0 + vec3(0.28, 0.07, 0.02) * rim * rim;
          }`,
        )
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uPartMetal[pPart];')
        .replace(
          '#include <opaque_fragment>',
          `if (uKitKnee > 0.0 && pPart != ${PART.skin} && gl_FrontFacing && pStripe < 0.5) {
            // The kit's highlight knee (PLAYER_LIGHT).
            float kl = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
            if (kl > uKitKnee) {
              float kx = kl - uKitKnee;
              outgoingLight *= (uKitKnee + kx / (1.0 + kx / uKitRange)) / kl;
            }
          }
          #include <opaque_fragment>`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += uHelmetStripe * pStripe * uStripeGlow * 3.0;`,
        );
    },
    'player',
  );
}

type Uniform<T> = { value: T };

/** WCAG relative luminance of an sRGB hex color. */
function luminance(hex: string): number {
  const c = new THREE.Color(hex); // linear
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** WCAG contrast ratio between a color and a luminance. */
function contrast(hex: string, lum: number): number {
  const l = luminance(hex);
  return (Math.max(l, lum) + 0.05) / (Math.min(l, lum) + 0.05);
}

function gearColor(c: GearColor, kit: Kit, kitColor: string): string {
  return c === 'kit' ? kitColor : c === 'trim' ? kit.trim : GEAR_COLORS[c];
}

export function setPlayerLook(mat: THREE.MeshStandardMaterial, { kit, skin, number, name, variety }: PlayerLook): void {
  const u = mat.userData.player as {
    uPartColor: Uniform<THREE.Color[]>;
    uTrim: Uniform<THREE.Color>;
    uHelmetStripe: Uniform<THREE.Color>;
    uStripeGlow: Uniform<number>;
    uPantsStripe: Uniform<THREE.Color>;
    uNumIdx: Uniform<number[]>;
    uNumX: Uniform<number[]>;
    uNumW: Uniform<number>;
    uNameIdx: Uniform<number[]>;
    uNameX: Uniform<number[]>;
    uNameW: Uniform<number>;
    uNameSqueeze: Uniform<number>;
    uNumColor: Uniform<THREE.Color>;
    uNumOutline: Uniform<THREE.Color>;
    uNameColor: Uniform<THREE.Color>;
    uPartShow: Uniform<number[]>;
    uSleeveColor: Uniform<THREE.Color>;
    uSleeves: Uniform<THREE.Vector2>;
    uTape: Uniform<number>;
    uSockStripes: Uniform<number>;
    uKnit: Uniform<number>;
    uEyeBlack: Uniform<number>;
    uSole: Uniform<THREE.Color>;
  };
  const v = variety;
  const glove = v ? gearColor(v.gloveColor, kit, kit.gloves) : kit.gloves;
  // By part id: skin, glove, sock, cleat, jersey, pants, helmet, the four
  // facemasks, visor (smoked), chin strap, towel, collar (trim; the shader),
  // the official's shirt (its stripes are the trim) and cap (the helmet color).
  const byPart = [skin, glove, kit.socks, kit.cleats, kit.jersey, kit.pants, kit.helmet, kit.facemask, kit.facemask, kit.facemask, kit.facemask, '#16181c', '#e9e9e6', '#f2f2ef', kit.trim, kit.jersey, kit.helmet, '#121315'];
  byPart.forEach((hex, i) => u.uPartColor.value[i]!.copy(linear(hex)));
  const show = u.uPartShow.value;
  show.fill(1);
  const style = v?.mask ?? 'skill';
  const styleId = { skill: PART.maskSkill, cage: PART.maskCage, qb: PART.maskQb }[style];
  for (const m of MASKS) if (m !== PART.maskLow) show[m] = m === styleId ? 1 : 0;
  show[PART.visor] = v?.visor ? 1 : 0;
  show[PART.towel] = v?.towel ? 1 : 0;
  u.uSleeveColor.value.copy(linear(v ? gearColor(v.sleeveColor, kit, kit.jersey) : kit.jersey));
  u.uSleeves.value.set(v?.sleeves.l ? 1 : 0, v?.sleeves.r ? 1 : 0);
  u.uTape.value = v?.tape ? 1 : 0;
  u.uSockStripes.value = v?.sockStripes ?? 0;
  u.uEyeBlack.value = v?.eyeBlack ? 1 : 0;
  // The knit's holes at full depth on a black jersey, a third on white.
  u.uKnit.value = 1 - 0.65 * Math.min(1, luminance(kit.jersey) / 0.8);
  // A dark cleat on a white sole, a light one on a dark sole.
  u.uSole.value.copy(linear(luminance(kit.cleats) < 0.3 ? '#dcdddf' : '#1b1c1f'));
  u.uTrim.value.copy(linear(kit.trim));
  u.uHelmetStripe.value.copy(linear(kit.helmetStripe));
  u.uStripeGlow.value = kit.stripeGlow;
  u.uPantsStripe.value.copy(linear(kit.pantsStripe));
  u.uNumColor.value.copy(linear(kit.number));
  u.uNumOutline.value.copy(linear(kit.numberOutline));
  // The nameplate has no outline, so it takes whichever number color stands
  // out more from the jersey (the Beasts' crimson on black doesn't).
  const jersey = luminance(kit.jersey);
  const byContrast = [kit.number, kit.numberOutline].sort((a, b) => contrast(b, jersey) - contrast(a, jersey));
  u.uNameColor.value.copy(linear(byContrast[0]!));
  const { metrics } = glyphAtlas();
  const num = layoutText(number === undefined ? '' : String(Math.max(0, Math.min(99, Math.round(number)))), metrics, MAX_NUMBER);
  u.uNumIdx.value = num.index;
  u.uNumX.value = num.x;
  u.uNumW.value = num.width;
  const plate = layoutText(name ?? '', metrics, MAX_NAME, NAME_TRACKING);
  u.uNameIdx.value = plate.index;
  u.uNameX.value = plate.x;
  u.uNameW.value = plate.width;
  // Long names are squeezed to fit across the shoulders, as on real jerseys.
  const widthM = plate.width * (NAME.cap / CAP);
  u.uNameSqueeze.value = widthM > NAME.maxWidth ? NAME.maxWidth / widthM : 1;
}
