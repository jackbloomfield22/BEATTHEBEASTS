import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadAnimLibrary, type AnimLibrary } from '@/anim/library';
import { PlayerAnimator } from '@/anim/animator';
import { Ragdoll } from '@/anim/ragdoll';
import { skinHexFor } from '@/app/characterization';
import { urlFlags, videoTime } from '@/app/platform';
import { practice, usePractice } from '@/game/practice';
import { replay, replayStats } from '@/game/replaySession';
import { montage } from '@/game/montageSession';
import type { SimRunner } from '@/game/runner';
import { Input } from '@/input/InputManager';
import { createRouteArt } from './routeArt';
import { measure, resetPops } from './popMeter';
import { lerpAngle, type AgentSnap } from '@/game/snapshot';
import { latency } from '@/game/latency';
import { view } from '@/game/view';
import { fieldX, fieldY, worldX, worldY, worldZ, yawOf } from '@/game/coords';
import { PUNT_DEPTH } from '@/game/kick';
import { blitzersShown } from '@/game/presnap';
import { LOFT_CHARGE, DEF_SLOTS, HOT_ROUTES, OFF_SLOTS, TAP_MAX, TICK, type PlayState, type SimPlayer } from '@/sim';
import { openness } from '@/sim/ai';
import { previewThrow } from '@/sim/passing';
import { autoMove, carrierOptions } from '@/sim/moves';
import { openState } from '@/game/view';
import { YARD } from '../world/constants';
import { hudDom, RING_LEN } from '@/ui/game/hudDom';
import { crowdEnergy } from '../crowd/reactions';
import { activeVfx } from '../vfx/active';
import { Audio } from '@/audio/audio';
import { KITS, kitAgainst } from '../players/kits';
import { bodyFromImperial } from '../players/bodyShape';
import { jerseyName } from '../players/glyphs';
import { playerVariety } from '../players/variety';
import { RENDER_POS } from '../players/renderPos';
import { bodyExtent, ContactSmoother, type ContactBody } from './contact';
import { loadPlayerAsset, Player, type PlayerAsset } from '../players/playerAsset';
import { prepareLate, shadowAttach } from '../lighting/shadows';
import { createFootball } from './football';
import { ballWorldVel, createBallFlight, heldAt, placeFlight, resetFlight } from './ballFlight';
import { createFieldMarks } from './fieldMarks';
import { hudTime, placeCue } from './cueRing';
import { frameEvents } from './frameEvents';
import { ballInHands, catchMagnet, catchReach, contests, drive, onEvents, onSnap, resetBody, type Body } from './choreo';
import { Officials } from './officials';
import { celebrate } from './celebrate';
import { celebration } from '@/game/celebration';
import { kickView } from './kickView';
import { reveal } from '@/game/tunnelReveal';
import { revealBodies, revealView } from './tunnelShow';

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

/**
 * A field goal or PAT (M6): the other 19 set around the kicking unit
 * (KickBall.tsx has the snapper, holder and kicker). Field frame relative to
 * the line of scrimmage, 7 yd in front of the spot of the kick: x downfield,
 * y left, yd. The protection is the NFL's tight split, guards to wings a
 * foot apart (~0.35 yd) with the wings a yard off the ends' outside hips; the
 * block unit puts eight in the gaps across from them, an edge rusher off each
 * wing and one jumper in the middle (the standard field goal block look).
 * The QB, RB and center step off: the snapper takes the center's place.
 */
const FG_SET: Record<string, { at: [number, number]; stance: string } | null> = {
  QB: null,
  RB: null,
  C: null,
  LG: { at: [-0.3, 1.15], stance: 'stance_ol_3pt' },
  RG: { at: [-0.3, -1.15], stance: 'stance_ol_3pt' },
  LT: { at: [-0.3, 2.3], stance: 'stance_ol_3pt' },
  RT: { at: [-0.3, -2.3], stance: 'stance_ol_3pt' },
  TE: { at: [-0.3, 3.45], stance: 'stance_ol_3pt' },
  SLOT: { at: [-0.3, -3.45], stance: 'stance_ol_3pt' },
  X: { at: [-1.1, 4.4], stance: 'stance_rb_2pt' },
  Z: { at: [-1.1, -4.4], stance: 'stance_rb_2pt' },
  LDT: { at: [1, 0.6], stance: 'stance_dl_4pt' },
  RDT: { at: [1, -0.6], stance: 'stance_dl_4pt' },
  LE: { at: [1, 1.75], stance: 'stance_dl_3pt' },
  RE: { at: [1, -1.75], stance: 'stance_dl_3pt' },
  WLB: { at: [1, 2.9], stance: 'stance_dl_3pt' },
  SLB: { at: [1, -2.9], stance: 'stance_dl_3pt' },
  LCB: { at: [1.1, 4.05], stance: 'stance_dl_3pt' },
  RCB: { at: [1.1, -4.05], stance: 'stance_dl_3pt' },
  FS: { at: [1.6, 5.6], stance: 'stance_lb_ready' },
  SS: { at: [1.6, -5.6], stance: 'stance_lb_ready' },
  MLB: { at: [2.6, 0], stance: 'stance_lb_ready' },
};

