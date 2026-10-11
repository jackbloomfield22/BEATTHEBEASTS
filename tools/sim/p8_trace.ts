// Passing round 8: a clip's last half second of the ball in the air, tick by tick, against the man it's thrown to.
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING8, withSwap } from '../../src/game/clips.ts';
import { handsAt, reach, reachFwd, catchAhead } from '../../src/sim/passing.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const c = PASSING8.find((x) => x.id === process.argv[2])!;
const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
const s = createPlay({ seed: Number(process.argv[3] ?? c.seed), offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
for (let k = 0; k < 1500 && !s.result; k++) {
  const b = s.ball;
  if (b.mode === 'air' && b.target >= 0 && b.arrive - s.t < 0.5) {
    const a = s.agents[b.target]!;
    const sp = Math.hypot(a.vel.x, a.vel.y);
    const ux = a.vel.x / sp, uy = a.vel.y / sp;
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y;
    const h = handsAt(a);
    const ah = catchAhead(s, a);
    console.log(`t ${s.t.toFixed(3)} along ${(dx * ux + dy * uy).toFixed(2)} across ${(-dx * uy + dy * ux).toFixed(2)} z ${b.pos.z.toFixed(2)} hands ${Math.hypot(b.pos.x - h.x, b.pos.y - h.y).toFixed(2)} r ${reach(a).r.toFixed(2)} fwd ${reachFwd(a, b.pos.z).toFixed(2)} v ${sp.toFixed(1)} relv ${((b.vel.x - a.vel.x) * ux + (b.vel.y - a.vel.y) * uy).toFixed(1)} ahead ${ah ? ah.dt.toFixed(3) : '-'}`);
  }
  stepPlay(s, c.script(s));
}
console.log(s.result?.reason, s.events.filter((e) => e.t > 0.5).map((e) => e.type).join(','));
