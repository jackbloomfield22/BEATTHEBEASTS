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

// Part ids: tools/blender/lib/gear.py PARTS.
export const PART = {
  skin: 0, glove: 1, sock: 2, cleat: 3, jersey: 4, pants: 5, helmet: 6,
  maskSkill: 7, maskCage: 8, maskQb: 9, maskLow: 10, visor: 11, strap: 12, towel: 13, collar: 14,
} as const;
const PART_SCALE = 16; // must match tools/blender/lib/gear.py PART_SCALE
const N = 15;
const MASKS = [PART.maskSkill, PART.maskCage, PART.maskQb, PART.maskLow];

// Finish per part: roughness, metalness. Skin ~0.6 (matte, varied per
// fragment in the shader); fabric rough; helmet shell a glossy clear-coated
// plastic (~0.2); facemasks powder-coated steel; the visor a smoked,
// polished polycarbonate; the chin strap a satin plastic cup.
const ROUGH = [0.62, 0.62, 0.85, 0.45, 0.72, 0.68, 0.2, 0.35, 0.35, 0.35, 0.35, 0.06, 0.4, 0.92, 0.75];
const METAL = [0, 0, 0, 0, 0, 0, 0.05, 0.55, 0.55, 0.55, 0.55, 0.25, 0, 0, 0];
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
float fabricHeight(vec3 p, float fp) {
  float k = 6.2832 / 0.0045;
  float lat = cos(k * p.x) + cos(k * p.y) + cos(k * p.z);
  float knit = smoothstep(0.8, 2.2, lat) * (1.0 - smoothstep(0.0008, 0.0022, fp));
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
// The part's color with its trim, a trim mask for the emissive stripe, and
// the fragment's roughness.
vec3 playerAlbedo(int part, vec3 p, out float stripe, out float rough) {
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
  } else if (part == ${PART.sock}) {
    // Stripes around the sock (trim color).
    float s1 = smoothstep(0.305, 0.31, p.y) * (1.0 - smoothstep(0.33, 0.335, p.y));
    float s2 = smoothstep(0.35, 0.355, p.y) * (1.0 - smoothstep(0.375, 0.38, p.y));
    c = mix(c, uTrim, s1 * step(0.5, uSockStripes) + s2 * step(1.5, uSockStripes));
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
  } else if (part == ${PART.collar}) {
    c = uTrim;
  } else if (part == ${PART.helmet}) {
    // Center stripe over the crown, front to back.
    float s = 1.0 - smoothstep(0.011, 0.014, abs(p.x));
    s *= step(1.70, p.y);
    stripe = s;
    c = mix(c, uHelmetStripe, s);
  } else if (part == ${PART.jersey}) {
    // Collar: a ring at the neck opening only (neck axis at z ≈ -0.016).
    float collar = smoothstep(1.55, 1.56, p.y) * (1.0 - smoothstep(0.10, 0.11, length(p.xz - vec2(0.0, -0.016))));
    float t = sleeveT(p);
    float band = step(0.24, abs(p.x)) * smoothstep(0.40, 0.41, t) * (1.0 - smoothstep(0.47, 0.48, t));
    c = mix(c, uTrim, max(collar, band));
    // Mesh holes and fold valleys a little darker than the knit around them.
    float fp = length(fwidth(p));
    c *= 1.0 + fabricHeight(p, fp) * 28.0;
    c = lettering(c, p);
    c = sleeveNumber(c, p);
  } else if (part == ${PART.pants}) {
    float side = step(0.12, abs(p.x)) * (1.0 - smoothstep(0.011, 0.015, abs(p.z + 0.005))) * step(p.y, 1.05);
    c = mix(c, uPantsStripe, side);
  }
  return c;
}
`;

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
  };
  mat.userData.player = uniforms;
  setPlayerLook(mat, look);
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
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
          diffuseColor.rgb = playerAlbedo(pPart, vRest, pStripe, pRough);`,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (pPart == ${PART.skin} || pPart == ${PART.jersey}) {
            // Relief as a bump from a rest-pose height field: muscles on
            // skin, the knit and its folds on the jersey.
            float mh = pPart == ${PART.skin} ? muscleHeight(vRest) : fabricHeight(vRest, length(fwidth(vRest)));
            vec3 dpx = dFdx(vViewPosition), dpy = dFdy(vViewPosition);
            float dhx = dFdx(mh), dhy = dFdy(mh);
            vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
          }`,
        )
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uPartMetal[pPart];')
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
  };
  const v = variety;
  const glove = v ? gearColor(v.gloveColor, kit, kit.gloves) : kit.gloves;
  // By part id: skin, glove, sock, cleat, jersey, pants, helmet, the four
  // facemasks, visor (smoked), chin strap, towel, collar (trim; the shader).
  const byPart = [skin, glove, kit.socks, kit.cleats, kit.jersey, kit.pants, kit.helmet, kit.facemask, kit.facemask, kit.facemask, kit.facemask, '#16181c', '#e9e9e6', '#f2f2ef', kit.trim];
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
