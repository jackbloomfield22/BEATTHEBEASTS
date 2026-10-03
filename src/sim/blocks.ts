// Blocking as engagements (TECH_PLAN §10, GDD §9.4). A blocker and a
// defender who meet become a pair whose leverage drifts every tick with the
// matchup: the rusher's Power/Finesse Moves and Block Shedding against Pass
// Block Power/Finesse and Anchor (or the run-blocking pair). Leverage past +1
// is a shed; the pair's contact point moves with the winner, which is what
// collapses the pocket visibly and differently by matchup.

import { atan2, exp } from '@/engine/math/detmath';
import { gauss } from './rand';
import type { Block, PlayState } from './state';
import { TICK, type Agent } from './types';
import { dist, norm, sub, type V2 } from './vec';
import { has } from './traits';
import { QB_RUNS } from './plays';

/** Start of an engagement: the blocker is set, a small edge. */
const LEV0 = -0.35;
/**
 * Leverage drift per second per unit of skill edge, and the noise. Tuned with
 * the harness so an even matchup sheds in ~3 s on average and a clear
 * mismatch (15+ points) in ~1.8 s (NFL "pass-rush win rate" within 2.5 s runs
 * ~10% (tackles) to ~25% (elite rushers); ESPN/NGS pass-rush win rate).
 */
const DRIFT = 0.55;
/**
 * The defender's base drift in a run block (per second, doubled in the
 * update). M5.5 (feedback item 6) lowered it from 0.55: an even run block
 * now sheds at ~2 s, a clear mismatch at ~1.3 s. On an NFL inside run the
 * back reaches the line ~1.3–1.5 s after the snap (handoff ~0.7–0.9 s, NGS
 * time to line of scrimmage), so blocks have to sustain about that long for
 * the scheme to open a hole; at 0.55 every block was shed by ~1.2 s. Tuned
 * with tools/sim/outcomes.ts so yards before contact run ~2 yd (M6: 0.34 →
 * 0.3 with the wider rep-to-rep spread below).
 */
const BASE = 0.3;
/** A rusher picked up again soon after beating his man starts the new rep this far ahead (leverage). */
const REPICK_LEV = 0.2;
/**
 * A run block's rep-to-rep spread (σ of skill edge): some reps the lineman
 * wins cleanly, some he's beaten at once (penetration: the stuffs). M5.5 had
 * 0.3; M6 widened it to 0.7 for penetration, which made a lucky rep shed
 * inside a second (M6.5 #8, tools/sim/runblocks.ts: median shed 1.0 s after
 * the engage, 61% of sheds before the back reached the line). 0.4 keeps the
 * stuffs and ends the boom-or-bust.
 */
const RUN_BIAS = 0.4;
/**
 * A defender comes off his block to the ball only when the back is within
 * this (yd) and on the far side of him from the blocker: a step and an arm.
 * At 4 yd (M6) every back running the gap beside an engaged tackle pulled him
 * off the block as he arrived (M6.5 #8), so the run died at the line.
 */
const COME_OFF = 2.5;
/** A pass set's rep-to-rep spread (σ of skill edge), M6: without it every rep of a matchup took the same time, and the rush never won early. */
const PASS_BIAS = 0.4;
/**
 * The rusher's base drift against a pass set. M5.5 lowered it from 0.55 to
 * 0.3 for a ~4.5 s no-throw pocket (the owner's play test); M6 puts it at
 * 0.45 with the counters, the rep spread and the help blocker (ai.ts
 * REPICK): the rush now wins early on some reps (first pressure ~2.7 s with
 * nobody throwing, ~3.1 s in the AI harness) while a QB who holds it still
 * has ~3.8 s. The skill edge (DRIFT) is unchanged, so the ratings spread
 * holds: `tools/sim/sacktime.ts` measures the best and worst pass-blocking
 * units in the snapshot.
 */
const PASS_BASE = 0.45;
const NOISE = 0.55;
/** A counter that works puts the rusher this far ahead (leverage, plus up to 0.3 more). */
const JUMP = 0.5;

const n = (a: Agent, k: string) => a.fx.r(k) / 99;

/** Pass-rush moves (GDD §10.4): the rusher's opening move and his counters. */
export type RushMove = 'bull' | 'speed' | 'swim' | 'spin' | 'club' | 'rip' | 'longArm';


/**
 * A rusher's move set, from his traits and his tools: what he opens with
 * and what he goes to when the first move stalls. A speed rusher (or an
 * edge bender) opens with speed and rips or spins under; a power rusher
 * bull-rushes and long-arms, then clubs or swims off it; an interior
 * wrecker swims and clubs; everyone else by his Power against Finesse
 * Moves. A sack artist has the deeper bag (more counters that work).
 */
