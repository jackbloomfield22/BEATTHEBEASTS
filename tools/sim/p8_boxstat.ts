// Passing round 8: how often the box-out is in play for a tight end in the identity harness's throws, and against whom.
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
import type { PlayState } from '../../src/sim/state.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));
for (const name of [process.argv[2] ?? 'Rob Gronkowski', process.argv[3] ?? 'Tony Gonzalez']) {
  const off = { ...base.offense, TE: simPlayer(findStint(snap, name, 'TE')!, 99) };
  let caught = 0, boxed = 0, sum = 0;
  const by = new Map<string, number>();
  for (const id of ['ace-te-seam', 'trips-y-cross', 'heavy-pa-te-leak', 'trips-stick']) for (const def of ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'].map(defById)) for (let k = 0; k < 12; k++) for (const at of [45, 70, 95]) {
    const play = PLAYS.find((p) => p.id === id)!;
    const s = createPlay({ seed: cellSeed(play, def, k), offense: off, defense: base.defense, play, def, los: 35, toGo: 10, user: true });
    const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'TE') + 1;
    runToWhistle(s, (st) => (st.phase === 'air' ? input({ catchType: 'rac' }) : st.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : input({ snap: st.phase === 'presnap', throwHeld: icon > 0 && since(st) >= at && since(st) < at + 3 ? icon : 0 })));
    const me = s.agents.find((a) => a.slot === 'TE')!;
    if (!s.result?.pass?.complete || s.result.pass.target !== me.i) continue;
    caught++;
    const k2 = (me.mem.boxK as number | undefined) ?? 0;
    if (k2 > 0) { boxed++; sum += k2; const d = s.agents[me.mem.boxedBy as number]!; by.set(d.p.pos, (by.get(d.p.pos) ?? 0) + 1); }
  }
  console.log(`${name}: ${caught} catches, boxed a man on ${((100 * boxed) / caught).toFixed(0)}% (mean box ${(sum / Math.max(1, boxed)).toFixed(2)}); by ${[...by].map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
