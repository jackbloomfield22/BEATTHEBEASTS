import * as THREE from 'three';
import { ARC_R, CEILING_Y, DOOR, DOOR_ANGLE, LOCKERS, LOCKER_D, LOCKER_H, ROOM_R, WALL, WALL_ANGLE, onArc } from './layout';
import { lockerLit } from './lockerLights';
import { bounceTexture, carpetTexture, perforatedTexture, slatTexture, backPanelTexture } from './textures';
import { createSharedLockerAssets, Locker } from './locker';
import { VideoWall } from './videoWall';

// The Contenders' locker room shell (M6): carpet, the curved slat wall with
// the row of stalls, a lit perforated ceiling panel (ref-04), the bench on
// its underlit plinth, the video wall, and the tunnel door with its corridor
// out to the field. Built once; the stalls dress and undress on top of it.
//
// The room lights itself the way ref-04's does: every stall's edge frame and
// interior glow, the ceiling panel's holes, the bench's underlight and the
// carpet's bounce are self-lit surfaces, and the environment (ambient and
// reflections) is prefiltered from those same sources. The stalls' analytic
// lights (lockerLights.ts) add the lamp pools and the gloss on top; the room
// reads without them.

export type RoomMood = 'pregame' | 'lightsdown';

export interface MoodSpec {
  /** Ceiling ring and downlights (emissive). */
  ceiling: number;
  /** The perforated panel's holes, and the warm bounce on the ceiling around it. */
  panel: number;
  bounce: number;
  /** The carpet's bounce light (emissive, so its mark always reads). */
  carpet: number;
  /** The bench's underlight strip and its pool on the carpet. */
  bench: number;
  /** Stall edge frames: bare and dressed. */
  edgeEmpty: number;
  edge: number;
  /** Stall interior glow: bare and dressed. */
  innerEmpty: number;
  inner: number;
  /** A blank nameplate's glow. */
  plateEmpty: number;
  /** A bare stall's lamp, as a share of a dressed one's. */
  emptyStall: number;
  /** Stall lamp and underlight levels. */
  stall: number;
  under: number;
  plate: number;
  /** Ceiling washers on each stall's face, and the underlight's floor pool. */
  wash: number;
  pool: number;
  /** Ambient (the room's environment map). */
  env: number;
  exposure: number;
  bloom: number;
  threshold: number;
  accent: number;
  grade: { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number]; saturation: number; contrast: number };
}

/**
 * Two moods. Pregame: house lights up, warm and full; the ceiling panel
 * glows, the carpet and its mark read, every stall is lit. Lights down: the
 * room drops away (panel, bounce and carpet nearly off) and only the stall
 * edges, the plates, the bench strip and the video wall carry it, as a hype
 * video before the walk-out. The video wall is the brightest thing in both;
 * pregame's room sits around a third of its brightness (ref-04). Levels
 * tuned by eye and by the shots' measured luminance (M6 lighting pass).
 */
export const MOODS: Record<RoomMood, MoodSpec> = {
  pregame: {
    ceiling: 1.6,
    panel: 1.25,
    bounce: 0.55,
    carpet: 0.16,
    bench: 1.6,
    edgeEmpty: 1.6,
    edge: 3.2,
    innerEmpty: 0.55,
    inner: 1.2,
    plateEmpty: 0.8,
    emptyStall: 0.4,
    stall: 12,
    under: 7,
    plate: 2.4,
    wash: 7,
    pool: 0.2,
    env: 1.5,
    exposure: 1.05,
    bloom: 0.7,
    threshold: 0.85,
    accent: 0.9,
    grade: { lift: [0.01, 0.007, 0.004], gamma: [0.98, 1.0, 1.03], gain: [1.06, 1.0, 0.92], saturation: 1.08, contrast: 1.04 },
  },
  lightsdown: {
    ceiling: 0.15,
    panel: 0.12,
    bounce: 0.04,
    carpet: 0.035,
    bench: 1.3,
    edgeEmpty: 1.8,
    edge: 3.6,
    innerEmpty: 0.35,
    inner: 1.1,
    plateEmpty: 0.9,
    emptyStall: 0.25,
    stall: 16,
    under: 10,
    plate: 3,
    wash: 1.2,
    pool: 0.32,
    env: 0.35,
    exposure: 1.2,
    bloom: 1.0,
    threshold: 0.75,
    accent: 1.5,
    grade: { lift: [0.0, 0.004, 0.0], gamma: [1.0, 0.98, 1.02], gain: [1.0, 1.02, 0.96], saturation: 1.15, contrast: 1.12 },
  },
};

