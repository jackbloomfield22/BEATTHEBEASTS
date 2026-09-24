import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { blockOf } from '../../src/sim/blocks.ts';
import { belief } from '../../src/sim/runs.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [play = 'singleback-power', def = 'cover3', seed = '1000', ...times] = process.argv.slice(2);
const s = createPlay({ seed: Number(seed), offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 35, toGo: 10, user: false });
const at = (times.length ? times : ['0.5', '1.0', '1.4']).map(Number);
const f = (v: number) => v.toFixed(1).padStart(5);
while (!s.result && s.tick < 2400) {
  stepPlay(s, NEUTRAL);
  const t = s.t - s.snapT;
  if (s.snapT >= 0 && at.some((x) => Math.abs(t - x) < 0.008)) {
    console.log(`--- t+${t.toFixed(2)} ${s.phase} carrier ${s.carrier >= 0 ? s.agents[s.carrier]!.slot + ' @' + f(s.agents[s.carrier]!.pos.x - 35) + f(s.agents[s.carrier]!.pos.y) : '-'}`);
    for (const a of s.agents) {
      const b = blockOf(s, a.i);
      const vs = b ? s.agents[b.b === a.i ? b.d : b.b]!.slot + ` lev ${b.lev.toFixed(2)}` : '';
      const tgt = typeof a.mem.target === 'number' && a.mem.target >= 0 ? s.agents[a.mem.target]!.slot : '';
      const extra = a.side === 'def' ? `${belief(s, a)} gap ${a.mem.gap !== undefined ? f((a.mem.gap as number)) : '    -'} ${a.mem.contain ? 'contain' : ''}` : `tgt ${tgt} ${a.mem.pull ? 'PULL' : ''}`;
      if (Math.abs(a.pos.y) < 9 || a.i === s.carrier) console.log(`${a.side} ${a.slot.padEnd(4)} ${f(a.pos.x - 35)} ${f(a.pos.y)} v ${f(Math.hypot(a.vel.x, a.vel.y))} ${a.down ? 'DOWN' : ''} ${b ? 'BLK ' + vs : ''} ${extra}`);
    }
  }
}
console.log(JSON.stringify(s.result), s.events.filter((e) => ['handoff', 'shed', 'tackle', 'hit', 'brokenTackle', 'missedTackle'].includes(e.type)).map((e) => `${(e.t - s.snapT).toFixed(2)} ${e.type} ${(e.who ?? []).map((i) => s.agents[i]!.slot).join('>')}`).join(' | '));
