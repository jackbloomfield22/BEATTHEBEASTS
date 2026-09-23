import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GaitClip } from './blend';

// The clip library: public/assets/characters/anims.glb (one animation per
// clip, keyed on bone names, so it plays on any Player clone) plus
// anims.json (frames, speed, foot contacts, gate results), both written by
// tools/blender/build_anims.py.

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;

export interface ClipMeta {
  kind: 'stance' | 'locomotion';
  frames: number;
  duration: number;
  loop: boolean;
  speed: number;
  /** Travel direction in the character's frame (x left, z forward). */
  dir: [number, number];
  /** Planted frame ranges per foot, [start, end) (end may wrap past the loop). */
  contacts: { l: [number, number][]; r: [number, number][] };
}

export interface AnimLibrary {
  clips: Map<string, THREE.AnimationClip>;
  meta: Record<string, ClipMeta>;
  fps: number;
  /** Forward locomotion cycles, slow to fast (walk, jog, run, sprint). */
  gaits: GaitClip[];
}

let pending: Promise<AnimLibrary> | null = null;

export function loadAnimLibrary(): Promise<AnimLibrary> {
  pending ??= Promise.all([
    new GLTFLoader().loadAsync(`${BASE}anims.glb`),
    fetch(`${BASE}anims.json`).then((r) => r.json() as Promise<{ fps: number; clips: Record<string, ClipMeta> }>),
  ]).then(([gltf, json]) => {
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) {
      // The armature node itself isn't part of a player clone; keep bone tracks only.
      c.tracks = c.tracks.filter((t) => !t.name.startsWith('rig.'));
      clips.set(c.name, c);
    }
    const gaits = ['loco_walk', 'loco_jog', 'loco_run', 'loco_sprint']
      .filter((n) => json.clips[n] && clips.has(n))
      .map((n) => {
        const m = json.clips[n]!;
        const [a, b] = m.contacts.l[0]!;
        return { name: n, speed: m.speed, duration: m.duration, duty: ((b - a + m.frames) % m.frames) / m.frames };
      });
    return { clips, meta: json.clips, fps: json.fps, gaits };
  });
  return pending;
}

/** Whether a foot is planted at a phase (0..1) of a clip. */
export function planted(meta: ClipMeta, foot: 'l' | 'r', phase: number): boolean {
  const f = phase * meta.frames;
  for (const [a, b] of meta.contacts[foot]) {
    if (b > a ? f >= a && f < b : f >= a || f < b % meta.frames) return true;
  }
  return false;
}