const WARM = new THREE.Color(1, 0.78, 0.55);
/** The dropped ceiling panel's radius: over the middle of the room, clear of the row's lamps. */
const PANEL_R = 5.4;

type GlowKind = 'ceiling' | 'accent' | 'tunnel' | 'panel' | 'bench';

/** A strip of pool light: bright along one long edge (the plinth), fading across the carpet. */
function poolStrip(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  // Canvas top = the plane's far edge (-Z in its frame, toward the plinth).
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 64);
  return new THREE.CanvasTexture(c);
}
const LIMEC = new THREE.Color(0xaaff00);

/** A frame on the arc: origin on the floor at `angle` and radius `r`, +Z toward the room's center. */
export function arcFrame(angle: number, r: number): THREE.Matrix4 {
  const p = onArc(angle, r);
  return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle), new THREE.Vector3(1, 1, 1));
}

export class Room {
  readonly scene = new THREE.Scene();
  readonly lockers: Locker[];
  readonly wall: VideoWall;
  readonly doorFrame = arcFrame(DOOR_ANGLE, ROOM_R);
  /** The field seen down the tunnel (a still of the stadium, rendered at entry). */
  readonly fieldView: THREE.MeshBasicMaterial;
  private emissive: { mat: THREE.MeshBasicMaterial; base: THREE.Color; kind: GlowKind }[] = [];
  private envScene = new THREE.Scene();
  private envMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color; kind: 'ceiling' | 'stall' | 'accent' | 'panel' }[] = [];
  /** Self-lit room surfaces whose emissive the mood sets. */
  private carpetMat: THREE.MeshStandardMaterial;
  private bounceMat: THREE.MeshStandardMaterial;
  mood: RoomMood = 'pregame';

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x020202);
    const shared = createSharedLockerAssets(lockerLit, backPanelTexture());
    this.lockers = LOCKERS.map((l) => new Locker(l, shared));
    for (const l of this.lockers) s.add(l.group);

    // Carpet: its own texture as a faint emissive (the bounce off the lit
    // ceiling and stalls), so the pile and the mark always read.
    const carpetTex = carpetTexture();
    this.carpetMat = lockerLit(new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.96, emissive: new THREE.Color(1, 0.94, 0.86), emissiveMap: carpetTex, emissiveIntensity: 0 }));
    const carpet = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R + 0.1, 96).rotateX(-Math.PI / 2), this.carpetMat);
    s.add(carpet);

    // Curved slat wall, open at the tunnel door.
    const doorHalf = (DOOR.width / 2 + 0.25) / ROOM_R;
    const slat = slatTexture();
    slat.repeat.set((2 * Math.PI * ROOM_R) / 1.1, 1);
    const wallMat = lockerLit(new THREE.MeshStandardMaterial({ map: slat, roughness: 0.62, side: THREE.BackSide }));
    // CylinderGeometry's theta starts at +Z and runs toward +X; our angles run from -Z toward +X.
    const toTheta = (a: number) => Math.PI - a;
    const wallGeo = new THREE.CylinderGeometry(ROOM_R + 0.05, ROOM_R + 0.05, CEILING_Y, 128, 1, true, toTheta(DOOR_ANGLE - doorHalf), 2 * Math.PI - 2 * doorHalf);
    wallGeo.translate(0, CEILING_Y / 2, 0);
    s.add(new THREE.Mesh(wallGeo, wallMat));
    // Over the door: a lintel of wall.
    const lintelGeo = new THREE.CylinderGeometry(ROOM_R + 0.05, ROOM_R + 0.05, CEILING_Y - DOOR.height, 16, 1, true, toTheta(DOOR_ANGLE + doorHalf), 2 * doorHalf);
    lintelGeo.translate(0, DOOR.height + (CEILING_Y - DOOR.height) / 2, 0);
    s.add(new THREE.Mesh(lintelGeo, wallMat));

    // Lime accent line above the row, and the fascia over the stalls.
    const span0 = LOCKERS[0]!.angle - LOCKERS[0]!.width / 2 / ARC_R;
    const span1 = LOCKERS[LOCKERS.length - 1]!.angle + LOCKERS[LOCKERS.length - 1]!.width / 2 / ARC_R;
    const accent = this.glow(LIMEC, 'accent');
    const band = new THREE.CylinderGeometry(ARC_R + 0.02, ARC_R + 0.02, 0.025, 96, 1, true, toTheta(span1), span1 - span0);
    band.translate(0, LOCKER_H + 0.12, 0);
    s.add(new THREE.Mesh(band, accent.mat));
    const fascia = new THREE.CylinderGeometry(ARC_R + 0.01, ARC_R + 0.01, 0.1, 96, 1, true, toTheta(span1), span1 - span0);
    fascia.translate(0, LOCKER_H + 0.05, 0);
    const fasciaMesh = new THREE.Mesh(fascia, lockerLit(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.4, side: THREE.BackSide })));
    s.add(fasciaMesh);

    // Ceiling (ref-04): a dropped perforated panel over the middle of the
    // room, its holes lit from above with the mark picked out in lime, a lit
    // reveal around its edge, and the plaster around it warm with bounce
    // from the panel and the row.
    this.bounceMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9, emissive: new THREE.Color(1, 0.9, 0.78), emissiveMap: bounceTexture(), emissiveIntensity: 0 });
    const ceil = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R + 0.1, 96).rotateX(Math.PI / 2), this.bounceMat);
    ceil.position.y = CEILING_Y;
    s.add(ceil);
    const panel = this.glow(new THREE.Color(1, 1, 1), 'panel');
    panel.mat.map = perforatedTexture();
    this.panelMat = panel.mat;
    const panelMesh = new THREE.Mesh(new THREE.CircleGeometry(PANEL_R, 96).rotateX(Math.PI / 2), panel.mat);
    panelMesh.position.y = CEILING_Y - 0.16;
    s.add(panelMesh);
    const soffit = new THREE.Mesh(new THREE.CylinderGeometry(PANEL_R, PANEL_R, 0.16, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.6, metalness: 0.4 }));
    soffit.position.y = CEILING_Y - 0.08;
    s.add(soffit);
    const ring = this.glow(WARM, 'ceiling');
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(PANEL_R + 0.03, 0.03, 6, 160).rotateX(Math.PI / 2), ring.mat);
    ringMesh.position.y = CEILING_Y - 0.16;
    s.add(ringMesh);
    const dl = this.glow(WARM, 'ceiling');
    const downs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07, 16).rotateX(Math.PI / 2), dl.mat, 28);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      downs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(7.3 * Math.sin(a), CEILING_Y - 0.005, -7.3 * Math.cos(a)));
    }
    s.add(downs);

    // Bench in front of the row: an upholstered arc with a lime welt.
    const r1 = ARC_R - 2.45;
    const r2 = ARC_R - 2.0;
    const a0 = span0 + 0.05;
    const a1 = span1 - 0.05;
    const seat = new THREE.Shape();
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const a = a0 + ((a1 - a0) * i) / N;
      const p = onArc(a, r2);
      if (i === 0) seat.moveTo(p.x, p.z);
      else seat.lineTo(p.x, p.z);
    }
    for (let i = N; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / N;
      const p = onArc(a, r1);
      seat.lineTo(p.x, p.z);
    }
    const seatGeo = new THREE.ExtrudeGeometry(seat, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 4 });
    seatGeo.rotateX(Math.PI / 2);
    seatGeo.translate(0, 0.46, 0);
    s.add(new THREE.Mesh(seatGeo, lockerLit(new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.38 }))));
    const welt = new THREE.CylinderGeometry(r1 - 0.015, r1 - 0.015, 0.018, 96, 1, true, toTheta(a1), a1 - a0);
    welt.translate(0, 0.37, 0);
    s.add(new THREE.Mesh(welt, accent.mat));
    // The plinth under the seat, set back, with the underlight strip at its
    // foot washing the carpet in front (ref-04's glowing base).
    const p1 = r1 + 0.1;
    const p2 = r2 - 0.08;
    const plinthShape = new THREE.Shape();
    for (let i = 0; i <= N; i++) {
      const p = onArc(a0 + 0.01 + ((a1 - a0 - 0.02) * i) / N, p2);
      if (i === 0) plinthShape.moveTo(p.x, p.z);
      else plinthShape.lineTo(p.x, p.z);
    }
    for (let i = N; i >= 0; i--) {
      const p = onArc(a0 + 0.01 + ((a1 - a0 - 0.02) * i) / N, p1);
      plinthShape.lineTo(p.x, p.z);
    }
    const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, { depth: 0.34, bevelEnabled: false, curveSegments: 4 });
    plinthGeo.rotateX(Math.PI / 2);
    plinthGeo.translate(0, 0.34, 0);
    s.add(new THREE.Mesh(plinthGeo, lockerLit(new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.45, metalness: 0.3 }))));
    const benchGlow = this.glow(new THREE.Color(0.85, 1, 0.55), 'bench');
    const strip = new THREE.CylinderGeometry(p1 - 0.012, p1 - 0.012, 0.022, 96, 1, true, toTheta(a1 - 0.01), a1 - a0 - 0.02);
    strip.translate(0, 0.03, 0);
    s.add(new THREE.Mesh(strip, benchGlow.mat));
    // Its pool on the carpet: soft segments along the arc, brightest at the plinth.
    this.benchPool = new THREE.MeshBasicMaterial({ map: poolStrip(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const SEG = 28;
    const segW = ((a1 - a0) * (p1 - 0.35)) / SEG + 0.02;
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(segW, 0.7).rotateX(-Math.PI / 2), this.benchPool, SEG);
    for (let i = 0; i < SEG; i++) pools.setMatrixAt(i, arcFrame(a0 + ((a1 - a0) * (i + 0.5)) / SEG, p1 - 0.35).multiply(new THREE.Matrix4().makeTranslation(0, 0.005, 0)));
    s.add(pools);

    // Video wall at the row's left end.
    this.wall = new VideoWall();
    const wf = arcFrame(WALL_ANGLE, ARC_R + 0.25);
    const wallGroup = new THREE.Group();
    wallGroup.applyMatrix4(wf);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(WALL.width + 0.16, WALL.height + 0.16, 0.12), lockerLit(new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.35, metalness: 0.4 })));
    frame.position.set(0, WALL.base + WALL.height / 2, -0.06);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(WALL.width, WALL.height), this.wall.material);
    screen.position.set(0, WALL.base + WALL.height / 2, 0.002);
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(WALL.width, 0.5, 0.45), lockerLit(new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.35 })));
    console_.position.set(0, 0.25, 0.1);
    wallGroup.add(frame, screen, console_);
    s.add(wallGroup);

    // Tunnel door and the corridor out to the field.
    const door = new THREE.Group();
    door.applyMatrix4(this.doorFrame);
    const concrete = lockerLit(new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9, side: THREE.BackSide }));
    const corridor = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width, DOOR.height, DOOR.depth), concrete);
    corridor.position.set(0, DOOR.height / 2, -DOOR.depth / 2);
    // The end wall of the box is replaced by the field view.
    door.add(corridor);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xaaff00, roughness: 0.6 });
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, DOOR.depth).rotateX(-Math.PI / 2), stripeMat);
    stripe.position.set(0, 0.004, -DOOR.depth / 2);
    door.add(stripe);
    const tun = this.glow(new THREE.Color(0.9, 0.95, 1), 'tunnel');
    for (let z = 1.2; z < DOOR.depth - 0.5; z += 2) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.14), tun.mat);
      lamp.position.set(0, DOOR.height - 0.02, -z);
      door.add(lamp);
    }
    this.fieldView = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const view = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.width, DOOR.height), this.fieldView);
    view.position.set(0, DOOR.height / 2, -DOOR.depth + 0.01);
    door.add(view);
    // Portal trim: lime-lit jambs and header.
    for (const x of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.05, DOOR.height, 0.06), accent.mat);
      jamb.position.set(x * (DOOR.width / 2 + 0.03), DOOR.height / 2, 0.02);
      door.add(jamb);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width + 0.11, 0.05, 0.06), accent.mat);
    header.position.set(0, DOOR.height + 0.025, 0.02);
    door.add(header);
    // Open door leaves, swung back against the corridor walls.
    const leafMat = lockerLit(new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.35, metalness: 0.3 }));
    for (const x of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, DOOR.height - 0.05, DOOR.width / 2), leafMat);
      leaf.position.set(x * (DOOR.width / 2 - 0.04), (DOOR.height - 0.05) / 2, -DOOR.width / 4 - 0.05);
      door.add(leaf);
    }
    s.add(door);

    // The room's environment (ambient and reflections): a small scene of
    // its light sources, prefiltered once per mood.
    this.buildEnvScene();
  }

  private benchPool: THREE.MeshBasicMaterial;
  private panelMat: THREE.MeshBasicMaterial;

  /** Redraw the carpet's and the ceiling's marks once the display face has loaded. */
  redrawMarks(): void {
    const old = [this.carpetMat.map, this.panelMat.map];
    const carpet = carpetTexture();
    this.carpetMat.map = carpet;
    this.carpetMat.emissiveMap = carpet;
    this.panelMat.map = perforatedTexture();
    this.carpetMat.needsUpdate = true;
    this.panelMat.needsUpdate = true;
    for (const t of old) t?.dispose();
  }

  private glow(c: THREE.Color, kind: GlowKind) {
    const mat = new THREE.MeshBasicMaterial({ color: c.clone() });
    const e = { mat, base: c.clone(), kind };
    this.emissive.push(e);
    return e;
  }

  private buildEnvScene(): void {
    const e = this.envScene;
    const add = (geo: THREE.BufferGeometry, color: THREE.Color, kind: 'ceiling' | 'stall' | 'accent' | 'panel', y = 0) => {
      const mat = new THREE.MeshBasicMaterial({ color: color.clone(), side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y - 1.5; // rendered from eye height
      e.add(m);
      this.envMats.push({ mat, base: color.clone(), kind });
    };
    const shell = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.028, 0.022), side: THREE.BackSide }));
    e.add(shell);
    // The ceiling panel: the room's big soft source from above.
    add(new THREE.CircleGeometry(PANEL_R, 32).rotateX(Math.PI / 2), new THREE.Color(1, 0.93, 0.83).multiplyScalar(0.55), 'panel', CEILING_Y - 0.16);
    add(new THREE.TorusGeometry(PANEL_R, 0.2, 6, 48).rotateX(Math.PI / 2), WARM.clone().multiplyScalar(2), 'ceiling', CEILING_Y);
    // The lit stalls: a warm band where the row is.
    add(new THREE.CylinderGeometry(ARC_R, ARC_R, 1.2, 48, 1, true, Math.PI - 0.75, 1.5), WARM.clone().multiplyScalar(0.9), 'stall', 1.3);
    add(new THREE.CylinderGeometry(ARC_R, ARC_R, 0.2, 48, 1, true, Math.PI - 0.75, 1.5), LIMEC.clone().multiplyScalar(0.5), 'accent', 0.1);
  }

  /** Prefilter the room's environment for the mood (a few ms; on entry and mood changes). */
  applyMood(mood: RoomMood, pmrem: THREE.PMREMGenerator): void {
    this.mood = mood;
    const m = MOODS[mood];
    const glowLevel: Record<GlowKind, number> = { ceiling: m.ceiling, accent: m.accent, tunnel: 2.5, panel: m.panel, bench: m.bench };
    for (const e of this.emissive) e.mat.color.copy(e.base).multiplyScalar(glowLevel[e.kind]);
    for (const e of this.envMats) e.mat.color.copy(e.base).multiplyScalar(e.kind === 'ceiling' ? m.ceiling / 2.2 : e.kind === 'accent' ? m.accent / 2.2 : e.kind === 'panel' ? m.panel : m.stall / 16);
    this.carpetMat.emissiveIntensity = m.carpet;
    this.bounceMat.emissiveIntensity = m.bounce;
    this.benchPool.color.setRGB(0.85, 1, 0.55).multiplyScalar(m.bench * 0.22);
    for (const l of this.lockers) {
      l.levels = { stall: m.stall, under: m.under, emptyStall: m.stall * m.emptyStall, plate: m.plate, plateEmpty: m.plateEmpty, wash: m.wash, pool: m.pool, edge: m.edge, edgeEmpty: m.edgeEmpty, inner: m.inner, innerEmpty: m.innerEmpty };
      l.applyLights();
    }
    const prev = this.scene.environment;
    this.scene.environment = pmrem.fromScene(this.envScene, 0, 0.1, 60).texture;
    this.scene.environmentIntensity = m.env;
    prev?.dispose();
  }
}

export { LOCKER_D };
