// Render snapshots (TECH_PLAN §4.3): what the render reads from the sim each
// tick. The runner keeps the previous and the current one and the render
// interpolates between them, so motion is smooth at any refresh rate while
// the sim steps a fixed 60 Hz.

import type { Anim, BallMode, Move, Phase, PlayState } from '@/sim';

export interface AgentSnap {
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  anim: Anim;
  move: Move | null;
  down: boolean;
  stamina: number;
}

export interface Snapshot {
  t: number;
  tick: number;
  phase: Phase;
  agents: AgentSnap[];
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number; mode: BallMode; holder: number; spin: number };
  carrier: number;
}

export function emptySnapshot(n: number): Snapshot {
  return {
    t: 0,
    tick: 0,
    phase: 'presnap',
    agents: Array.from({ length: n }, () => ({ x: 0, y: 0, vx: 0, vy: 0, face: 0, anim: 'stance' as Anim, move: null, down: false, stamina: 1 })),
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mode: 'held', holder: -1, spin: 0 },
    carrier: -1,
  };
}

/** Copy the state into a snapshot (reusing its objects: no garbage per tick). */
export function capture(s: PlayState, out: Snapshot): Snapshot {
  out.t = s.t;
  out.tick = s.tick;
  out.phase = s.phase;
  out.carrier = s.carrier;
  for (let i = 0; i < s.agents.length; i++) {
    const a = s.agents[i]!;
    const o = out.agents[i]!;
    o.x = a.pos.x;
    o.y = a.pos.y;
    o.vx = a.vel.x;
    o.vy = a.vel.y;
    o.face = a.face;
    o.anim = a.anim;
    o.move = a.move;
    o.down = a.down;
    o.stamina = a.stamina;
  }
  const b = s.ball;
  const ob = out.ball;
  ob.x = b.pos.x;
  ob.y = b.pos.y;
  ob.z = b.pos.z;
  ob.vx = b.vel.x;
  ob.vy = b.vel.y;
  ob.vz = b.vel.z;
  ob.mode = b.mode;
  ob.holder = b.holder;
  ob.spin = b.spin;
  return out;
}

export function copySnapshot(from: Snapshot, to: Snapshot): void {
  to.t = from.t;
  to.tick = from.tick;
  to.phase = from.phase;
  to.carrier = from.carrier;
  for (let i = 0; i < from.agents.length; i++) Object.assign(to.agents[i]!, from.agents[i]!);
  Object.assign(to.ball, from.ball);
}

/** Shortest-path angle interpolation. */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