export function rushPlan(d: Agent): { open: RushMove[]; counters: RushMove[] } {
  const power = n(d, 'powerMoves') * 0.6 + n(d, 'strength') * 0.4;
  const finesse = n(d, 'finesseMoves') * 0.6 + n(d, 'speed') * 0.4;
  if (has(d, 'speed-rusher') || has(d, 'edge-bender')) return { open: ['speed', 'speed', 'rip'], counters: ['spin', 'rip', 'club', 'swim'] };
  if (has(d, 'power-rusher') || has(d, 'wrecking-ball')) return { open: ['bull', 'longArm', 'bull'], counters: ['club', 'swim', 'longArm', 'rip'] };
  if (has(d, 'interior-wrecker')) return { open: ['swim', 'club', 'bull'], counters: ['swim', 'club', 'rip', 'spin'] };
  if (finesse > power + 0.05) return { open: ['speed', 'speed', 'swim', 'spin'], counters: ['spin', 'rip', 'swim'] };
  if (power > finesse + 0.05) return { open: ['bull', 'bull', 'longArm', 'swim'], counters: ['club', 'swim', 'longArm'] };
  return { open: ['bull', 'speed', 'swim', 'longArm'], counters: ['club', 'spin', 'rip', 'swim'] };
}

/** Choose the opening rush move from the defender's set (one roll). */
export function pickMove(s: PlayState, d: Agent): RushMove {
  const set = rushPlan(d).open;
  return set[Math.floor(s.rng.block() * set.length)]!;
}

/** The power moves collapse the pocket (the pair drives back into it); the rest win around the edge or through a shoulder. */
const POWER: Block['move'][] = ['bull', 'longArm'];

/**
 * When a rush stalls he goes to a counter (GDD §10.4: the move set
 * resolved against the line over time). The first comes ~0.9–1.3 s into the
 * rep, then every ~0.7–1.2 s while the blocker still has him. It works (a
 * leverage jump: he's half a step past) on a logistic of the counter's edge,
 * about a third of the time for an even matchup and more for a sack artist;
 * a failed one costs him ground. NFL pass-rush win rates run ~10% (tackles)
 * to ~25% (elite rushers) inside 2.5 s (ESPN/NGS), and a pocket that holds
 * past ~3 s has usually seen a counter win.
 */
function counterMove(s: PlayState, b: Agent, d: Agent, blk: Block): void {
  if (blk.kind !== 'pass' || blk.t < blk.next) return;
  blk.next = blk.t + 0.7 + 0.5 * s.rng.block();
  if (blk.lev > 0.45) return;
  const set = rushPlan(d).counters;
  const mv = set[Math.floor(s.rng.block() * set.length)]!;
  const e = edge(b, d, { ...blk, move: mv });
  // A Relentless Motor gets a second effort late in the down (past 2 s: the trait catalog's line).
  const p = 1 / (1 + exp(-(4.5 * e - 0.7 + (has(d, 'sack-artist') ? 0.4 : 0) + (blk.t > 2 && has(d, 'motor') ? 0.6 : 0))));
  blk.tries++;
  if (s.rng.block() < p) {
    blk.move = mv;
    blk.lev += JUMP + 0.3 * s.rng.block();
  } else blk.lev -= 0.12;
  s.events.push({ t: s.t, type: 'engage', who: [b.i, d.i], data: { move: mv, counter: true } });
}

