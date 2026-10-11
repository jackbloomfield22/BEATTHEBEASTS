// Passing round 13 (docs/passing/PASSING13.md; a copy of p12_cam.ts, itself from round 12 (PASSING12.md) and p11_cam.ts): the broadcast camera on a pass, measured in Node frame by frame at 60 fps
// on the same code the game draws it with (src/render/game/broadcastCam.ts), the rig's springs stepped as a 60-fps
// recording steps them. From the windup to the catch: the pan's speed (the look's direction, °/s, a 3-frame mean), the
// zoom's (° of lens/s) and the dolly's (m/s); the QB's drawn height (px at 960×540) and whether he's in the frame
// through the release and the finish; the receiver's drawn height at the catch.
//   node tools/run-ts.mjs tools/sim/p13_cam.ts [--ids=p9-slant,...] [--frames]
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING9, PASSING10, withSwap, type Clip } from '../../src/game/clips.ts';
import { capture, emptySnapshot } from '../../src/game/snapshot.ts';
import { BroadcastCam, poseToWorld, Spring } from '../../src/render/game/broadcastCam.ts';
import { worldX, worldZ } from '../../src/game/coords.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',');
const frames = process.argv.includes('--frames');

const W = 960;
const H = 540;
/** The QB's and the receiver's drawn height: from the ground to the top of the helmet (m; a 6-3 man in a helmet). */
const MAN_H = 1.95;

