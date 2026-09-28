import * as THREE from 'three';
import { DECADE_HEX, POS_HEX } from '@data/legacy/palette';
import { canvasTexture, LIME } from './textures';

// The video wall at the end of the row (M6 brief): the slot machine spins on
// it, and the Beasts show there as a flippable lineup. Drawn into a canvas
// only when something changes or moves (≈30 Hz while the reels spin), so an
// idle wall costs nothing but its texture.

export interface WallBeast {
  pos: string;
  name: string;
  team: string;
  decade: string;
  ovr: number;
}

export type WallContent =
  | { kind: 'idle'; round: number; title: string; sub: string }
  | { kind: 'slot'; teams: string[]; decades: string[]; final: { t: string; d: string }; startedAt: number; duration: number; round: number; note?: string }
  | { kind: 'beasts'; beasts: WallBeast[]; page: number; showOvr: boolean; rating: number | null; tier: { l: string; c: string } | null }
  | { kind: 'pick'; name: string; pos: string; num: number; team: string; decade: string; ovr: number | null; round: number };

const W = 1280;
const H = 720;
const BEASTS_RED = '#ff2a4d';
/** The wall's body face (the second typeface, M6.6): team and decade lines. */
const WALL_BODY = '"Barlow Semi Condensed", "Barlow", sans-serif';

/**
 * The wall's material multiplies the canvas by `brightness` (2.2) so the
 * screen is the room's brightest surface; full-white type then read 2.2 in
 * linear light, far over the room's bloom threshold (0.85 pregame, 0.75
 * lights down), and the team and year on the reels haloed into mush
 * (Playtest 1). Type is capped instead: every text color is scaled (in
 * linear light) so its brightest channel lands at TEXT_PEAK after the
 * multiply, under both thresholds. The lit field behind it keeps its level.
 */
export const TEXT_PEAK = 0.62;

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** A text color for the wall: the same hue, no brighter than TEXT_PEAK (linear) once the wall's brightness is applied. */
export function wallInk(color: string, brightness: number): string {
  let rgb: number[];
  let a = 1;
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  const fn = /^rgba?[(]([^)]+)[)]$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if (fn) {
    const p = fn[1]!.split(',').map((x) => Number(x.trim()));
    rgb = [p[0]!, p[1]!, p[2]!];
    a = p[3] ?? 1;
  } else return color;
  const lin = rgb.map((c) => toLin(c / 255));
  const peak = Math.max(...lin) * brightness;
  const k = peak > TEXT_PEAK ? TEXT_PEAK / peak : 1;
  const [R, G, B] = lin.map((c) => Math.round(toSrgb(c * k) * 255));
  return a < 1 ? `rgba(${R},${G},${B},${a})` : `rgb(${R},${G},${B})`;
}