/**
 * A punt (M6.6): the spread punt look, relative to the line of scrimmage
 * (x downfield, y left, yd). The snapper and the punter are KickBall's; the
 * guards and tackles in two-point sets a foot apart, wings off the ends, the
 * personal protector 5 yd deep, and gunners split wide near the numbers.
 * The Beasts: six on the line, a vise of two on each gunner (a corner in
 * press and a second man a yard off), a middle man, and the returner ~42 yd
 * deep. The gunners and the vise release at the snap and the returner
 * settles under the ball (puntMotion).
 */
const PUNT_SET: Record<string, { at: [number, number]; stance: string } | null> = {
  QB: null,
  C: null,
  LG: { at: [-0.3, 1.1], stance: 'stance_ol_ready' },
  RG: { at: [-0.3, -1.1], stance: 'stance_ol_ready' },
  LT: { at: [-0.3, 2.2], stance: 'stance_ol_ready' },
  RT: { at: [-0.3, -2.2], stance: 'stance_ol_ready' },
  TE: { at: [-1, 3.3], stance: 'stance_ol_ready' },
  SLOT: { at: [-1, -3.3], stance: 'stance_ol_ready' },
  RB: { at: [-5.5, 0.8], stance: 'stance_rb_2pt' },
  X: { at: [-0.3, 21], stance: 'stance_wr_2pt' },
  Z: { at: [-0.3, -21], stance: 'stance_wr_2pt' },
  LDT: { at: [1, 0.6], stance: 'stance_dl_3pt' },
  RDT: { at: [1, -0.6], stance: 'stance_dl_3pt' },
  LE: { at: [1, 1.9], stance: 'stance_dl_3pt' },
  RE: { at: [1, -1.9], stance: 'stance_dl_3pt' },
  WLB: { at: [1.1, 3.4], stance: 'stance_dl_3pt' },
  SLB: { at: [1.1, -3.4], stance: 'stance_dl_3pt' },
  LCB: { at: [1, 20.4], stance: 'stance_db_press' },
  RCB: { at: [1, -20.4], stance: 'stance_db_press' },
  MLB: { at: [2, 22], stance: 'stance_db_ready' },
  SS: { at: [2, -22], stance: 'stance_db_ready' },
  FS: { at: [42, 0], stance: 'stance_db_ready' },
};

/** Who runs on a punt once it's snapped: the gunners and their vise downfield, the returner under the ball. */
const PUNT_RUNNERS: Record<string, 'gunner' | 'vise' | 'returner'> = { X: 'gunner', Z: 'gunner', LCB: 'vise', RCB: 'vise', MLB: 'vise', SS: 'vise', FS: 'returner' };


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
    return { player, who: `${p.id}|${kit}|0`, kit, animator: new PlayerAnimator(player, lib), ragdoll: new Ragdoll(player), slot: slots[k]!, lastYaw: 0, lastSpeed: 0, throwAt: -1, throwClip: null, catchFor: -1, lie: null, fallen: false, lyingClip: false, yaw: 0, gaitSpeed: 0, once: new Set<string>(), catchClip: null, reach: false, hurdled: new Set<number>(), head: 0, headT: -1, cutAt: -9, ext: bodyExtent(RENDER_POS[p.pos], body.heightM, body.weightKg), contest: null };
  });
}

/**
 * Personnel changes the man in a slot between plays (an FB or a second TE in
 * the SLOT slot, the nickel corner for a linebacker): dress the body for
 * whoever lines up there now. Look and body only; the skeleton and clips stay.
 */
function relook(b: Body, p: SimPlayer, kit = b.kit, anonymous = false): void {
  // Keyed by the man, the kit and the nameplate (a body is built as `id|kit|0`).
  const look = `${p.id}|${kit}|${anonymous ? 1 : 0}`;
  if (b.who === look) return;
  b.who = look;
  b.kit = kit;
  const body = bodyFromImperial(p.heightIn, p.weightLb);
  // The Beasts' drive montage (M7) plays men the game never names: no nameplate.
  b.player.setLook({ kit: KITS[kit]!, skin: skinHexFor(p.name), number: p.num, name: anonymous ? '' : jerseyName(p.name), variety: playerVariety(RENDER_POS[p.pos], body.heightM, body.weightKg, p.name) });
  b.player.setBody(body.heightM, body.weightKg);
  b.ext = bodyExtent(RENDER_POS[p.pos], body.heightM, body.weightKg);
}

/**
 * A punt's coverage and return, drawn (no sim: the result is the punt
 * model's): after the snap the gunners sprint at the landing spot (~8.5 m/s,
 * a gunner's top end), the vise runs with them a step behind, and the
 * returner drifts under the ball and waits. Returns his ground speed (m/s)
 * for the gait. Moves the body's root.
 */