const list: Clip[] = [...PASSING9, ...PASSING10].filter((c) => (ids ? ids.includes(c.id) : !c.id.startsWith('p9-rac') && c.id !== 'p9-reach-mid'));
const cam = new THREE.PerspectiveCamera(52, W / H, 0.1, 500);
const v = new THREE.Vector3();
/** A man's drawn height (px) and whether his feet and head are in the frame. */
function drawn(x: number, y: number): { h: number; in: boolean; top: number; bot: number } {
  v.set(worldX(y), 0, worldZ(x)).project(cam);
  const fx = v.x;
  const fy = v.y;
  const fz = v.z;
  v.set(worldX(y), MAN_H, worldZ(x)).project(cam);
  const inside = (a: number, b: number, z: number) => Math.abs(a) <= 1 && Math.abs(b) <= 1 && z < 1;
  return { h: ((v.y - fy) * H) / 2, in: inside(fx, fy, fz) && inside(v.x, v.y, v.z), top: ((1 - v.y) * H) / 2, bot: ((1 - fy) * H) / 2 };
}
for (const c of list) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  const cur = capture(s, emptySnapshot(s.agents.length));
  const bc = new BroadcastCam();
  let springs: Spring[] | null = null;
  const dt = 1 / 60;
  type F = { t: number; eye: THREE.Vector3; dir: THREE.Vector3; fov: number; qb: ReturnType<typeof drawn>; rec: ReturnType<typeof drawn> | null; phase: string };
  const log: F[] = [];
  let windup = -1;
  let release = -1;
  let arrive = -1;
  let target = -1;
  let caught = -1;
  let relQ: { x: number; y: number; face: number } | null = null;
  for (let k = 0; k < 1500 && !s.result; k++) {
    if (windup < 0 && s.windup) windup = s.t;
    if (release < 0 && s.ball.mode === 'air') {
      relQ = { x: s.agents[s.qb]!.pos.x, y: s.agents[s.qb]!.pos.y, face: s.agents[s.qb]!.face };
      release = s.t;
      arrive = s.ball.arrive;
      target = s.ball.target;
    }
    if (release >= 0 && caught < 0 && s.phase !== 'air') caught = s.t;
    bc.stepBreakaway(s, cur, 0, dt, false);
    const t = poseToWorld(bc.pose(s, cur));
    if (!springs) springs = t.map((x) => new Spring(x));
    const w = bc.weights(s, cur);
    const p = springs.map((sp, i) => sp.step(t[i]!, w[i]!, dt));
    bc.camNow.eye.set(p[0]!, p[1]!, p[2]!);
    bc.camNow.aspect = W / H;
    bc.camNow.ok = true;
    cam.position.set(p[0]!, p[1]!, p[2]!);
    cam.fov = p[6]!;
    cam.lookAt(p[3]!, p[4]!, p[5]!);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const q = cur.agents[s.qb]!;
    const rc = target >= 0 ? cur.agents[target]! : null;
    log.push({ t: s.t, eye: cam.position.clone(), dir: cam.getWorldDirection(new THREE.Vector3()), fov: p[6]!, qb: drawn(q.x, q.y), rec: rc ? drawn(rc.x, rc.y) : null, phase: s.phase });
    if (caught >= 0 && s.t > caught + 0.6) break;
    stepPlay(s, c.script(s));
    capture(s, cur);
  }
  if (release < 0) {
    console.log(`${c.id}: no throw`);
    continue;
  }
  // Speeds: the angle between successive look directions (°/s), the lens (°/s), the eye (m/s); the pan as a 3-frame mean.
  const raw = log.map((f, i) => (i === 0 ? { pan: 0, zoom: 0, dolly: 0 } : { pan: (f.dir.angleTo(log[i - 1]!.dir) * 180) / Math.PI / dt, zoom: Math.abs(f.fov - log[i - 1]!.fov) / dt, dolly: f.eye.distanceTo(log[i - 1]!.eye) / dt }));
  const m3 = (i: number, k: 'pan' | 'zoom' | 'dolly') => (raw[Math.max(0, i - 1)]![k] + raw[i]![k] + raw[Math.min(raw.length - 1, i + 1)]![k]) / 3;
  const from = log.findIndex((f) => f.t >= (windup >= 0 ? windup : release) - 1e-9);
  const to = log.findIndex((f) => f.t >= (caught >= 0 ? caught : arrive) - 1e-9);
  let pk = { pan: 0, zoom: 0, dolly: 0, panT: 0 };
  for (let i = from; i <= to; i++) {
    const pan = m3(i, 'pan');
    if (pan > pk.pan) pk = { ...pk, pan, panT: log[i]!.t - release };
    pk.zoom = Math.max(pk.zoom, m3(i, 'zoom'));
    pk.dolly = Math.max(pk.dolly, m3(i, 'dolly'));
  }
  const at = (t: number) => log[Math.max(0, log.findIndex((f) => f.t >= t - 1e-9))]!;
  const rel = at(release);
  // The QB in the frame through the release and the finish: until when (s after the release).
  let qbIn = -1;
  for (const f of log) if (f.t >= release && f.t <= release + 1.5) {
    if (!f.qb.in) break;
    qbIn = f.t - release;
  }
  const cat = at(caught >= 0 ? caught : arrive);
  // (Round 12) The eye against the QB at the release, in his frame (m: ahead, to his left, up), for the clips' previews.
  if (process.argv.includes('--rel')) {
    const q = relQ!;
    const YD = 0.9144;
    const ex = 50 - rel.eye.z / YD;
    const ey = -rel.eye.x / YD;
    const dx = (ex - q.x) * YD;
    const dy = (ey - q.y) * YD;
    const f = [Math.cos(q.face), Math.sin(q.face)];
    console.log(`  eye from the QB at the release: ${(dx * f[0]! + dy * f[1]!).toFixed(2)} m ahead, ${(-dx * f[1]! + dy * f[0]!).toFixed(2)} m to his left, ${rel.eye.y.toFixed(2)} m up; lens ${rel.fov.toFixed(1)}°; facing ${((q.face * 180) / Math.PI).toFixed(0)}°`);
  }
  console.log(
    `${c.id}: windup ${windup >= 0 ? (release - windup).toFixed(2) : '-'} s before the release, flight ${(arrive - release).toFixed(2)} s | ` +
      `peak pan ${pk.pan.toFixed(0)}°/s (at ${pk.panT.toFixed(2)} s), zoom ${pk.zoom.toFixed(0)}°/s, dolly ${pk.dolly.toFixed(1)} m/s | ` +
      `QB ${rel.qb.h.toFixed(0)} px at the release (top ${rel.qb.top.toFixed(0)}, feet ${rel.qb.bot.toFixed(0)}), ${at(release + 0.25).qb.h.toFixed(0)} px +0.25 s, in frame to +${qbIn.toFixed(2)} s | ` +
      `receiver ${cat.rec ? cat.rec.h.toFixed(0) : '-'} px at the catch, lens ${cat.fov.toFixed(1)}°`,
  );
  if (frames)
    for (let i = from; i <= to; i += 3) {
      const f = log[i]!;
      const yaw = (Math.atan2(-f.dir.x, -f.dir.z) * 180) / Math.PI;
      const pitch = (Math.asin(f.dir.y) * 180) / Math.PI;
      console.log(`  ${(f.t - release).toFixed(2)} ${f.phase} yaw ${yaw.toFixed(1)} pitch ${pitch.toFixed(1)} eye ${f.eye.x.toFixed(1)},${f.eye.y.toFixed(1)},${f.eye.z.toFixed(1)} pan ${m3(i, 'pan').toFixed(0)} zoom ${m3(i, 'zoom').toFixed(0)} dolly ${m3(i, 'dolly').toFixed(1)} fov ${f.fov.toFixed(1)} qb ${f.qb.h.toFixed(0)}px ${f.qb.in ? 'in' : 'OUT'} (${f.qb.top.toFixed(0)}-${f.qb.bot.toFixed(0)}) rec ${f.rec ? f.rec.h.toFixed(0) : '-'}`);
    }
}
