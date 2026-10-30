import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { PlayerAnimator, type AnimInput } from '@/anim/animator';
import { FAMILIES, type AnimLibrary, type ClipMeta } from '@/anim/library';
import type { GaitClip } from '@/anim/blend';
import type { Player } from '@/render/players/playerAsset';

// Animation round 18 (docs/anim/BREAK18.md): the keyed breaks on the ball (tools/blender/lib/actions_b18.py) and the
// animator's break (animator.ts breakClip, breakPace), on the exported library.
const json = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { fps: number; clips: Record<string, ClipMeta & { gates: { pass: boolean } }> };

describe('the break clips', () => {
  it('pass their gates, start on the plant foot of the loop they leave and hand over to the jog', () => {
    const want: [string, string, 'l' | 'r', number, number][] = [
      ['db_break_w_l', 'loco_backpedal', 'l', 0, 0],
      ['db_break_w_r', 'loco_backpedal', 'r', 0.5, 0.5],
      ['lb_break_l', 'lb_shuffle_l', 'l', 0, 0],
      ['lb_break_r', 'lb_shuffle_r', 'r', 0.5, 0.5],
    ];
    for (const [n, from, plant, fromPhase, toPhase] of want) {
      const m = json.clips[n]!;
      expect(m, n).toBeDefined();
      expect(m.gates.pass, n).toBe(true);
      expect(m.from, n).toBe(from);
      expect(m.to, n).toBe('loco_jog');
      expect(m.fromPhase ?? 0, n).toBe(fromPhase);
      expect(m.toPhase ?? 0, n).toBe(toPhase);
      // The plant foot is down from the first frame.
      expect(m.contacts[plant][0]![0], n).toBe(0);
    }
  });

  it('stop over the plant out of the pedal, then drive', () => {
    const tr = json.clips.db_break_w_l!.travel!;
    const low = tr.indexOf(Math.min(...tr));
    expect(low).toBeGreaterThan(3);
    expect(low).toBeLessThan(tr.length / 2);
    for (let i = low + 1; i < tr.length; i++) expect(tr[i]!).toBeGreaterThan(tr[i - 1]!);
  });
});

describe('the animator breaks on the ball', () => {
  let lib: AnimLibrary;
  let gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] };
  beforeAll(async () => {
    const glb = readFileSync('public/assets/characters/anims.glb');
    gltf = await new Promise((res, rej) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', (g) => res(g as never), rej));
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) {
      c.tracks = c.tracks.filter((t) => !t.name.startsWith('rig.') && !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || t.name === 'root.position' || t.name === 'pelvis.position'));
      clips.set(c.name, c);
    }
    const made = new Map<string, GaitClip>();
    const gc = (n: string): GaitClip => {
      if (!made.has(n)) {
        const m = json.clips[n]!;
        const [a, b] = m.contacts.l[0]!;
        made.set(n, { name: n, speed: m.speed, duration: m.duration, duty: ((b - a + m.frames) % m.frames) / m.frames });
      }
      return made.get(n)!;
    };
    const fam = (f: readonly string[]) => f.filter((n) => json.clips[n] && clips.has(n)).map(gc).sort((x, y) => x.speed - y.speed);
    lib = { clips, meta: json.clips, fps: json.fps, gaits: fam(FAMILIES[0]), families: FAMILIES.map((f) => fam(f)) };
  });
  const player = (): Player => {
    const root = new THREE.Group();
    root.add(gltf.scene.clone(true));
    const bones = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
    });
    return { root, bones, shape: { scale: 1 } } as unknown as Player;
  };
  /** A corner facing +Z: pedalling back at `v0` m/s, braked at `brake` m/s^2 from 0.8 s, then driven forward at `drive` m/s^2 to 5 m/s. */
  function run(brk: boolean, brake: number, drive: number) {
    const p = player();
    const a = new PlayerAnimator(p, lib);
    a.setStance('stance_db_ready');
    const dt = 1 / 60;
    const v0 = 2.4;
    let z = 0;
    let v = 0;
    const out = { fired: '', t: -1, rates: [] as number[], done: -1 };
    const vel = new THREE.Vector3();
    for (let f = 0; f < 150; f++) {
      const t = f * dt;
      if (t < 0.3) v = -v0 * (t / 0.3);
      else if (t < 0.8) v = -v0;
      else if (v < 0) v = Math.min(0, v + brake * dt) || 1e-3;
      else v = Math.min(5, v + drive * dt);
      z += v * dt;
      p.root.position.set(0, 0, z);
      const back = v < -0.8 * 0.9144;
      const input: AnimInput = { speed: back ? -v : Math.max(0, v), backpedal: back, vel: vel.set(0, 0, v), side: 'lb', brk };
      a.update(dt, input);
      if (a.breakDbg.fired && !out.fired) {
        out.fired = a.breakDbg.fired;
        out.t = t;
      }
      const tr = a.transition;
      if (tr && tr.name === out.fired && !tr.done) out.rates.push(tr.t);
      if (out.fired && out.done < 0 && (!tr || tr.done)) out.done = t;
    }
    return out;
  }

  it('plays the W-step when the sim brakes his pedal and drives him forward, and not without the flag', () => {
    const on = run(true, 10, 8);
    expect(on.fired).toMatch(/^db_break_w_[lr]$/);
    // Within a few frames of the brake.
    expect(on.t).toBeGreaterThan(0.8);
    expect(on.t).toBeLessThan(0.95);
    expect(run(false, 10, 8).fired).toBe('');
  });

  it('plays a quicker man\'s break quicker (its pace is the sim\'s)', () => {
    const quick = run(true, 13, 12);
    const slow = run(true, 8, 6);
    expect(quick.fired).not.toBe('');
    expect(slow.fired).not.toBe('');
    expect(quick.done).toBeGreaterThan(0);
    expect(slow.done).toBeGreaterThan(0);
    expect(quick.done - quick.t).toBeLessThan(slow.done - slow.t);
  });
});
