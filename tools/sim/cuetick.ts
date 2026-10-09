// The tick after the snap a player pressing on the throw-timing cue presses
// (src/sim/cue.ts), for a clip's play, seed and receiver: the round-four
// clips (src/game/clips.ts PASSING4) press there.
//   node tools/run-ts.mjs tools/sim/cuetick.ts play icon seed [def] [hot] [qb]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';

const [play, icon, seed, def = 'cover3', hot = '', qb = ''] = process.argv.slice(2);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const offense = qb ? { ...r.offense, QB: simPlayer(findStint(snap, qb, 'QB')!, 16) } : r.offense;
const s = createPlay({ seed: Number(seed), offense, defense: r.defense, play: playById(play!), def: defById(def), los: 30, toGo: 10, user: true });
for (let k = 0; k < 600 && !s.result; k++) {
  if (s.phase !== 'presnap') {
    const q = throwCue(s, s.agents[s.icons[Number(icon) - 1]!]!);
    if (q && s.t >= q.ballOut - q.release - 1e-9) {
      console.log(`press at ${Math.round((s.t - s.snapT) * 60)} ticks (${(s.t - s.snapT).toFixed(2)} s), ball out ${(q.ballOut - s.snapT).toFixed(2)} s, release ${q.release.toFixed(2)}`);
      break;
    }
  }
  stepPlay(s, s.phase === 'presnap' ? input({ snap: true, hotRoute: hot ? { icon: Number(icon), route: hot as RouteName } : null }) : input({}));
}
