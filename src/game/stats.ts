// The game's box score (GDD §14): every snap's sim state and events folded
// into per-player lines for your side (passing, rushing, receiving, the line)
// and for the Beasts (tackles, sacks, pressures, picks, breakups, big hits),
// plus the coverage snapshot (who was on each receiver when the ball came
// out). Pure: the game session (game.ts) calls these at each whistle, the
// tests call them on plays run straight through the sim.

import type { PlayResult, PlayState } from '@/sim';
import { IN_PHASE } from '@/sim/outcomes';
import type { Situation } from './situation';

export interface PassLine {
  name: string;
  cmp: number;
  att: number;
  yds: number;
  td: number;
  int: number;
  sacks: number;
  /** Yards lost to sacks. */
  sackYds: number;
  long: number;
}
export interface RushLine {
  name: string;
  car: number;
  yds: number;
  td: number;
  long: number;
  /** Tackles he broke on his carries. */
  bt: number;
  fum: number;
  /** Fumbles the Beasts recovered. */
  lost: number;
}
export interface RecLine {
  name: string;
  tgt: number;
  rec: number;
  yds: number;
  td: number;
  long: number;
  /** Yards after the catch. */
  yac: number;
  drops: number;
  /** Targets with a defender in phase when the ball got there (within IN_PHASE, the harness's contested line), and the ones he caught. */
  contested: number;
  contestedWon: number;
}
export interface BlockLine {
  name: string;
  slot: string;
  sacks: number;
  pressures: number;
  /** Designed-run reps where he engaged a defender, and the ones he won (see runBlockReps). */
  runReps: number;
  runWins: number;
}
export interface DefLine {
  name: string;
  pos: string;
  num: number;
  tackles: number;
  sacks: number;
  pressures: number;
  ints: number;
  /** Passes defensed that weren't picks (the ball knocked away at the catch point). */
  pbu: number;
  bigHits: number;
}

/** The box score: legacy's categories, the per-player lines, and the team totals. */
export interface GameBox {
  pass: PassLine;
  rush: Record<string, RushLine>;
  rec: Record<string, RecLine>;
  /** Your blockers, by name (the five linemen, and anyone else who gave up pressure). */
  ol: Record<string, BlockLine>;
  /** The Beasts, by name. */
  def: Record<string, DefLine>;
  /** Targets by receiver, by the defender nearest the ball when it arrived (the matchups). */
  covered: Record<string, Record<string, { tgt: number; yds: number }>>;
  /** The coverage snapshot: on each dropback, the Beast nearest each receiver when the ball came out (or the pocket broke down). */
  shadow: Record<string, { snaps: number; by: Record<string, number> }>;
  /** Pressures and sacks by a Beast nobody blocked. */
  freeRushers: { pressures: number; sacks: number };
  bigHits: number;
  firstDowns: number;
  plays: number;
  yards: number;
  turnovers: number;
  sacks: number;
}

export function emptyGameBox(qb = ''): GameBox {
  return {
    pass: { name: qb, cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacks: 0, sackYds: 0, long: 0 },
    rush: {},
    rec: {},
    ol: {},
    def: {},
    covered: {},
    shadow: {},
    freeRushers: { pressures: 0, sacks: 0 },
    bigHits: 0,
    firstDowns: 0,
    plays: 0,
    yards: 0,
    turnovers: 0,
    sacks: 0,
  };
}

/**
 * NFL passer rating (the league's formula since 1973: four components, each
 * clamped to [0, 2.375], summed, ×100/6). Source: NFL Record & Fact Book,
 * "Passer rating". No attempts reads 0.
 */
export function passerRating(p: Pick<PassLine, 'cmp' | 'att' | 'yds' | 'td' | 'int'>): number {
  if (!p.att) return 0;
  const c = (x: number) => Math.max(0, Math.min(2.375, x));
  const a = c((p.cmp / p.att - 0.3) * 5);
  const b = c((p.yds / p.att - 3) * 0.25);
  const t = c((p.td / p.att) * 20);
  const i = c(2.375 - (p.int / p.att) * 25);
  return ((a + b + t + i) / 6) * 100;
}

