// The tackling harness (docs/physics/TACKLING.md): what happens from the
// first hand on the ball carrier to the whistle, by who carries it and who
// gets there first.
//   node tools/run-ts.mjs tools/sim/tackling.ts [reps] [--duels] [--json=out.json]
//
// - Yards after first contact (the spot minus where the first defender got a
//   hand on him), by carrier type and by first tackler's type.
// - Broken tackles (brokenTackle events) and tacklers made to miss
//   (missedTackle) a carry; gang tackles (2+ defenders in on the tackle);
//   driven back (the body finished behind where he was first hit); the time
//   from the first contact to the whistle on a tackle.
// - --duels: named carriers in the RB slot and named tacklers in the strong
//   safety slot on the same plays (the identity harness's way), for the
//   contrasts a fan expects (Bettis falls forward, Barry slips arm tackles,
//   Kam stops a back cold).
//
// NFL reference (cited in docs/physics/TACKLING.md): RB yards after contact
// ~2.8–3.1 an attempt league-wide (PFF), the power backs 3.5+; forced missed
// tackles ~0.15–0.20 an attempt (PFF); about one tackle in five shared
// (gamebook assists).

import { readFileSync, writeFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, PASS_PLAYS, practiceRosters, RUN_PLAYS, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import type { PlayState } from '../../src/sim/state.ts';
import type { DefSlot, OffSlot, SimPlayer } from '../../src/sim/types.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 4);
const DUELS = process.argv.includes('--duels');
const JSON_OUT = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
const HASHES = [3.08, 0, -3.08];

export interface Carry {
  /** Carrier and first tackler types. */
  ctype: string;
  ttype: string;
  /** Yards after first contact (spot − first contact x); NaN with no contact. */
  after: number;
  /** Where the body ended against where he was first hit (yd, + forward). */
  body: number;
  broken: number;
  missed: number;
  /** Defenders in on the tackle (0 when he wasn't tackled). */
  gang: number;
  /** First contact to whistle (s), tackles only. */
  toDown: number;
  tackled: boolean;
  bigHit: boolean;
  kind: string;
}

/** A carrier's type by body and position: what a fan sees. */
export function carrierType(p: SimPlayer): string {
  if (p.pos === 'RB') return p.weightLb >= 225 ? 'RB power (225+)' : 'RB (under 225)';
  if (p.pos === 'WR') return p.weightLb < 195 ? 'WR small (<195)' : 'WR';
  return p.pos;
}
export function tacklerType(p: SimPlayer): string {
  if (p.pos === 'DE' || p.pos === 'DT') return 'DL';
  if (p.pos === 'LB') return 'LB';
  return 'DB';
}

/** Read one finished play. */
export function readCarry(s: PlayState): Carry | null {
  const r = s.result;
  if (!r) return null;
  // The man who had it last on offense (the runner, or the receiver after the catch).
  const ci = s.carrier;
  if (ci < 0) return null;
  const c = s.agents[ci]!;
  if (c.side !== 'off' || ci === s.qb) return null;
  const evs = s.events.filter((e) => e.who?.includes(ci) && (e.type === 'hit' || e.type === 'brokenTackle' || e.type === 'missedTackle' || e.type === 'tackle'));
  const first = evs[0];
  const tackleEv = s.events.find((e) => e.type === 'tackle' && e.who?.[1] === ci);

  let after = NaN;
  let body = NaN;
  let ttype = '—';
  let toDown = NaN;
  if (first?.at) {
    after = r.spot - first.at.x;
    body = c.pos.x - first.at.x;
    const tk = first.type === 'brokenTackle' ? first.who?.[1] : first.who?.[0];
    if (tk !== undefined) ttype = tacklerType(s.agents[tk]!.p);
    if (tackleEv) toDown = (s.whistleT ?? s.t) - first.t;
  }
  // In on the tackle: every defender with a hit on him in the last engagement (from the last broken tackle on).
  const lastBreak = Math.max(-1, ...s.events.filter((e) => e.type === 'brokenTackle' && e.who?.[0] === ci).map((e) => e.t));
  const inOn = new Set<number>();
  if (tackleEv) {
    for (const e of s.events) if ((e.type === 'hit' || e.type === 'tackle') && e.t > lastBreak && e.who?.[1] === ci && e.who[0] !== undefined) inOn.add(e.who[0]);
  }
  const hitEv = s.events.find((e) => e.type === 'hit' && e.who?.[1] === ci && e.t > lastBreak);
  return {
    ctype: carrierType(c.p),
    ttype,
    after,
    body,
    broken: s.events.filter((e) => e.type === 'brokenTackle' && e.who?.[0] === ci).length,
    missed: s.events.filter((e) => e.type === 'missedTackle' && e.who?.[1] === ci).length,
    gang: tackleEv ? inOn.size : 0,
    toDown,
    tackled: !!tackleEv && r.reason === 'tackle',
    bigHit: !!r.bigHit,
    kind: String(hitEv?.data?.kind ?? (hitEv?.data?.big ? 'big' : hitEv?.data?.wrap ? 'wrap' : '')),
  };
}

function play(offense: Record<OffSlot, SimPlayer>, defense: Record<DefSlot, SimPlayer>, kinds: 'run' | 'pass' | 'both', reps: number): Carry[] {
  const out: Carry[] = [];
  const plays = [...(kinds !== 'pass' ? RUN_PLAYS : []), ...(kinds !== 'run' ? PASS_PLAYS : [])].filter((p) => !p.situ && !p.unlock && !p.hailMary);
  for (const pl of plays) for (const def of DEF_CALLS) for (let k = 0; k < reps; k++) {
    const s = createPlay({ seed: cellSeed(pl, def, k), offense, defense, play: pl, def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
    for (let t = 0; t < 60 * 40 && !s.result; t++) stepPlay(s, NEUTRAL);
    const c = readCarry(s);
    if (c) out.push(c);
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

export function summary(cs: Carry[]): string {
  const hit = cs.filter((c) => Number.isFinite(c.after));
  const tk = cs.filter((c) => c.tackled && Number.isFinite(c.toDown));
  const sorted = tk.map((c) => c.toDown).sort((a, b) => a - b);
  return [
    `carries ${cs.length}, contacted ${hit.length}`,
    `yards after first contact ${mean(hit.map((c) => c.after)).toFixed(2)} (median ${[...hit.map((c) => c.after)].sort((a, b) => a - b)[hit.length >> 1]?.toFixed(1)})`,
    `broken a carry ${mean(cs.map((c) => c.broken)).toFixed(3)}  made to miss ${mean(cs.map((c) => c.missed)).toFixed(3)}`,
    `tackled: gang (2+) ${pct(tk.filter((c) => c.gang >= 2).length / Math.max(1, tk.length))}, 3+ ${pct(tk.filter((c) => c.gang >= 3).length / Math.max(1, tk.length))}; driven back ${pct(tk.filter((c) => c.body < -0.2).length / Math.max(1, tk.length))}; big hits ${pct(cs.filter((c) => c.bigHit).length / Math.max(1, cs.length))}`,
    `contact to whistle on a tackle: median ${sorted[sorted.length >> 1]?.toFixed(2)} s, p10 ${sorted[Math.floor(sorted.length * 0.1)]?.toFixed(2)}, p90 ${sorted[Math.floor(sorted.length * 0.9)]?.toFixed(2)} s`,
    `hold at the tackle: ${[...new Set(tk.map((c) => c.kind))].map((k) => `${k || '?'} ${pct(tk.filter((c) => c.kind === k).length / Math.max(1, tk.length))}`).join('  ')}`,
  ].join('\n');
}

function matrix(cs: Carry[]): string {
  const ct = [...new Set(cs.map((c) => c.ctype))].sort();
  const tt = ['DL', 'LB', 'DB'];
  const rows = [`${'carrier \\ first tackler'.padEnd(18)} ${tt.map((t) => t.padStart(12)).join('')}   all   broken  toDown`];
  for (const c of ct) {
    const mine = cs.filter((x) => x.ctype === c && Number.isFinite(x.after));
    const cells = tt.map((t) => {
      const xs = mine.filter((x) => x.ttype === t).map((x) => x.after);
      return xs.length >= 8 ? `${mean(xs).toFixed(2)} (${xs.length})`.padStart(12) : '—'.padStart(12);
    });
    const all = cs.filter((x) => x.ctype === c);
    rows.push(`${c.padEnd(18)} ${cells.join('')} ${mean(mine.map((x) => x.after)).toFixed(2).padStart(5)}  ${mean(all.map((x) => x.broken)).toFixed(2).padStart(6)}  ${mean(all.filter((x) => x.tackled && Number.isFinite(x.toDown)).map((x) => x.toDown)).toFixed(2)} s`);
  }
  return rows.join('\n');
}

const findP = (name: string, pos: string): SimPlayer => {
  const e = findStint(snap, name, pos);
  if (!e) throw new Error(`${name} ${pos}`);
  return simPlayer(e, 99);
};

export function duelCarrier(name: string, pos: string, reps: number): Carry[] {
  return play({ ...base.offense, RB: findP(name, pos) }, base.defense, 'run', reps);
}
export function duelTackler(name: string, pos: string, reps: number): Carry[] {
  return play(base.offense, { ...base.defense, SS: findP(name, pos) } as Record<DefSlot, SimPlayer>, 'run', reps);
}

if (process.argv[1]?.endsWith('tackling.ts')) {
  const runs = play(base.offense, base.defense, 'run', REPS);
  const passes = play(base.offense, base.defense, 'pass', Math.max(1, REPS >> 1));
  console.log('== Runs (AI vs AI, the harness book) ==');
  console.log(summary(runs));
  console.log('\n== After the catch ==');
  console.log(summary(passes));
  console.log('\n== Yards after first contact by carrier and first tackler (n) ==');
  console.log(matrix([...runs, ...passes]));
  const json: Record<string, unknown> = { runs: summary(runs), passes: summary(passes) };
  if (DUELS) {
    console.log('\n== Duels: carriers in the RB slot (run book) ==');
    for (const [n, p] of [['Jerome Bettis', 'RB'], ['Derrick Henry', 'RB'], ['Earl Campbell', 'RB'], ['Barry Sanders', 'RB'], ['Jamaal Charles', 'RB'], ['Chris Johnson', 'RB']] as const) {
      const cs = duelCarrier(n, p, REPS);
      const hit = cs.filter((c) => Number.isFinite(c.after));
      const tk = cs.filter((c) => c.tackled && Number.isFinite(c.toDown));
      const line = `${n.padEnd(16)} after contact ${mean(hit.map((c) => c.after)).toFixed(2)}  broken ${mean(cs.map((c) => c.broken)).toFixed(2)}  missed ${mean(cs.map((c) => c.missed)).toFixed(2)}  driven back ${pct(tk.filter((c) => c.body < -0.2).length / Math.max(1, tk.length))}  to down ${mean(tk.map((c) => c.toDown)).toFixed(2)} s`;
      console.log(line);
      json[n] = line;
    }
    console.log('\n== Duels: tacklers at strong safety (run book), yards after contact when he is first there ==');
    for (const [n, p] of [['Kam Chancellor', 'S'], ['Steve Atwater', 'S'], ['Ronnie Lott', 'S'], ['Ed Reed', 'S']] as const) {
      const cs = duelTackler(n, p, REPS);
      const ss = cs.filter((c) => Number.isFinite(c.after) && c.ttype === 'DB');
      const line = `${n.padEnd(16)} after contact (DB first) ${mean(ss.map((c) => c.after)).toFixed(2)} (${ss.length})  big hits ${pct(cs.filter((c) => c.bigHit).length / Math.max(1, cs.length))}  driven back ${pct(cs.filter((c) => c.tackled && c.body < -0.2).length / Math.max(1, cs.filter((c) => c.tackled).length))}`;
      console.log(line);
      json[n] = line;
    }
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(json, null, 1));
}
