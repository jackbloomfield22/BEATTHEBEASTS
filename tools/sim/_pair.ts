import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [play, def, seed, who = 'FS', t0 = '2', t1 = '3.5'] = process.argv.slice(2);
const s = createPlay({ seed: Number(seed), offense: r.offense, defense: r.defense, play: playById(play!), def: defById(def!), los: 35, toGo: 10, user: false });
while (!s.result && s.tick < 2400) {
  stepPlay(s, NEUTRAL);
  const t = s.t - s.snapT;
  if (s.snapT >= 0 && t >= Number(t0) && t <= Number(t1) && s.tick % 3 === 0 && s.carrier >= 0) {
    const c = s.agents[s.carrier]!; const d = s.agents[s.slot[who]!]!;
    console.log(t.toFixed(2), 'C', (c.pos.x - 35).toFixed(1), c.pos.y.toFixed(1), 'v', c.vel.x.toFixed(1), c.vel.y.toFixed(1), '|', who, (d.pos.x - 35).toFixed(1), d.pos.y.toFixed(1), 'v', d.vel.x.toFixed(1), d.vel.y.toFixed(1), 'busy', d.busy, 'dist', Math.hypot(c.pos.x - d.pos.x, c.pos.y - d.pos.y).toFixed(2), d.down ? 'DOWN' : '', d.anim);
  }
}
console.log(s.events.filter((e) => e.who?.includes(s.slot[who]!)).map((e) => `${(e.t - s.snapT).toFixed(2)} ${e.type}`).join(' | '));
