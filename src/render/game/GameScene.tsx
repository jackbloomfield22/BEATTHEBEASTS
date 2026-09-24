import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadAnimLibrary, type AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { skinHexFor } from '@/app/characterization';
import { urlFlags } from '@/app/platform';
import { practice } from '@/game/practice';
import { lerpAngle, type AgentSnap } from '@/game/snapshot';
import { view } from '@/game/view';
import { worldX, worldY, worldZ, yawOf } from '@/game/coords';
import { BULLET_CHARGE, DEF_SLOTS, OFF_SLOTS, TAP_MAX, TICK, type SimPlayer } from '@/sim';
import { hudDom, RING_LEN } from '@/ui/game/hudDom';
import { crowdEnergy } from '../crowd/reactions';
import { KITS } from '../players/kits';
import { bodyFromImperial } from '../players/bodyShape';
import { jerseyName } from '../players/glyphs';
import { playerVariety, type Position } from '../players/variety';
import { loadPlayerAsset, Player, type PlayerAsset } from '../players/playerAsset';
import { YARD } from '../world/constants';
import { prepareLate, shadowAttach } from '../lighting/shadows';
import { createFootball } from './football';
import { createFieldMarks } from './fieldMarks';
import { frameEvents } from './frameEvents';

// The live play (TECH_PLAN §4.3): one top-priority frame callback advances
// the sim through the Practice session, then every player, the ball, the
// turf lines and the receiver icons are written from the two latest sim
// snapshots, interpolated. Players are built once per roster; each play only
// re-stances them.

const STANCE: Record<string, string> = {
  QB: 'stance_qb_gun',
  RB: 'stance_rb_2pt',
  X: 'stance_wr_2pt',
  Z: 'stance_wr_2pt',
  SLOT: 'stance_wr_2pt',
  TE: 'stance_ol_3pt',
  LT: 'stance_ol_3pt',
  LG: 'stance_ol_3pt',
  C: 'stance_ol_3pt',
  RG: 'stance_ol_3pt',
  RT: 'stance_ol_3pt',
  LE: 'stance_dl_3pt',
  RE: 'stance_dl_3pt',
  LDT: 'stance_dl_4pt',
  RDT: 'stance_dl_4pt',
  WLB: 'stance_lb_ready',
  MLB: 'stance_lb_ready',
  SLB: 'stance_lb_ready',
  LCB: 'stance_db_ready',
  RCB: 'stance_db_ready',
  FS: 'stance_db_ready',
  SS: 'stance_db_ready',
};

const RENDER_POS: Record<SimPlayer['pos'], Position> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', OL: 'OL', DE: 'DL', DT: 'DL', LB: 'LB', CB: 'CB', S: 'S' };

interface Body {
  player: Player;
  animator: PlayerAnimator;
  slot: string;
  /** Temporary fall until the tackle clips and ragdoll arrive (M5-3): 0 standing .. 1 down. */
  fall: number;
  lastYaw: number;
  lastSpeed: number;
}

