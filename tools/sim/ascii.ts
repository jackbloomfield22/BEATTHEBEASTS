// ASCII top-down frames of a headless play (debugging without a GPU).
//   node tools/run-ts.mjs tools/sim/ascii.ts <play> <def> [seed] [every-ticks]
import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [play = 'trips-inside-zone', def = 'cover1', seed = '1000', every = '15'] = process.argv.slice(2);
const s = createPlay({ seed: Number(seed), offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 35, toGo: 10, user: false });
const code = (slot: string, side: string) => {
  const m: Record<string, string> = { QB: 'Q', RB: 'R', X: 'X', Z: 'Z', SLOT: 'S', TE: 'T', LT: 'o', LG: 'o', C: 'c', RG: 'o', RT: 'o', LE: 'E', RE: 'E', LDT: 'D', RDT: 'D', WLB: 'W', MLB: 'M', SLB: 'L', LCB: 'C', RCB: 'C', FS: 'F', SS: 'H' };
  return m[slot] ?? (side === 'off' ? '?' : '!');
};
function frame() {
  const cx = s.carrier >= 0 ? s.agents[s.carrier]!.pos.x : s.ball.pos.x;
  const W = 50, H = 31;
  const x0 = Math.floor(cx - 12);
  const rows = Array.from({ length: H }, () => Array.from({ length: W }, () => ' '));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x0 + x; const fy = 15 - y;
    if (Math.abs(fy) > 26.6) rows[y]![x] = '|';
    else if (fx % 5 === 0) rows[y]![x] = '.';
    if (fx === 35) rows[y]![x] = ':';
  }
  const put = (px: number, py: number, ch: string) => { const x = Math.round(px - x0); const y = Math.round(15 - py); if (x >= 0 && x < W && y >= 0 && y < H) rows[y]![x] = ch; };
  for (const a of s.agents) { let ch = code(a.slot, a.side); if (a.side === 'off') ch = ch.toLowerCase() === ch ? ch : ch; if (a.down) ch = '_'; put(a.pos.x, a.pos.y, a.side === 'def' ? ch.toLowerCase() === ch ? ch.toUpperCase() : ch.toLowerCase() : ch); }
  put(s.ball.pos.x, s.ball.pos.y, '*');
  if (s.carrier >= 0) { const c = s.agents[s.carrier]!; put(c.pos.x, c.pos.y, '@'); }
  console.log(`t=${s.t.toFixed(2)} ${s.phase} x0=${x0} (offense caps, defense lowercase; @ carrier, * ball, _ down)`);
  console.log(rows.map((r) => r.join('')).join('\n'));
}
const log: string[] = [];
while (!s.result && s.tick < 2400) {
  stepPlay(s, NEUTRAL);
  for (const e of s.events.splice(0)) if (!['engage'].includes(e.type)) log.push(`${s.t.toFixed(2)} ${e.type} ${JSON.stringify(e.who)} ${JSON.stringify(e.data ?? {})}`);
  if (s.tick % Number(every) === 0 && s.snapT >= 0) frame();
}
frame();
console.log(log.join('\n'));
console.log(JSON.stringify(s.result));
