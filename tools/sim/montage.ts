// The Beasts' drive on screen (M7, src/game/montage.ts): over many games, how
// often each kind of drive gets its deciding play staged, how many tries it
// took, how long the search ran, how far the moment sits from the snap, and
// how long it's on screen unskipped (screenSecs: the play and the result).
//   node tools/run-ts.mjs tools/sim/montage.ts [games]
import { readFileSync } from 'node:fs';
import { makeRng } from '../../src/engine/rng/index.ts';
import { assembleRatedBeasts } from '../../src/game/beasts.ts';
import { makeCatalog } from '../../src/game/draft.ts';
import { applyBeastsDrive, beastsPossession, createMatch, type Match } from '../../src/game/match.ts';
import { montageTeams, screenSecs, stageDrive } from '../../src/game/montage.ts';
import { contactFor } from '../../src/render/game/kickView.ts';
import { practiceRosters, TICK, type SnapshotLike } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike & { units: never[] };
const jer = JSON.parse(readFileSync('data/augment/jerseys.json', 'utf8')) as { numbers: Record<string, number> };
const cat = makeCatalog(snap, jer.numbers);
const games = Number(process.argv[2] ?? 20);
const user = practiceRosters(snap).team;
const userIds = [user.QB, user.RB, user.RB2, user.WR1, user.WR2, user.WR3, user.TE, user.TE2, ...user.OL].map((p) => p.id);

type Row = { n: number; staged: number; tries: number; ms: number; toKey: number; worstMs: number; screen: number; screenMin: number; screenMax: number };
const rows: Record<string, Row> = {};
let worst = 0;
for (let g = 0; g < games; g++) {
  const seed = 1000 + g * 7919;
  const beasts = assembleRatedBeasts(makeRng(seed ^ 0x9e3779b9), (id) => cat.entry.get(id)?.ovr);
  const t0 = performance.now();
  const teams = montageTeams(cat, [...userIds, ...beasts.beasts.map((b) => b.id), ...beasts.subs.map((b) => b.id)], seed);
  const teamMs = performance.now() - t0;
  const m: Match = createMatch({ drives: 6, quarterSecs: null, seed, beastsRating: beasts.rating.rating, diffAdj: 0, kickerRange: 50 });
  for (let round = 1; round <= 6; round++) {
    const d = beastsPossession(m);
    const a = performance.now();
    const st = stageDrive(d, teams, seed, m.round, m.ot);
    const ms = performance.now() - a;
    worst = Math.max(worst, ms);
    const row = (rows[d.result] ??= { n: 0, staged: 0, tries: 0, ms: 0, toKey: 0, worstMs: 0, screen: 0, screenMin: Infinity, screenMax: 0 });
    row.n++;
    row.ms += ms;
    row.worstMs = Math.max(row.worstMs, ms);
    const on = st ? screenSecs(st, (k) => contactFor(k === 'punt' ? 'PUNT' : 'FG')) : 0;
    if (st) {
      row.staged++;
      row.screen += on;
      row.screenMin = Math.min(row.screenMin, on);
      row.screenMax = Math.max(row.screenMax, on);
    }
    if (st?.type === 'kick') {
      if (g < 3) console.log(`game ${g} round ${round}: ${d.result} ${d.plays} plays ${d.yards} yd from ${d.start} -> ${st.label} from ${st.los}, ${st.yards} yd, hang ${st.hang.toFixed(1)} s, next ${d.nextStart}, ${on.toFixed(1)} s on screen`);
    } else if (st) {
      row.tries += st.tries;
      row.toKey += (st.keyTick - st.snapTick) * TICK;
      if (g < 3) console.log(`game ${g} round ${round}: ${d.result} ${d.plays} plays ${d.yards} yd from ${d.start} -> ${st.kind} ${st.label} ${st.src.setup.play.id} vs ${st.src.setup.def.id} ${st.down}&${st.toGo} at ${st.los}, ${st.yards} yd, key +${((st.keyTick - st.snapTick) * TICK).toFixed(2)} s, whistle +${((st.whistleTick - st.snapTick) * TICK).toFixed(2)} s, ${st.src.frames.length} frames, ${st.tries} tries, ${ms.toFixed(0)} ms, ${on.toFixed(1)} s on screen`);
    } else if (g < 3) console.log(`game ${g} round ${round}: ${d.result} ${d.plays} plays ${d.yards} yd -> card (${ms.toFixed(0)} ms)`);
    // The game goes on as the resolver decided: the user's drive just ends (a punt from their 30).
    applyBeastsDrive(m, d);
    m.userDrives.push({ start: 25, plays: 5, yards: 5, result: 'Punt', points: 0, against: 0, next: 20 });
    m.drive = null;
    m.round++;
    m.phase = 'meanwhile';
  }
  if (g === 0) console.log(`teams drawn in ${teamMs.toFixed(0)} ms`);
}
for (const [k, r] of Object.entries(rows)) console.log(`${k.padEnd(10)} ${r.staged}/${r.n} staged, ${(r.tries / Math.max(1, r.staged)).toFixed(1)} tries, ${(r.ms / r.n).toFixed(0)} ms avg (worst ${r.worstMs.toFixed(0)}), moment +${(r.toKey / Math.max(1, r.staged)).toFixed(2)} s, on screen ${(r.screen / Math.max(1, r.staged)).toFixed(1)} s (${r.screenMin.toFixed(1)}–${r.screenMax.toFixed(1)})`);
console.log(`worst search ${worst.toFixed(0)} ms`);
