import * as THREE from 'three';
import { routePoints } from '@/sim/ai';
import type { PlayState, RouteName } from '@/sim';
import type { V2 } from '@/sim/vec';
import { worldX, worldZ } from '@/game/coords';

// The route preview (M5.5): every receiver's route drawn on the turf before
// the snap, from where he stands, in the play call's art (his position's
// color, an arrowhead, a bar where he settles). Built from routePoints, the
// same function the sim runs the routes from, so the art can't disagree with
// the play or a hot route.

/** Position colors, as the play call's art (ui/game/PlayArt.tsx). */
const POS_COLOR: Record<string, number> = { WR: 0x00e5ff, TE: 0xbd6bff, RB: 0xff2a6d, QB: 0xffd400 };
/** Ribbon width (m) and height over the turf. */
const WIDTH = 0.34;
const LIFT = 0.075;

const toWorld = (p: V2) => new THREE.Vector3(worldX(p.y), LIFT, worldZ(p.x));

function ribbon(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const m = Math.hypot(dx, dz) || 1;
    const nx = (-dz / m) * (width / 2);
    const nz = (dx / m) * (width / 2);
    const p = pts[i]!;
    pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** An arrowhead at the end of a route (pointing along its last leg), or a bar across it for a settle. */
function cap(end: THREE.Vector3, from: THREE.Vector3, sit: boolean): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(end, from).setY(0).normalize();
  const n = new THREE.Vector3(-d.z, 0, d.x);
  if (sit) return ribbon([end.clone().addScaledVector(n, -0.75), end.clone().addScaledVector(n, 0.75)], WIDTH * 1.3);
  const tip = end.clone().addScaledVector(d, 0.9);
  const l = end.clone().addScaledVector(n, 0.6);
  const r = end.clone().addScaledVector(n, -0.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([l.x, l.y, l.z, r.x, r.y, r.z, tip.x, tip.y, tip.z], 3));
  g.setIndex([0, 1, 2]);
  return g;
}

export interface RouteArt {
  group: THREE.Group;
  /**
   * Show or hide, and redraw when the routes change. `focus` is a receiver
   * being hot-routed (icon number): his route is drawn as `candidate` and the
   * others fade back.
   */
  update(s: PlayState, show: boolean, dt: number, focus?: { icon: number; candidate: RouteName } | null): void;
}

export function createRouteArt(): RouteArt {
  const group = new THREE.Group();
  group.name = 'routeArt';
  group.visible = false;
  let key = '';
  let fade = 0;
  const mats: THREE.MeshBasicMaterial[] = [];
  const clear = () => {
    for (const c of [...group.children]) {
      group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    for (const m of mats) m.dispose();
    mats.length = 0;
  };
  const build = (s: PlayState, focus: { icon: number; candidate: RouteName } | null | undefined) => {
    clear();
    // A designed run: the back's path, to the mesh, through the aiming point and on up (as the play art draws it).
    const run = s.setup.play.run;
    if (run) {
      const rb = s.agents[s.slot.RB!]!;
      const qb = s.agents[s.qb]!;
      const los = s.setup.los;
      const by = s.setup.ballY ?? 0;
      const side = run.aim >= 0 ? 1 : -1;
      const jab = run.scheme === 'counter' ? [{ x: rb.pos.x + 0.4, y: rb.pos.y - side * 1.1 }] : [];
      const path = [rb.pos, ...jab, { x: qb.pos.x + 0.3, y: qb.pos.y + run.aim * 0.25 }, { x: los + 1, y: by + run.aim }, { x: los + 6, y: by + run.aim * (run.scheme === 'outsideZone' ? 1.3 : 1.05) }];
      const pts = path.map(toWorld);
      const mat = new THREE.MeshBasicMaterial({ color: POS_COLOR.RB, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
      mat.userData.base = 0.9;
      mats.push(mat);
      const line = new THREE.Mesh(ribbon(pts, WIDTH * 1.2), mat);
      const head = new THREE.Mesh(cap(pts[pts.length - 1]!, pts[pts.length - 2]!, false), mat);
      line.renderOrder = head.renderOrder = 3;
      group.add(line, head);
    }
    s.icons.forEach((i, k) => {
      const a = s.agents[i]!;
      const mine = focus && focus.icon === k + 1;
      const r = routePoints(s, a, mine ? focus.candidate : undefined);
      if (!r) return;
      const pts = [toWorld(a.pos), ...r.pts.map(toWorld)];
      const mat = new THREE.MeshBasicMaterial({
        color: POS_COLOR[a.p.pos] ?? 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        toneMapped: false,
      });
      mat.userData.base = focus && !mine ? 0.3 : 0.9;
      mats.push(mat);
      const line = new THREE.Mesh(ribbon(pts, mine ? WIDTH * 1.4 : WIDTH), mat);
      const head = new THREE.Mesh(cap(pts[pts.length - 1]!, pts[pts.length - 2]!, r.sit[r.sit.length - 1] ?? false), mat);
      line.renderOrder = head.renderOrder = 3;
      group.add(line, head);
    });
  };
  return {
    group,
    update(s, show, dt, focus) {
      const k = show ? `${s.setup.play.id}|${JSON.stringify(s.hot)}|${focus ? `${focus.icon}:${focus.candidate}` : ''}|${s.icons.map((i) => s.agents[i]!.pos.y.toFixed(1)).join(',')}` : key;
      if (show && k !== key) {
        key = k;
        build(s, focus);
      }
      // A quick fade in and out rather than a pop.
      fade = Math.max(0, Math.min(1, fade + (show ? 1 : -1) * dt * 8));
      group.visible = fade > 0.01;
      for (const m of mats) m.opacity = (m.userData.base as number) * fade;
    },
  };
}
