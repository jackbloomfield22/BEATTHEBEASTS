import * as THREE from 'three';
import { patchMaterial } from '../sky/atmosphere';
import type { Kit } from './kits';

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

// Rest-pose landmarks (glTF space: +X left, +Y up, +Z forward), mirroring
// tools/blender/lib/skeleton.py and gear.py.
const GLSL = /* glsl */ `
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
}

function linear(hex: string): THREE.Color {
  return new THREE.Color(hex); // three converts sRGB hex to the linear working space
}

export function createPlayerMaterial(look: PlayerLook): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
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

export function setPlayerLook(mat: THREE.MeshStandardMaterial, { kit, skin }: PlayerLook): void {
  const u = mat.userData.player as {
    uPartColor: { value: THREE.Color[] };
    uTrim: { value: THREE.Color };
    uHelmetStripe: { value: THREE.Color };
    uStripeGlow: { value: number };
    uPantsStripe: { value: THREE.Color };
  };
  const byPart = [skin, kit.gloves, kit.socks, kit.cleats, kit.jersey, kit.pants, kit.helmet, kit.facemask];
  byPart.forEach((hex, i) => u.uPartColor.value[i]!.copy(linear(hex)));
  u.uTrim.value.copy(linear(kit.trim));
  u.uHelmetStripe.value.copy(linear(kit.helmetStripe));
  u.uStripeGlow.value = kit.stripeGlow;
  u.uPantsStripe.value.copy(linear(kit.pantsStripe));
}
