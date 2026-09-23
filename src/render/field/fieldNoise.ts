import * as THREE from 'three';

// Baked turf noise (M4.5 broadcast performance). The field shader used to
// evaluate 12 octaves of value noise per pixel (albedo variation at two
// scales plus the blade bump), about 48 hashes, and from the broadcast camera
// the field is ~90% of the screen. The same fbm, baked once at startup, is
// three texture reads:
//   - FIELD: the large-scale color variation (0.08 cycles/m, 4 octaves) over
//     the whole field plane, 3.2 px/m;
//   - TURF: the fine variation (1.7/m, 3 octaves) in R and the blade height
//     (6/m ×3 and 23/m ×2) in G, tiling every 8 m at 64 px/m. Octave
//     frequencies are rounded to whole cells per tile so it tiles exactly;
//     the rotated octaves of the old shader aren't periodic, so the pattern
//     differs in detail but not in character.

/** World rectangle the FIELD texture covers (the field plane: x ±39 m, z −71..67 m, with a margin). */
export const FIELD_NOISE_RECT = { x0: -40, z0: -72, w: 80, h: 140 } as const;
const FIELD_PX_PER_M = 3.2;
/** TURF tile size, m. */
export const TURF_TILE = 8;
const TURF_PX = 512;

function hash(ix: number, iy: number, seed: number): number {
  // Integer hash (lowbias32 style) to [0, 1).
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise at (x, y) in lattice cells; the lattice wraps every `period` cells (0: never). */
function vnoise(x: number, y: number, seed: number, period = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (i: number) => (period ? ((i % period) + period) % period : i);
  const x0 = w(ix);
  const x1 = w(ix + 1);
  const y0 = w(iy);
  const y1 = w(iy + 1);
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** fbm like the shader's: amplitudes 0.5, 0.25, ...; frequency ×~2.03 per octave. */
function fbm(xm: number, ym: number, freq: number, octaves: number, seed: number, tile = 0): number {
  let s = 0;
  let a = 0.5;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    // Tiling: a whole number of cells across the tile.
    const cells = tile ? Math.max(1, Math.round(f * tile)) : 0;
    const ff = tile ? cells / tile : f;
    s += a * vnoise(xm * ff + o * 17.3 * (tile ? 0 : 1), ym * ff, seed + o, cells);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

function texture(data: Uint8Array, w: number, h: number, wrap: THREE.Wrapping): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = wrap;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

function bakeField(): THREE.DataTexture {
  const { x0, z0, w, h } = FIELD_NOISE_RECT;
  const W = Math.round(w * FIELD_PX_PER_M);
  const H = Math.round(h * FIELD_PX_PER_M);
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      const z = z0 + ((j + 0.5) / H) * h;
      const k = (j * W + i) * 4;
      data[k] = byte(fbm(x, z, 0.08, 4, 11));
      data[k + 3] = 255;
    }
  }
  return texture(data, W, H, THREE.ClampToEdgeWrapping);
}

function bakeTurf(): THREE.DataTexture {
  const N = TURF_PX;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * TURF_TILE;
      const z = ((j + 0.5) / N) * TURF_TILE;
      const k = (j * N + i) * 4;
      data[k] = byte(fbm(x, z, 1.7, 3, 23, TURF_TILE));
      data[k + 1] = byte(fbm(x, z, 6, 3, 37, TURF_TILE) * 0.6 + fbm(x, z, 23, 2, 53, TURF_TILE) * 0.4);
      data[k + 3] = 255;
    }
  }
  return texture(data, N, N, THREE.RepeatWrapping);
}

let baked: { uFieldNoise: { value: THREE.DataTexture }; uTurfNoise: { value: THREE.DataTexture } } | null = null;

/** The baked noise textures as shader uniforms (baked on first use, ~0.1 s). */
export function fieldNoiseUniforms() {
  baked ??= { uFieldNoise: { value: bakeField() }, uTurfNoise: { value: bakeTurf() } };
  return baked;
}

export const FIELD_NOISE_PARS_GLSL = /* glsl */ `
uniform sampler2D uFieldNoise;
uniform sampler2D uTurfNoise;
vec2 fieldNoiseUv(vec2 xz) { return (xz - vec2(${FIELD_NOISE_RECT.x0.toFixed(1)}, ${FIELD_NOISE_RECT.z0.toFixed(1)})) / vec2(${FIELD_NOISE_RECT.w.toFixed(1)}, ${FIELD_NOISE_RECT.h.toFixed(1)}); }
vec4 turfNoise(vec2 xz) { return texture2D(uTurfNoise, xz / ${TURF_TILE.toFixed(1)}); }
`;