/**
 * Run-block reps on a designed run. Modeled on ESPN's Run Block Win Rate
 * (NGS tracking, 2019 on): a blocker wins the rep when he holds his man
 * until the play is decided. Here: every blocker who engaged a defender
 * (an `engage` event) has a rep; he wins it unless a man he engaged shed
 * him (a `shed` event, a whiff included) within 2.5 s of the snap and
 * before the whistle. 2.5 s is ESPN's pass-block window, used for the run
 * as the point by which a run has hit or been stopped (NFL runs average
 * ~2.5–3 s snap to tackle).
 */
export const RUN_BLOCK_WINDOW = 2.5;
export function runBlockReps(s: PlayState): { i: number; won: boolean }[] {
  const snap = Math.max(0, s.snapT);
  const decided = Math.min(s.whistleT >= 0 ? s.whistleT : s.t, snap + RUN_BLOCK_WINDOW);
  const reps = new Map<number, boolean>();
  for (const e of s.events) {
    if (e.type === 'engage') {
      const b = e.who?.[0];
      if (b !== undefined && s.agents[b]?.side === 'off' && !reps.has(b)) reps.set(b, true);
    } else if (e.type === 'shed' && e.t <= decided) {
      const b = e.who?.[1];
      if (b !== undefined && reps.has(b)) reps.set(b, false);
    }
  }
  return [...reps].map(([i, won]) => ({ i, won }));
}

const isRun = (s: PlayState) => !!s.setup.play.run;

/** The Beast a pass rusher beat for his sack or pressure: the blocker on him, the last one he shed, or −1 (unblocked). */
function beatenBy(s: PlayState, d: number): number {
  const p = s.pressures.find((x) => x.by === d);
  if (p && p.beat >= 0) return p.beat;
  const on = s.blocks.find((k) => k.d === d);
  if (on) return on.b;
  for (let k = s.events.length - 1; k >= 0; k--) {
    const e = s.events[k]!;
    if (e.type === 'shed' && e.who?.[0] === d) return e.who[1] ?? -1;
  }
  return -1;
}

/**
 * One snap into the box score. `before` is the situation it was snapped
 * in; `qb` your quarterback's name (a scramble with nobody else on the
 * ball is his carry).
 */
