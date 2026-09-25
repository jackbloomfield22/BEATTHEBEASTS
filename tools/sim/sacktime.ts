// Pocket time: how long until the QB goes down when he never throws (Pro).
// Runs the practice line, then the best and worst pass-blocking units in the
// snapshot, so the ratings spread stays visible while tuning the blocks.
//   node tools/run-ts.mjs tools/sim/sacktime.ts [plays per line]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, PASS_PLAYS, practiceRosters, stepPlay, type OffSlot, type SimPlayer, type SnapshotLike } from '../../src/sim/index.ts';
import { pressureOn } from '../../src/sim/ai.ts';
import { simPlayer } from '../../src/sim/roster.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const N = Number(process.argv[2] ?? 400);
const OL: OffSlot[] = ['LT', 'LG', 'C', 'RG', 'RT'];

/** A unit's pass-block grade: the mean of its linemen's pass-block ratings. */
const grade = (ids: string[]) => {
  const es = ids.map((id) => snap.entries.find((e) => e.id === id)!);
  const one = (p: SimPlayer) => (p.attrs.pbPower! + p.attrs.pbFinesse! + p.attrs.anchor!) / 3;
  return es.reduce((a, e) => a + one(simPlayer(e, 70)), 0) / es.length;
};
const units = snap.units.filter((u) => u.linemen.length >= 5).map((u) => ({ u, g: grade(u.linemen) })).sort((a, b) => a.g - b.g);

// Dropbacks only (a run hands off whatever the QB does); the screens release the line, so they're out too.
const DROPBACKS = PASS_PLAYS.filter((p) => !p.situ && p.type !== 'screen');

export function run(offense: Record<OffSlot, SimPlayer>) {
  const ts: number[] = [];
  const firstShed: number[] = [];
  const pressure: number[] = [];
  for (let k = 0; k < N; k++) {
    const s = createPlay({ seed: 9000 + k * 7919, offense, defense: r.defense, play: DROPBACKS[k % DROPBACKS.length]!, def: DEF_CALLS[k % DEF_CALLS.length]!, los: 35, toGo: 10, user: true, difficulty: 'pro' });
    let shed = -1;
    let press = -1;
    while (!s.result && s.tick < 60 * 12) {
      stepPlay(s, input({ snap: s.tick === 0 }));
      for (const e of s.events.splice(0)) if (e.type === 'shed' && shed < 0) shed = s.t;
      if (press < 0 && s.snapT >= 0 && pressureOn(s, s.agents[s.qb]!) >= 0.45) press = s.t - s.snapT;
    }
    ts.push(s.result ? s.t : 12);
    firstShed.push(shed);
    pressure.push(press < 0 ? 12 : press);
  }
  return { ts, firstShed, pressure };
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)]!.toFixed(2);
const report = (label: string, offense: Record<OffSlot, SimPlayer>) => {
  const { ts, firstShed, pressure } = run(offense);
  console.log(`${label.padEnd(28)} sack p10 ${q(ts, 0.1)} p50 ${q(ts, 0.5)} p90 ${q(ts, 0.9)} | first shed p50 ${q(firstShed, 0.5)} | first pressure p50 ${q(pressure, 0.5)}`);
};
const withUnit = (ids: string[]) => {
  const o = { ...r.offense };
  OL.forEach((k, j) => (o[k] = simPlayer(snap.entries.find((e) => e.id === ids[j])!, 70 + j)));
  return o;
};
report('practice line (SF 1980s)', r.offense);
const best = units[units.length - 1]!;
const worst = units[0]!;
report(`best: ${best.u.id} ${best.g.toFixed(0)}`, withUnit(best.u.linemen));
report(`worst: ${worst.u.id} ${worst.g.toFixed(0)}`, withUnit(worst.u.linemen));