function buildTeam(players: SimPlayer[], slots: string[], kit: 'royal' | 'beasts', asset: PlayerAsset, lib: AnimLibrary): Body[] {
  return players.map((p, k) => {
    const body = bodyFromImperial(p.heightIn, p.weightLb);
    const player = new Player(asset, {
      kit: KITS[kit]!,
      skin: skinHexFor(p.name),
      number: p.num,
      name: jerseyName(p.name),
      variety: playerVariety(RENDER_POS[p.pos], body.heightM, body.weightKg, p.name),
      ...body,
    });
    player.root.rotation.order = 'YXZ';
    return { player, animator: new PlayerAnimator(player, lib), slot: slots[k]!, fall: 0, lastYaw: 0, lastSpeed: 0 };
  });
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();
const tmp: AgentSnap = { x: 0, y: 0, vx: 0, vy: 0, face: 0, anim: 'stance', move: null, down: false, stamina: 1 };

export function GameScene() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [bodies, setBodies] = useState<Body[] | null>(null);
  const [marks] = useState(createFieldMarks);
  const [ball] = useState(createFootball);
  const shownPlay = useRef(-1);
  const lastSimT = useRef(0);
  const snapped = useRef(false);

  useEffect(() => {
    let alive = true;
    let group: THREE.Group | null = null;
    const wait = async () => {
      while (alive && !practice.rosters) await new Promise((r) => setTimeout(r, 100));
    };
    Promise.all([loadPlayerAsset(), loadAnimLibrary(), wait()]).then(async ([asset, lib]) => {
      if (!alive || !practice.rosters) return;
      const R = practice.rosters;
      // Agent order in the sim: OFF_SLOTS then DEF_SLOTS (sim/plays.ts).
      const all = [...buildTeam(OFF_SLOTS.map((k) => R.offense[k]), OFF_SLOTS, 'royal', asset, lib), ...buildTeam(DEF_SLOTS.map((k) => R.defense[k]), DEF_SLOTS, 'beasts', asset, lib)];
      const g = new THREE.Group();
      g.name = 'players';
      for (const b of all) {
        b.player.root.visible = false;
        g.add(b.player.root);
      }
      await prepareLate(g, gl, camera, scene);
      if (!alive) return;
      group = g;
      scene.add(g);
      shadowAttach.requested = true;
      setBodies(all);
      (window as unknown as { __btbGameReady?: boolean }).__btbGameReady = true;
    }, console.error);
    scene.add(marks.group, ball);
    return () => {
      alive = false;
      if (group) scene.remove(group);
      scene.remove(marks.group, ball);
    };
  }, [scene, gl, camera, marks, ball]);

  useFrame(({ camera, gl, clock }, dt) => {
    const step = urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    practice.frame(step);
    const r = practice.runner;
    const show = !!r && !!bodies;
    marks.group.visible = show && r!.cur.phase !== 'dead';
    ball.visible = show;
    frameEvents.length = 0;
    if (!show) {
      if (bodies) for (const b of bodies) b.player.root.visible = false;
      for (const el of hudDom.icons) if (el) el.style.visibility = 'hidden';
      shownPlay.current = -1;
      return;
    }
    const s = r.state;
    const { prev, cur } = r;
    const alpha = r.alpha;
    for (const e of r.drainEvents()) frameEvents.push(e);
    reactCrowd(clock.elapsedTime);

    // A new play: settle everyone into his stance where he lines up.
    if (shownPlay.current !== practice.playId) {
      shownPlay.current = practice.playId;
      snapped.current = false;
      bodies.forEach((b, i) => {
        const a = cur.agents[i]!;
        b.player.root.visible = true;
        b.player.root.position.set(worldX(a.y), 0, worldZ(a.x));
        b.player.root.rotation.set(0, yawOf(a.face), 0);
        b.fall = 0;
        b.animator.reset();
        b.animator.setStance(STANCE[b.slot] ?? 'stance_idle');
        b.animator.update(10, { speed: 0 });
        b.lastYaw = yawOf(a.face);
        b.lastSpeed = 0;
      });
      lastSimT.current = cur.t;
    }
    // The snap: everyone who has a get-off out of his stance plays it.
    if (!snapped.current && cur.phase !== 'presnap') {
      snapped.current = true;
      for (const b of bodies) {
        const st = STANCE[b.slot] ?? '';
        const off = `getoff_${st.slice(7)}`;
        if (b.animator.lib.meta[off]) b.animator.play(off);
        else b.animator.setStance('stance_idle');
      }
    }
    // Animate by the sim time that passed (the same as the frame time in
    // play; more when a test or a hitch stepped several ticks at once).
    const simT = cur.t + alpha * TICK;
    const animDt = Math.max(0, Math.min(0.5, simT - lastSimT.current));
    lastSimT.current = simT;
    const viewportPx = gl.domElement.height;
    bodies.forEach((b, i) => {
      const p0 = prev.agents[i]!;
      const p1 = cur.agents[i]!;
      tmp.x = p0.x + (p1.x - p0.x) * alpha;
      tmp.y = p0.y + (p1.y - p0.y) * alpha;
      tmp.vx = p0.vx + (p1.vx - p0.vx) * alpha;
      tmp.vy = p0.vy + (p1.vy - p0.vy) * alpha;
      const face = lerpAngle(p0.face, p1.face, alpha);
      const sp = Math.hypot(tmp.vx, tmp.vy);
      // Until the backpedal is blended in (M5-3), a player moving backward
      // turns to run where he's going instead of moonwalking.
      const along = tmp.vx * Math.cos(face) + tmp.vy * Math.sin(face);
      const heading = along < -1 && sp > 1 ? Math.atan2(tmp.vy, tmp.vx) : face;
      const yaw = yawOf(heading);
      const root = b.player.root;
      root.position.set(worldX(tmp.y), 0, worldZ(tmp.x));
      root.rotation.y = yaw;
      // Down: a plain tip-over until the tackle clips and the ragdoll blend (M5-3).
      b.fall = Math.max(0, Math.min(1, b.fall + (p1.down ? animDt / 0.45 : -animDt / 0.6)));
      root.rotation.x = b.fall * b.fall * 1.35;
      const speedM = (heading === face ? Math.max(0, along) : sp) * YARD;
      const yawRate = animDt > 0 ? lerpAngle(0, yaw - b.lastYaw, 1) / Math.max(animDt, 1 / 120) : 0;
      const accel = animDt > 0 ? (speedM - b.lastSpeed) / Math.max(animDt, 1 / 120) : 0;
      b.lastYaw = yaw;
      b.lastSpeed = speedM;
      // Eyes: the ball in the air, else downfield.
      const bp = cur.ball;
      _look.set(worldX(bp.y), worldY(Math.max(bp.z, 1.2)), worldZ(bp.x));
      b.animator.update(animDt, { speed: b.fall > 0.2 ? 0 : speedM, yawRate: Math.max(-4, Math.min(4, yawRate)), accel: Math.max(-12, Math.min(12, accel)), lookAt: cur.phase === 'air' ? _look : null });
      b.player.updateLod(camera, viewportPx);
    });

    placeBall(s.snapT, s.t);
    placeMarks(s.setup.los, s.setup.toGo);
    placeHud();
  }, -100);

  function placeBall(snapT: number, t: number) {
    const r = practice.runner!;
    const { prev, cur } = r;
    const a = r.alpha;
    const b0 = prev.ball;
    const b1 = cur.ball;
    const held = b1.mode === 'held' && b1.holder >= 0;
    const inSnap = cur.phase === 'presnap' || (snapT >= 0 && t - snapT < 0.34);
    if (held && !inSnap && bodies) {
      // Carried: tucked at the carrier's side, pointing where he runs.
      const body = bodies[b1.holder]!;
      const root = body.player.root;
      const yaw = root.rotation.y;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const s = body.player.shape.scale;
      ball.position.set(root.position.x + fx * 0.22 * s - fz * 0.2 * s, (1.02 - body.fall * 0.7) * s, root.position.z + fz * 0.22 * s + fx * 0.2 * s);
      _dir.set(fx, 0.45, fz).normalize();
      ball.quaternion.setFromUnitVectors(_X, _dir);
      return;
    }
    ball.position.set(worldX(b0.y + (b1.y - b0.y) * a), worldY(b0.z + (b1.z - b0.z) * a), worldZ(b0.x + (b1.x - b0.x) * a));
    if (cur.phase === 'presnap') {
      // On the ground, pointing downfield.
      ball.position.y = 0.09;
      ball.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      return;
    }
    const vx = worldX(b1.vy);
    const vz = worldZ(b1.vx) - worldZ(0);
    const vy = worldY(b1.vz);
    _dir.set(vx, vy, vz);
    if (_dir.lengthSq() > 1) {
      _dir.normalize();
      // A spiral: the long axis along the flight, spinning about it.
      _q.setFromUnitVectors(_X, _dir);
      _q2.setFromAxisAngle(_X, b0.spin + (b1.spin - b0.spin) * a);
      ball.quaternion.copy(_q).multiply(_q2);
    }
  }

  function placeMarks(los: number, toGo: number) {
    marks.los.position.z = worldZ(los);
    const gain = los + toGo;
    marks.gain.visible = gain < 100;
    marks.gain.position.z = worldZ(gain);
  }

  function placeHud() {
    const r = practice.runner!;
    const s = r.state;
    const cur = r.cur;
    const rect = gl.domElement.getBoundingClientRect();
    const pocket = cur.phase === 'presnap' || cur.phase === 'snap' || cur.phase === 'dropback' || cur.phase === 'pocket';
    const thrown = s.windup !== null;
    for (let k = 0; k < 5; k++) {
      const el = hudDom.icons[k];
      const v = view.icons[k]!;
      const idx = s.icons[k];
      if (idx === undefined || !pocket || thrown || !bodies) {
        v.visible = false;
        if (el) el.style.visibility = 'hidden';
        continue;
      }
      const root = bodies[idx]!.player.root;
      _p.set(root.position.x, 2.35 * bodies[idx]!.player.shape.scale, root.position.z).project(camera);
      const behind = _p.z > 1;
      v.x = rect.left + ((_p.x + 1) / 2) * rect.width;
      v.y = rect.top + ((1 - _p.y) / 2) * rect.height;
      v.visible = !behind;
      // His motion on screen: project a point a yard along his velocity.
      const a = cur.agents[idx]!;
      const sp = Math.hypot(a.vx, a.vy);
      const dx = sp > 0.5 ? a.vx / sp : 1;
      const dy = sp > 0.5 ? a.vy / sp : 0;
      _dir.set(worldX(a.y + dy * 2), 2.35, worldZ(a.x + dx * 2)).project(camera);
      const mx = ((_dir.x + 1) / 2) * rect.width + rect.left - v.x;
      const my = ((1 - _dir.y) / 2) * rect.height + rect.top - v.y;
      const m = Math.hypot(mx, my);
      if (m > 1e-3) {
        v.ux = mx / m;
        v.uy = my / m;
      }
      if (el) {
        el.style.visibility = v.visible ? 'visible' : 'hidden';
        el.style.transform = `translate(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px)`;
      }
      // The power ring: fills while the icon is held (a tap stays empty: touch).
      const ring = hudDom.rings[k];
      if (ring) {
        const held = s.hold.icon === k + 1 && practice.controls.heldIcon === k + 1;
        const t = held ? s.hold.ticks * TICK : 0;
        const charge = t <= TAP_MAX ? 0 : Math.min(1, (t - TAP_MAX) / BULLET_CHARGE);
        ring.style.strokeDashoffset = String(RING_LEN * (1 - charge));
        ring.style.opacity = held ? '1' : '0';
      }
    }
    const ret = hudDom.reticle;
    const rc = practice.controls.reticle;
    if (ret) {
      const v = rc.icon ? view.icons[rc.icon - 1] : null;
      ret.style.visibility = v && v.visible && !thrown ? 'visible' : 'hidden';
      if (v) ret.style.transform = `translate(${(v.x + rc.x).toFixed(1)}px, ${(v.y + rc.y).toFixed(1)}px)`;
    }
    const st = hudDom.stamina;
    if (st) {
      const c = cur.carrier >= 0 ? cur.agents[cur.carrier]! : null;
      const mine = c && s.agents[cur.carrier]!.side === 'off' && cur.phase === 'carrier';
      st.style.visibility = mine ? 'visible' : 'hidden';
      if (mine && hudDom.staminaFill) hudDom.staminaFill.style.transform = `scaleX(${c.stamina.toFixed(3)})`;
    }
  }

  function reactCrowd(now: number) {
    for (const e of frameEvents) {
      if (e.type === 'touchdown') crowdEnergy.trigger('touchdown', now);
      else if (e.type === 'interception' || e.type === 'recovery') crowdEnergy.trigger('turnover', now);
      else if (e.type === 'sack') crowdEnergy.trigger('defensiveStop', now);
      else if (e.type === 'hit' && e.data?.big) crowdEnergy.trigger('bigPlay', now);
      else if (e.type === 'drop') crowdEnergy.trigger('groan', now);
    }
  }

  return null;
}
