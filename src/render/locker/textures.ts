import * as THREE from 'three';
import { DECADE_HEX } from '@data/legacy/palette';

// Canvas-drawn textures for the locker room: nameplates, jerseys, the
// sticker strip on each stall, the carpet and the wall paneling. Everything
// is drawn here in code (no image assets), in the Contenders' black and lime.
// Type is Bungee (the game's display face, bundled with @fontsource, OFL);
// canvases redraw once it has loaded.

export const LIME = '#aaff00';
const INK = '#f2f2f2';

let fontReady: Promise<void> | null = null;
export function whenFontReady(): Promise<void> {
  fontReady ??= (typeof document !== 'undefined' && document.fonts
    ? Promise.all([document.fonts.load('64px Bungee'), document.fonts.load('600 32px "Inter Variable"')]).then(() => undefined)
    : Promise.resolve()
  ).catch(() => undefined);
  return fontReady;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Small deterministic hash noise for surface grain (no Math.random: shots must match run to run). */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 1, cell = 2): void {
  let s = seed * 2654435761;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < h; y += cell)
    for (let x = 0; x < w; x += cell) {
      const v = rnd();
      ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * amount})` : `rgba(0,0,0,${(0.5 - v) * amount})`;
      ctx.fillRect(x, y, cell, cell);
    }
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, max: number, width: number): number {
  let size = max;
  ctx.font = `${size}px ${family}`;
  while (size > 8 && ctx.measureText(text).width > width) {
    size -= 2;
    ctx.font = `${size}px ${family}`;
  }
  return size;
}

// ---------------------------------------------------------------- nameplate

export interface PlateLine {
  name: string;
  num: number | null;
}

/**
 * A nameplate: brushed dark metal with the name and number. Blank plates
 * (an empty locker) show only the etched rule. The same canvas is the
 * emissive map, so "lighting" the plate is its emissive intensity.
 */
export function drawNameplate(c: HTMLCanvasElement, lines: PlateLine[] | null): void {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(0, 0, w, h);
  // Brushed grain along the plate.
  for (let y = 0; y < h; y += 2) {
    const v = 10 + ((y * 37) % 11);
    ctx.fillStyle = `rgb(${v},${v},${v + 1})`;
    ctx.fillRect(0, y, w, 1);
  }
  ctx.strokeStyle = 'rgba(170,255,0,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  if (!lines) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(w * 0.2, h / 2 - 2, w * 0.6, 4);
    return;
  }
  const colW = w / lines.length;
  lines.forEach((l, i) => {
    const x0 = i * colW;
    const hasNum = l.num !== null;
    const numW = hasNum ? Math.min(colW * 0.26, h * 1.1) : 0;
    if (hasNum) {
      ctx.fillStyle = LIME;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, String(l.num), 'Bungee', h * 0.62, numW - 8);
      ctx.fillText(String(l.num), x0 + 10 + numW / 2, h / 2 + 3);
      ctx.fillStyle = 'rgba(170,255,0,0.5)';
      ctx.fillRect(x0 + numW + 12, h * 0.22, 2, h * 0.56);
    }
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    const text = l.name.toUpperCase();
    fitFont(ctx, text, 'Bungee', h * (lines.length > 1 ? 0.3 : 0.4), colW - numW - 34);
    ctx.fillText(text, x0 + numW + 22, h / 2 + 3);
  });
}

// ---------------------------------------------------------------- jersey

/**
 * A home jersey seen from the back as it hangs in the stall: silhouette in
 * the alpha (cut out with alphaTest), mesh fabric, lime sleeve stripes, the
 * name bar arched across the shoulders and the number.
 */
export function drawJersey(c: HTMLCanvasElement, name: string, num: number): void {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const sx = w / 512;
  const sy = h / 640;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.scale(sx, sy);
  const body = new Path2D();
  body.moveTo(200, 30);
  body.quadraticCurveTo(256, 42, 312, 30); // back collar
  body.lineTo(452, 72); // right shoulder
  body.lineTo(498, 206); // sleeve outer
  body.lineTo(410, 226); // cuff
  body.lineTo(398, 194); // armpit
  body.quadraticCurveTo(404, 420, 400, 612); // side
  body.quadraticCurveTo(256, 624, 112, 612); // hem
  body.quadraticCurveTo(108, 420, 114, 194);
  body.lineTo(102, 226);
  body.lineTo(14, 206);
  body.lineTo(60, 72);
  body.closePath();
  ctx.fillStyle = '#141517';
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // Mesh fabric: a fine dot lattice, and soft vertical folds from the hanger.
  for (let y = 0; y < 640; y += 6)
    for (let x = (y / 6) % 2 ? 3 : 0; x < 512; x += 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(x, y, 2, 2);
    }
  const folds = ctx.createLinearGradient(0, 0, 512, 0);
  [0, 0.12, 0.3, 0.46, 0.6, 0.78, 0.9, 1].forEach((t, i) => folds.addColorStop(t, i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.28)'));
  ctx.fillStyle = folds;
  ctx.fillRect(0, 0, 512, 640);
  // Sleeve stripes (lime, white, lime) near the cuffs.
  for (const [a, b] of [
    [[60, 72], [14, 206]],
    [[452, 72], [498, 206]],
  ] as const) {
    for (const [k, col, wdt] of [
      [0.66, LIME, 10],
      [0.74, '#e8e8e8', 5],
      [0.8, LIME, 10],
    ] as const) {
      const x = a[0] + (b[0] - a[0]) * k;
      const y = a[1] + (b[1] - a[1]) * k;
      ctx.strokeStyle = col;
      ctx.lineWidth = wdt;
      ctx.beginPath();
      const inward = a[0] < 256 ? 1 : -1;
      ctx.moveTo(x - 4 * inward, y);
      ctx.lineTo(x + 92 * inward, y + 22);
      ctx.stroke();
    }
  }
  // Collar trim and side panels.
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(200, 32);
  ctx.quadraticCurveTo(256, 44, 312, 32);
  ctx.stroke();
  ctx.fillStyle = 'rgba(170,255,0,0.85)';
  ctx.fillRect(106, 250, 10, 380);
  ctx.fillRect(396, 250, 10, 380);
  // Name bar, arched with the shoulders.
  const text = name.toUpperCase();
  ctx.fillStyle = INK;
  const size = fitFont(ctx, text, 'Bungee', 44, 300);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, x) => s + x, 0) + (chars.length - 1) * size * 0.06;
  let x = 256 - total / 2;
  chars.forEach((ch, i) => {
    const cx = x + widths[i]! / 2;
    const u = (cx - 256) / 200;
    ctx.save();
    ctx.translate(cx, 104 + 16 * u * u);
    ctx.rotate(u * 0.12);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    x += widths[i]! + size * 0.06;
  });
  // Number: white with a lime outline, block type.
  const n = String(num);
  ctx.font = `${n.length > 1 ? 230 : 250}px Bungee`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 16;
  ctx.strokeStyle = LIME;
  ctx.strokeText(n, 256, 330);
  ctx.fillStyle = '#d6d6d6';
  ctx.fillText(n, 256, 330);
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- stickers

export interface StickerSpec {
  /** "SF · 1980s": team + decade tag. */
  tag: { team: string; decade: string } | null;
  traits: string[];
  allPro: number;
  pos: string;
  posColor: string;
}

/**
 * The seat cabinet's front: black lacquer, and once he's drafted, stickers
 * slapped on at slight angles (team+decade tag, a trait badge or two, the
 * All-Pro count). `shown` (0..n) reveals them one by one as the locker dresses.
 */
export function drawStickers(c: HTMLCanvasElement, spec: StickerSpec | null, shown = 99): void {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#141416');
  g.addColorStop(1, '#0a0a0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.05, 7, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, 0, w, 3);
  if (!spec) return;
  type Sticker = { text: string; bg: string; fg: string; border: string; star?: boolean };
  const list: Sticker[] = [];
  if (spec.tag) {
    const dh = DECADE_HEX[spec.tag.decade];
    list.push({ text: `${spec.tag.team} · ${spec.tag.decade}`, bg: '#f4f1e8', fg: '#111', border: dh?.text ?? LIME });
  }
  for (const t of spec.traits.slice(0, 2)) list.push({ text: t, bg: '#101112', fg: LIME, border: LIME });
  if (spec.allPro > 0) list.push({ text: `${spec.allPro}× All-Pro`, bg: '#ffd400', fg: '#111', border: '#fff2a0', star: true });
  const scale = h / 180;
  let x = 22 * scale;
  let row = 0;
  list.slice(0, shown).forEach((s, i) => {
    ctx.save();
    ctx.font = `${Math.round(30 * scale)}px Bungee`;
    const tw = ctx.measureText(s.text).width + (s.star ? 40 * scale : 0);
    const sw = tw + 34 * scale;
    const sh = 56 * scale;
    if (x + sw > w - 16 * scale) {
      row++;
      x = 30 * scale;
    }
    const y = (26 + row * 72) * scale;
    const rot = [-0.05, 0.035, -0.02, 0.05][i % 4]!;
    ctx.translate(x + sw / 2, y + sh / 2);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 3 * scale;
    ctx.fillStyle = s.bg;
    ctx.beginPath();
    ctx.roundRect(-sw / 2, -sh / 2, sw, sh, 12 * scale);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = s.border;
    ctx.lineWidth = 4 * scale;
    ctx.stroke();
    ctx.fillStyle = s.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.text, s.star ? 18 * scale : 0, 3 * scale);
    if (s.star) star(ctx, -sw / 2 + 30 * scale, 0, 15 * scale, s.fg);
    ctx.restore();
    x += sw + 16 * scale;
  });
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ---------------------------------------------------------------- room surfaces

/**
 * The carpet: charcoal cut pile with a lime ring and the team name at the
 * center of the room (our own mark; no league branding anywhere).
 */
export function carpetTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(2048, 2048);
  ctx.fillStyle = '#17181a';
  ctx.fillRect(0, 0, 2048, 2048);
  grain(ctx, 2048, 2048, 0.07, 3, 2);
  const cx = 1024;
  const cy = 1024;
  // Outer border band follows the room's wall.
  ctx.strokeStyle = '#0d0d0e';
  ctx.lineWidth = 60;
  ctx.beginPath();
  ctx.arc(cx, cy, 990, 0, Math.PI * 2);
  ctx.stroke();
  // The ring and wordmark.
  ctx.strokeStyle = LIME;
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(cx, cy, 360, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 318, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#0e0f10';
  ctx.beginPath();
  ctx.arc(cx, cy, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = LIME;
  ctx.font = '150px Bungee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', cx, cy + 8);
  // Arc text around the ring.
  const ringText = (text: string, radius: number, start: number, dir: 1 | -1) => {
    ctx.font = '56px Bungee';
    const chars = [...text];
    const span = chars.reduce((s, ch) => s + ctx.measureText(ch).width + 10, 0) / radius;
    let a = start - (dir * span) / 2;
    for (const ch of chars) {
      const cw = (ctx.measureText(ch).width + 10) / radius;
      a += (dir * cw) / 2;
      ctx.save();
      ctx.translate(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
      ctx.rotate(a + (dir * Math.PI) / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      a += (dir * cw) / 2;
    }
  };
  ctx.fillStyle = '#e9e9e9';
  ringText('CONTENDERS', 430, -Math.PI / 2, 1);
  ctx.fillStyle = 'rgba(170,255,0,0.8)';
  ringText('ALL-TIME', 460, Math.PI / 2, -1);
  const t = canvasTexture(c);
  t.anisotropy = 8;
  return t;
}

/** Dark stained wood slats for the walls between and behind the stalls. */
export function slatTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#1b1411';
  ctx.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 32) {
    const g = ctx.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, '#0c0908');
    g.addColorStop(0.12, '#2a1e18');
    g.addColorStop(0.5, '#231913');
    g.addColorStop(0.92, '#1a120e');
    g.addColorStop(1, '#070505');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 32, 512);
  }
  // Grain streaks.
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '255,220,190' : '0,0,0'},${0.03 + rnd() * 0.05})`;
    ctx.fillRect(x, y, 1, 20 + rnd() * 80);
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Interior back panel of a stall: fine vertical grooves, lit from the top when the stall is lit. */
export function backPanelTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 512);
  ctx.fillStyle = '#1d1d20';
  ctx.fillRect(0, 0, 256, 512);
  for (let x = 0; x < 256; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, 0, 2, 512);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 2, 0, 1, 512);
  }
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  return canvas(w, h)[0];
}
