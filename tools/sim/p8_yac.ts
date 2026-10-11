// Passing round 8: the identity harness's yards after the catch, per play,
// for a pair at X or TE (identity.ts's loop, broken down), with the catch's
// contest, his speed at the catch and the first tackle's outcome.
//   node tools/run-ts.mjs tools/sim/p8_yac.ts "Tyreek Hill,WR" "Wes Welker,WR" X [repsMul]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
import type { OffSlot } from '../../src/sim/types.ts';
import type { PlayState } from '../../src/sim/state.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const [A, B, SLOT, MUL] = process.argv.slice(2);
const slot = SLOT as OffSlot;
const mul = Number(MUL ?? 18);
const plays = slot === 'TE' ? ['ace-te-seam', 'trips-y-cross', 'heavy-pa-te-leak', 'trips-stick'] : ['doubles-slants', 'doubles-quick-outs', 'doubles-curls', 'singleback-pa-post'];
const covers = ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'].map(defById);
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));
function open(s: PlayState): boolean {
  const c = s.agents[s.carrier]!;
  return !s.def.some((i) => { const d = s.agents[i]!; return !d.down && Math.hypot(d.pos.x - c.pos.x, d.pos.y - c.pos.y) < 2.6; });
}
for (const who of [A!, B!]) {
  const [name, pos] = who.split(',');
  const p = simPlayer(findStint(snap, name!, pos)!, 99);
  const off = { ...base.offense, [slot]: p };
  const out: string[] = [];
  let all: number[] = [];
  for (const id of plays) {
    const play = PLAYS.find((q) => q.id === id)!;
    const ys: number[] = [];
    let broken = 0, vc = 0;
    for (const def of covers) for (let k = 0; k < mul; k++) for (const at of [45, 70, 95]) {
      const s = createPlay({ seed: cellSeed(play, def, k), offense: off, defense: base.defense, play, def, los: 35, toGo: 10, user: true });
      const icon = s.icons.findIndex((i) => s.agents[i]!.slot === slot) + 1;
      runToWhistle(s, (st) => {
        const t = since(st);
        if (st.phase === 'air') return input({ catchType: 'rac' });
        if (st.phase === 'carrier') return input({ move: { x: 1, y: 0 }, sprint: open(st) });
        return input({ snap: st.phase === 'presnap', throwHeld: icon > 0 && t >= at && t < at + 3 ? icon : 0 });
      });
      const pr = s.result?.pass;
      const me = s.agents.find((a) => a.slot === slot)!;
      if (!pr?.attempted || pr.target !== me.i || !pr.complete) continue;
      ys.push(s.result!.yards - pr.airYards);
      const c = s.events.find((e) => e.type === 'catch');
      void c;
      broken += s.events.filter((e) => (e.type === 'brokenTackle' || e.type === 'missedTackle') && e.who?.includes(me.i)).length;
      vc++;
    }
    all = all.concat(ys);
    const m = ys.reduce((a, b) => a + b, 0) / Math.max(1, ys.length);
    const med = [...ys].sort((a, b) => a - b)[Math.floor(ys.length / 2)] ?? NaN;
    const big = ys.filter((y) => y >= 10).length;
    out.push(`${id.padEnd(20)} n ${String(ys.length).padStart(4)} yac ${m.toFixed(2)} med ${med.toFixed(1)} 10+ ${((100 * big) / Math.max(1, ys.length)).toFixed(0)}%  evaded ${(broken / Math.max(1, vc)).toFixed(2)}/catch`);
  }
  console.log(`${name}: yac ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)} (n ${all.length})`);
  for (const o of out) console.log('  ' + o);
}
