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

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', font = 'Bungee'): void {
    const ctx = this.ctx;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
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
    const pages = c.page === 0 ? groups : [groups[c.page - 1]!];
    let y = 150;
    const rowH = pages.length > 1 ? 44 : 90;
    for (const gp of pages) {
      this.text(gp.label.toUpperCase(), 60, y, 24, 'rgba(255,255,255,0.5)', 'left');
      y += pages.length > 1 ? 36 : 60;
      for (const b of gp.rows) {
        const big = pages.length === 1;
        ctx.fillStyle = POS_HEX[b.pos]?.solid ?? '#fff';
        ctx.fillRect(60, y - (big ? 26 : 16), big ? 90 : 60, big ? 52 : 32);
        this.text(b.pos, 60 + (big ? 45 : 30), y + 2, big ? 34 : 22, '#0a0a0a');
        this.text(b.name.toUpperCase(), big ? 180 : 140, y + 2, big ? 48 : 28, '#ffffff', 'left');
        this.text(`${b.team} · ${b.decade}`, W - 60, y + 2, big ? 30 : 22, DECADE_HEX[b.decade]?.text ?? '#ccc', 'right');
        y += rowH;
      }
      y += 16;
    }
    // Page dots.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === c.page ? '#ffffff' : 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.arc(W / 2 - 45 + i * 30, H - 44, 8, 0, Math.PI * 2);
      ctx.fill();
    }
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
