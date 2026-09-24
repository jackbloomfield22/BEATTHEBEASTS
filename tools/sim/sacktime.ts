import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const ts: number[] = []; const firstShed: number[] = [];
for (let k = 0; k < 200; k++) {
  const s = createPlay({ seed: 9000 + k * 7919, offense: r.offense, defense: r.defense, play: PLAYS[k % 4]!, def: DEF_CALLS[k % 3]!, los: 35, toGo: 10, user: true });
  let shed = -1;
  while (!s.result && s.tick < 60 * 12) {
    stepPlay(s, input({ snap: s.tick === 0 }));
    for (const e of s.events.splice(0)) if (e.type === 'shed' && shed < 0) shed = s.t;
  }
  ts.push(s.result ? s.t : 12); firstShed.push(shed);
}
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)]!.toFixed(2);
console.log('time to sack (QB never throws): p10', q(ts, 0.1), 'p50', q(ts, 0.5), 'p90', q(ts, 0.9), '| first shed p10', q(firstShed, 0.1), 'p50', q(firstShed, 0.5), 'p90', q(firstShed, 0.9));