function puntMotion(b: Body, los: number, dt: number): number {
  const role = PUNT_RUNNERS[b.slot];
  const p = kickView.path;
  if (!role || !p || kickView.t < 0.35) return 0;
  const land = p[p.length - 1]!;
  const lx = kickView.spotX + land[0];
  const ly = land[1];
  const root = b.player.root;
  const x = fieldX(root.position.z);
  const y = fieldY(root.position.x);
  // The returner stops ~1 yd short of the spot; the coverage converges on it, the vise a step behind.
  const tx = role === 'returner' ? lx + 1 : role === 'gunner' ? lx - 4 : lx - 6;
  const ty = role === 'returner' ? ly : y + (ly - y) * Math.min(1, (x - los) / Math.max(1, lx - los));
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  const top = role === 'returner' ? 4.5 : role === 'gunner' ? 8.5 : 8;
  // Up to speed over ~1 s after the release.
  const v = Math.min(top, top * Math.min(1, (kickView.t - 0.35) / 1.0)) * Math.min(1, d / 1.5);
  if (d < 0.2 || v < 0.05) return 0;
  const yd = (v / YARD) * dt;
  root.position.x = worldX(y + (dy / d) * yd);
  root.position.z = worldZ(x + (dx / d) * yd);
  root.rotation.y = yawOf(Math.atan2(dy, dx));
  return v;
}

const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hands = new THREE.Vector3();
const _flightOn = new THREE.Vector3();
/**
 * The catch's last stretch (passing round 3): the drawn ball as it was last
 * frame in the air, and how long since the sim called it caught. It
 * carries on from there into the hands at about its own pace (`dur`).
 */
const catchIn = { air: false, age: -1, dur: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() };
/** The ball's last stretch into the hands (s): the sim calls the catch as it comes within his reach, 0.03–0.08 s before it gets to him; at least a frame, at most this. Ours. */
const CATCH_IN = 0.1;
const CATCH_IN_MIN = 1 / 30;
/**
 * The ball's readability on the broadcast camera (render only): true size
 * within BALL_NEAR m of the camera, growing to BALL_GROW× by BALL_FAR. A
 * real-size football 40 m out is ~5 px across at 1280 wide and disappears
 * against the grass in the air; broadcast games draw it larger than life the
 * same way. Ours, sized by eye on the passing recordings.
 */
const BALL_NEAR = 12;
const BALL_FAR = 45;
const BALL_GROW = 1.6;
/** Fastest the drawn facing turns (rad/s): a sharp pivot, ~180° in a quarter second. */
const YAW_MAX = 12;
const tmp: AgentSnap = { x: 0, y: 0, vx: 0, vy: 0, face: 0, anim: 'stance', move: null, down: false, stamina: 1 };
/** Contact between drawn bodies (M6.5 #12, contact.ts): per body, and the contested pairs this frame. */
const contactBodies: ContactBody[] = [];
const contactPairs: [number, number][] = [];
const _lean = { x: 0, z: 0 };
/** What the scene draws: the live play's runner, or a replay's. */
type Runner = SimRunner;

/** The carrier's move options as the HUD says them (one word each). */
const OPTION_WORD: Record<string, string> = { juke: 'Juke', stiffArm: 'Stiff arm', spin: 'Spin', truck: 'Truck', hurdle: 'Hurdle', dive: 'Dive', protect: 'Protect' };

