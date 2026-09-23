import * as THREE from 'three';
import { patchMaterial } from '../sky/atmosphere';
import type { Kit } from './kits';
import { glyphAtlas, CAP, CELL, PAD, SPREAD } from './glyphAtlas';
import { ATLAS_COLS, ATLAS_ROWS, layoutText, MAX_NAME, MAX_NUMBER } from './glyphs';

// One material styles a whole player (one draw call): each vertex carries a
// part id (tools/blender/build_character.py writes it to TEXCOORD_0.x, the
// loader renames it aPart), and the shader picks the part's color and
// finish. Trim (collar, sleeve bands, pants stripe, helmet stripe) is drawn
// from the rest pose (`position` before skinning), so it follows the body
// through every animation without textures.

export const PART = { skin: 0, glove: 1, sock: 2, cleat: 3, jersey: 4, pants: 5, helmet: 6, facemask: 7 } as const;
const PART_SCALE = 16; // must match tools/blender/lib/gear.py PART_SCALE
const N = 8;

// Finish per part: roughness, metalness. Skin ~0.5; fabric rough; helmet
// shell a glossy clear-coated plastic (~0.2); facemask powder-coated steel.
const ROUGH = [0.5, 0.62, 0.85, 0.45, 0.72, 0.68, 0.2, 0.35];
const METAL = [0, 0, 0, 0, 0, 0, 0.05, 0.55];

// Lettering on the jersey (sizes from the NFL uniform rules: back numbers
// 10-12 in, front 8-10 in; nameplate letters about 2.5-3 in). Heights are cap
// heights in m; centers are rest-pose y. The back sits over the pad arch
// (tools/blender/lib/gear.py), the front over the chest plate.
// Numbers are condensed (athletic block numerals are narrower than Bungee),
// which keeps two digits inside the back's width over the pads.
const BACK_NUMBER = { cap: 0.235, y: 1.3 };
const FRONT_NUMBER = { cap: 0.19, y: 1.31 };
const NUMBER_CONDENSE = 0.84;
const NAME = { cap: 0.066, y: 1.505, maxWidth: 0.34 };
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
uniform vec3 uPartColor[${N}];
uniform float uPartRough[${N}];
uniform float uPartMetal[${N}];
uniform vec3 uTrim;
uniform vec3 uHelmetStripe;
uniform float uStripeGlow;
uniform vec3 uPantsStripe;
varying float vPart;
varying vec3 vRest;
int playerPart() { return int(floor(vPart + 0.001)); }
float sleeveT(vec3 p) {
  vec3 sh = vec3(sign(p.x) * 0.195, 1.505, -0.015);
  vec3 dir = normalize(vec3(sign(p.x) * 0.7071, -0.7071, 0.0));
  return dot(p - sh, dir) / 0.30;
}
// The part's color with its trim, and a trim mask for the emissive stripe.
vec3 playerAlbedo(int part, vec3 p, out float stripe) {
  vec3 c = uPartColor[part];
  stripe = 0.0;
  if (part == ${PART.helmet}) {
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
    c = lettering(c, p);
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
  };
  mat.userData.player = uniforms;
  setPlayerLook(mat, look);
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec2 aPart;\nvarying float vPart;\nvarying vec3 vRest;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPart = aPart.x * ${PART_SCALE.toFixed(1)};\nvRest = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          int pPart = playerPart();
          float pStripe;
          diffuseColor.rgb = playerAlbedo(pPart, vRest, pStripe);`,
        )
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uPartRough[pPart];')
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

export function setPlayerLook(mat: THREE.MeshStandardMaterial, { kit, skin, number, name }: PlayerLook): void {
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
  };
  const byPart = [skin, kit.gloves, kit.socks, kit.cleats, kit.jersey, kit.pants, kit.helmet, kit.facemask];
  byPart.forEach((hex, i) => u.uPartColor.value[i]!.copy(linear(hex)));
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
