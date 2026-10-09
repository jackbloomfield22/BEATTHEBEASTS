// Passing round 6: the RB screen's incompletions, by what happened (screens.ts's set-up), with the ball against the back at the catch or the miss.
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const play = playById('doubles-rb-screen');
const HASHES = [3.08, 0, -3.08];
const tally: Record<string, number> = {};
for (const def of DEF_CALLS.filter((d) => ['cover1', 'cover3', 'cover1blitz'].includes(d.id)))
  for (let k = 0; k < 60; k++) {
    const sd = sidesFor(rosters, play, def);
    const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
    while (!s.result && s.tick < 2400) stepPlay(s, NEUTRAL);
    if (!s.result?.pass?.attempted || s.result.pass.complete) continue;
    const ev = s.events.filter((e) => ['drop', 'deflection', 'interception', 'bobble', 'catchOutOfBounds'].includes(e.type)).map((e) => e.type + (e.data?.why ? ':' + e.data.why : '') + (e.data?.batted ? ':bat' : ''));
    const key = ev.join(',') || 'nobody touched it';
    tally[key] = (tally[key] ?? 0) + 1;
    if (process.argv.includes('--detail')) console.log(def.id, k, key, s.result.pass.hard);
  }
console.log(tally);
// --trace=def,k: the back and the ball over the last half second of the flight.
const tr = process.argv.find((a) => a.startsWith('--trace='))?.slice(8).split(',');
if (tr) {
  const def = DEF_CALLS.find((d) => d.id === tr[0])!;
  const k = Number(tr[1]);
  const sd = sidesFor(rosters, play, def);
  const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
  while (!s.result && s.tick < 2400) {
    if (s.ball.mode === 'air' && s.ball.target >= 0 && s.ball.arrive - s.t < 0.5) {
      const r = s.agents[s.ball.target]!;
      const b = s.ball;
      console.log(`t ${(b.arrive - s.t).toFixed(2)} rb ${r.pos.x.toFixed(2)},${r.pos.y.toFixed(2)} v ${r.vel.x.toFixed(2)},${r.vel.y.toFixed(2)} face ${r.face.toFixed(2)} ball ${b.pos.x.toFixed(2)},${b.pos.y.toFixed(2)},${b.pos.z.toFixed(2)} aim ${b.aim.x.toFixed(2)},${b.aim.y.toFixed(2)},${b.aim.z.toFixed(2)} meant ${b.meant.x.toFixed(2)},${b.meant.y.toFixed(2)} route ${r.route?.idx}/${r.route?.pts.length} sit ${r.route?.sit.join('')}`);
    }
    stepPlay(s, NEUTRAL);
  }
}
