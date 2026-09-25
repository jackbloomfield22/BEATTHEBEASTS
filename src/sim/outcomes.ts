// Play outcomes as a football person reads them (feedback items 6 and 7):
// the passing and running distributions the AI-vs-AI sim produces. The
// headless harness prints them, and tests hold their shape (completion rate,
// the explosive tail, YAC, contested catches; yards per carry, stuffs,
// explosive runs, fumbles) inside believable bands.
//
// Bands: NFL league-wide completion runs ~62–66%; ~10–12% of completions
// gain 20+ yd and ~2–4% gain 40+; YAC on short throws (under 10 air yards)
// averages ~5–6 yd; contested catch rates (PFF, NGS) sit around 40–50% for
// the best receivers and lower for everyone else.

import { routeOf } from './ai';
import { NEUTRAL } from './input';
import { stepPlay } from './play';
import { DEF_CALLS, PASS_PLAYS, RUN_PLAYS, type DefCall, type OffPlay, type RouteName } from './plays';
import { createPlay, type PlayState } from './state';
import type { DefSlot, OffSlot, SimPlayer } from './types';
import { dist } from './vec';

/** Short, underneath routes (the "YAC on short routes" figure). */
const SHORT: RouteName[] = ['slant', 'flat', 'hitch', 'stick', 'drag', 'checkdown', 'swing', 'sit', 'curl', 'out', 'in'];

/** A target is "in phase" with a defender inside this (yd) when the ball gets there. */
export const IN_PHASE = 1.0;

export interface PassSample {
  play: string;
  def: string;
  route: RouteName | null;
  complete: boolean;
  intercepted: boolean;
  /** Yards gained on the play (from the line). */
  yards: number;
  /** Catch spot minus the line (completions). */
  air: number;
  /** Yards after the catch (completions). */
  yac: number;
  /**
   * How open he was: the nearest defender to the ball when it reached him
   * (yd); 0 when a defender got to it first; his separation at the planned
   * arrival when it never got to him (overthrown). NaN on a throwaway.
   */
  sep: number;
}

/**
 * The pocket (feedback item 4). Bands (NFL, NGS/PFF, 2018–2023): sacks on
 * ~6–7% of dropbacks; QB scrambles on ~4–6% (more for a mobile QB) for ~6–8
 * yd each; pressure on ~30–35% of dropbacks, the first at a median ~2.5 s.
 */
export interface PocketDist {
  dropbacks: number;
  sackRate: number;
  scrambleRate: number;
  /** Yards per scramble that ended with him running (not sacked). */
  scrambleYds: number;
  /** Sacks after he'd tucked it. */
  scrambleSacks: number;
  pressureRate: number;
  /** Median snap-to-first-pressure, s (plays with pressure). */
  timeToPressure: number;
}

export interface PassDist {
  pocket: PocketDist;
  plays: number;
  att: number;
  comp: number;
  int: number;
  sacks: number;
  cmpPct: number;
  ypa: number;
  /** Share of completions gaining 20+ and 40+. */
  exp20: number;
  exp40: number;
  /** Average YAC on completions to short routes, and on all completions. */
  yacShort: number;
  yacAll: number;
  /** Share of targets in phase (a defender within IN_PHASE at arrival), and the catch rate on those. */
  contestedShare: number;
  contestedCatch: number;
  /** Catch rate when the target had 2+ yd of separation. */
  openCatch: number;
  /** Completions by gain: <0, 0–4, 5–9, 10–19, 20–39, 40+. */
  buckets: number[];
  samples: PassSample[];
}

/** Separation at the planned arrival: the nearest defender to the target on the first tick at or past it. */
function arrivalSep(s: PlayState): number {
  const r = s.agents[s.ball.target];
  if (!r) return 99;
  let k = 99;
  for (const i of s.def) {
    const d = s.agents[i]!;
    if (!d.down) k = Math.min(k, dist(d.pos, r.pos));
  }
  return k;
}

