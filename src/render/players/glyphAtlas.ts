import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, GLYPH_CHARS, downsampleField, sdfFromCoverage, type GlyphMetrics } from './glyphs';

// One SDF atlas of jersey lettering for every player (TECH_PLAN §10.2):
// digits, capitals and a little punctuation in Bungee (the game's display
// face, OFL, bundled via @fontsource/bungee), rasterized once at startup and
// turned into a signed distance field so numbers and names stay sharp at any
// distance, with an outline for free.

/** Atlas cell, px. One cell is 1 em in the shader's text space. */
export const CELL = 64;
/** SDF spread, px: the distance the field encodes either side of an edge. */
export const SPREAD = 6;
/** Cap height as a share of the cell (the rest is room for the spread and outline). */
export const CAP = 0.62;
/** Left padding inside each cell, px (the pen position sits here). */
export const PAD = 8;

export interface GlyphAtlas {
  texture: THREE.DataTexture;
  metrics: GlyphMetrics[];
}

let atlas: GlyphAtlas | null = null;
let pending: Promise<GlyphAtlas> | null = null;

const FONT_FAMILY = 'Bungee';

export function loadGlyphAtlas(): Promise<GlyphAtlas> {
  pending ??= (async () => {
    try {
      await document.fonts.load(`${CELL}px ${FONT_FAMILY}`, GLYPH_CHARS);
    } catch {
      /* the fallback face still draws legible glyphs */
    }
    atlas = buildAtlas();
    return atlas;
  })();
  return pending;
}

/** The atlas, once loadGlyphAtlas() has resolved (loadPlayerAsset awaits it). */
export function glyphAtlas(): GlyphAtlas {
  if (!atlas) throw new Error('glyph atlas not loaded');
  return atlas;
}

/**
 * Glyphs are rasterized at SUPERSAMPLE times the atlas resolution, the field
 * is computed there and box-filtered down (round two, docs/characters/
 * CHARACTERS2.md). From a 64 px cell's coverage thresholded at 50%, every
 * edge sat on the pixel grid, and at a nameplate's or a number's distance
 * in the huddle (a texel ~2 mm on the jersey, several screen pixels) the
 * letters' edges and outlines showed as stair-steps. At 4x the field is
 * accurate to a quarter of a texel and the edges are straight and round
 * where the face is. A one-off ~0.1-0.3 s at load.
 */
export const SUPERSAMPLE = 4;

function buildAtlas(): GlyphAtlas {
  const w = CELL * ATLAS_COLS;
  const h = CELL * ATLAS_ROWS;
  const ss = SUPERSAMPLE;
  const cell = CELL * ss;
  const canvas = document.createElement('canvas');
  canvas.width = w * ss;
  canvas.height = h * ss;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Size the face so its cap height is CAP of the cell.
  ctx.font = `100px ${FONT_FAMILY}, Impact, sans-serif`;
  const capAt100 = ctx.measureText('H').actualBoundingBoxAscent || 72;
  const size = (CAP * cell * 100) / capAt100;
  ctx.font = `${size}px ${FONT_FAMILY}, Impact, sans-serif`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const metrics: GlyphMetrics[] = [];
  // Caps centered vertically in the cell: baseline at (1 + CAP) / 2 of it.
  const baseline = ((1 + CAP) / 2) * cell;
  [...GLYPH_CHARS].forEach((ch, i) => {
    const cx = (i % ATLAS_COLS) * cell;
    const cy = Math.floor(i / ATLAS_COLS) * cell;
    const m = ctx.measureText(ch);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cell, cell);
    ctx.clip();
    ctx.fillText(ch, cx + PAD * ss, cy + baseline);
    ctx.restore();
    metrics.push({ advance: m.width / cell });
  });
  const W = w * ss;
  const H = h * ss;
  const rgba = ctx.getImageData(0, 0, W, H).data;
  const cov = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) cov[i] = rgba[i * 4 + 3]!;
  const sdf = downsampleField(sdfFromCoverage(cov, W, H, SPREAD * ss), W, H, ss);
  const texture = new THREE.DataTexture(sdf, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return { texture, metrics };
}
