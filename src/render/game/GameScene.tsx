import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadAnimLibrary, type AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { Ragdoll } from '@/anim/ragdoll';
import { skinHexFor } from '@/app/characterization';
import { urlFlags } from '@/app/platform';
import { practice, usePractice } from '@/game/practice';
import { Input } from '@/input/InputManager';
import { createRouteArt } from './routeArt';
import { measure, resetPops } from './popMeter';
import { lerpAngle, type AgentSnap } from '@/game/snapshot';
import { latency } from '@/game/latency';
import { view } from '@/game/view';
import { worldX, worldY, worldZ, yawOf } from '@/game/coords';
import { LOFT_CHARGE, DEF_SLOTS, HOT_ROUTES, OFF_SLOTS, TAP_MAX, TICK, type PlayState, type SimPlayer } from '@/sim';
import { openness } from '@/sim/ai';
import { previewThrow } from '@/sim/passing';
import { openState } from '@/game/view';
import { YARD } from '../world/constants';
import { hudDom, RING_LEN } from '@/ui/game/hudDom';
import { crowdEnergy } from '../crowd/reactions';
import { activeVfx } from '../vfx/active';
import { Audio } from '@/audio/audio';
import { KITS } from '../players/kits';
import { bodyFromImperial } from '../players/bodyShape';
import { jerseyName } from '../players/glyphs';
import { playerVariety, type Position } from '../players/variety';
import { loadPlayerAsset, Player, type PlayerAsset } from '../players/playerAsset';
import { prepareLate, shadowAttach } from '../lighting/shadows';
import { createFootball } from './football';
import { createFieldMarks } from './fieldMarks';
import { frameEvents } from './frameEvents';
import { ballInHands, drive, onEvents, onSnap, resetBody, type Body } from './choreo';

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

/** The stance for a slot on this play: the QB under center or in the gun by the formation. */
const stanceFor = (slot: string, s: PlayState): string => (slot === 'QB' && s.setup.play.formation.center ? 'stance_qb_center' : STANCE[slot] ?? 'stance_idle');

const RENDER_POS: Record<SimPlayer['pos'], Position> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', OL: 'OL', DE: 'DL', DT: 'DL', LB: 'LB', CB: 'CB', S: 'S' };

function buildTeam(players: SimPlayer[], slots: string[], kit: string, asset: PlayerAsset, lib: AnimLibrary): Body[] {
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
    return { player, animator: new PlayerAnimator(player, lib), ragdoll: new Ragdoll(player), slot: slots[k]!, lastYaw: 0, lastSpeed: 0, throwAt: -1, catchFor: -1, lie: null, fallen: false, lyingClip: false, yaw: 0, gaitSpeed: 0, once: new Set<string>() };
  });
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _dir = new THREE.Vector3();
/** Fastest the drawn facing turns (rad/s): a sharp pivot, ~180° in a quarter second. */
const YAW_MAX = 12;
const tmp: AgentSnap = { x: 0, y: 0, vx: 0, vy: 0, face: 0, anim: 'stance', move: null, down: false, stamina: 1 };