export function tallySnap(b: GameBox, s: PlayState, r: PlayResult, before: Situation, qb: string): void {
  b.plays++;
  const y = r.offenseBall ? r.spot - before.los : 0;
  const td = r.touchdown && r.offenseBall ? 1 : 0;
  const name = (i: number | undefined) => (i !== undefined && i >= 0 ? (s.agents[i]?.p.name ?? '') : '');
  const side = (i: number | undefined) => (i !== undefined && i >= 0 ? s.agents[i]?.side : undefined);
  const defLine = (i: number): DefLine => {
    const a = s.agents[i]!;
    return (b.def[a.p.name] ??= { name: a.p.name, pos: a.p.pos, num: a.p.num, tackles: 0, sacks: 0, pressures: 0, ints: 0, pbu: 0, bigHits: 0 });
  };
  const blockLine = (i: number): BlockLine => {
    const a = s.agents[i]!;
    return (b.ol[a.p.name] ??= { name: a.p.name, slot: a.slot, sacks: 0, pressures: 0, runReps: 0, runWins: 0 });
  };
  if (!r.offenseBall) b.turnovers++;

  // The Beasts' side of it: hits, tackles, picks, breakups.
  const broke = new Set<number>();
  for (const e of s.events) {
    const by = e.who?.[0];
    if (by === undefined) continue;
    if (e.type === 'hit' && e.data?.big) {
      if (side(by) === 'def') defLine(by).bigHits++;
      if (side(e.who?.[1]) === 'off') b.bigHits++;
    } else if ((e.type === 'tackle' || e.type === 'sack') && side(by) === 'def' && side(e.who?.[1]) === 'off') {
      defLine(by).tackles++; // a sack is a tackle too (NFL scoring)
      if (e.type === 'sack') defLine(by).sacks++;
    } else if (e.type === 'interception' && side(by) === 'def') defLine(by).ints++;
    else if (e.type === 'deflection' && side(by) === 'def' && !broke.has(by)) {
      broke.add(by);
      if (!r.pass?.intercepted) defLine(by).pbu++;
    }
  }

  // Pressure: each Beast who got to the QB (a sack is a pressure too), and who let him.
  const pressured = new Set<number>();
  const credit = (d: number, sack: boolean) => {
    const beat = beatenBy(s, d);
    if (beat >= 0 && side(beat) === 'off') {
      const l = blockLine(beat);
      if (sack) l.sacks++;
      else l.pressures++;
    } else if (sack) b.freeRushers.sacks++;
    else b.freeRushers.pressures++;
  };
  for (const p of s.pressures) {
    pressured.add(p.by);
    defLine(p.by).pressures++;
    credit(p.by, false);
  }
  if (r.sack) {
    const e = s.events.find((x) => x.type === 'sack');
    const d = e?.who?.[0];
    if (d !== undefined && side(d) === 'def') {
      if (!pressured.has(d)) {
        defLine(d).pressures++;
        credit(d, false);
      }
      credit(d, true);
    }
  }

  // The line on a designed run.
  if (isRun(s)) {
    for (const rep of runBlockReps(s)) {
      const a = s.agents[rep.i]!;
      if (a.p.pos !== 'OL' && !b.ol[a.p.name]) continue;
      const l = blockLine(rep.i);
      l.runReps++;
      if (rep.won) l.runWins++;
    }
  }

  if (r.sack) {
    b.sacks++;
    b.pass.sacks++;
    b.pass.sackYds += Math.max(0, -y);
    b.yards += y;
    return;
  }
  if (r.pass?.attempted) {
    b.pass.att++;
    const tgt = s.agents[r.pass.target];
    const rn = tgt?.p.name ?? '';
    const line = (b.rec[rn] ??= { name: rn, tgt: 0, rec: 0, yds: 0, td: 0, long: 0, yac: 0, drops: 0, contested: 0, contestedWon: 0 });
    line.tgt++;
    const contested = r.pass.sep !== undefined && r.pass.sep < IN_PHASE;
    if (contested) line.contested++;
    // The nearest Beast when the ball got there: who covered him on this target.
    const cov = nearestDefender(s, r.pass.target);
    if (cov) {
      const c = ((b.covered[rn] ??= {})[cov] ??= { tgt: 0, yds: 0 });
      c.tgt++;
      if (r.pass.complete && !r.pass.intercepted) c.yds += y;
    }
    for (const e of s.events) if (e.type === 'drop' && e.who?.length === 1 && e.who[0] === r.pass.target) line.drops++;
    if (r.pass.intercepted) b.pass.int++;
    else if (r.pass.complete) {
      b.pass.cmp++;
      b.pass.yds += y;
      b.pass.td += td;
      b.pass.long = Math.max(b.pass.long, y);
      line.rec++;
      line.yds += y;
      line.td += td;
      line.long = Math.max(line.long, y);
      if (contested) line.contestedWon++;
      const c = s.events.find((e) => e.type === 'catch' && e.who?.[0] === r.pass!.target);
      if (c?.at) line.yac += Math.max(0, Math.min(r.spot, 100) - c.at.x);
    }
  } else {
    // A carry: the man who had it (the fumbler if he put it on the ground), else the QB's scramble.
    const fum = s.events.find((e) => e.type === 'fumble' && side(e.who?.[0]) === 'off');
    const ri = fum?.who?.[0] ?? (side(s.carrier) === 'off' ? s.carrier : (s.events.find((e) => e.type === 'handoff')?.who?.[1] ?? s.qb));
    const rn = name(ri) || qb;
    const line = (b.rush[rn] ??= { name: rn, car: 0, yds: 0, td: 0, long: 0, bt: 0, fum: 0, lost: 0 });
    line.car++;
    line.yds += y;
    line.td += td;
    line.long = Math.max(line.long, y);
    for (const e of s.events) {
      if (e.type === 'brokenTackle' && e.who?.[0] === ri) line.bt++;
      if (e.type === 'fumble' && e.who?.[0] === ri) line.fum++;
    }
    if (fum && !r.offenseBall) line.lost++;
  }
  b.yards += y;
}

