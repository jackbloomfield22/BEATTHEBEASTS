/// <reference types="vite/client" />
// Animation round 18 (docs/anim/BREAK18.md): the back seven's feet on the sim's own motion, headless. Each play is run in
// the sim as the Practice Field runs it, and every linebacker and defensive back drives two animators from the sim's
// velocity and facing, fed as GameScene and choreo.ts drive() feed them (the drawn facing eased toward the sim's at 22/s,
// at most 12 rad/s; the pedal under 5.2 m/s going back faster than 0.8 yd/s, else he faces his run; the gait's speed eased
// over 60 ms): one with the keyed breaks (AnimInput.brk) and one without. For each: the steps taken (feet that couldn't
// stay planted), the breaks played (clip, start time, mean rate) and the sim's speed at them. It leaves out what the
// game plays besides (the get-offs, the read step, the hip flip, tackles, contact), so its counts are the gait's alone:
// an A/B of the break, not the game's totals (those are the pop meter's, tools/shots/video.spec.ts BTB_MEASURE).
//   node tools/run-ts.mjs tools/sim/b18_breakbench.ts [--ids=p9-curl,...] [--slot=RCB] [--trace] [--ms]
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PlayerAnimator, type AnimInput } from '../../src/anim/animator.ts';
import type { AnimLibrary, ClipMeta } from '../../src/anim/library.ts';
import { FAMILIES } from '../../src/anim/library.ts';
import type { GaitClip } from '../../src/anim/blend.ts';
import type { Player } from '../../src/render/players/playerAsset.ts';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { CLIPS, CONCEPTS, PHYSICS, PASSING, PASSING2, PASSING3, PASSING5, PASSING6, PASSING7, PASSING8, PASSING9, PASSING10, PASSING17, withSwap, type Clip } from '../../src/game/clips.ts';

