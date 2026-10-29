// Animation round 16 (docs/anim/FEET16.md): the animator alone, headless in Node, on the exported clip library
// (public/assets/characters/anims.glb, anims.json): scripted bodies moving the ways the round's plays move them
// (a shuffle, a scrape, a lineman's set, a run with a cut, a pedal), for the side layer's and the step's checks and
// the animator's cost per body without the browser.
//   node tools/run-ts.mjs tools/sim/a16_animbench.ts [frames] [--trace]
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PlayerAnimator, type AnimInput } from '../../src/anim/animator.ts';
import type { AnimLibrary, ClipMeta } from '../../src/anim/library.ts';
import { FAMILIES } from '../../src/anim/library.ts';
import type { GaitClip } from '../../src/anim/blend.ts';
import type { Player } from '../../src/render/players/playerAsset.ts';

const glb = readFileSync('public/assets/characters/anims.glb');
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, ClipMeta> };
const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) =>
  new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => res(g as never), rej),
);
// As library.ts loads it.
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
// (One object per clip, as library.ts makes them: the animator finds a family's clips by identity.)
const made = new Map<string, GaitClip>();
const gc = (n: string): GaitClip => made.get(n) ?? made.set(n, gc0(n)).get(n)!;
const gc0 = (n: string): GaitClip => {
  const m = json.clips[n]!;
  const [a, b] = m.contacts.l[0]!;
  return { name: n, speed: m.speed, duration: m.duration, duty: ((b - a + m.frames) % m.frames) / m.frames };
};
const fam = (f: readonly string[]) => f.filter((n) => json.clips[n] && clips.has(n)).map(gc).sort((x, y) => x.speed - y.speed);
const NOWALK = process.argv.includes('--nowalk');
const lib: AnimLibrary = { clips, meta: json.clips, fps: json.fps, gaits: fam(FAMILIES[0]), families: FAMILIES.map((f) => fam(NOWALK ? f.filter((n) => n !== 'loco_walk') : f)) };

function makePlayer(): Player {
  const root = new THREE.Group();
  const rig = gltf.scene.clone(true);
  root.add(rig);
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  return { root, bones, shape: { scale: 1 } } as unknown as Player;
}

