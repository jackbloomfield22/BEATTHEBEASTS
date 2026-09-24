// Blocking as engagements (TECH_PLAN §10, GDD §9.4). A blocker and a
// defender who meet become a pair whose leverage drifts every tick with the
// matchup: the rusher's Power/Finesse Moves and Block Shedding against Pass
// Block Power/Finesse and Anchor (or the run-blocking pair). Leverage past +1
// is a shed; the pair's contact point moves with the winner, which is what
// collapses the pocket visibly and differently by matchup.

import { atan2 } from '@/engine/math/detmath';
import { gauss } from './rand';
import type { Block, PlayState } from './state';
import { TICK, type Agent } from './types';
import { dist, norm, sub, type V2 } from './vec';

/** Start of an engagement: the blocker is set, a small edge. */
const LEV0 = -0.35;
/**
 * Leverage drift per second per unit of skill edge, and the noise. Tuned with
 * the harness so an even matchup sheds in ~3 s on average and a clear
 * mismatch (15+ points) in ~1.8 s (NFL "pass-rush win rate" within 2.5 s runs
 * ~10% (tackles) to ~25% (elite rushers); ESPN/NGS pass-rush win rate).
 */
const DRIFT = 0.55;
const BASE = 0.55;
const NOISE = 0.55;

const n = (a: Agent, k: string) => a.fx.r(k) / 99;

/** Choose a rush move from the defender's tools (and one roll). */
export function pickMove(s: PlayState, d: Agent): Block['move'] {
  const power = n(d, 'powerMoves') * 0.6 + n(d, 'strength') * 0.4;
  const finesse = n(d, 'finesseMoves') * 0.6 + n(d, 'speed') * 0.4;
  const speedRusher = d.p.traits?.includes('speed-rusher') ?? false;
  const r = s.rng.block();
  if (speedRusher && r < 0.6) return 'speed';
  if (finesse > power + 0.05) return r < 0.6 ? 'speed' : r < 0.85 ? 'swim' : 'spin';
  if (power > finesse + 0.05) return r < 0.7 ? 'bull' : 'swim';
  return r < 0.4 ? 'bull' : r < 0.75 ? 'speed' : r < 0.9 ? 'swim' : 'spin';
}

/** Rusher's edge over the blocker for this move (−1..1 roughly). */
function edge(b: Agent, d: Agent, blk: Block): number {
  const shed = n(d, 'blockShed');
  if (blk.kind === 'run') {
    const lineman = b.p.pos === 'OL';
    // Linemen drive with their run-block ratings; receivers and tight ends stalk with Run Block.
    const push = lineman
      ? n(b, 'rbPower') * 0.5 + n(b, 'rbFinesse') * 0.2 + n(b, 'strength') * 0.3
      : n(b, 'runBlock') * 0.55 + n(b, 'impactBlock') * 0.15 + n(b, 'strength') * 0.3 - 0.12;
    const hold = shed * 0.5 + n(d, 'strength') * 0.3 + n(d, 'powerMoves') * 0.2;
    const mass = (d.fx.mass - b.fx.mass) / 250;
    return hold - push + mass;
  }
  let rush: number;
  let pro: number;
  switch (blk.move) {
    case 'bull':
      rush = n(d, 'powerMoves') * 0.45 + n(d, 'strength') * 0.3 + shed * 0.25;
      pro = n(b, 'pbPower') * 0.45 + n(b, 'anchor') * 0.4 + n(b, 'strength') * 0.15;
      rush += (d.fx.mass - b.fx.mass) / 300;
      break;
    case 'speed':
      rush = n(d, 'finesseMoves') * 0.35 + n(d, 'speed') * 0.35 + n(d, 'acceleration') * 0.3;
      pro = n(b, 'pbFinesse') * 0.5 + n(b, 'agility') * 0.25 + n(b, 'speed') * 0.25;
      break;
    default:
      rush = n(d, 'finesseMoves') * 0.55 + shed * 0.25 + n(d, 'agility') * 0.2;
      pro = n(b, 'pbFinesse') * 0.55 + n(b, 'pbPower') * 0.2 + n(b, 'agility') * 0.25;
  }
  return rush - pro;
}

