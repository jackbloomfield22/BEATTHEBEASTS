import * as THREE from 'three';
import { POS_HEX } from '@data/legacy/palette';
import type { Slot } from '@data/legacy/types';
import { ARC_R, CEILING_Y, LOCKER_D, LOCKER_H, ROD_Y, SEAT_H, SHELF_Y, TOP_H, frontOf, onArc, type LockerPlace } from './layout';
import { lockerLit, lockerLightsWorld, lockerLightUniforms } from './lockerLights';
import { cleatGeometry, gloveGeometry, hangerGeometry, helmetGeometry, jerseyGeometry, towelGeometry } from './props';
import { canvasTexture, drawJersey, drawNameplate, drawStickers, makeCanvas, type PlateLine, type StickerSpec } from './textures';

// One stall of the Contenders' locker room and the way it dresses itself
// when its man is drafted (M6 brief): the nameplate lights with his name and
// number, the stall light and the position-colored underlight come on, the
// jersey drops onto the hanger, the helmet lands on the shelf, gloves and a
// towel go over the shelf's edge, the cleats land on the floor, and the
// stickers go on one by one. About 2.8 s; `dress(..., true)` sets the end
// state at once (a room restored from a finished draft).

export const POS_OF_SLOT: Record<Slot, 'QB' | 'RB' | 'WR' | 'TE' | 'OL'> = { QB: 'QB', RB: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', WR3: 'WR', TE: 'TE', TE2: 'TE', OL: 'OL' };

/** What a dressed stall shows (one man; five for the OL). */
export interface LockerOccupant {
  men: { name: string; jerseyName: string; num: number }[];
  stickers: StickerSpec;
}

export interface SharedLockerAssets {
  lacquer: THREE.MeshStandardMaterial;
  back: THREE.MeshStandardMaterial;
  cushion: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  helmetShell: THREE.MeshStandardMaterial;
  helmetStripe: THREE.MeshStandardMaterial;
  helmetMask: THREE.MeshStandardMaterial;
  cleatUpper: THREE.MeshStandardMaterial;
  cleatSole: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  towel: THREE.MeshStandardMaterial;
  poolTex: THREE.Texture;
  geo: {
    box: THREE.BoxGeometry;
    plane: THREE.PlaneGeometry;
    rod: THREE.CylinderGeometry;
    helmet: ReturnType<typeof helmetGeometry>;
    jersey: THREE.BufferGeometry;
    hanger: THREE.BufferGeometry;
    cleat: ReturnType<typeof cleatGeometry>;
    glove: THREE.BufferGeometry;
    towel: THREE.BufferGeometry;
  };
}

export function createSharedLockerAssets(lit: <M extends THREE.MeshStandardMaterial>(m: M) => M, backTex: THREE.Texture): SharedLockerAssets {
  const std = (p: THREE.MeshStandardMaterialParameters) => lit(new THREE.MeshStandardMaterial(p));
  return {
    lacquer: std({ color: 0x0e0e10, roughness: 0.32, metalness: 0.05 }),
    back: std({ color: 0x3a3a3e, map: backTex, roughness: 0.75 }),
    cushion: std({ color: 0x151517, roughness: 0.55 }),
    chrome: std({ color: 0xd8d8dc, roughness: 0.25, metalness: 1 }),
    helmetShell: std({ color: 0x111214, roughness: 0.16, metalness: 0.15 }),
    helmetStripe: std({ color: 0xaaff00, roughness: 0.3, emissive: new THREE.Color(0xaaff00), emissiveIntensity: 0.12 }),
    helmetMask: std({ color: 0x0c0c0d, roughness: 0.45, metalness: 0.6 }),
    cleatUpper: std({ color: 0x141416, roughness: 0.4 }),
    cleatSole: std({ color: 0xaaff00, roughness: 0.5 }),
    glove: std({ color: 0x1a1b1e, roughness: 0.6 }),
    towel: std({ color: 0xe9e7e2, roughness: 0.95, side: THREE.DoubleSide }),
    poolTex: poolTexture(),
    geo: {
      box: new THREE.BoxGeometry(1, 1, 1),
      plane: new THREE.PlaneGeometry(1, 1),
      rod: new THREE.CylinderGeometry(0.012, 0.012, 1, 10).rotateZ(Math.PI / 2),
      helmet: helmetGeometry(),
      jersey: jerseyGeometry(),
      hanger: hangerGeometry(),
      cleat: cleatGeometry(),
      glove: gloveGeometry(),
      towel: towelGeometry(),
    },
  };
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** A drop under gravity from `h` meters that lands at `land` s after `start`, then a small bounce. */
function drop(t: number, start: number, land: number, h: number, bounce = 0.02): number {
  if (t < start) return h;
  if (t < land) {
    const u = (t - start) / (land - start);
    return h * (1 - u * u);
  }
  const b = t - land;
  return bounce * Math.max(0, Math.sin(b * 14)) * Math.exp(-b * 9);
}

/** Warm white of the stall lights (≈3200 K, as the references' stall lamps). */
const WARM = new THREE.Color(1, 0.8, 0.58);

export class Locker {
  readonly group = new THREE.Group();
  readonly place: LockerPlace;
  readonly pos: 'QB' | 'RB' | 'WR' | 'TE' | 'OL';
  readonly posColor: THREE.Color;
  private plate: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial };
  private stickers: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private strip: THREE.MeshBasicMaterial;
  private under: THREE.MeshBasicMaterial;
  private lightIdx: number;
  private kit = new THREE.Group();
  private jerseys: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; hanger: THREE.Mesh; baseY: number }[] = [];
  private helmets: THREE.Group[] = [];
  private shelfKit = new THREE.Group();
  private cleats = new THREE.Group();
  occupant: LockerOccupant | null = null;
  /** Time since the dressing started (s), or null when idle. */
  private t: number | null = null;
  private stickersShown = 0;
  /** 0..1 how "on" the stall's lights are (a lit, dressed stall = 1). */
  private lit = 0;
  /** The room's light levels (set by the mood). */
  levels = { stall: 14, under: 9, emptyStall: 0.0, plate: 2.2, wash: 5, pool: 0.5 };
  private pool: THREE.MeshBasicMaterial;

  constructor(place: LockerPlace, shared: SharedLockerAssets) {
    this.place = place;
    this.pos = POS_OF_SLOT[place.slot];
    this.posColor = new THREE.Color(POS_HEX[this.pos]!.solid);
    this.lightIdx = place.index;
    const W = place.width;
    const g = this.group;
    g.position.copy(place.pos);
    g.rotation.y = place.rotY;
    const { geo } = shared;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geo.box, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    const D = LOCKER_D;
    // Frame: sides, top cabinet, seat cabinet, shelf, rod, back.
    for (const s of [-1, 1]) box(0.05, LOCKER_H, D, s * (W / 2 - 0.025), LOCKER_H / 2, -D / 2, shared.lacquer);
    box(W, TOP_H, D, 0, LOCKER_H - TOP_H / 2, -D / 2, shared.lacquer);
    box(W - 0.1, SEAT_H - 0.08, D - 0.04, 0, 0.08 + (SEAT_H - 0.08) / 2, -D / 2 - 0.02, shared.lacquer);
    box(W - 0.14, 0.08, D - 0.12, 0, 0.04, -D / 2 - 0.06, shared.lacquer); // recessed toe kick
    box(W - 0.12, 0.06, D - 0.1, 0, SEAT_H + 0.03, -D / 2 - 0.03, shared.cushion);
    box(W - 0.1, 0.025, D - 0.1, 0, SHELF_Y, -D / 2 - 0.05, shared.lacquer);
    const rod = new THREE.Mesh(geo.rod, shared.chrome);
    rod.scale.set(1, W - 0.1, 1);
    rod.position.set(0, ROD_Y, -D / 2 - 0.02);
    g.add(rod);
    const back = new THREE.Mesh(geo.plane, shared.back);
    back.scale.set(W - 0.1, LOCKER_H - TOP_H - SEAT_H, 1);
    back.position.set(0, SEAT_H + (LOCKER_H - TOP_H - SEAT_H) / 2, -D + 0.02);
    (shared.back.map as THREE.Texture).repeat.set(1, 1);
    g.add(back);

    // Nameplate on the top cabinet's face (the canvas is its emissive map too).
    const pc = makeCanvas(place.slot === 'OL' ? 2048 : 1024, 160);
    drawNameplate(pc, null);
    const ptex = canvasTexture(pc);
    const pmat = new THREE.MeshStandardMaterial({ map: ptex, emissiveMap: ptex, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, roughness: 0.35, metalness: 0.4 });
    const plate = new THREE.Mesh(geo.plane, pmat);
    plate.scale.set(W - 0.12, 0.17, 1);
    plate.position.set(0, LOCKER_H - TOP_H / 2, 0.002);
    g.add(plate);
    this.plate = { canvas: pc, tex: ptex, mat: pmat };

    // Sticker strip: the seat cabinet's face.
    const sc = makeCanvas(place.slot === 'OL' ? 1024 : 512, 180);
    drawStickers(sc, null);
    const stex = canvasTexture(sc);
    const sticker = new THREE.Mesh(geo.plane, new THREE.MeshStandardMaterial({ map: stex, roughness: 0.4 }));
    sticker.scale.set(W - 0.1, SEAT_H - 0.1, 1);
    sticker.position.set(0, 0.08 + (SEAT_H - 0.08) / 2, -0.019);
    g.add(sticker);
    this.stickers = { canvas: sc, tex: stex };

    // Stall light strip under the shelf's front edge; underlight in the toe kick.
    this.strip = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const strip = new THREE.Mesh(geo.box, this.strip);
    strip.scale.set(W - 0.16, 0.012, 0.02);
    strip.position.set(0, SHELF_Y - 0.02, -0.12);
    g.add(strip);
    this.under = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const under = new THREE.Mesh(geo.box, this.under);
    under.scale.set(W - 0.16, 0.014, 0.012);
    under.position.set(0, 0.075, -0.07);
    g.add(under);

    // The underlight's pool on the carpet (additive; the light loop lights
    // the carpet too, but a soft decal keeps the color reading at a distance).
    this.pool = new THREE.MeshBasicMaterial({ map: shared.poolTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const pool = new THREE.Mesh(geo.plane, this.pool);
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(W + 0.5, 1.5, 1);
    pool.position.set(0, 0.004, 0.62);
    g.add(pool);

    // The kit (hidden until dressed).
    g.add(this.kit);
    this.kit.visible = false;
    const men = place.slot === 'OL' ? 5 : 1;
    const spacing = men > 1 ? (W - 0.2) / men : 0;
    const scale = men > 1 ? 0.76 : 1;
    for (let i = 0; i < men; i++) {
      const x = men > 1 ? -((W - 0.2) / 2) + spacing * (i + 0.5) : 0;
      const hanger = new THREE.Mesh(geo.hanger, shared.chrome);
      hanger.position.set(x, ROD_Y - 0.07, -D / 2 - 0.02 + i * 0.012);
      hanger.scale.setScalar(scale);
      const jc = makeCanvas(512, 640);
      const jtex = canvasTexture(jc);
      const jersey = new THREE.Mesh(geo.jersey, lockerLit(new THREE.MeshStandardMaterial({ map: jtex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82 })));
      jersey.scale.setScalar(scale);
      jersey.position.set(x, ROD_Y - 0.09, -D / 2 - 0.02 + i * 0.012);
      this.kit.add(hanger, jersey);
      this.jerseys.push({ mesh: jersey, canvas: jc, tex: jtex, hanger, baseY: jersey.position.y });
      // Helmet on the shelf, facemask out, turned a little.
      const helmet = new THREE.Group();
      helmet.add(new THREE.Mesh(geo.helmet.shell, shared.helmetShell), new THREE.Mesh(geo.helmet.stripe, shared.helmetStripe), new THREE.Mesh(geo.helmet.mask, shared.helmetMask));
      helmet.scale.setScalar(men > 1 ? 0.92 : 1);
      helmet.position.set(men > 1 ? x : -0.12, SHELF_Y + 0.0125 + 0.135, -D / 2 - 0.02);
      helmet.rotation.y = men > 1 ? 0.2 * (i - 2) : 0.38;
      helmet.userData.baseY = helmet.position.y;
      this.kit.add(helmet);
      this.helmets.push(helmet);
    }
    // Towel and gloves over the shelf's front edge; cleats on the floor.
    const edgeZ = -D / 2 - 0.05 + (D - 0.1) / 2;
    const towel = new THREE.Mesh(geo.towel, shared.towel);
    towel.position.set(men > 1 ? -W / 2 + 0.3 : 0.22, SHELF_Y + 0.0125, edgeZ);
    towel.scale.set(men > 1 ? 1 : 0.85, 1, 1);
    this.shelfKit.add(towel);
    if (men === 1)
      for (const s of [-1, 1]) {
        const glove = new THREE.Mesh(geo.glove, shared.glove);
        glove.rotation.set(-Math.PI / 2 + 0.12, 0, s * 0.1);
        glove.position.set(-0.3 + s * 0.05, SHELF_Y + 0.02, edgeZ + 0.02 + (s > 0 ? 0.006 : 0));
        this.shelfKit.add(glove);
      }
    this.kit.add(this.shelfKit);
    const cleatPairs = men > 1 ? [-0.8, -0.4, 0, 0.4, 0.8] : [0];
    for (const cx of cleatPairs)
      for (const s of [-1, 1]) {
        const c = new THREE.Group();
        c.add(new THREE.Mesh(geo.cleat.upper, shared.cleatUpper), new THREE.Mesh(geo.cleat.sole, shared.cleatSole));
        c.position.set(cx + s * 0.085, 0, 0.16);
        c.rotation.y = s * 0.12 + cx * 0.1;
        this.cleats.add(c);
      }
    this.kit.add(this.cleats);

    // World-space lights for the shared loop.
    g.updateMatrixWorld(true);
    const stall = lockerLightsWorld[this.lightIdx]!;
    stall.pos.set(0, SHELF_Y - 0.03, -0.1).applyMatrix4(g.matrixWorld);
    stall.dir.set(0, -1, -0.45).normalize().transformDirection(g.matrixWorld);
    stall.color.copy(WARM);
    lockerLightUniforms.uLkCone.value[this.lightIdx]!.set(-0.2, 0.55, 3);
    const ul = lockerLightsWorld[9 + this.lightIdx]!;
    ul.pos.set(0, 0.07, -0.02).applyMatrix4(g.matrixWorld);
    ul.dir.set(0, -0.35, 1).normalize().transformDirection(g.matrixWorld);
    ul.color.copy(this.posColor);
    lockerLightUniforms.uLkCone.value[9 + this.lightIdx]!.set(-0.1, 0.7, 2.5);
    // Ceiling washer: from above the bench line, aimed at the stall's face.
    const wa = lockerLightsWorld[18 + this.lightIdx]!;
    wa.pos.copy(frontOf(place, 1.5, CEILING_Y - 0.08));
    wa.dir.copy(onArc(place.angle, ARC_R, 1.4)).sub(wa.pos).normalize();
    wa.color.set(1, 0.84, 0.66);
    lockerLightUniforms.uLkCone.value[18 + this.lightIdx]!.set(0.8, 0.95, 0.12);
    this.clear();
  }

  /** Dress the stall for a drafted man (or men). `instant` skips the animation. */
  dress(o: LockerOccupant, instant = false): void {
    this.occupant = o;
    const lines: PlateLine[] = o.men.map((m) => ({ name: m.jerseyName, num: m.num }));
    drawNameplate(this.plate.canvas, lines);
    this.plate.tex.needsUpdate = true;
    o.men.forEach((m, i) => {
      const j = this.jerseys[i];
      if (!j) return;
      drawJersey(j.canvas, m.jerseyName, m.num);
      j.tex.needsUpdate = true;
    });
    this.kit.visible = true;
    this.t = instant ? 99 : 0;
    this.stickersShown = instant ? 99 : 0;
    drawStickers(this.stickers.canvas, o.stickers, this.stickersShown);
    this.stickers.tex.needsUpdate = true;
    this.update(0);
  }

  /** Back to bare: blank plate, dark shelf, an empty hanger. */
  clear(): void {
    this.occupant = null;
    this.t = null;
    drawNameplate(this.plate.canvas, null);
    this.plate.tex.needsUpdate = true;
    drawStickers(this.stickers.canvas, null);
    this.stickers.tex.needsUpdate = true;
    this.kit.visible = true;
    // Only the hanger(s) stay.
    for (const j of this.jerseys) j.mesh.visible = false;
    for (const h of this.helmets) h.visible = false;
    this.shelfKit.visible = false;
    this.cleats.visible = false;
    this.lit = 0;
    this.plate.mat.emissiveIntensity = 0;
    this.applyLights();
  }

  /** Redraw textures (after the display font loads). */
  redraw(): void {
    if (this.occupant) {
      drawNameplate(this.plate.canvas, this.occupant.men.map((m) => ({ name: m.jerseyName, num: m.num })));
      this.occupant.men.forEach((m, i) => this.jerseys[i] && drawJersey(this.jerseys[i]!.canvas, m.jerseyName, m.num));
      for (const j of this.jerseys) j.tex.needsUpdate = true;
      drawStickers(this.stickers.canvas, this.occupant.stickers, this.stickersShown);
    } else {
      drawNameplate(this.plate.canvas, null);
      drawStickers(this.stickers.canvas, null);
    }
    this.plate.tex.needsUpdate = true;
    this.stickers.tex.needsUpdate = true;
  }

  get dressing(): boolean {
    return this.t !== null && this.t < DRESS_END;
  }

  update(dt: number): void {
    if (this.t === null) return;
    this.t += dt;
    const t = this.t;
    // Lights: the stall lamp flickers on like a tube starting, the plate
    // wipes up, the underlight swells in the position color.
    const flick = t < 0.08 ? 1 : t < 0.14 ? 0.1 : t < 0.2 ? 0.8 : t < 0.24 ? 0.3 : 1;
    this.lit = clamp01(t / 0.25) * flick;
    this.plate.mat.emissiveIntensity = this.levels.plate * ease(clamp01((t - 0.05) / 0.45));
    const u = ease(clamp01((t - 0.1) / 0.6));
    this.applyLights(u);
    // Jersey drops onto the hanger and sways to rest.
    this.jerseys.forEach((j, i) => {
      if (!this.occupant || i >= this.occupant.men.length) {
        j.mesh.visible = false;
        return;
      }
      const start = 0.35 + i * 0.07;
      j.mesh.visible = t >= start;
      j.mesh.position.y = j.baseY + drop(t, start, start + 0.3, 0.5, 0.012);
      const s = Math.max(0, t - start - 0.3);
      j.mesh.rotation.z = 0.06 * Math.sin(s * 7) * Math.exp(-s * 3.2);
      j.mesh.rotation.x = -0.05 * Math.sin(s * 5.5 + 0.6) * Math.exp(-s * 3);
      j.hanger.rotation.z = j.mesh.rotation.z;
    });
    // Helmet lands on the shelf.
    this.helmets.forEach((h, i) => {
      const start = 0.8 + i * 0.06;
      h.visible = t >= start;
      h.position.y = (h.userData.baseY as number) + drop(t, start, start + 0.25, 0.42, 0.018);
    });
    // Towel and gloves.
    const k = clamp01((t - 1.2) / 0.25);
    this.shelfKit.visible = t >= 1.2;
    this.shelfKit.scale.set(1, 0.3 + 0.7 * ease(k) + 0.05 * Math.sin(k * Math.PI), 1);
    // Cleats.
    this.cleats.visible = t >= 1.45;
    this.cleats.position.y = drop(t, 1.45, 1.65, 0.3, 0.015);
    // Stickers go on one by one.
    const n = t < 1.8 ? 0 : Math.floor((t - 1.8) / 0.2) + 1;
    if (n !== this.stickersShown && this.stickersShown < 99) {
      this.stickersShown = Math.min(n, 9);
      drawStickers(this.stickers.canvas, this.occupant?.stickers ?? null, this.stickersShown);
      this.stickers.tex.needsUpdate = true;
      if (t > 3.5) this.stickersShown = 99;
    }
  }

  /** Push this stall's light levels into the shared loop and the emissive strips. */
  applyLights(under = this.occupant ? 1 : 0): void {
    const stall = lockerLightsWorld[this.lightIdx]!;
    const on = this.occupant ? this.lit : 0;
    stall.intensity = this.levels.stall * on + this.levels.emptyStall * (1 - on);
    this.strip.color.copy(WARM).multiplyScalar(0.2 + 5 * on);
    const ul = lockerLightsWorld[9 + this.lightIdx]!;
    ul.intensity = this.levels.under * under;
    this.under.color.copy(this.posColor).multiplyScalar(0.15 + 4 * under);
    this.pool.color.copy(this.posColor).multiplyScalar(this.levels.pool * under);
    lockerLightsWorld[18 + this.lightIdx]!.intensity = this.levels.wash * (0.55 + 0.45 * on);
  }
}

/** A soft pool of light: brightest at the stall's toe kick (top edge), fading out across the carpet. */
function poolTexture(): THREE.Texture {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 0, 4, 64, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return canvasTexture(c, false);
}

/** When the room's time runs past this, a dressing is over. */
export const DRESS_END = 2.9;
