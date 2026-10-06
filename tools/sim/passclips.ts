// What each passing clip (src/game/clips.ts PASSING) does in Node: the
// throw, the catch or not, the yards; the recordings must show the same.
//   node tools/run-ts.mjs tools/sim/passclips.ts
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING, withSwap } from '../../src/game/clips.ts';
import { PERSONNEL } from '../../src/sim/personnel.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
for (const c of PASSING) {
  let offense = r.offense;
  if (c.swap) {
    const t = withSwap({ team: r.team, beasts: r.beasts }, c.play, c.swap, snap);
    const per = PERSONNEL[playById(c.play).formation.personnel];
    offense = { ...r.offense, QB: t.team.QB, ...(c.swap.off && c.swap.off !== 'QB' ? { [c.swap.off]: t.team[per[c.swap.off] as keyof typeof t.team] } : {}) } as typeof r.offense;
  }
  const s = runToWhistle(createPlay({ seed: c.seed, offense, defense: r.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true }), c.script);
  const th = s.events.find((e) => e.type === 'throw');
  const p = s.result?.pass;
  const ev = s.events.filter((e) => ['catch', 'drop', 'deflection', 'interception'].includes(e.type)).map((e) => `${e.type}${e.data?.look ? `(${e.data.look})` : ''}${e.data?.why ? `(${e.data.why})` : ''}`);
  console.log(`${c.id.padEnd(20)} ${p?.complete ? 'caught' : p?.intercepted ? 'INT' : 'incomplete'} ${s.result?.yards.toFixed(1)} yd air ${p?.airYards} sep ${p?.sep} contest ${p?.contest} | throw ${th?.data?.kind} why ${th?.data?.why} off ${th?.data?.off} spiral ${th?.data?.spiral} rpm ${th?.data?.rpm}${th?.data?.hit ? ' HIT' : ''} | ${ev.join(' ')}`);
}
