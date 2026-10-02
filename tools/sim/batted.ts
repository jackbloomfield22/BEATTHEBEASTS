// The AI pass game's throws at the line and in the air: batted balls, touch
// passes (air put under it) and hang, by route (docs/m66/SLANTS.md).
//   node tools/run-ts.mjs tools/sim/batted.ts [playsPerCell=12] [--zone]
// How each throw ended (caught, broken up, batted at the line, tipped, dropped,
// thrown where nobody got it, picked), and completion by coverage.
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, PASS_PLAYS, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { routeOf } from '../../src/sim/ai.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 12);
const HASHES = [3.08, 0, -3.08];
let att = 0;
let bat = 0;
let touch = 0;
let hang = 0;
const hows: Record<string, number> = {};

const byDef = new Map<string, { n: number; c: number }>();
const by = new Map<string, { n: number; bat: number; touch: number; c: number }>();
for (const play of PASS_PLAYS.filter((p) => !p.situ)) {
  for (const def of DEF_CALLS) {
    if (process.argv.includes('--zone') && ['cover1', 'cover2man', 'cover1blitz', 'cover1off'].includes(def.id)) continue;
    for (let k = 0; k < N; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let route = '';
      let kind = '';
      let h = 0;

      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        stepPlay(s, NEUTRAL);
        if (!route && s.ball.mode === 'air' && s.ball.target >= 0) {
          route = routeOf(s, s.agents[s.ball.target]!) ?? 'none';
          kind = s.ball.kind ?? '';
          h = s.ball.arrive - s.ball.releaseT;

        }
      }
      if (!route) continue;
      att++;
      {
        const r = s.result!;
        const complete = !!r.pass?.complete && !r.pass.intercepted;
        const first = s.events.find((e) => e.type === 'catch' || e.type === 'deflection' || e.type === 'drop' || e.type === 'interception');
        const how = complete ? 'catch' : r.pass?.intercepted ? 'int' : !first ? (s.ball.target === -3 ? 'away' : 'miss') : first.data?.batted ? 'bat' : first.type === 'drop' ? 'drop' : r.pass?.sep !== undefined ? 'pbu' : 'tip';
        hows[how] = (hows[how] ?? 0) + 1;
      }
      hang += h;
      const b = s.events.some((e) => e.type === 'deflection' && e.data?.batted);
      if (b) bat++;
      if (kind === 'touch') touch++;
      const e = by.get(route) ?? { n: 0, bat: 0, touch: 0, c: 0 };
      e.n++;
      if (b) e.bat++;
      if (kind === 'touch') e.touch++;
      if (s.result?.pass?.complete && !s.result.pass.intercepted) e.c++;
      by.set(route, e);

      const f = byDef.get(def.id) ?? { n: 0, c: 0 };
      f.n++;
      if (s.result?.pass?.complete && !s.result.pass.intercepted) f.c++;
      byDef.set(def.id, f);
    }
  }
}
const pc = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
console.log(Object.entries(hows).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pc(v, att)}`).join('  '));
console.log(`attempts ${att}  batted ${pc(bat, att)}  touch ${pc(touch, att)}  hang ${(hang / att).toFixed(2)} s`);
for (const [k, e] of [...by].sort((a, b) => b[1].n - a[1].n)) console.log(`${k.padEnd(10)} n ${String(e.n).padStart(4)} cmp ${pc(e.c, e.n).padStart(6)} batted ${pc(e.bat, e.n).padStart(6)} touch ${pc(e.touch, e.n).padStart(6)}`);
console.log([...byDef].map(([k, e]) => `${k} ${pc(e.c, e.n)}`).join('  '));