/** The coverage snapshot for one dropback: the Beast nearest each eligible receiver right now. */
export function sampleShadow(b: GameBox, s: PlayState): void {
  for (const a of s.agents) {
    if (a.side !== 'off' || a.i === s.qb || a.p.pos === 'OL') continue;
    const near = nearestDefender(s, a.i);
    if (!near) continue;
    const sh = (b.shadow[a.p.name] ??= { snaps: 0, by: {} });
    sh.snaps++;
    sh.by[near] = (sh.by[near] ?? 0) + 1;
  }
}

export function nearestDefender(s: PlayState, target: number): string | null {
  const a = s.agents[target];
  if (!a) return null;
  let best: string | null = null;
  let bd = Infinity;
  for (const d of s.agents) {
    if (d.side === a.side) continue;
    const dx = d.pos.x - a.pos.x;
    const dy = d.pos.y - a.pos.y;
    const dd = dx * dx + dy * dy;
    if (dd < bd) {
      bd = dd;
      best = d.p.name;
    }
  }
  return best;
}

// ---- The play of the game ---------------------------------------------------------------

/** One snap as the game remembers it (the drive chart's plays, the play of the game). */
export interface PlayLog {
  /** 0-based index into the game's drives (yours), and the snap's number in it (1-based). */
  drive: number;
  n: number;
  /** Round (1-based) and overtime period, for the label. */
  round: number;
  ot: number;
  down: number;
  toGo: number;
  los: number;
  playId: string;
  playName: string;
  headline: string;
  detail: string;
  yards: number;
  touchdown: boolean;
  turnover: boolean;
  pickSix: boolean;
  /** Score before the snap. */
  score: { user: number; beasts: number };
  /** The game's last round or overtime. */
  late: boolean;
}

/**
 * Expected points on a first-and-10 from the line of scrimmage (yards from
 * your goal line): a linear fit to nflfastR's EP model (own 25 ≈ 0.9,
 * midfield ≈ 2.5, opponent's 25 ≈ 3.9).
 */
export const expectedPoints = (los: number): number => -0.7 + 0.064 * los;

/**
 * How much a snap swung the game, in points: expected points after minus
 * before (a touchdown is 7, the six and the kick; a turnover hands the
 * Beasts their expected points from the spot; a pick-six is −7), counted
 * half again in the last round or overtime when the game was within a
 * score before the snap (win probability moves most then).
 */
export function playImpact(p: PlayLog): number {
  const before = expectedPoints(p.los);
  const spot = Math.max(1, Math.min(99, p.los + p.yards));
  const after = p.pickSix ? -7 : p.touchdown ? 7 : p.turnover ? -expectedPoints(100 - spot) : expectedPoints(spot);
  const close = Math.abs(p.score.user - p.score.beasts) <= 8;
  return (after - before) * (p.late && close ? 1.5 : 1);
}

/**
 * The play of the game: your touchdowns first, then the turnovers, then
 * everything else; within each, the snap with the biggest swing either way
 * (playImpact's magnitude: the longer score, the costlier pick, the bigger
 * gain, and the late, close ones over the early). Ties go to the earlier
 * snap. −1 if there were no snaps.
 */
export function pickPlayOfGame(plays: PlayLog[]): number {
  let best = -1;
  let bv = -Infinity;
  plays.forEach((p, i) => {
    // Swings stay under 20 points, so the tier always decides first.
    const tier = p.touchdown ? 2 : p.turnover ? 1 : 0;
    const v = tier * 100 + Math.abs(playImpact(p));
    if (v > bv + 1e-9) {
      bv = v;
      best = i;
    }
  });
  return best;
}