export function passDistribution(rosters: { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> }, n: number, plays: OffPlay[] = PASS_PLAYS, defs: DefCall[] = DEF_CALLS): PassDist {
  const samples: PassSample[] = [];
  let playsRun = 0;
  let sacks = 0;
  let scrambles = 0;
  let scrambleYds = 0;
  let scrambleRuns = 0;
  let scrambleSacks = 0;
  const pressures: number[] = [];
  for (const play of plays) {
    for (const def of defs) {
      for (let k = 0; k < n; k++) {
        const s = createPlay({ seed: 1000 + k * 7919, offense: rosters.offense, defense: rosters.defense, play, def, los: 35, toGo: 10, user: false });
        let sep = -1;
        let target = -1;
        let catchX = NaN;
        for (let t = 0; t < 60 * 40 && !s.result; t++) {
          stepPlay(s, NEUTRAL);
          if (s.ball.mode === 'air' && s.ball.target >= 0) target = s.ball.target;
          if (sep < 0 && target >= 0 && s.pass?.attempted && s.t >= s.ball.arrive - 1e-9) {
            // The ball may already be caught (arrive is the planned time); the target is the thrown-to man either way.
            const b = s.ball.target;
            s.ball.target = target;
            sep = arrivalSep(s);
            s.ball.target = b;
          }
          if (Number.isNaN(catchX) && s.pass?.complete && s.carrier >= 0) catchX = s.agents[s.carrier]!.pos.x;
        }
        playsRun++;
        const r = s.result!;
        if (r.sack) sacks++;
        if (s.pressureT >= 0) pressures.push(s.pressureT - s.snapT);
        if (s.scrambleT >= 0) {
          scrambles++;
          if (r.sack) scrambleSacks++;
          else if (!r.pass?.attempted) {
            scrambleRuns++;
            scrambleYds += r.yards;
          }
        }
        if (!r.pass?.attempted) continue;
        // A throwaway has no target: an attempt, but no route or separation.
        const tgt = s.agents[r.pass.target];
        const complete = r.pass.complete && !r.pass.intercepted;
        const catchAt = s.events.find((e) => e.type === 'catch')?.at?.x ?? catchX;
        const air = complete ? catchAt - s.setup.los : 0;
        samples.push({
          play: play.id,
          def: def.id,
          route: tgt ? routeOf(s, tgt) : null,
          complete,
          intercepted: r.pass.intercepted,
          yards: r.yards,
          air,
          yac: complete ? r.yards - air : 0,
          sep: !tgt ? NaN : r.pass.sep !== undefined ? r.pass.sep : s.events.some((e) => e.type === 'interception' || e.type === 'deflection') ? 0 : sep < 0 ? 99 : sep,
        });
      }
    }
  }
  const comp = samples.filter((p) => p.complete);
  const short = comp.filter((p) => p.route && SHORT.includes(p.route) && p.air < 10);
  const contested = samples.filter((p) => p.sep < IN_PHASE);
  const open = samples.filter((p) => p.sep >= 2);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const share = (a: number, b: number) => (b ? a / b : 0);
  const edges = [0, 5, 10, 20, 40];
  const buckets = [0, 0, 0, 0, 0, 0];
  for (const p of comp) {
    let j = 0;
    while (j < edges.length && p.yards >= edges[j]!) j++;
    buckets[j]!++;
  }
  const pr = [...pressures].sort((a, b) => a - b);
  return {
    pocket: {
      dropbacks: playsRun,
      sackRate: share(sacks, playsRun),
      scrambleRate: share(scrambles, playsRun),
      scrambleYds: scrambleRuns ? scrambleYds / scrambleRuns : 0,
      scrambleSacks,
      pressureRate: share(pressures.length, playsRun),
      timeToPressure: pr[Math.floor(pr.length / 2)] ?? 0,
    },
    plays: playsRun,
    att: samples.length,
    comp: comp.length,
    int: samples.filter((p) => p.intercepted).length,
    sacks,
    cmpPct: share(comp.length, samples.length),
    ypa: avg(samples.map((p) => (p.complete ? p.yards : 0))),
    exp20: share(comp.filter((p) => p.yards >= 20).length, comp.length),
    exp40: share(comp.filter((p) => p.yards >= 40).length, comp.length),
    yacShort: avg(short.map((p) => p.yac)),
    yacAll: avg(comp.map((p) => p.yac)),
    contestedShare: share(contested.length, samples.length),
    contestedCatch: share(contested.filter((p) => p.complete).length, contested.length),
    openCatch: share(open.filter((p) => p.complete).length, open.length),
    buckets,
    samples,
  };
}