/** Rusher's edge over the blocker for this move (−1..1 roughly). */
function edge(b: Agent, d: Agent, blk: Block): number {
  const shed = n(d, 'blockShed');
  if (blk.kind === 'run') {
    const lineman = b.p.pos === 'OL';
    // Linemen drive with their run-block ratings; receivers and tight ends
    // stalk with Run Block (backs carry no Run Block rating: a fullback's
    // Pass Block, the same hat-on-a-man skill, stands in for his lead block).
    const rb = b.p.pos === 'RB' ? 'passBlock' : 'runBlock';
    const push = lineman
      ? n(b, 'rbPower') * 0.5 + n(b, 'rbFinesse') * 0.2 + n(b, 'strength') * 0.3
      : // A stalk in space: a receiver on a defensive back holds him about a second (−0.25: a DB coming off it to the ball is the norm).
        n(b, rb) * 0.55 + n(b, 'impactBlock') * 0.15 + n(b, 'strength') * 0.3 - 0.25;
    const hold = shed * 0.5 + n(d, 'strength') * 0.3 + n(d, 'powerMoves') * 0.2;
    const mass = (d.fx.mass - b.fx.mass) / 250;
    // A Run Stuffer holds the point of attack; Road Graders move him off the
    // ball (the trait catalog's lines; ~a sixth of the gap between an
    // average and a Pro Bowl run blocker each).
    // The blockers' own: a Blocking WR's stalk holds ~0.4 s longer, a Sixth
    // Lineman seals the edge ~0.3 s longer, a Lead Blocker (H-back, wing,
    // fullback) wins his lead block more often; a Liability Blocker is shed
    // 30% faster. (Each an edge of ~0.08–0.12, the trait catalog's lines.)
    const own =
      (b.p.pos === 'WR' && has(b, 'blocking-wr') ? 0.12 : 0) +
      (b.p.pos === 'TE' && has(b, 'sixth-lineman') ? 0.1 : 0) +
      (!lineman && has(b, 'lead-blocker') ? 0.08 : 0) -
      (has(b, 'liability-blocker') ? 0.1 : 0);
    return hold - push + mass + (has(d, 'run-stuffer') ? 0.08 : 0) - (lineman && has(b, 'road-graders') ? 0.08 : 0) - own;
  }
  let rush: number;
  let pro: number;
  switch (blk.move) {
    case 'bull':
    case 'longArm':
      // Power: through the man (the long arm converts speed to power and keeps him off the rusher's pads).
      rush = n(d, 'powerMoves') * 0.45 + n(d, 'strength') * 0.3 + shed * 0.25 + (blk.move === 'longArm' ? 0.03 : 0);
      pro = n(b, 'pbPower') * 0.45 + n(b, 'anchor') * 0.4 + n(b, 'strength') * 0.15;
      rush += (d.fx.mass - b.fx.mass) / 300;
      break;
    case 'speed':
    case 'rip':
      // Around the edge: get-off and bend (the rip gets the shoulder under the tackle's hands).
      rush = n(d, 'finesseMoves') * 0.35 + n(d, 'speed') * 0.35 + n(d, 'acceleration') * 0.3;
      pro = n(b, 'pbFinesse') * 0.5 + n(b, 'agility') * 0.25 + n(b, 'speed') * 0.25;
      break;
    default:
      // Hands: swim, spin, club.
      rush = n(d, 'finesseMoves') * 0.55 + shed * 0.25 + n(d, 'agility') * 0.2;
      pro = n(b, 'pbFinesse') * 0.55 + n(b, 'pbPower') * 0.2 + n(b, 'agility') * 0.25;
  }
  return rush - pro;
}
/**
 * The trait catalog's pass-rush timings, as a head start (or a deficit) in
 * leverage: the leverage he'd gain in that many seconds at this matchup's
 * rate, so "wins 0.3 s earlier" is 0.3 s earlier. A Speed Rusher on a speed
 * or rip move against a tackle whose Pass Block Finesse is below his Finesse
 * Moves: −0.3 s. An Interior Wrecker on a guard or center: −0.25 s. Pass Pro
 * Wall: the pocket holds 0.2 s longer; Turnstile: 0.2 s less.
 */
function rushHeadStart(b: Agent, d: Agent, blk: Block): number {
  let dt = 0;
  if ((blk.move === 'speed' || blk.move === 'rip') && n(d, 'finesseMoves') > n(b, 'pbFinesse') && has(d, 'speed-rusher')) dt += 0.3;
  if ((b.slot === 'LG' || b.slot === 'C' || b.slot === 'RG') && has(d, 'interior-wrecker')) dt += 0.25;
  if (has(b, 'pass-pro-wall')) dt -= 0.2;
  if (b.p.pos === 'TE' && has(b, 'pass-pro-te')) dt -= 0.3; // a tight end who protects: the edge rush delayed 0.3 s
  if (has(b, 'turnstile')) dt += 0.2;
  if (dt === 0) return 0;
  return dt * (PASS_BASE + DRIFT * 2 * Math.max(0, edge(b, d, blk) + blk.bias));
}

/**
 * Patient Runner (the trait catalog: "blocks develop for him: the running
 * lane highlight appears 0.2 s earlier and cutback lanes stay open
 * longer"): on his designed run, while he's still behind the line, a block
 * on the backside of the aiming point (the blocks that make the cutback
 * lane) starts PATIENT_T to the good: the leverage the defender would gain
 * in that time at this matchup's rate, so it holds that much longer. The
 * catalog doesn't size "longer"; 0.1 s, half its lane figure, is ours, and
 * it's worth ~+0.3 yd a carry to Roger Craig (tools/sim/usagefx.ts). The
 * game has no running-lane highlight to show 0.2 s earlier, and reading the
 * blocks 0.2 s ahead in the back's own lane choice measured as nothing
 * (4.36 yd a carry against 4.48 without), so that half isn't in.
 */