export function GameScene() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [bodies, setBodies] = useState<Body[] | null>(null);
  const [marks] = useState(createFieldMarks);
  const [ball] = useState(createFootball);
  const [routeArt] = useState(createRouteArt);
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
      const all = [...buildTeam(OFF_SLOTS.map((k) => R.offense[k]), OFF_SLOTS, practice.offenseKit, asset, lib), ...buildTeam(DEF_SLOTS.map((k) => R.defense[k]), DEF_SLOTS, 'beasts', asset, lib)];
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
    scene.add(marks.group, ball, routeArt.group);
    return () => {
      alive = false;
      if (group) scene.remove(group);
      scene.remove(marks.group, ball, routeArt.group);
    };
  }, [scene, gl, camera, marks, ball, routeArt]);

  useFrame(({ camera, gl, clock }, dt) => {
    const step = urlFlags.video ? 1 / urlFlags.video : urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    latency.frame++;
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
        resetBody(b);
        b.animator.reset();
        b.animator.setStance(stanceFor(b.slot, s));
        b.animator.update(10, { speed: 0 });
        b.lastYaw = yawOf(a.face);
        b.yaw = b.lastYaw;
        b.lastSpeed = 0;
        b.gaitSpeed = 0;
      });
      if (urlFlags.pops) resetPops();
      lastSimT.current = cur.t;
    }
    // The snap: everyone who has a get-off out of his stance plays it.
    if (!snapped.current && cur.phase !== 'presnap') {
      snapped.current = true;
      onSnap(bodies, s, (slot) => stanceFor(slot, s));
      latency.respond('snap');
    }
    onEvents(bodies, s, frameEvents);
    // Animate by the sim time that passed (the same as the frame time in
    // play; more when a test or a hitch stepped several ticks at once).
    const simT = cur.t + alpha * TICK;
    const animDt = Math.max(0, Math.min(0.5, simT - lastSimT.current));
    lastSimT.current = simT;
    const viewportPx = gl.domElement.height;
    // The player the user moves now: the QB until the ball leaves him, then his carrier.
    const ph = cur.phase;
    const userCarrier = cur.carrier >= 0 && s.agents[cur.carrier]!.side === 'off';
    const controlled = ph === 'carrier' ? (userCarrier ? cur.carrier : -1) : ph === 'snap' || ph === 'dropback' || ph === 'pocket' ? s.qb : -1;
    if (controlled < 0) latency.motion(null);
    bodies.forEach((b, i) => {
      const p0 = prev.agents[i]!;
      const p1 = cur.agents[i]!;
      tmp.x = p0.x + (p1.x - p0.x) * alpha;
      tmp.y = p0.y + (p1.y - p0.y) * alpha;
      tmp.vx = p0.vx + (p1.vx - p0.vx) * alpha;
      tmp.vy = p0.vy + (p1.vy - p0.vy) * alpha;
      const face = lerpAngle(p0.face, p1.face, alpha);
      if (i === controlled) latency.motion({ x: tmp.vx, y: tmp.vy });
      const sp = Math.hypot(tmp.vx, tmp.vy);
      const along = tmp.vx * Math.cos(face) + tmp.vy * Math.sin(face);
      const d = drive(b, i, s, simT, sp > 0.05 ? along : 0, sp);
      const heading = d.faceVelocity ? Math.atan2(tmp.vy, tmp.vx) : face;
      // The drawn facing turns toward the sim's: eased, and no faster than a
      // quick pivot (a back turning out of his pedal turns his hips, he
      // doesn't flip in a frame). The sim's facing already turns smoothly;
      // this catches the switches between facing and running direction.
      const want = yawOf(heading);
      const dy = lerpAngle(0, want - b.yaw, 1);
      const turn = Math.max(-YAW_MAX * animDt, Math.min(YAW_MAX * animDt, dy * (1 - Math.exp(-animDt * 22))));
      b.yaw = animDt > 0 ? b.yaw + turn : want;
      const yaw = b.yaw;
      // The gait's speed, eased over ~60 ms (a juke's sidestep changes the speed along his facing in a tick).
      b.gaitSpeed += (d.speed - b.gaitSpeed) * (1 - Math.exp(-animDt / 0.06));
      d.speed = b.gaitSpeed;
      const root = b.player.root;
      root.position.set(worldX(tmp.y), 0, worldZ(tmp.x));
      root.rotation.y = yaw;
      if (b.lie) {
        // Lying where the fall left him (the lying clip's root is at his hips, his head along +Z).
        root.position.set(b.lie.x, 0, b.lie.z);
        root.rotation.y = b.lie.prone ? b.lie.yaw : b.lie.yaw + Math.PI;
        // A clip that lay him down keeps the yaw it had (its root already faces along him).
      }
      const yawRate = animDt > 0 ? lerpAngle(0, yaw - b.lastYaw, 1) / Math.max(animDt, 1 / 120) : 0;
      const accel = animDt > 0 ? (d.speed - b.lastSpeed) / Math.max(animDt, 1 / 120) : 0;
      b.lastYaw = yaw;
      b.lastSpeed = d.speed;
      b.animator.update(animDt, { speed: d.speed, backpedal: d.backpedal, yawRate: Math.max(-4, Math.min(4, yawRate)), accel: Math.max(-12, Math.min(12, accel)), lookAt: d.look });
      b.ragdoll.update(animDt);
      // A body hitting the turf hard kicks up dust (a big hit's landing).
      const land = b.ragdoll.landing;
      if (land) {
        b.ragdoll.landing = null;
        activeVfx()?.emit('hitDust', [land.x, land.y, land.z], { scale: 1.3 });
      }
      b.player.updateLod(camera, viewportPx);
      if (urlFlags.pops) measure(b, animDt, latency.frame, s.agents[i]!.anim, cur.phase);
    });

    placeBall(s.snapT, s.t);
    placeMarks(s.setup.los, s.setup.toGo);
    // The route preview: held key, the hot-route picker, or just after a hot route is called.
    const ui = usePractice.getState();
    const hot = ui.hot;
    const showRoutes = cur.phase === 'presnap' && (Input.isHeld('preSnap.routes') || !!hot || performance.now() < practice.routeFlashUntil);
    routeArt.update(s, showRoutes, step, hot && hot.stage === 'route' ? { icon: hot.icon, candidate: HOT_ROUTES[hot.focus]! } : null);
  }, -100);

  // The HUD goes on after the camera has moved this frame (GameCamera runs
  // at -90), so the icons and the carrier's keys sit on the players as drawn,
  // not a frame behind them.
  useFrame(({ camera }) => {
    if (!practice.runner || !bodies) return;
    camera.updateMatrixWorld();
    placeHud();
  }, -80);

  function placeBall(snapT: number, t: number) {
    const r = practice.runner!;
    const { prev, cur } = r;
    const a = r.alpha;
    const b0 = prev.ball;
    const b1 = cur.ball;
    const held = b1.mode === 'held' && b1.holder >= 0;
    const inSnap = cur.phase === 'presnap' || (snapT >= 0 && t - snapT < 0.34);
    if (held && !inSnap && bodies && ballInHands(bodies[b1.holder]!, r.state, ball)) return;
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
    // How open each target is (the icons glow when open, dim when covered),
    // after the snap and before the throw; refreshed every few frames.
    const reading = !thrown && cur.phase !== 'presnap' && cur.phase !== 'snap';
    if (reading && latency.frame % 4 === 0) {
      const qb = s.agents[s.qb]!;
      for (let k = 0; k < s.icons.length; k++) view.icons[k]!.open = openState(openness(s, qb, s.agents[s.icons[k]!]!, true).sep);
    }
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
        const o = reading ? v.open : 'none';
        if (el.dataset.open !== o) el.dataset.open = o;
      }
      // The power ring: fills while the icon is held (a tap stays empty: touch).
      const ring = hudDom.rings[k];
      if (ring) {
        const held = s.hold.icon === k + 1 && practice.controls.heldIcon === k + 1;
        const t = held ? s.hold.ticks * TICK : 0;
        const charge = t <= TAP_MAX ? 0 : Math.min(1, (t - TAP_MAX) / LOFT_CHARGE);
        ring.style.strokeDashoffset = String(RING_LEN * (1 - charge));
        ring.style.opacity = held ? '1' : '0';
        if (held) latency.respond('throwHold');
      }
    }
    // Where the held throw would land (the error cone's size), on the turf.
    const land = marks.land;
    const heldIcon = practice.controls.heldIcon;
    const rec = heldIcon ? s.icons[heldIcon - 1] : undefined;
    land.visible = pocket && !thrown && rec !== undefined;
    if (land.visible && rec !== undefined) {
      const t = s.hold.ticks * TICK;
      const charge = t <= TAP_MAX ? 0 : Math.min(1, (t - TAP_MAX) / LOFT_CHARGE);
      const aim = practice.controls.aim;
      const pv = previewThrow(s, s.agents[s.qb]!, s.agents[rec]!, charge, aim);
      land.position.set(worldX(pv.y), 0.07, worldZ(pv.x));
      const r = Math.max(0.6, Math.min(4, pv.sigma)) * YARD;
      land.getObjectByName('cone')!.scale.setScalar(r);
    }
    const ret = hudDom.reticle;
    const rc = practice.controls.reticle;
    if (ret) {
      const v = rc.icon ? view.icons[rc.icon - 1] : null;
      ret.style.visibility = v && v.visible && !thrown ? 'visible' : 'hidden';
      if (v) ret.style.transform = `translate(${(v.x + rc.x).toFixed(1)}px, ${(v.y + rc.y).toFixed(1)}px)`;
    }
    // The carrier's cluster rides under him (his feet on screen) the whole time he has the ball.
    const ch = hudDom.carrierHud;
    if (ch) {
      const c = cur.carrier >= 0 ? cur.agents[cur.carrier]! : null;
      const mine = !!c && s.agents[cur.carrier]!.side === 'off' && cur.phase === 'carrier' && !c.down && !!bodies;
      ch.style.visibility = mine ? 'visible' : 'hidden';
      if (mine) {
        const root = bodies![cur.carrier]!.player.root;
        _p.set(root.position.x, -0.15, root.position.z).project(camera);
        const x = rect.left + ((_p.x + 1) / 2) * rect.width;
        const y = rect.top + ((1 - _p.y) / 2) * rect.height;
        // Kept on screen (a carrier near the bottom edge keeps his keys in view).
        ch.style.transform = `translate(${Math.max(120, Math.min(rect.width - 120, x)).toFixed(1)}px, ${Math.min(rect.height - 90, y).toFixed(1)}px)`;
        if (hudDom.staminaFill) hudDom.staminaFill.style.transform = `scaleX(${c.stamina.toFixed(3)})`;
      }
    }
  }

  function reactCrowd(now: number) {
    for (const e of frameEvents) {
      if (e.type === 'touchdown') crowdEnergy.trigger('touchdown', now);
      else if (e.type === 'interception' || e.type === 'recovery') crowdEnergy.trigger('turnover', now);
      else if (e.type === 'sack') crowdEnergy.trigger('defensiveStop', now);
      else if (e.type === 'hit' && e.data?.big) crowdEnergy.trigger('bigPlay', now);
      if (e.type === 'hit') Audio.hit(Number(e.data?.force ?? 4), !!e.data?.big);
      else if (e.type === 'drop') crowdEnergy.trigger('groan', now);
    }
  }

  return null;
}
