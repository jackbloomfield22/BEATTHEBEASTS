// Determinism hash (TECH_PLAN §16): FNV-1a over the play state, quantized to
// 1e-6 yd. The same seed and inputs must give the same hash on every engine.

import type { PlayState } from './state';

function mix(h: number, v: number): number {
  // Quantize and fold both 32-bit halves in.
  const q = Math.round(v * 1e6);
  const lo = q | 0;
  const hi = Math.floor(q / 4294967296) | 0;
  h = Math.imul(h ^ lo, 16777619);
  return Math.imul(h ^ hi, 16777619);
}

export function hashPlay(s: PlayState): number {
  let h = 2166136261 | 0;
  h = mix(h, s.tick);
  for (const a of s.agents) {
    h = mix(h, a.pos.x);
    h = mix(h, a.pos.y);
    h = mix(h, a.vel.x);
    h = mix(h, a.vel.y);
    h = mix(h, a.face);
    h = mix(h, a.down ? 1 : 0);
  }
  const b = s.ball;
  h = mix(h, b.pos.x);
  h = mix(h, b.pos.y);
  h = mix(h, b.pos.z);
  h = mix(h, b.holder);
  for (const k of s.blocks) h = mix(h, k.lev);
  h = mix(h, s.events.length);
  return h >>> 0;
}
