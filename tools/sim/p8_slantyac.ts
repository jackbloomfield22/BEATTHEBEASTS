// Passing round 8: what ends a slant after the catch (the identity harness's X on doubles-slants).
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
import type { PlayState } from '../../src/sim/state.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const name = process.argv[2] ?? 'Tyreek Hill';
const playId = process.argv[3] ?? 'doubles-slants';
const p = simPlayer(findStint(snap, name, 'WR')!, 99);
const off = { ...base.offense, X: p };
const play = PLAYS.find((q) => q.id === playId)!;
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));
const tally = new Map<string, number>();
let n = 0, dtSum = 0, vSum = 0, nearSum = 0;
for (const def of ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'].map(defById)) for (let k = 0; k < 18; k++) for (const at of [45, 70, 95]) {
  const s = createPlay({ seed: cellSeed(play, def, k), offense: off, defense: base.defense, play, def, los: 35, toGo: 10, user: true });
  const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
  let catchT = -1, vC = 0, near = 0;
  runToWhistle(s, (st) => {
    const t = since(st);
    const me = st.agents.find((a) => a.slot === 'X')!;
    if (catchT < 0 && st.carrier === me.i && st.phase === 'carrier') {
      catchT = st.t; vC = Math.hypot(me.vel.x, me.vel.y);
      near = Math.min(...st.def.map((i) => Math.hypot(st.agents[i]!.pos.x - me.pos.x, st.agents[i]!.pos.y - me.pos.y)));
    }
    if (st.phase === 'air') return input({ catchType: 'rac' });
    if (st.phase === 'carrier') {
      const c = st.agents[st.carrier]!;
      const op = !st.def.some((i) => { const d = st.agents[i]!; return !d.down && Math.hypot(d.pos.x - c.pos.x, d.pos.y - c.pos.y) < 2.6; });
      return input({ move: { x: 1, y: 0 }, sprint: op });
    }
    return input({ snap: st.phase === 'presnap', throwHeld: icon > 0 && t >= at && t < at + 3 ? icon : 0 });
  });
  const pr = s.result?.pass;
  const me = s.agents.find((a) => a.slot === 'X')!;
  if (!pr?.complete || pr.target !== me.i) continue;
  n++;
  const hit = s.events.find((e) => e.type === 'hit' && e.who?.includes(me.i));
  const tk = hit ? s.agents[hit.who![0] === me.i ? hit.who![1]! : hit.who![0]!]! : null;
  const key = tk ? `${tk.p.pos}` : String(s.result?.reason ?? 'none');
  tally.set(key, (tally.get(key) ?? 0) + 1);
  dtSum += (hit?.t ?? s.t) - catchT; vSum += vC; nearSum += near;
}
console.log(`${name} ${playId}: ${n} catches, catch speed ${(vSum / n).toFixed(1)} yd/s, nearest defender at the catch ${(nearSum / n).toFixed(1)} yd, catch to first hit ${(dtSum / n).toFixed(2)} s`);
console.log('first hit by:', [...tally].map(([k, v]) => `${k} ${v}`).join(', '));
