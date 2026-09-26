import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GaitClip } from './blend';

// The clip library: public/assets/characters/anims.glb (one animation per
// clip, keyed on bone names, so it plays on any Player clone) plus
// anims.json (frames, speed, foot contacts, gate results), both written by
// tools/blender/build_anims.py.

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;

export interface ClipMeta {
  /** 'signature': the locker-room hologram clips (M6), in place, looping; play them raw. */
  kind: 'stance' | 'locomotion' | 'transition' | 'overlay' | 'signature';
  frames: number;
  duration: number;
  loop: boolean;
  speed: number;
  /** Travel direction in the character's frame (x left, z forward). */
  dir: [number, number];
  /** Planted frame ranges per foot, [start, end) (end may wrap past the loop). */
  contacts: { l: [number, number][]; r: [number, number][] };
  /** Transitions: metres travelled along `dir` by each frame (the clip plays in place). */
  travel?: number[];
  /** Transitions: the clips it leaves and hands over to. */
  from?: string;
  to?: string;
  /** Transitions into a gait: the gait phase it hands over at (0 = left touch-down). */
  toPhase?: number;
  /** Sideways travel by frame (m, +X left), for moves that cut. */
  side?: number[];
  /** Transitions that turn the body (a pull, a hip flip): degrees (+ left) it faces away from its start by the last frame; turn the heading by it at the hand-over. */
  turn?: number;
  /** Transitions out of a gait: the phase of it they start at (0 = left touch-down). */
  fromPhase?: number;
  /** Frames where the sim's moments land: the ball leaves the hand, a catch is secured, a tackle's contact. */
  events?: Record<string, number>;
  /** Overlays: the bones they drive. */
  mask?: string[];
}

export interface AnimLibrary {
  clips: Map<string, THREE.AnimationClip>;
  meta: Record<string, ClipMeta>;
  fps: number;
  /** Forward locomotion cycles, slow to fast (walk, jog, run, sprint). */
  gaits: GaitClip[];
  /**
   * The gait families, each slow to fast (M6.5 #11): [receiver, carrier in
   * space, carrier in traffic, carrier's drive]. A family whose clips are
   * missing (an older library) is the receiver's.
   */
  families: GaitClip[][];
}

/** The families' clips by name (the walk is shared: a carrier slowed to a walk walks). */
export const FAMILIES = [
  ['loco_walk', 'loco_jog', 'loco_run', 'loco_sprint'],
  ['loco_walk', 'carry_jog', 'carry_run', 'carry_sprint'],
  ['loco_walk', 'carry_traffic_jog', 'carry_traffic_run'],
  ['loco_walk', 'carry_drive_jog', 'carry_drive_run', 'carry_drive_sprint'],
] as const;

function gaitClip(n: string, m: ClipMeta): GaitClip {
  const [a, b] = m.contacts.l[0]!;
  return { name: n, speed: m.speed, duration: m.duration, duty: ((b - a + m.frames) % m.frames) / m.frames };
}

let pending: Promise<AnimLibrary> | null = null;

export function loadAnimLibrary(): Promise<AnimLibrary> {
  pending ??= Promise.all([
    new GLTFLoader().loadAsync(`${BASE}anims.glb`),
    fetch(`${BASE}anims.json`).then((r) => r.json() as Promise<{ fps: number; clips: Record<string, ClipMeta> }>),
  ]).then(([gltf, json]) => {
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) {
      // The armature node itself isn't part of a player clone; keep bone
      // tracks only. Clips move bones by rotation; only the root and the
      // pelvis translate. Dropping the other (constant) position and every
      // scale track lets each player keep its own bone proportions
      // (variety.ts: shoulder width, arm length) through playback.
      c.tracks = c.tracks.filter((t) => {
        if (t.name.startsWith('rig.')) return false;
        if (t.name.endsWith('.scale')) return false;
        if (t.name.endsWith('.position')) return t.name === 'root.position' || t.name === 'pelvis.position';
        return true;
      });
      clips.set(c.name, c);
    }
    const made = new Map<string, GaitClip>();
    const family = (names: readonly string[]) =>
      names
        .filter((n) => json.clips[n] && clips.has(n))
        .map((n) => made.get(n) ?? made.set(n, gaitClip(n, json.clips[n]!)).get(n)!)
        .sort((x, y) => x.speed - y.speed);
    const gaits = family(FAMILIES[0]);
    const families = FAMILIES.map((f, i) => {
      const g = family(f);
      return i > 0 && g.length < f.length ? gaits : g;
    });
    return { clips, meta: json.clips, fps: json.fps, gaits, families };
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

/** Distance a transition has travelled at time t (s), linear between frames. */
export function travelAt(meta: ClipMeta, fps: number, t: number): number {
  const tr = meta.travel;
  if (!tr || tr.length === 0) return 0;
  const f = Math.min(Math.max(t * fps, 0), tr.length - 1);
  const i = Math.min(Math.floor(f), tr.length - 2);
  if (i < 0) return tr[0]!;
  return tr[i]! + (tr[i + 1]! - tr[i]!) * (f - i);
}