const YD = 0.9144;
const glb = readFileSync('public/assets/characters/anims.glb');
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, ClipMeta> };
const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) =>
  new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => res(g as never), rej),
);
const clips = new Map<string, THREE.AnimationClip>();
for (const c of gltf.animations) {
  c.tracks = c.tracks.filter((t) => {
    if (t.name.startsWith('rig.')) return false;
    if (t.name.endsWith('.scale')) return false;
    if (t.name.endsWith('.position')) return t.name === 'root.position' || t.name === 'pelvis.position';
    return true;
  });
  clips.set(c.name, c);
}
const made = new Map<string, GaitClip>();
const gc = (n: string): GaitClip => {
  const have = made.get(n);
  if (have) return have;
  const m = json.clips[n]!;
  const [a, b] = m.contacts.l[0]!;
  const g = { name: n, speed: m.speed, duration: m.duration, duty: ((b - a + m.frames) % m.frames) / m.frames };
  made.set(n, g);
  return g;
};
const fam = (f: readonly string[]) => f.filter((n) => json.clips[n] && clips.has(n)).map(gc).sort((x, y) => x.speed - y.speed);
const lib: AnimLibrary = { clips, meta: json.clips, fps: json.fps, gaits: fam(FAMILIES[0]), families: FAMILIES.map((f) => fam(f)) };
function makePlayer(): Player {
  const root = new THREE.Group();
  root.add(gltf.scene.clone(true));
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  return { root, bones, shape: { scale: 1 } } as unknown as Player;
}

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = (process.argv.find((a) => a.startsWith('--ids='))?.slice(6) ?? 'p9-slant,p9-go,cut-run,p9-screen,p9-contested,sack,p9-curl,tackle-hurdle').split(',');
const only = process.argv.find((a) => a.startsWith('--slot='))?.slice(7);
const TRACE = process.argv.includes('--trace');
const all: Clip[] = [...CLIPS, ...CONCEPTS, ...PHYSICS, ...PASSING, ...PASSING2, ...PASSING3, ...PASSING5, ...PASSING6, ...PASSING7, ...PASSING8, ...PASSING9, ...PASSING10, ...PASSING17];
const BACK7 = /LB|CB|^S$|FS|SS|NB/;
const dt = 1 / 60;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
let ms = 0;
let calls = 0;
const tot = { on: 0, off: 0, breaks: 0 };
const _vel = new THREE.Vector3();
for (const id of ids) {
  const c = all.find((x) => x.id === id);
  if (!c) continue;
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  type B = { i: number; slot: string; a: PlayerAnimator; p: Player; brk: boolean; yaw: number; gs: number; lastYaw: number; lastSp: number; steps: number; log: string[] };
  const bodies: B[] = [];
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (!BACK7.test(d.slot as string) || (only && d.slot !== only)) continue;
    for (const brk of [true, false]) {
      const p = makePlayer();
      const a = new PlayerAnimator(p, lib);
      a.setStance(/LB/.test(d.slot as string) ? 'stance_lb_ready' : 'stance_db_ready');
      bodies.push({ i, slot: d.slot as string, a, p, brk, yaw: d.face + Math.PI, gs: 0, lastYaw: d.face + Math.PI, lastSp: 0, steps: 0, log: [] });
    }
  }
  let ballT = -1;
  for (let k = 0; k < 1500 && !s.result && (ballT < 0 || s.t - ballT < 1.8); k++) {
    stepPlay(s, c.script(s));
    if (s.snapT < 0) continue;
    if (ballT < 0 && s.phase !== 'presnap' && s.phase !== 'snap' && s.phase !== 'dropback' && s.phase !== 'pocket' && s.phase !== 'air') ballT = s.t;
    for (const b of bodies) {
      const d = s.agents[b.i]!;
      const sp = Math.hypot(d.vel.x, d.vel.y);
      const along = sp > 0.05 ? d.vel.x * Math.cos(d.face) + d.vel.y * Math.sin(d.face) : 0;
      let speed = Math.max(0, along) * YD;
      let backpedal = false;
      let heading = d.face;
      if (along < -0.8) {
        if (sp * YD < 5.2) {
          backpedal = true;
          speed = sp * YD;
        } else {
          heading = Math.atan2(d.vel.y, d.vel.x);
          speed = sp * YD;
        }
      }
      const want = heading + Math.PI;
      const dy = wrap(want - b.yaw);
      b.yaw += Math.max(-12 * dt, Math.min(12 * dt, dy * (1 - Math.exp(-dt * 22))));
      b.gs += (speed - b.gs) * (1 - Math.exp(-dt / 0.06));
      const yawRate = wrap(b.yaw - b.lastYaw) / dt;
      const accel = (b.gs - b.lastSp) / dt;
      b.lastYaw = b.yaw;
      b.lastSp = b.gs;
      b.p.root.position.set(-d.pos.y * YD, 0, (50 - d.pos.x) * YD);
      b.p.root.rotation.y = b.yaw;
      const input: AnimInput = { speed: b.gs, backpedal, yawRate: Math.max(-4, Math.min(4, yawRate)), accel: Math.max(-12, Math.min(12, accel)), vel: _vel.set(-d.vel.y * YD, 0, -d.vel.x * YD), side: 'lb', brk: b.brk };
      const t0 = performance.now();
      b.a.update(dt, input);
      ms += performance.now() - t0;
      calls++;
      const ts = (s.t - s.snapT).toFixed(2);
      const bd = b.a.breakDbg;
      // --frames: every frame of a break playing (its time and rate, the gait's state, each foot's lock and the clip's foot off it).
      if (process.argv.includes('--frames') && b.brk && (b.a.transition?.name.includes('break') || bd.ended)) {
        const g = b.a.gaitDbg();
        const ft = (f: 'l' | 'r') => { const lk = b.a.footLockOf(f); const dd = b.a.lockDbg[f]; return `${f}:${lk.locked ? 'L' : '-'}${lk.weight.toFixed(1)} off ${(Math.hypot(lk.pos.x - dd.cb.x, lk.pos.z - dd.cb.z) * 100).toFixed(0)}`; };
        b.log.push(`\n      ${ts} ${b.a.transition?.name ?? ''} t ${(b.a.transition?.t ?? 0).toFixed(3)} sim ${(sp * YD).toFixed(2)} along ${(along * YD).toFixed(2)} back ${g.back.toFixed(2)} bph ${g.backPhase.toFixed(2)} ${ft('l')} ${ft('r')}`);
      }
      if (bd.fired) {
        tot.breaks++;
        const an = b.a as unknown as { brkDsp: number; brkAcc: number; back: number };
        b.log.push(`${ts} ${bd.fired} from ${bd.t0.toFixed(2)} s (sim ${(sp * YD).toFixed(1)} m/s, along ${(along * YD).toFixed(1)}, accel ${an.brkAcc.toFixed(1)}, dspeed ${an.brkDsp.toFixed(1)}, pedal ${an.back.toFixed(2)})`);
      }
      if (bd.ended) b.log.push(`${ts} end ${bd.ended} (${bd.why}) mean rate ${bd.rate.toFixed(2)}`);
      for (const f of ['l', 'r'] as const) {
        const dd = b.a.lockDbg[f];
        if (dd.stepped && !dd.why.endsWith(':lift')) {
          b.steps++;
          if (b.brk) tot.on++;
          else tot.off++;
          if (TRACE) b.log.push(`${ts} step ${f} ${dd.why} far ${(dd.far * 100).toFixed(0)} over ${(dd.over * 100).toFixed(0)} ${b.a.transition?.name ?? ''}`);
        }
      }
    }
  }
  console.log(`== ${id}`);
  for (let k = 0; k < bodies.length; k += 2) {
    const on = bodies[k]!;
    const off = bodies[k + 1]!;
    if (on.steps === 0 && off.steps === 0 && on.log.length === 0) continue;
    console.log(`  ${on.slot.padEnd(4)} steps ${off.steps} -> ${on.steps}${on.log.length ? '  ' + on.log.join('; ') : ''}${TRACE && off.log.length ? '\n        without: ' + off.log.join('; ') : ''}`);
  }
}
console.log(`steps without the breaks ${tot.off}, with ${tot.on}; breaks ${tot.breaks}`);
if (process.argv.includes('--ms')) console.log(`${(ms / calls).toFixed(4)} ms per body per frame`);
