// Print chosen agents' positions every N ticks for one play.
import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [playId, defId, seed, slots, every = '10', hash = '0', flip = '0'] = process.argv.slice(2);
const play = playById(playId!);
const sd = sidesFor(r, play, defById(defId!));
const s = createPlay({ seed: Number(seed), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: Number(hash), flip: flip === '1', toGo: 10, user: false });
const want = slots!.split(',');
while (!s.result && s.tick < 2400) {
  stepPlay(s, NEUTRAL);
  const ev = s.events.filter((e) => e.t === s.t && e.type !== 'engage').map((e) => `${e.type}${e.who ? '[' + e.who.map((i) => s.agents[i]!.slot).join(',') + ']' : ''}`);
  if (s.tick % Number(every) === 0 || ev.length) {
    const parts = want.map((k) => {
      const a = s.agents[s.slot[k]!]!;
      return `${k} ${(a.pos.x - 35).toFixed(1)},${a.pos.y.toFixed(1)} v${a.vel.x.toFixed(1)},${a.vel.y.toFixed(1)} ${a.anim} r${a.route ? a.route.idx + "/" + a.route.pts.length : "-"} room ${a.mem.room} ${a.mem.mode ?? ""}${typeof a.mem.carry === "number" && (a.mem.carry as number) >= 0 ? ":" + s.agents[a.mem.carry as number]!.slot : ""}`;
    });
    console.log(`${(s.t - Math.max(0, s.snapT)).toFixed(2)} ${s.phase.padEnd(7)} ${parts.join(' | ')} ${ev.join(' ')}`);
  }
}
console.log(JSON.stringify(s.result));