export class VideoWall {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private ctx: CanvasRenderingContext2D;
  private content: WallContent = { kind: 'idle', round: 0, title: 'The Draft', sub: '' };
  private lastDraw = -1;
  private dirty = true;
  /** Seconds the room has run (the wall's clock). */
  now = 0;
  brightness = 2.2;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = canvasTexture(this.canvas);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: new THREE.Color(1, 1, 1).multiplyScalar(this.brightness) });
  }

  set(c: WallContent): void {
    this.content = c;
    this.dirty = true;
  }

  get current(): WallContent {
    return this.content;
  }

  /** The reels are still turning. */
  get spinning(): boolean {
    const c = this.content;
    return c.kind === 'slot' && this.now - c.startedAt < c.duration + 0.6;
  }

  redraw(): void {
    this.dirty = true;
  }

  update(dt: number): void {
    this.now += dt;
    const animating = this.spinning;
    if (!this.dirty && !animating) return;
    if (animating && !this.dirty && this.now - this.lastDraw < 1 / 30) return;
    this.lastDraw = this.now;
    this.dirty = false;
    this.draw();
    this.texture.needsUpdate = true;
  }

  private draw(): void {
    const ctx = this.ctx;
    // Screen base: a lit field, the room's brightest surface (the owner's
    // brief: the room sits around a third of the wall), lime-green at the
    // center falling to deep green at the edges, then the scanline and frame.
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.62);
    g.addColorStop(0, '#46602a');
    g.addColorStop(0.55, '#1f2d13');
    g.addColorStop(1, '#0b1006');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.strokeStyle = 'rgba(170,255,0,0.4)';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    const c = this.content;
    if (c.kind === 'idle') this.drawIdle(c);
    else if (c.kind === 'slot') this.drawSlot(c);
    else if (c.kind === 'beasts') this.drawBeasts(c);
    else this.drawPick(c);
  }

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', font = 'Bungee', weight = ''): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${font}`.trim();
    ctx.fillStyle = wallInk(color, this.brightness);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    // A dark halo keeps type crisp on the lit field.
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = size * 0.35;
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  private header(round: number, label: string): void {
    this.text('CONTENDERS', 60, 70, 34, LIME, 'left');
    this.text(label, W - 60, 70, 30, '#dcdcdc', 'right');
    if (round > 0) {
      for (let i = 0; i < 9; i++) {
        this.ctx.fillStyle = i < round - 1 ? LIME : i === round - 1 ? '#ffffff' : 'rgba(255,255,255,0.15)';
        this.ctx.fillRect(W / 2 - 9 * 22 + i * 44, 60, 34, 10);
      }
    }
  }

  private drawIdle(c: Extract<WallContent, { kind: 'idle' }>): void {
    this.header(c.round, c.round ? `ROUND ${c.round} OF 9` : '');
    this.text(c.title.toUpperCase(), W / 2, H / 2 - 20, 110, '#ffffff');
    this.text(c.sub.toUpperCase(), W / 2, H / 2 + 90, 36, LIME);
  }

  private drawSlot(c: Extract<WallContent, { kind: 'slot' }>): void {
    this.header(c.round, `ROUND ${c.round} OF 9`);
    const t = this.now - c.startedAt;
    const reels: { items: string[]; final: string; x: number; w: number; stop: number; color: (s: string) => string }[] = [
      { items: c.teams, final: c.final.t, x: 150, w: 520, stop: c.duration * 0.82, color: () => '#ffffff' },
      { items: c.decades, final: c.final.d, x: 710, w: 420, stop: c.duration, color: (s) => DECADE_HEX[s]?.text ?? '#fff' },
    ];
    const ctx = this.ctx;
    const rowH = 150;
    const cy = 380;
    for (const r of reels) {
      ctx.save();
      ctx.fillStyle = '#0b0d0e';
      ctx.fillRect(r.x, cy - 220, r.w, 440);
      ctx.beginPath();
      ctx.rect(r.x, cy - 220, r.w, 440);
      ctx.clip();
      const n = r.items.length;
      const fi = Math.max(0, r.items.indexOf(r.final));
      // Reel position in rows: decelerates onto the final item (cubic ease-out
      // over the reel's time, ~5 turns), with a small overshoot and settle.
      const u = Math.min(1, t / r.stop);
      const turns = 5 * n;
      const pos = fi + turns * (1 - Math.pow(1 - u, 3)) - turns + (u >= 1 ? 0.12 * Math.sin((t - r.stop) * 18) * Math.exp(-(t - r.stop) * 8) : 0);
      const speed = u < 1 ? 3 * turns * Math.pow(1 - u, 2) / r.stop : 0;
      const blur = Math.min(5, speed / 12);
      for (let k = -2; k <= 2; k++) {
        const idx = Math.round(pos) + k;
        const item = r.items[((idx % n) + n) % n]!;
        const y = cy + (idx - pos) * rowH;
        const locked = u >= 1 && k === 0;
        const col = locked ? r.color(item) : 'rgba(255,255,255,0.75)';
        for (let b = 0; b <= blur; b++) {
          ctx.globalAlpha = (locked ? 1 : 0.9) / (1 + blur * 0.7);
          this.text(item, r.x + r.w / 2, y + b * 9 - (blur * 9) / 2, locked ? 108 : 92, col);
        }
        ctx.globalAlpha = 1;
      }
      // Glass shading top and bottom.
      const sh = ctx.createLinearGradient(0, cy - 220, 0, cy + 220);
      sh.addColorStop(0, 'rgba(0,0,0,0.9)');
      sh.addColorStop(0.3, 'rgba(0,0,0,0)');
      sh.addColorStop(0.7, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.9)');
      ctx.fillStyle = sh;
      ctx.fillRect(r.x, cy - 220, r.w, 440);
      ctx.restore();
      // The pay line.
      ctx.strokeStyle = u >= 1 ? LIME : 'rgba(170,255,0,0.35)';
      ctx.lineWidth = u >= 1 ? 6 : 3;
      ctx.strokeRect(r.x - 6, cy - rowH / 2, r.w + 12, rowH);
      // Lock flash.
      if (u >= 1 && t - r.stop < 0.35) {
        ctx.fillStyle = `rgba(170,255,0,${0.35 * (1 - (t - r.stop) / 0.35)})`;
        ctx.fillRect(r.x, cy - rowH / 2, r.w, rowH);
      }
    }
    if (t > c.duration + 0.2 && c.note) this.text(c.note.toUpperCase(), W / 2, H - 70, 30, LIME);
  }

  private drawBeasts(c: Extract<WallContent, { kind: 'beasts' }>): void {
    const ctx = this.ctx;
    this.text('THE BEASTS', 60, 70, 40, BEASTS_RED, 'left');
    // The draft shows no numbers: the tier's word, never the rating (c.rating and c.showOvr are ignored).
    if (c.tier) this.text(c.tier.l.toUpperCase(), W - 60, 70, 28, c.tier.c, 'right');
    const groups = [
      { label: 'Front', rows: c.beasts.filter((b) => b.pos === 'DE' || b.pos === 'DT') },
      { label: 'Linebackers', rows: c.beasts.filter((b) => b.pos === 'LB') },
      { label: 'Secondary', rows: c.beasts.filter((b) => b.pos === 'CB' || b.pos === 'S') },
    ];
    // All eleven (page 0) sit in two columns, the front and the backers on
    // the left, the secondary on the right, so the lineup stays inside the
    // frame (one column of eleven ran ~80 px past the bottom edge: Playtest 1,
    // "the Beasts panel overflows its border").
    const big = c.page !== 0;
    const cols = big
      ? [{ x: 60, w: W - 120, groups: [groups[c.page - 1]!] }]
      : [
          { x: 60, w: 560, groups: [groups[0]!, groups[1]!] },
          { x: 680, w: 540, groups: [groups[2]!] },
        ];
    const rowH = big ? 96 : 60;
    for (const col of cols) {
      let y = 150;
      for (const gp of col.groups) {
        this.text(gp.label.toUpperCase(), col.x, y, 24, 'rgba(255,255,255,0.5)', 'left');
        y += big ? 62 : 44;
        for (const b of gp.rows) {
          const boxW = big ? 90 : 64;
          const boxH = big ? 52 : 40;
          ctx.fillStyle = wallInk(POS_HEX[b.pos]?.solid ?? '#ffffff', this.brightness);
          ctx.fillRect(col.x, y - boxH / 2, boxW, boxH);
          this.text(b.pos, col.x + boxW / 2, y + 2, big ? 34 : 24, '#0a0a0a');
          const nx = col.x + boxW + 20;
          const name = b.name.toUpperCase();
          const era = `${b.team} · ${b.decade}`;
          const eraCol = DECADE_HEX[b.decade]?.text ?? '#cccccc';
          if (big) {
            this.text(name, nx, y + 2, this.fit(name, 'Bungee', 48, col.w - boxW - 260), '#ffffff', 'left');
            this.text(era, col.x + col.w, y + 2, 34, eraCol, 'right', WALL_BODY, '700');
          } else {
            this.text(name, nx, y - 9, this.fit(name, 'Bungee', 28, col.w - boxW - 24), '#ffffff', 'left');
            this.text(era, nx, y + 19, 22, eraCol, 'left', WALL_BODY, '700');
          }
          y += rowH;
        }
        y += 14;
      }
    }
    // Page dots.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === c.page ? wallInk('#ffffff', this.brightness) : 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(W / 2 - 45 + i * 30, H - 44, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The largest size (≤ max, in steps of 2) at which `s` fits `width`. */
  private fit(s: string, font: string, max: number, width: number): number {
    let size = max;
    this.ctx.font = `${size}px ${font}`;
    while (size > 14 && this.ctx.measureText(s).width > width) this.ctx.font = `${(size -= 2)}px ${font}`;
    return size;
  }

  private drawPick(c: Extract<WallContent, { kind: 'pick' }>): void {
    this.header(c.round, `PICK ${c.round}`);
    const col = POS_HEX[c.pos]?.solid ?? LIME;
    this.ctx.fillStyle = col;
    this.ctx.fillRect(90, 200, 16, 330);
    this.text(c.pos, 140, 240, 56, col, 'left');
    this.text(`#${c.num}`, W - 90, 240, 70, '#ffffff', 'right');
    const name = c.name.toUpperCase();
    let size = 120;
    this.ctx.font = `${size}px Bungee`;
    while (size > 40 && this.ctx.measureText(name).width > W - 240) this.ctx.font = `${(size -= 4)}px Bungee`;
    this.text(name, 140, 370, size, '#ffffff', 'left');
    this.text(`${c.team} · ${c.decade}`, 140, 480, 44, DECADE_HEX[c.decade]?.text ?? LIME, 'left');
    // No OVR on the pick card (the draft shows no numbers; c.ovr is ignored).
  }
}
