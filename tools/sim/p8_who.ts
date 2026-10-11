import { readFileSync } from 'node:fs';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import type { SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
for (const [n, pos] of [['Rob Gronkowski', 'TE'], ['Tony Gonzalez', 'TE'], ['Kelvin Benjamin', 'WR'], ['Terrell Owens', 'WR'], ['Tyreek Hill', 'WR'], ['Wes Welker', 'WR'], ['Anquan Boldin', 'WR'], ['DeSean Jackson', 'WR'], ['Calvin Johnson', 'WR'], ['Antonio Gates', 'TE'], ['Ronnie Lott', 'S'], ['Jerry Rice', 'WR']] as const) {
  const e = findStint(snap, n, pos);
  if (!e) { console.log(n, 'missing'); continue; }
  const p = simPlayer(e, 99) as unknown as { heightIn: number; weightLb: number; ratings: Record<string, number>; traits: string[] };
  const r = Object.fromEntries(Object.entries((p as unknown as { attrs: Record<string, { value: number } | number> }).attrs).map(([k, v]) => [k, typeof v === "number" ? v : v.value]));
  console.log(n.padEnd(16), JSON.stringify({ h: p.heightIn, w: p.weightLb, str: r.strength, cit: r.catchInTraffic, spd: r.speed, acc: r.acceleration, agi: r.agility, bt: r.breakTackle, truck: r.trucking, elu: r.elusiveness, sa: r.stiffArm, rac: r.rac, catching: r.catching, rr: r.routeRunning, traits: p.traits }).slice(0, 400));
}