/** A scripted body: its velocity (world m/s) and facing (rad) by time, and any one-shot calls. */
interface Script {
  name: string;
  vel(t: number): [number, number];
  face(t: number): number;
  style?: 'ol';
  start?: string;
  /** One-shots: [time (s), clip]. */
  play?: [number, string][];
  /** The quarterback: his feet held under him in his one-shots, his hips square (AnimInput.holdFeet, warp). */
  qb?: boolean;
}
const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
const SCRIPTS: Script[] = [
  // A linebacker scraping to his left, eyes on the QB (facing +Z, moving +X), 0 to 3 m/s.
  { name: 'lb-scrape', vel: (t) => [3 * smooth(0.2, 0.6, t), 0], face: () => 0, start: 'stance_lb_ready' },
  // A corner shuffling at 2 m/s on a slant back (135 deg).
  { name: 'db-shuffle', vel: (t) => [-1.4 * smooth(0.2, 0.5, t), -1.4 * smooth(0.2, 0.5, t)], face: () => 0, start: 'stance_db_ready' },
  // A tackle's vertical set, 3.5 m/s straight back then out.
  { name: 'ol-set', vel: (t) => [0.8 * smooth(0.6, 1.2, t), -3.5 * smooth(0.1, 0.4, t) * (1 - 0.5 * smooth(1.2, 1.8, t))], face: () => 0, style: 'ol', start: 'stance_ol_pass' },
  // A runner, 0 to 6 m/s, cut 45 deg at 1.5 s.
  { name: 'run-cut', vel: (t) => { const s = 6 * smooth(0, 0.8, t); const a = 0.8 * smooth(1.4, 1.6, t); return [s * Math.sin(a), s * Math.cos(a)]; }, face: (t) => 0.8 * smooth(1.4, 1.65, t) },
  // The slant's weak-side linebacker: the read step on the snap, then off at a slant to his facing (docs/anim/FEET16.md).
  { name: 'lb-read', vel: (t) => [-1.5 * smooth(0.6, 1.2, t), 2.4 * smooth(0.6, 1.4, t)], face: (t) => -0.36 + 0.1 * smooth(0.6, 1.2, t), start: 'stance_lb_ready', play: [[0.3, 'lb_read_step']] },
  // The quarterback: a three-step drop from the gun, the throw, sliding left in the pocket in between.
  { name: 'qb', vel: (t) => [t > 1.2 && t < 1.8 ? 1.2 : 0, t < 0.9 ? -2.5 * smooth(0, 0.2, t) * (1 - smooth(0.7, 0.9, t)) : 0], face: () => 0, start: 'stance_qb_gun', qb: true, play: [[0.05, 'qb_drop_gun3'], [2.2, 'qb_throw_quick']] },
  // Steady gaits straight ahead, for the stride matching (a step here is the gait's own mismatch).
  { name: 'jog-2.0', vel: (t) => [0, 2.0 * smooth(0, 0.5, t)], face: () => 0 },
  { name: 'jog-2.8', vel: (t) => [0, 2.8 * smooth(0, 0.5, t)], face: () => 0 },
  { name: 'run-4.5', vel: (t) => [0, 4.5 * smooth(0, 0.6, t)], face: () => 0 },
  { name: 'run-7', vel: (t) => [0, 7 * smooth(0, 0.8, t)], face: () => 0 },
    // A hard curve at speed: 5 m/s, turning 2.5 rad/s from 0.8 s (the bank at its limit; the outside foot's reach).
  { name: 'curve', vel: (t) => { const a = t < 0.8 ? 0 : 2.5 * (t - 0.8); const v = 5 * smooth(0, 0.6, t); return [v * Math.sin(a), v * Math.cos(a)]; }, face: (t) => (t < 0.8 ? 0 : 2.5 * (t - 0.8)) },
    // A defensive back's pedal at 3 m/s.
  { name: 'db-pedal', vel: (t) => [0, -3 * smooth(0.1, 0.4, t)], face: () => 0 },
];

