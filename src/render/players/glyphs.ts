// Pure pieces of the jersey lettering (TECH_PLAN §10.2): the signed distance
// transform that turns rasterized glyphs into an SDF atlas, and the text
// layout that places a number or a name in em units. No DOM here, so both
// are unit-tested; glyphAtlas.ts does the canvas work.

/** Characters the atlas holds. Anything else in a name is dropped. */
export const GLYPH_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.'- ";
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(GLYPH_CHARS.length / ATLAS_COLS);
/** Longest name the shader lays out (glyph slots); longer names are squeezed, not cut. */
export const MAX_NAME = 16;
export const MAX_NUMBER = 2;

const INF = 1e20;

// Felzenszwalb & Huttenlocher (2012), "Distance Transforms of Sampled
// Functions": exact 1D squared-distance transform, applied along columns
// then rows for the exact 2D Euclidean distance.
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}

/** Squared distance from every pixel to the nearest pixel where `inside` is true. */
function edt2d(inside: (i: number) => boolean, w: number, h: number): Float64Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!;
  }
  return grid;
}

/**
 * Signed distance field of a coverage image (0..255, >= 128 is inside),
 * encoded to bytes: 128 on the edge, 255 at `spread` px inside, 0 at
 * `spread` px outside.
 */
export function sdfFromCoverage(cov: ArrayLike<number>, w: number, h: number, spread: number): Uint8Array {
  const outside = edt2d((i) => cov[i]! >= 128, w, h); // distance to ink, for pixels outside it
  const inside = edt2d((i) => cov[i]! < 128, w, h); // distance to background, for pixels inside
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Half a pixel either side of the boundary, so the edge sits between pixels.
    const sd = cov[i]! >= 128 ? Math.sqrt(inside[i]!) - 0.5 : -(Math.sqrt(outside[i]!) - 0.5);
    out[i] = Math.round(Math.min(255, Math.max(0, 128 + (sd / spread) * 127)));
  }
  return out;
}

export interface GlyphMetrics {
  /** Advance width, in em (the cell is 1 em wide). */
  advance: number;
}

export interface TextLayout {
  /** Atlas index per slot (-1 = empty). */
  index: number[];
  /** Left edge of each glyph's ink box, in em from the text's left edge. */
  x: number[];
  /** Total width in em. */
  width: number;
}

/**
 * Lay out text left to right with the glyphs' advances and extra tracking
 * (em), keeping only characters in the atlas and at most `slots` of them.
 * The shader centers the text by its width.
 */
export function layoutText(
  text: string,
  metrics: readonly GlyphMetrics[],
  slots: number,
  tracking = 0,
): TextLayout {
  const index: number[] = [];
  const x: number[] = [];
  let pen = 0;
  // Accents drop to the base letter (MUÑOZ prints as MUNOZ, as jerseys do).
  for (const ch of text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()) {
    const i = GLYPH_CHARS.indexOf(ch);
    if (i < 0 || index.length >= slots) continue;
    if (index.length > 0) pen += tracking;
    index.push(i);
    x.push(pen);
    pen += metrics[i]!.advance;
  }
  const width = pen;
  while (index.length < slots) {
    index.push(-1);
    x.push(0);
  }
  return { index, x, width };
}

/** The name as printed on a jersey back: the surname, from a full name. */
export function jerseyName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  // Keep generational suffixes with the surname ("Jr.", "III" go on the jersey too).
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  // And surname particles ("St. Brown", "Van Noy", "De La Puente").
  const particle = /^(st\.?|van|von|de|del|della|da|di|la|le|mac)$/i;
  let last = parts.length - 1;
  while (last > 0 && suffix.test(parts[last]!)) last--;
  let first = last;
  while (first > 1 && particle.test(parts[first - 1]!)) first--;
  return parts.slice(first).join(' ');
}
