// Passing round 7 (docs/passing/PASSING7.md): drops on open balls, by who's
// catching. passidentity.ts's hands pair (the same four plays and five
// coverages, the man at X, a ball that reached him with no defender within
// 1.5 yd), for a spread of Catching, and what made each ball hard (the
// catch's biggest cost, resolveCatch's s.pass.hard).
//   node tools/run-ts.mjs tools/sim/p7drops.ts [reps=8] [--names=A,B] [--shared]
// --shared: passidentity's own seeds (the same 40 on every play and call).
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import type { PlayState } from '../../src/sim/state.ts';
import type { OffSlot } from '../../src/sim/types.ts';
import type { SimPlayer } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 8);
const NAMES = (process.argv.find((a) => a.startsWith('--names='))?.slice(8) ?? 'Marvin Harrison,Jerry Rice,Roddy White,Diontae Johnson,Kelvin Benjamin,Darius Slayton').split(',');
const SHARED = process.argv.includes('--shared');
const COVERS = ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'];
const PLAYSET: [string, number][] = [
  ['doubles-slants', 30],
  ['doubles-curls', 60],
  ['doubles-quick-outs', 34],
  ['singleback-drive', 90],
];
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));
for (const name of NAMES) {
  const e = findStint(snap, name, 'WR');
  if (!e) continue;
  const rec: SimPlayer = simPlayer(e, 99);
  const off = { ...base.offense, X: rec } as Record<OffSlot, SimPlayer>;
  let n = 0;
  let dropped = 0;
  const byHard = new Map<string, [number, number]>();
  const byPlay = new Map<string, [number, number]>();
  let offSum = 0;
  let pSum = 0;
  const costSum = new Map<string, number>();
  for (const [pi, [id, at]] of PLAYSET.entries()) {
    const play = PLAYS.find((p) => p.id === id)!;
    for (const [ci, d] of COVERS.entries())
      for (let k = 1; k <= REPS * 5; k++) {
        // (Its own seed on every play and call: passidentity.ts's hands pair reuses 40 seeds across them, so its drops ride on ~40 dice.)
        const s = createPlay({ seed: SHARED ? 9000 + k * 17 : 20000 + pi * 5000 + ci * 1000 + k * 7, offense: off, defense: base.defense, play, def: defById(d), los: 30, toGo: 10, user: true });
        const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
        let dbg: { costs: [string, number][]; off: number; p: number } | null = null;
        runToWhistle(s, (st) => {
          const g = (st as unknown as { dbg?: typeof dbg }).dbg;
          if (g && !dbg) dbg = g;
          if (st.phase === 'air') return input({ catchType: 'rac' });
          if (st.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
          const t = since(st);
          return input({ snap: st.phase === 'presnap', throwHeld: t >= at && t < at + 3 ? icon : 0 });
        });
        dbg ??= (s as unknown as { dbg?: typeof dbg }).dbg ?? null;
        const p = s.result?.pass;
        const x = s.agents.find((a) => a.slot === 'X')!;
        if (!p?.attempted || p.target !== x.i || p.sep === undefined || p.sep < 1.5) continue;
        const drop = s.events.some((ev) => ev.type === 'drop' && ev.who?.[0] === x.i);
        if (!p.complete && !drop) continue;
        n++;
        if (drop) dropped++;
        if (drop && process.argv.includes('--detail')) console.log(`  DROP ${id}/${d}/${k} sep ${p.sep} contest ${p.contest} ${JSON.stringify(dbg)}`);
        const h = p.hard ?? '?';
        const b = byHard.get(h) ?? [0, 0];
        b[0]++;
        if (drop) b[1]++;
        byHard.set(h, b);
        const q = byPlay.get(id) ?? [0, 0];
        q[0]++;
        if (drop) q[1]++;
        byPlay.set(id, q);
        if (dbg) {
          offSum += dbg.off;
          pSum += dbg.p;
          for (const [c, v] of dbg.costs) costSum.set(c, (costSum.get(c) ?? 0) + v);
        }
      }
  }
  const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
  console.log(`${name} (Catching ${e.attrs.catching}${e.traits.length ? ', ' + e.traits.map((t) => t.id).join(' ') : ''}): ${n} open balls, dropped ${pc(dropped, n)} | mean off ${(offSum / n).toFixed(2)} yd, mean p ${(pSum / n).toFixed(3)}`);
  console.log(`   costs (mean): ${[...costSum].map(([c, v]) => `${c} ${(v / n).toFixed(3)}`).join('  ')}`);
  console.log(`   by hardest: ${[...byHard].map(([h, [a, b]]) => `${h} ${b}/${a}`).join('  ')}`);
  console.log(`   by play: ${[...byPlay].map(([h, [a, b]]) => `${h} ${pc(b, a)} of ${a}`).join('  ')}`);
}