/** One block of text for the harness and the docs. */
export function formatPassDist(d: PassDist): string {
  const p = (x: number) => `${(100 * x).toFixed(1)}%`;
  return [
    `plays ${d.plays}  att ${d.att}  comp ${d.comp}  int ${d.int}  sacks ${d.sacks}`,
    `completion ${p(d.cmpPct)}  ypa ${d.ypa.toFixed(1)}`,
    `completions 20+ ${p(d.exp20)}  40+ ${p(d.exp40)}`,
    `YAC short routes ${d.yacShort.toFixed(1)}  all ${d.yacAll.toFixed(1)}`,
    `in phase (< ${IN_PHASE} yd) ${p(d.contestedShare)} of targets, caught ${p(d.contestedCatch)}; 2+ yd open caught ${p(d.openCatch)}`,
    `completions by gain  <0 ${d.buckets[0]}  0-4 ${d.buckets[1]}  5-9 ${d.buckets[2]}  10-19 ${d.buckets[3]}  20-39 ${d.buckets[4]}  40+ ${d.buckets[5]}`,
    `pocket: sacks ${p(d.pocket.sackRate)} of dropbacks  scrambles ${p(d.pocket.scrambleRate)} for ${d.pocket.scrambleYds.toFixed(1)} yd (${d.pocket.scrambleSacks} sacked after tucking)  pressured ${p(d.pocket.pressureRate)}, first at ${d.pocket.timeToPressure.toFixed(2)} s (median)`,
  ].join('\n');
}

// ---- The run game --------------------------------------------------------------
//
// Bands (NFL, 2015–2023 league-wide): ~4.2–4.5 yards per carry; ~17–20% of
// carries stuffed (no gain or a loss); ~10–12% gain 10+ and ~2–3% gain 20+;
// fumbles on ~1% of carries, about half lost.

export interface RunSample {
  play: string;
  def: string;
  yards: number;
  fumble: boolean;
  lost: boolean;
  /** Where the first defender got a hand on him, from the line (yd); the whistle spot if nobody did. */
  contact: number;
  /** Tackles he broke or made miss. */
  broken: number;
}

export interface RunDist {
  carries: number;
  ypc: number;
  /** Share of carries for no gain or a loss. */
  stuff: number;
  /** Share gaining 10+ and 20+. */
  exp10: number;
  exp20: number;
  fumbles: number;
  lost: number;
  /** Median gain. */
  median: number;
  /** Average yards before first contact, and broken or missed tackles per carry. */
  ybc: number;
  brokenPer: number;
  samples: RunSample[];
}

export function runDistribution(rosters: { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> }, n: number, plays: OffPlay[] = RUN_PLAYS, defs: DefCall[] = DEF_CALLS): RunDist {
  const samples: RunSample[] = [];
  for (const play of plays) {
    for (const def of defs) {
      for (let k = 0; k < n; k++) {
        const s = createPlay({ seed: 1000 + k * 7919, offense: rosters.offense, defense: rosters.defense, play, def, los: 35, toGo: 10, user: false });
        for (let t = 0; t < 60 * 40 && !s.result; t++) stepPlay(s, NEUTRAL);
        const r = s.result!;
        const fumble = s.events.some((e) => e.type === 'fumble');
        const first = s.events.find((e) => (e.type === 'hit' || e.type === 'brokenTackle' || e.type === 'missedTackle') && e.t > s.runReadT);
        const at = first ? (first.at?.x ?? s.agents[s.carrier >= 0 ? s.carrier : s.slot.RB!]!.pos.x) : r.spot;
        const broken = s.events.filter((e) => e.type === 'brokenTackle' || e.type === 'missedTackle').length;
        samples.push({ play: play.id, def: def.id, yards: r.offenseBall ? r.yards : 0, fumble, lost: !r.offenseBall, contact: at - s.setup.los, broken });
      }
    }
  }
  const ys = samples.map((p) => p.yards).sort((a, b) => a - b);
  const share = (f: (p: RunSample) => boolean) => (samples.length ? samples.filter(f).length / samples.length : 0);
  return {
    carries: samples.length,
    ypc: ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length),
    stuff: share((p) => p.yards <= 0),
    exp10: share((p) => p.yards >= 10),
    exp20: share((p) => p.yards >= 20),
    fumbles: samples.filter((p) => p.fumble).length,
    lost: samples.filter((p) => p.lost).length,
    median: ys[Math.floor(ys.length / 2)] ?? 0,
    ybc: samples.reduce((a, p) => a + p.contact, 0) / Math.max(1, samples.length),
    brokenPer: samples.reduce((a, p) => a + p.broken, 0) / Math.max(1, samples.length),
    samples,
  };
}

export function formatRunDist(d: RunDist): string {
  const p = (x: number) => `${(100 * x).toFixed(1)}%`;
  return [
    `carries ${d.carries}  ypc ${d.ypc.toFixed(2)}  median ${d.median.toFixed(1)}`,
    `stuffed ${p(d.stuff)}  10+ ${p(d.exp10)}  20+ ${p(d.exp20)}  fumbles ${d.fumbles} (lost ${d.lost})`,
    `yards before contact ${d.ybc.toFixed(2)}  broken/missed tackles per carry ${d.brokenPer.toFixed(2)}`,
  ].join('\n');
}