export function GameScene() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const [bodies, setBodies] = useState<Body[] | null>(null);
  const [marks] = useState(createFieldMarks);
  const [ball] = useState(createFootball);
  const [flight] = useState(createBallFlight);
  const [routeArt] = useState(createRouteArt);
  /** The play the bodies are set for: `p<playId>` live, `r<epoch>` a replay ('' none). */
  const shownPlay = useRef('');
  const officials = useRef<Officials | null>(null);
  const kickSet = useRef<string | null>(null);
  const lastSimT = useRef(0);
  const snapped = useRef(false);
  const [contact] = useState(() => new ContactSmoother());
  /** The Contenders' kit on the field (white if theirs is as dark as the Beasts'): the montage dresses the defense in it. */
  const userKit = useRef('whiteLime');
  /** The tunnel reveal was on last frame (its exposure is given back the frame it ends). */
  const revealOn = useRef(false);

  useEffect(() => {
    let alive = true;
    let group: THREE.Group | null = null;
    const wait = async () => {
      while (alive && !(replay.rosters ?? practice.rosters)) await new Promise((r) => setTimeout(r, 100));
    };
    Promise.all([loadPlayerAsset(), loadAnimLibrary(), wait()]).then(async ([asset, lib]) => {
      // The results screen's replay brings its own two teams (the game's); otherwise the live session's.
      const R = replay.rosters ?? practice.rosters;
      if (!alive || !R) return;
      // Agent order in the sim: OFF_SLOTS then DEF_SLOTS (sim/plays.ts).
      // Never two dark kits on the field (Playtest 1 decision 5): the offense changes to white if its kit is as dark as the Beasts'.
      const offKit = kitAgainst(practice.offenseKit, 'beasts').id;
      userKit.current = offKit;
      const all = [...buildTeam(OFF_SLOTS.map((k) => R.offense[k]), OFF_SLOTS, offKit, asset, lib), ...buildTeam(DEF_SLOTS.map((k) => R.defense[k]), DEF_SLOTS, 'beasts', asset, lib)];
      const g = new THREE.Group();
      g.name = 'players';
      for (const b of all) {
        b.player.root.visible = false;
        g.add(b.player.root);
      }
      const crew = new Officials(asset, lib);
      crew.group.visible = false;
      g.add(crew.group);
      officials.current = crew;
      await prepareLate(g, gl, camera, scene);
      if (!alive) return;
      group = g;
      scene.add(g);
      shadowAttach.requested = true;
      setBodies(all);
      replay.sceneReady();
      (window as unknown as { __btbGameReady?: boolean }).__btbGameReady = true;
      // Capture specs read what each body is playing (tools/shots/carriergame.spec.ts); recording only.
      if (urlFlags.video) (window as unknown as { __btbBodies?: Body[] }).__btbBodies = all;
    }, console.error);
    scene.add(marks.group, ball, routeArt.group);
    return () => {
      alive = false;
      if (group) scene.remove(group);
      scene.remove(marks.group, ball, routeArt.group);
    };
  }, [scene, gl, camera, marks, ball, routeArt]);

  /**
   * Draw the players from the sim's latest two snapshots (alpha between
   * them), animated by animDt of sim time: the per-body pass of a frame, and
   * of every step of a replay's catch-up. `live`: a real frame (latency
   * probes, the pop meter, LOD and the dust a fall kicks up).
   */
  function animate(bs: Body[], r: Runner, alpha: number, simT: number, animDt: number, controlled: number, live: boolean, camera: THREE.Camera, viewportPx: number) {
    const s = r.state;
    const { prev, cur } = r;
    contests(bs, s, simT, contactPairs);
    bs.forEach((b, i) => {
      // A touchdown celebration (M7) drives the scorer and the team-mates coming over itself.
      if (live && celebrate.owns(i)) return;
      const p0 = prev.agents[i]!;
      const p1 = cur.agents[i]!;
      tmp.x = p0.x + (p1.x - p0.x) * alpha;
      tmp.y = p0.y + (p1.y - p0.y) * alpha;
      tmp.vx = p0.vx + (p1.vx - p0.vx) * alpha;
      tmp.vy = p0.vy + (p1.vy - p0.vy) * alpha;
      const face = lerpAngle(p0.face, p1.face, alpha);
      if (live && i === controlled) latency.motion({ x: tmp.vx, y: tmp.vy });
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
      // Bodies in contact: drawn a little off the sim's spot, leaning in (contact.ts; render only).
      const cc = contact.cur[i];
      _lean.x = _lean.z = 0;
      if (cc && !b.lie) {
        root.position.x += cc.ox;
        root.position.z += cc.oz;
        _lean.x = cc.lx;
        _lean.z = cc.lz;
      }
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
      b.animator.update(animDt, { speed: d.speed, backpedal: d.backpedal, yawRate: Math.max(-4, Math.min(4, yawRate)), accel: Math.max(-12, Math.min(12, accel)), lookAt: d.look, lookWide: d.lookWide, carry: d.carry, traffic: d.traffic, drive: d.drive, press: d.press, dip: d.dip, contactLean: _lean });
      // The hands to the ball on a catch (passing round 3), over the clip's own reach.
      catchReach(b, i, s);
      b.ragdoll.update(animDt);
      // A body hitting the turf hard kicks up dust (a big hit's landing).
      const land = b.ragdoll.landing;
      if (land) {
        b.ragdoll.landing = null;
        if (live) activeVfx()?.emit('hitDust', [land.x, land.y, land.z], { scale: 1.3 });
      }
      if (live) {
        b.player.updateLod(camera, viewportPx);
        if (urlFlags.pops) measure(b, animDt, latency.frame, s.agents[i]!.anim, cur.phase);
      }
    });
    // Where the trunks are drawn (less the contact offset: it must not feed back), then the contact response for next frame.
    bs.forEach((b, i) => {
      const cb = (contactBodies[i] ??= { x: 0, z: 0, fx: 0, fz: 1, ext: b.ext, scale: 1, free: false });
      const cc = contact.cur[i];
      const yaw = b.player.root.rotation.y;
      cb.x = b.animator.trunk.x - (cc?.ox ?? 0);
      cb.z = b.animator.trunk.z - (cc?.oz ?? 0);
      cb.fx = Math.sin(yaw);
      cb.fz = Math.cos(yaw);
      cb.ext = b.ext;
      cb.scale = b.player.shape.scale;
      cb.free = !b.fallen && !b.lie && !b.ragdoll.active && !s.agents[i]!.down;
    });
    contactBodies.length = bs.length;
    contact.update(contactBodies, contactPairs, animDt);
    officials.current?.update(animDt, cur.ball, s.result, s.result ? s.result.spot - s.setup.los : 0, s.setup.toGo, camera, viewportPx);
  }

  /**
   * A replay's scrub (replay.ts): step the play on to the target and animate
   * every step, so the bodies arrive with the clips, falls and catches they'd
   * have had playing it. Coarse (12 ticks a step) more than a second out:
   * that far back only what persists matters (a man down, a catch made);
   * finer over the last second, a broadcast frame (2 ticks) over its last
   * third. At most `budgetMs` of a frame, the rest on the next (the screen
   * shows it fast-forwarding).
   */
  function catchUp(bs: Body[], budgetMs: number, camera: THREE.Camera, viewportPx: number) {
    const p = replay.player!;
    const t0 = performance.now();
    while (p.seeking && performance.now() - t0 < budgetMs) {
      const left = p.target - p.tick;
      replayStats.ticks += p.stepTicks(left > 60 ? 12 : left > 20 ? 4 : 2);
      replayStats.steps++;
      const r = p.runner;
      const s = r.state;
      const cur = r.cur;
      frameEvents.length = 0;
      for (const e of r.drainEvents()) frameEvents.push(e);
      if (!snapped.current && cur.phase !== 'presnap') {
        snapped.current = true;
        onSnap(bs, s, (slot) => stanceFor(slot, s));
      }
      onEvents(bs, s, frameEvents);
      const simT = cur.t + TICK;
      const animDt = Math.max(0, Math.min(0.5, simT - lastSimT.current));
      lastSimT.current = simT;
      animate(bs, r, 1, simT, animDt, -1, false, camera, viewportPx);
    }
    // The hits on the way there don't shake the camera or sound.
    frameEvents.length = 0;
    const ms = performance.now() - t0;
    replayStats.ms += ms;
    replayStats.worstFrameMs = Math.max(replayStats.worstFrameMs, ms);
    if (!p.seeking) replayStats.seeks++;
  }

  useFrame(({ camera, gl, clock }, dt) => {
    // (A recording steps only in the frames the recorder asked for: platform.ts videoTime.)
    const step = urlFlags.video ? videoTime.step() : urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    latency.frame++;
    // A replay (M7) plays instead of the live snap, which holds where it stands until it hands back.
    replay.frame(step);
    // The Beasts' drive (M7) plays its staged snap the same way (or its kick through the kick view), when no replay is up.
    if (!replay.active) montage.frame(step);
    const mp = !replay.active && montage.active ? montage.player : null;
    if (!replay.active && !montage.active) practice.frame(step);
    const rp = replay.active ? replay.player : mp;
    const r: Runner | null = rp ? rp.runner : practice.runner;
    const show = !!r && !!bodies;
    marks.group.visible = show && r!.cur.phase !== 'dead';
    ball.visible = show;
    frameEvents.length = 0;
    if (officials.current) officials.current.group.visible = show;
    // The tunnel reveal (M7, tunnelShow.ts): the run-out and the Beasts' line in place of the play,
    // from the walk-out's hand-over until the pre-game card. It holds in the light until the bodies are built.
    if (reveal.active || revealOn.current) {
      const R = practice.rosters;
      reveal.frame(step, !!bodies && !!R && !!practice.runner);
      revealOn.current = reveal.active;
      revealView(reveal.active);
      if (reveal.active) {
        marks.group.visible = false;
        ball.visible = false;
        if (officials.current) officials.current.group.visible = false;
        for (const el of hudDom.icons) if (el) el.style.visibility = 'hidden';
        if (r) routeArt.update(r.state, false, step, null);
        if (bodies && R && reveal.shot !== 'hold') {
          const roster = [...OFF_SLOTS.map((k) => R.offense[k]), ...DEF_SLOTS.map((k) => R.defense[k])];
          revealBodies(bodies, roster, OFF_SLOTS.length, step, clock.elapsedTime, camera, gl.domElement.height);
        } else if (bodies) for (const b of bodies) b.player.root.visible = false;
        // After it, the next frame sets everyone in the pre-game lineup.
        shownPlay.current = '';
        return;
      }
    }
    if (bodies && kickView.active && !rp) {
      // The kick: everyone set in the field goal (or punt) look, the sim's marks and ball away.
      if (officials.current) officials.current.group.visible = true;
      marks.group.visible = false;
      ball.visible = false;
      for (const el of hudDom.icons) if (el) el.style.visibility = 'hidden';
      if (r) routeArt.update(r.state, false, step, null);
      const punt = kickView.kind === 'PUNT';
      const los = kickView.spotX + (punt ? PUNT_DEPTH : 7);
      const key = `${kickView.kind}:${kickView.spotX}:${kickView.team}:${montage.cutCount}`;
      if (kickSet.current !== key) {
        kickSet.current = key;
        // The Beasts' kick on their drive (M7): their (anonymous) kicking unit in black, the return or block team in your kit.
        const men = kickView.team === 'bst' ? montage.kick?.men : null;
        if (men) bodies.forEach((b, i) => relook(b, men[i]!, i < OFF_SLOTS.length ? 'beasts' : userKit.current, true));
        for (const b of bodies) {
          const set = (punt ? PUNT_SET : FG_SET)[b.slot];
          b.player.root.visible = !!set;
          if (!set) continue;
          const off = (OFF_SLOTS as string[]).includes(b.slot);
          b.player.root.position.set(worldX(set.at[1]), 0, worldZ(los + set.at[0]));
          b.player.root.rotation.set(0, yawOf(off ? 0 : Math.PI), 0);
          resetBody(b);
          b.animator.reset();
          b.animator.setStance(set.stance);
          b.animator.update(10, { speed: 0 });
        }
        officials.current?.place(los, 0);
        // A punt cut into part-way (the Beasts' drive cuts in with the ball in the punter's hands): the coverage
        // and the returner are already where that much of the play has taken them.
        if (punt && kickView.path && kickView.t > 0) {
          const t1 = kickView.t;
          for (let t = 0; t < t1; t += 1 / 30) {
            kickView.t = t;
            for (const b of bodies) if (b.player.root.visible) puntMotion(b, los, 1 / 30);
          }
          kickView.t = t1;
        }
      }
      for (const b of bodies) {
        if (!b.player.root.visible) continue;
        const speed = punt ? puntMotion(b, los, step) : 0;
        b.animator.update(step, { speed });
        b.player.updateLod(camera, gl.domElement.height);
      }
      officials.current?.update(step, { x: los, y: 0 }, null, 0, 10, camera, gl.domElement.height);
      // Back from the kick, the next snapshot sets everyone again.
      shownPlay.current = '';
      return;
    }
    kickSet.current = null;
    if (!show) {
      if (bodies) for (const b of bodies) b.player.root.visible = false;
      for (const el of hudDom.icons) if (el) el.style.visibility = 'hidden';
      shownPlay.current = '';
      return;
    }

    // A new play (or a replay rebuilt for a scrub back): settle everyone into his stance where he lines up.
    const showing = mp ? `m${mp.epoch}` : rp ? `r${rp.epoch}` : `p${practice.playId}`;
    if (shownPlay.current !== showing) {
      if (!rp && shownPlay.current.startsWith('r') && replay.handoff === practice.playId) {
        // A snap's replay has closed on the very state the live play is in: carry on with the bodies as they are.
        replay.handoff = -1;
        shownPlay.current = showing;
      } else {
        shownPlay.current = showing;
        snapped.current = false;
        if (!rp) celebrate.reset(practice.playId);
        const s0 = r.state;
        const cur0 = r.cur;
        bodies.forEach((b, i) => {
          const a = cur0.agents[i]!;
          // The montage: the Beasts on offense in their black, the Contenders' defense in the user's kit, all anonymous.
          const off = i < OFF_SLOTS.length;
          if (mp) relook(b, s0.agents[i]!.p, off ? 'beasts' : userKit.current, true);
          else relook(b, s0.agents[i]!.p, off ? userKit.current : 'beasts');
          b.player.root.visible = true;
          b.player.root.position.set(worldX(a.y), 0, worldZ(a.x));
          b.player.root.rotation.set(0, yawOf(a.face), 0);
          resetBody(b);
          b.animator.reset();
          b.animator.setStance(stanceFor(b.slot, s0));
          b.animator.update(10, { speed: 0 });
          b.lastYaw = yawOf(a.face);
          b.yaw = b.lastYaw;
          b.lastSpeed = 0;
          b.gaitSpeed = 0;
        });
        if (urlFlags.pops) resetPops();
        contact.reset();
        lastSimT.current = cur0.t;
        officials.current?.place(s0.setup.los, s0.setup.ballY ?? 0);
      }
    }
    const viewportPx = gl.domElement.height;
    // A scrub under way: step and animate toward it, a slice of each frame (closing: as fast as it goes;
    // the capture harness and the browser tests, whose frames are slow anyway: all at once).
    if (rp?.seeking) catchUp(bodies, urlFlags.video || urlFlags.shot !== null ? Infinity : replay.closing ? 40 : 7, camera, viewportPx);
    if (rp && replay.closing && !rp.seeking) replay.finish();

    const rr: Runner = rp ? rp.runner : r;
    const s = rr.state;
    const { cur } = rr;
    const alpha = rr.alpha;
    for (const e of rr.drainEvents()) frameEvents.push(e);
    if (mp) reactMontage(clock.elapsedTime);
    else if (rp) reactReplay();
    else reactCrowd(clock.elapsedTime);

    // The snap: everyone who has a get-off out of his stance plays it.
    if (!snapped.current && cur.phase !== 'presnap') {
      snapped.current = true;
      onSnap(bodies, s, (slot) => stanceFor(slot, s));
      if (!rp) latency.respond('snap');
    }
    onEvents(bodies, s, frameEvents);
    // Animate by the sim time that passed (the same as the frame time in
    // play; more when a test or a hitch stepped several ticks at once).
    const simT = cur.t + alpha * TICK;
    const animDt = Math.max(0, Math.min(0.5, simT - lastSimT.current));
    lastSimT.current = simT;
    // The player the user moves now: the QB until the ball leaves him, then his carrier.
    const ph = cur.phase;
    const userCarrier = cur.carrier >= 0 && s.agents[cur.carrier]!.side === 'off';
    const controlled = rp ? -1 : ph === 'carrier' ? (userCarrier ? cur.carrier : -1) : ph === 'snap' || ph === 'dropback' || ph === 'pocket' ? s.qb : -1;
    if (controlled < 0 && !rp) latency.motion(null);
    animate(bodies, rr, alpha, simT, animDt, controlled, true, camera, viewportPx);
    // The touchdown celebration (M7): after a user score's whistle, render-only, in frame time (the dead ball's sim stops a few seconds on).
    if (rp) celebrate.release();
    else {
      const paused = usePractice.getState().stage === 'paused';
      celebration.frame(s, practice.playId, step, paused);
      celebrate.update(bodies, s, practice.playId, paused ? 0 : step, officials.current);
    }

    placeBall(rr, s.snapT, s.t, animDt);
    placeMarks(s.setup.los, s.setup.toGo);
    // The route preview: held key, the hot-route picker, or just after a hot route is called.
    const ui = usePractice.getState();
    const hot = rp ? null : ui.hot;
    const showRoutes = !rp && cur.phase === 'presnap' && (Input.isHeld('preSnap.routes') || !!hot || performance.now() < practice.routeFlashUntil);
    routeArt.update(s, showRoutes, step, hot && hot.stage === 'route' ? { icon: hot.icon, candidate: HOT_ROUTES[hot.focus]! } : null);
  }, -100);

  // The HUD goes on after the camera has moved this frame (GameCamera runs
  // at -90), so the icons and the carrier's keys sit on the players as drawn,
  // not a frame behind them.
  useFrame(({ camera }) => {
    if (!practice.runner || !bodies || replay.active || montage.active) return;
    camera.updateMatrixWorld();
    placeHud();
  }, -80);

  function placeBall(r: Runner, snapT: number, t: number, dt: number) {
    const { prev, cur } = r;
    const a = r.alpha;
    const b0 = prev.ball;
    const b1 = cur.ball;
    const held = b1.mode === 'held' && b1.holder >= 0;
    const inSnap = cur.phase === 'presnap' || (snapT >= 0 && t - snapT < 0.34);
    // True size in the hands; in the air and on the turf it grows with distance from the camera (BALL_FAR).
    ball.scale.setScalar(1);
    if (r === practice.runner && !replay.active && celebrate.placeBall(ball)) return;
    if (held && !inSnap && bodies && ballInHands(bodies[b1.holder]!, r.state, ball)) {
      // Just caught: the ball finishes its flight into the hands (passing round 3: the sim takes it as it comes
      // within his reach, up to a yard short of him, and it jumped into his hands in a frame).
      if (catchIn.air && b1.holder !== r.state.qb) {
        catchIn.air = false;
        catchIn.age = 0;
        // At the ball's own pace (the rest of its way to the hands), a frame or three.
        catchIn.dur = THREE.MathUtils.clamp(catchIn.pos.distanceTo(ball.position) / Math.max(1, catchIn.vel.length()), CATCH_IN_MIN, CATCH_IN);
      }
      if (catchIn.age >= 0 && catchIn.age < catchIn.dur) {
        catchIn.age += dt;
        const k = Math.min(1, catchIn.age / catchIn.dur);
        _flightOn.copy(catchIn.pos);
        ball.position.lerpVectors(_flightOn, ball.position, k);
        ball.quaternion.slerpQuaternions(catchIn.quat, ball.quaternion, k);
      }
      heldAt(flight, ball);
      return;
    }
    catchIn.age = -1;
    ball.position.set(worldX(b0.y + (b1.y - b0.y) * a), worldY(b0.z + (b1.z - b0.z) * a), worldZ(b0.x + (b1.x - b0.x) * a));
    if (cur.phase === 'presnap') {
      // On the ground, pointing downfield.
      ball.position.y = 0.09;
      ball.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      resetFlight(flight);
      return;
    }
    if (held) return;
    // The spiral, its attitude and wobble, the release from the hand, the tumble and the bounce (ballFlight.ts).
    placeFlight(flight, ball, r.state, ballWorldVel(b1.vx, b1.vy, b1.vz, _dir), dt, t);
    // The last frames of the flight bend into the catcher's hands (M6.5 #5).
    if (b1.mode === 'air' && r.state.ball.target >= 0 && bodies) {
      const k = catchMagnet(bodies[r.state.ball.target]!, ball.position, _hands);
      if (k > 0) ball.position.lerp(_hands, k);
    }
    // Where the drawn ball is and where it's going, for the catch (above).
    catchIn.air = b1.mode === 'air';
    if (catchIn.air) {
      catchIn.pos.copy(ball.position);
      ballWorldVel(b1.vx, b1.vy, b1.vz, catchIn.vel);
      catchIn.quat.copy(ball.quaternion);
    }
    const far = THREE.MathUtils.clamp((ball.position.distanceTo(camera.position) - BALL_NEAR) / (BALL_FAR - BALL_NEAR), 0, 1);
    ball.scale.setScalar(1 + (BALL_GROW - 1) * far);
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
    // (A windup the player's still holding for touch keeps the icons and the ring up: the motion's started, the throw isn't chosen yet.)
    const thrown = s.windup !== null && !s.windup.held;
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
        // The throw-timing cue (passing round 4): when to press for the ball to be out on his break.
        placeCue(k, el, s, idx, hudTime(cur.t, r.alpha), practice.playId, latency.frame, v.visible && cur.phase !== 'presnap' && !!s.setup.user);
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
    // A Pre-Snap Wizard's blitz tags: over each Beast who'll blitz, at the line only.
    const blitz = cur.phase === 'presnap' && bodies ? blitzersShown(s) : [];
    for (let k = 0; k < hudDom.blitz.length; k++) {
      const el = hudDom.blitz[k];
      if (!el) continue;
      const idx = blitz[k];
      if (idx === undefined || !bodies) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
        continue;
      }
      const root = bodies[idx]!.player.root;
      _p.set(root.position.x, 2.35 * bodies[idx]!.player.shape.scale, root.position.z).project(camera);
      el.style.visibility = _p.z > 1 ? 'hidden' : 'visible';
      el.style.transform = `translate(${(rect.left + ((_p.x + 1) / 2) * rect.width).toFixed(1)}px, ${(rect.top + ((1 - _p.y) / 2) * rect.height).toFixed(1)}px)`;
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
        // The three options the sim holds on him now (moves.ts), the move he's in lit.
        // M6.6 (Playtest 1: "the move prompts show up late"): the sim only
        // sets them once carrierStep runs him, which on a designed run is
        // after he has pressed the aiming point (to the line on a gap scheme,
        // a beat on zone), so the words were blank for up to a second after
        // the handoff. Until the sim holds a set, the HUD reads the same
        // pure ranking itself (read-only) and shows it dimmed: on screen the
        // moment he has the ball, lit fully once a press will do it.
        const live = s.agents[cur.carrier]!;
        const held = typeof live.mem.opts === 'string';
        const opts = held ? (live.mem.opts as string).split(',') : carrierOptions(s, live);
        if (ch.dataset.pending !== String(!held)) ch.dataset.pending = String(!held);
        const inMove = live.busy > 0 && live.move ? (live.move === 'jukeL' || live.move === 'jukeR' ? 'juke' : live.move) : live.move === 'protect' ? 'protect' : null;
        // The one action button's cue (slot 0): the move the game would make now (autoMove, read-only), or "Move" while nobody's close enough.
        const pick = autoMove(s, live);
        const autoWord = pick === 'jukeL' || pick === 'jukeR' ? 'juke' : (pick ?? '');
        for (let k = 0; k < 3; k++) {
          const el = hudDom.opts[k];
          if (!el) continue;
          const o = k === 0 ? autoWord : (opts[k] ?? '');
          const w = OPTION_WORD[o] ?? '';
          const word = o === 'dive' && live.slot === 'QB' ? 'Slide' : w || (k === 0 ? 'Move' : '');
          const span = el.lastElementChild as HTMLElement | null;
          if (span && span.textContent !== word) span.textContent = word;
          el.classList.toggle('lit', !!o && o === inMove);
        }
        hudDom.sprint?.classList.toggle('lit', live.mem.sprint === true);
      }
    }
  }

  /** A replay's hits sound again; the crowd doesn't react twice. */
  function reactReplay() {
    for (const e of frameEvents) if (e.type === 'hit') Audio.hit(Number(e.data?.force ?? 4), !!e.data?.big);
  }

  /** The Beasts' drive (M7): it's their house, so a Beasts score or big play brings the bowl up and a Contenders stop sits it down. */
  function reactMontage(now: number) {
    for (const e of frameEvents) {
      if (e.type === 'touchdown') crowdEnergy.trigger('touchdown', now);
      else if (e.type === 'interception' || e.type === 'recovery' || e.type === 'sack') crowdEnergy.trigger('groan', now);
      else if (e.type === 'catch') crowdEnergy.trigger('bigPlay', now);
      if (e.type === 'hit') Audio.hit(Number(e.data?.force ?? 4), !!e.data?.big);
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
