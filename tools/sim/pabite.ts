// Play action, readable (Playtest 2): how far the linebackers come downhill
// on the fake, against the same snap without it. For each PA play and each
// coverage, the AI QB runs it; we take each linebacker's most forward step
// (toward the line, yd from where he stood at the snap) in the first 1.4 s,
// zone droppers only,
// and the share that "bite" (step up ≥ 1 yd). The no-fake baseline is a
// drop-back from the same personnel.
//   node tools/run-ts.mjs tools/sim/pabite.ts [reps]
import { readFileSync } from 'node:fs';
import { effects } from '../../src/sim/effects.ts';
import { createPlay, DEF_CALLS, input, PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const REPS = Number(process.argv[2] ?? 12);
const LBS = new Set(['WLB', 'MLB', 'SLB']);

export function bite(playId: string, playRec?: number, reps = REPS) {
  const play = PLAYS.find((p) => p.id === playId)!;
  let n = 0;
  let step = 0;
  let bit = 0;
  for (const def of DEF_CALLS)
    for (let k = 0; k < reps; k++) {
      const s = createPlay({ seed: 1000 + k * 31, offense: r.offense, defense: r.defense, play, def, los: 30, toGo: 10, user: false });
      if (playRec !== undefined)
        for (const i of s.def) {
          const a = s.agents[i]!;
          if (LBS.has(a.slot)) {
            a.p = { ...a.p, attrs: { ...a.p.attrs, playRec } };
            a.fx = effects(a.p);
          }
        }
      stepPlay(s, input({ snap: true }));
      // Zone droppers only (a blitzer or a man defender steps up on every play).
      const lbs = s.def.map((i) => s.agents[i]!).filter((a) => LBS.has(a.slot) && s.setup.def.assign[a.slot as keyof typeof s.setup.def.assign]?.kind === 'zone');
      const x0 = lbs.map((a) => a.pos.x);
      const best = lbs.map(() => 0);
      for (let t = 0; t < 84 && s.phase !== 'dead'; t++) {
        stepPlay(s, input({}));
        lbs.forEach((a, j) => (best[j] = Math.max(best[j]!, x0[j]! - a.pos.x)));
      }
      for (const b of best) {
        n++;
        step += b;
        if (b >= 1) bit++;
      }
    }
  return { step: step / n, bite: bit / n };
}

const pa = PLAYS.filter((p) => p.pa);
if (process.argv[1]?.includes('pabite')) for (const p of pa) {
  const b = bite(p.id);
  const base = PLAYS.find((q) => q.type === 'dropback' && q.formation.personnel === p.formation.personnel) ?? PLAYS.find((q) => q.type === 'dropback')!;
  const nb = bite(base.id);
  console.log(`${p.id.padEnd(22)} LB step up ${b.step.toFixed(2)} yd, bite ${(b.bite * 100).toFixed(0)}%   vs ${base.id}: ${nb.step.toFixed(2)} yd, ${(nb.bite * 100).toFixed(0)}%`);
}

// Every player is himself: the same fakes against 60 and 95 Play Recognition linebackers.
if (process.argv[1]?.includes('pabite')) {
const lo = pa.map((p) => bite(p.id, 60));
const hi = pa.map((p) => bite(p.id, 95));
const avg = (xs: { step: number; bite: number }[]) => ({ step: xs.reduce((a, x) => a + x.step, 0) / xs.length, bite: xs.reduce((a, x) => a + x.bite, 0) / xs.length });
const [l, h] = [avg(lo), avg(hi)];
console.log(`Play Recognition 60: step up ${l.step.toFixed(2)} yd, bite ${(l.bite * 100).toFixed(0)}%;  95: ${h.step.toFixed(2)} yd, ${(h.bite * 100).toFixed(0)}%`);
}