export function engage(s: PlayState, b: Agent, d: Agent, kind: Block['kind']): Block {
  // A lineman's block starts with him set; a stalk block in space starts even.
  const lev0 = kind === 'run' && b.p.pos !== 'OL' ? 0 : LEV0;
  const blk: Block = { b: b.i, d: d.i, lev: lev0, kind, move: kind === 'run' ? 'drive' : pickMove(s, d), t: 0 };
  s.blocks.push(blk);
  b.anim = 'block';
  d.anim = 'engaged';
  s.events.push({ t: s.t, type: 'engage', who: [b.i, d.i], data: { move: blk.move } });
  return blk;
}

export const blockOf = (s: PlayState, i: number): Block | undefined => s.blocks.find((k) => k.b === i || k.d === i);

/**
 * Advance every engagement one tick: leverage, the pair's motion, sheds.
 * `goal` is where the defenders are trying to get (the QB, or the ball carrier).
 */
export function stepBlocks(s: PlayState, goal: V2): void {
  for (let k = s.blocks.length - 1; k >= 0; k--) {
    const blk = s.blocks[k]!;
    const b = s.agents[blk.b]!;
    const d = s.agents[blk.d]!;
    blk.t += TICK;
    const e = edge(b, d, blk);
    // Drift toward whoever has the edge, plus a base drift for the rusher
    // (blocks don't hold forever), plus matchup noise.
    // Run blocks resolve faster than pass sets (a drive block is a shorter fight).
    blk.lev += (DRIFT * e * 2 + BASE * (blk.kind === 'run' ? 2.0 : 1)) * TICK + NOISE * Math.sqrt(TICK) * gauss(s.rng.block) * 0.35;
    if (blk.lev < -1) blk.lev = -1;
    if (blk.lev >= 1 || b.down || d.down) {
      // Shed: the defender is free, the blocker lunges and loses a beat.
      s.blocks.splice(k, 1);
      b.busy = Math.max(b.busy, 18);
      b.anim = 'run';
      d.anim = 'rush';
      d.mem.shedAt = s.t;
      s.events.push({ t: s.t, type: 'shed', who: [d.i, b.i], data: { move: blk.move, after: Math.round(blk.t * 100) / 100 } });
      continue;
    }
    // Pair motion. The defender drives toward his goal; the blocker holds
    // position between them. Who is winning sets how fast the pair moves.
    const toGoal = norm(sub(goal, d.pos));
    const win = (blk.lev + 1) / 2; // 0 blocker dominant … 1 defender about to shed
    let vx: number;
    let vy: number;
    if (blk.kind === 'run') {
      // The blocker drives the defender back and toward the play side.
      const drive = norm({ x: 1, y: (b.mem.driveY as number | undefined) ?? 0 });
      const push = (1 - win) * 2.2 - win * 1.2;
      vx = drive.x * push;
      vy = drive.y * push;
    } else if (blk.move === 'bull') {
      // Bull rush: straight back into the pocket.
      const push = Math.max(0, win - 0.25) * 2.8;
      vx = toGoal.x * push;
      vy = toGoal.y * push;
    } else {
      // Speed and finesse: around the edge, then down toward the QB.
      const side = Math.sign(d.pos.y - b.pos.y) || 1;
      const around = win * 2.2;
      vx = toGoal.x * win * 1.4 - 0.3;
      vy = side * around * 0.6 + toGoal.y * win;
    }
    // Move both, keeping them in contact on the line from blocker to defender.
    for (const a of [b, d]) {
      a.vel.x += (vx - a.vel.x) * 0.2;
      a.vel.y += (vy - a.vel.y) * 0.2;
      a.pos.x += a.vel.x * TICK;
      a.pos.y += a.vel.y * TICK;
    }
    const gap = b.fx.radius + d.fx.radius;
    const dd = dist(b.pos, d.pos);
    if (dd > 1e-6 && Math.abs(dd - gap) > 0.02) {
      const ux = (d.pos.x - b.pos.x) / dd;
      const uy = (d.pos.y - b.pos.y) / dd;
      const fix = (dd - gap) / 2;
      b.pos.x += ux * fix;
      b.pos.y += uy * fix;
      d.pos.x -= ux * fix;
      d.pos.y -= uy * fix;
    }
    b.face = atan2(d.pos.y - b.pos.y, d.pos.x - b.pos.x);
    d.face = atan2(b.pos.y - d.pos.y, b.pos.x - d.pos.x);
  }
}