const FRAMES = Number(process.argv[2] ?? 150);
const TRACE = process.argv.includes('--trace');
// --dump <file>: every bone's world matrix every frame (a change to the animator's cost must leave these as they were).
const DUMP = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1]! : null;
const dump: number[] = [];
// --count: the clips with weight each frame (each one is sampled whole by the mixer), and those under 1e-3.
const COUNT = process.argv.includes('--count');
let weighted = 0;
let tinyW = 0;
const dt = 1 / 60;
const bodies = SCRIPTS.map((sc) => {
  const p = makePlayer();
  const a = new PlayerAnimator(p, lib);
  if (sc.start) a.setStance(sc.start);
  return { sc, p, a, x: 0, z: 0 };
});
const _vel = new THREE.Vector3();
// Everyone watches the quarterback's spot (the look-at), as the back seven do.
const _look = new THREE.Vector3(0, 1.6, -6);
const last = new Map<string, { face: number; speed: number }>();
const _toe = new THREE.Vector3();
let ms = 0;
const perScript = new Map<string, number>();
let steps = 0;
for (let f = 0; f < FRAMES; f++) {
  const t = f * dt;
  for (const b of bodies) {
    const [vx, vz] = b.sc.vel(t);
    b.x += vx * dt;
    b.z += vz * dt;
    const face = b.sc.face(t);
    for (const [at, clip] of b.sc.play ?? []) if (Math.abs(t - at) < dt / 2) b.a.play(clip, { now: true });
    b.p.root.position.set(b.x, 0, b.z);
    b.p.root.rotation.y = face;
    const along = vx * Math.sin(face) + vz * Math.cos(face);
    // As choreo.ts drive(): a pedal going back faster than 0.8 yd/s, under 5.2 m/s; never for a lineman.
    const sp = Math.hypot(vx, vz);
    const back = along < -0.8 * 0.9144 && sp < 5.2 && b.sc.style !== 'ol';
    const speed = back ? sp : Math.max(0, along);
    // As GameScene: the turn rate and the acceleration, for the lean.
    const lf = last.get(b.sc.name) ?? { face, speed };
    last.set(b.sc.name, { face, speed });
    const input: AnimInput = { speed, backpedal: back, vel: _vel.set(vx, 0, vz), side: b.sc.style ?? 'lb', yawRate: (face - lf.face) / dt, accel: Math.max(-12, Math.min(12, (speed - lf.speed) / dt)), lookAt: b.sc.qb ? null : _look, holdFeet: !!b.sc.qb, warp: !b.sc.qb };
    const t0 = performance.now();
    b.a.update(dt, input);
    ms += performance.now() - t0;
    if (process.argv.includes('--weights') && f % 30 === 0 && b.sc.name === 'jog-2.0') {
      const acts = (b.a as unknown as { actions: Map<string, THREE.AnimationAction> }).actions;
      const an = b.a as unknown as { locoW: number[]; locos: { name: string }[]; famSplit: { walk: { name: string }[]; run: { name: string }[] }[]; runW: number; famW: number[] };
      console.log('lw', an.locoW.map((w, j) => `${an.locos[j]!.name}:${w.toFixed(2)}`).join(' '), 'runW', an.runW, 'fam', an.famW.join(','), 'split0', an.famSplit[0]!.walk.map((g) => g.name), an.famSplit[0]!.run.map((g) => g.name));
      console.log(f, [...acts].filter(([, a]) => a.getEffectiveWeight() > 0).map(([n, a]) => `${n}:${a.getEffectiveWeight().toFixed(2)}@${a.time.toFixed(2)}`).join(' '));
    }
    if (COUNT) {
      const acts = (b.a as unknown as { actions: Map<string, THREE.AnimationAction> }).actions;
      let n = 0;
      let tiny = 0;
      for (const a of acts.values()) {
        const w = a.getEffectiveWeight();
        if (w > 0) n++;
        if (w > 0 && w < 1e-3) tiny++;
      }
      weighted += n;
      tinyW += tiny;
    }
    if (DUMP) {
      b.p.root.updateMatrixWorld(true);
      for (const bone of b.p.bones.values()) dump.push(...bone.matrixWorld.elements);
    }
    for (const s of ['l', 'r'] as const) {
      const d = b.a.lockDbg[s];
      if (d.stepped && !d.why.endsWith(':lift')) {
        steps++;
        perScript.set(b.sc.name, (perScript.get(b.sc.name) ?? 0) + 1);
        if (process.argv.includes('--steps')) console.log(`step ${b.sc.name} f${f} ${s} ${d.why} far ${((d.far ?? 0) * 100).toFixed(1)} over ${((d.over ?? 0) * 100).toFixed(1)} age ${(d.age ?? 0).toFixed(2)}`);
      }
    }
    if (TRACE) {
      const g = b.a.gaitDbg();
      const row = [b.sc.name, f, g.speed.toFixed(2), g.loco.toFixed(2), g.side.toFixed(2), g.sideSpeed.toFixed(2), g.sidePhase.toFixed(2)];
      for (const s of ['l', 'r'] as const) {
        const lk = b.a.footLockOf(s);
        b.p.bones.get(`toe_${s}`)!.getWorldPosition(_toe);
        const d = b.a.lockDbg[s];
        row.push(`${s}:${lk.locked ? lk.source : d.stepped ? 'STEP' : '-'} w${lk.weight.toFixed(2)} toe(${_toe.x.toFixed(3)},${_toe.y.toFixed(3)},${_toe.z.toFixed(3)}) cb(${d.cb.x.toFixed(3)},${d.cb.z.toFixed(3)})${d.stepped ? ' ' + d.why : ''}`);
      }
      console.log(row.join(' '));
    }
  }
}
if (DUMP) writeFileSync(DUMP, Buffer.from(new Float64Array(dump).buffer));
if (COUNT) console.log(`clips with weight per body per frame: ${(weighted / (bodies.length * FRAMES)).toFixed(2)}, of them under 1e-3: ${(tinyW / (bodies.length * FRAMES)).toFixed(2)}`);
console.log([...perScript].map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`${bodies.length} bodies x ${FRAMES} frames: ${(ms / (bodies.length * FRAMES)).toFixed(4)} ms per body per frame; ${steps} steps`);
