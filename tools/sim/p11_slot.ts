// Passing round 11 (docs/passing/PASSING11.md): how often the drawn arm slot (side-arm or over the top, render/game/choreo.ts
// throwSlot) shows in the AI book, and in what pockets: the lane he moved his release by (the throw event's), the pressure on
// him as he lets it go (ai.ts pressureOn) and the lineman in the lane (his distance from the QB, blocked or free). The drawn
// weight is choreo.ts's: before (round 8) the lane alone; after (round 11) the lane scaled by the man's threat (slotThreat).
//   node tools/run-ts.mjs tools/sim/p11_slot.ts [reps a cell, 4]
import { readFileSync } from 'node:fs';
import { createPlay, NEUTRAL, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, PASS_PLAYS } from '../../src/sim/plays.ts';
import { pressureOn } from '../../src/sim/ai.ts';
import { LANE_MAX } from '../../src/sim/passing.ts';
import { slotThreat } from '../../src/render/game/slotThreat.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const n = Number(process.argv[2] ?? 4);
const HASHES = [3.08, 0, -3.08];
/** choreo.ts SLOT_K: the most of a slot variant drawn. */
const SLOT_K = 0.8;
/** A slot drawn at this weight or more reads as one (a fifth of the way to side-arm: the elbow visibly down). Ours. */
const SEEN = 0.2;
type Row = { lane: number; pressure: number; threat: number };
const rows: Row[] = [];
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock))
  for (const def of DEF_CALLS)
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let pressure = 0;
      let threat = 0;
      for (let t = 0; t < 60 * 40 && !s.result && !s.events.some((e) => e.type === 'throw'); t++) {
        const w = s.windup;
        if (w && !w.away) {
          const qb = s.agents[s.qb]!;
          const rec = s.agents[s.icons[w.icon]!]!;
          pressure = pressureOn(s, qb);
          threat = slotThreat(s, qb, rec.pos);
        }
        stepPlay(s, NEUTRAL);
      }
      const th = s.events.find((e) => e.type === 'throw');
      if (th && th.data?.kind !== undefined) rows.push({ lane: Number(th.data?.lane ?? 0), pressure, threat });
    }
const before = (r: Row) => SLOT_K * Math.min(1, Math.abs(r.lane) / LANE_MAX);
const after = (r: Row) => before(r) * r.threat;
const pct = (xs: Row[], f: (r: Row) => number) => (xs.length ? ((100 * xs.filter((r) => f(r) >= SEEN).length) / xs.length).toFixed(0) : '-');
const clean = rows.filter((r) => r.pressure < 0.3);
const hot = rows.filter((r) => r.pressure >= 0.3);
console.log(`${rows.length} throws (${clean.length} from a clean pocket, pressure < 0.3; ${hot.length} under pressure)`);
console.log(`release moved at all: ${((100 * rows.filter((r) => Math.abs(r.lane) > 0.01).length) / rows.length).toFixed(0)}%`);
console.log(`slot drawn (weight >= ${SEEN}): before ${pct(rows, before)}% (clean ${pct(clean, before)}%, pressured ${pct(hot, before)}%) | after ${pct(rows, after)}% (clean ${pct(clean, after)}%, pressured ${pct(hot, after)}%)`);