const PATIENT_T = 0.1;
function patientHeadStart(s: PlayState, b: Agent, d: Agent, blk: Block): number {
  const run = s.setup.play.run;
  if (!run || QB_RUNS.includes(run.scheme)) return 0;
  const rb = s.agents[s.slot.RB!];
  if (!rb || !has(rb, 'patient-runner') || (s.carrier >= 0 && s.carrier !== rb.i) || rb.pos.x > s.setup.los) return 0;
  const side = run.aim >= 0 ? 1 : -1;
  if ((d.pos.y - ((s.setup.ballY ?? 0) + run.aim)) * side >= 0) return 0;
  return PATIENT_T * (BASE * 2 + DRIFT * 2 * Math.max(0, edge(b, d, blk) + blk.bias));
}

export function engage(s: PlayState, b: Agent, d: Agent, kind: Block['kind']): Block {
  // A lineman's block starts with him set; a stalk block in space starts even.
  // A rusher picked up again right after beating his man (help, the back) comes in with his momentum: half a step ahead.
  const fresh = s.t - ((d.mem.shedAt as number | undefined) ?? -9) > 2;
  const lev0 = kind === 'run' && b.p.pos !== 'OL' ? 0 : kind === 'pass' && !fresh ? REPICK_LEV : LEV0;
  // A run block's rep-to-rep spread (σ 0.3 of skill edge, about the gap
  // between an average and a Pro Bowl run blocker): who gets his hands inside
  // first. Pass sets keep their calibrated spread (sacktime.ts), so none there.
  const bias = kind === 'run' ? gauss(s.rng.block) * RUN_BIAS : gauss(s.rng.block) * PASS_BIAS;
  const blk: Block = { b: b.i, d: d.i, lev: lev0, kind, move: kind === 'run' ? 'drive' : pickMove(s, d), t: 0, bias, next: 0.9 + 0.4 * s.rng.block(), tries: 0 };
  if (kind === 'pass') blk.lev += rushHeadStart(b, d, blk);
  else blk.lev -= patientHeadStart(s, b, d, blk);
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
    counterMove(s, b, d, blk);
    let e = edge(b, d, blk) + blk.bias;
    if (blk.kind === 'run') {
      // Leverage is position too: a blocker squarely between his man and the
      // ball holds him; once the ball is on the other side of the defender
      // (a back bouncing outside the edge man, cutting back behind a down
      // block), he comes off the block to make the play.
      const toB = norm(sub(b.pos, d.pos));
      const toC = norm(sub(goal, d.pos));
      const cover = toB.x * toC.x + toB.y * toC.y;
      if (dist(d.pos, goal) < COME_OFF) e += Math.max(0, 0.4 - cover) * 1.2;
    }
    // Drift toward whoever has the edge, plus a base drift for the rusher
    // (blocks don't hold forever), plus matchup noise.
    // Run blocks resolve faster than pass sets (a drive block is a shorter fight).
    blk.lev += (DRIFT * e * 2 + (blk.kind === 'run' ? BASE * 2.0 : PASS_BASE)) * TICK + NOISE * Math.sqrt(TICK) * gauss(s.rng.block) * 0.35;
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
      // The edge man's technique: work to the blocker's outside shoulder and
      // keep it (set the edge), harder the more he's winning; a reach block
      // that has him beat (win near 0) still runs him wide.
      const k = d.mem.contain as number | undefined;
      if (k !== undefined) vy += k * (0.3 + 1.4 * win);
    } else if (POWER.includes(blk.move)) {
      // Bull rush and long arm: straight back into the pocket.
      // A Power Rusher on a weaker anchor collapses it a yard sooner (the trait catalog's line; ~30% faster back).
      const push = Math.max(0, win - 0.25) * 2.8 * (n(d, 'powerMoves') > n(b, 'anchor') && has(d, 'power-rusher') ? 1.3 : 1);
      vx = toGoal.x * push;
      vy = toGoal.y * push;
    } else {
      // Speed and finesse: around the edge, then down toward the QB.
      const side = Math.sign(d.pos.y - b.pos.y) || 1;
      const around = win * 2.2;
      // (An Edge Bender dips under the punch: turning the corner costs 30% less.)
      vx = toGoal.x * win * 1.4 - 0.3 * (has(d, 'edge-bender') ? 0.7 : 1);
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
