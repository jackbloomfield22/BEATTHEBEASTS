// Passing round 4: what a player's throw does seed by seed (the clip finder
// for src/game/clips.ts PASSING4): play, receiver, the press tick, the hold.
//   node tools/run-ts.mjs tools/sim/p4find.ts play icon at hold [def] [hot] [seeds]
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, stepPlay, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { userThrow } from '../../src/game/clips.ts';

const [play, icon, at, hold, def = 'cover3', hot = '', seeds = '12'] = process.argv.slice(2);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const f = userThrow({ icon: Number(icon), at: Number(at), hold: Number(hold), hot: (hot || undefined) as RouteName | undefined });
for (let seed = 1; seed <= Number(seeds); seed++) {
  const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play!), def: defById(def), los: 30, toGo: 10, user: true });
  for (let k = 0; k < 900 && !s.result; k++) stepPlay(s, f(s));
  const th = s.events.find((e) => e.type === 'throw');
  const c = s.events.find((e) => ['catch', 'drop', 'deflection', 'interception', 'bobble'].includes(e.type));
  const p = s.result?.pass;
  console.log(`seed ${String(seed).padStart(2)} ${p?.complete ? 'CATCH' : p?.intercepted ? 'INT  ' : (c?.type ?? 'inc').padEnd(5)} yds ${String(s.result?.yards ?? '-').padStart(3)} air ${th?.data?.air ?? '-'} kind ${th?.data?.kind ?? '-'} look ${c?.data?.look ?? '-'} sep ${p?.sep ?? '-'} meant (${Number(th?.data?.meantX).toFixed(1)},${Number(th?.data?.meantY).toFixed(1)}) aim (${th?.at?.x.toFixed(1)},${th?.at?.y.toFixed(1)})`);
}
