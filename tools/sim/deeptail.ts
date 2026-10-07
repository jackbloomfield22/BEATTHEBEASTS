// Why deep balls complete (docs/passing/PASSING2.md, item 6): the AI pass
// game's attempts by depth of target (air yards at the aim), completion and
// interception by depth, and for the 40+ completions where they come from:
// the air yards and the run after, the route, how open he was, how far the
// nearest deep defender was from the catch point at the throw and at the
// catch, and the hang time. NFL reference (NGS/PFF, 2018–2023): ~11–12% of
// attempts travel 20+ air yards and ~4–5% 30+; 20–29 yd complete ~45%,
// 30–39 ~35%, 40+ ~25%; ~3% of completions gain 40+.
//   node tools/run-ts.mjs tools/sim/deeptail.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, practiceRosters, stepPlay, NEUTRAL, PASS_PLAYS, DEF_CALLS, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor, cellSeed } from '../../src/sim/outcomes.ts';
import { routeOf } from '../../src/sim/ai.ts';
import { dist } from '../../src/sim/vec.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const n = Number(process.argv[2] ?? 20);
const HASHES = [3.08, 0, -3.08];
const BUCKETS = [-99, 0, 10, 20, 30, 40];
const by = BUCKETS.map(() => ({ att: 0, comp: 0, int: 0, yds: 0, hang: 0, sep: 0, safeAtThrow: 0, ttt: [] as number[], late: 0, past: 0, yac: 0, routes: new Map<string, number>() }));
const tail: string[] = [];
const tailStats = { n: 0, air: 0, yac: 0, sep: 0, safeThrow: 0, safeCatch: 0, hang: 0, over: 0, routes: new Map<string, number>() };
let comps = 0;
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock)) {
  for (const def of DEF_CALLS) {
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(r, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let aimAir = NaN;
      let hang = NaN;
      let safeThrow = NaN;
      let safeCatch = NaN;
      let route = '';
      let ttt = NaN;
      let late = false;
      let past = false;
      const deepDef = () => {
        // The deepest two defenders at the throw: the safeties' help over the top.
        return [...s.def].sort((a, b) => s.agents[b]!.pos.x - s.agents[a]!.pos.x).slice(0, 2);
      };
      let deep: number[] = [];
      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        stepPlay(s, NEUTRAL);
        if (Number.isNaN(aimAir) && s.ball.mode === 'air' && s.ball.target >= 0) {
          aimAir = s.ball.aim.x - s.setup.los;
          hang = s.ball.arrive - s.t;
          deep = deepDef();
          safeThrow = Math.min(...deep.map((i) => dist(s.agents[i]!.pos, s.ball.aim)));
          route = routeOf(s, s.agents[s.ball.target]!) ?? '?';
          ttt = s.ball.releaseT - s.snapT;
          late = s.read.idx >= s.icons.length;
          const rt = s.agents[s.ball.target]!.route;
          past = !!rt && rt.idx >= rt.pts.length;
        }
        if (Number.isNaN(safeCatch) && s.pass?.complete && s.carrier >= 0 && deep.length) safeCatch = Math.min(...deep.map((i) => dist(s.agents[i]!.pos, s.agents[s.carrier]!.pos)));
      }
      const res = s.result!;
      if (!res.pass?.attempted || Number.isNaN(aimAir)) continue;
      const j = BUCKETS.findLastIndex((b) => aimAir >= b);
      const row = by[j]!;
      const complete = res.pass.complete && !res.pass.intercepted;
      row.att++;
      row.hang += hang;
      row.sep += Math.min(10, res.pass.sep ?? 0);
      row.safeAtThrow += Math.min(30, safeThrow);
      row.ttt.push(ttt);
      if (late) row.late++;
      if (past) row.past++;
      row.routes.set(route, (row.routes.get(route) ?? 0) + 1);
      if (complete) {
        row.comp++;
        row.yds += res.yards;
        row.yac += res.yards - ((s.events.find((e) => e.type === 'catch')?.at?.x ?? s.setup.los) - s.setup.los);
        comps++;
      }
      if (res.pass.intercepted) row.int++;
      if (complete && res.yards >= 40) {
        const air = (s.events.find((e) => e.type === 'catch')?.at?.x ?? s.setup.los) - s.setup.los;
        const look = String(s.events.find((e) => e.type === 'catch')?.data?.look ?? '');
        tailStats.n++;
        tailStats.air += air;
        tailStats.yac += res.yards - air;
        tailStats.sep += Math.min(10, res.pass.sep ?? 0);
        tailStats.safeThrow += Math.min(30, safeThrow);
        tailStats.safeCatch += Math.min(30, safeCatch);
        tailStats.hang += hang;
        if (look === 'overShoulder') tailStats.over++;
        tailStats.routes.set(route, (tailStats.routes.get(route) ?? 0) + 1);
        if (tail.length < 40) tail.push(`${play.id} ${def.id} ${k}: ${route} air ${air.toFixed(0)} yac ${(res.yards - air).toFixed(0)} sep ${res.pass.sep} contest ${res.pass.contest} safety ${safeThrow.toFixed(1)} → ${safeCatch.toFixed(1)} yd hang ${hang.toFixed(2)} ${look}`);
      }
    }
  }
}
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const att = by.reduce((t, b) => t + b.att, 0);
console.log('aim air yd   share   cmp     int    ypa   yac   hang  sep  deepD  ttt   late  pastRoute  routes');
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN);
BUCKETS.forEach((b, j) => {
  const x = by[j]!;
  console.log(`${String(b < -50 ? '<0' : b).padStart(4)}+       ${pct(x.att, att).padStart(6)} ${pct(x.comp, x.att).padStart(6)} ${pct(x.int, x.att).padStart(6)} ${(x.yds / Math.max(1, x.att)).toFixed(1).padStart(5)} ${(x.yac / Math.max(1, x.comp)).toFixed(1).padStart(5)} ${(x.hang / Math.max(1, x.att)).toFixed(2)} ${(x.sep / Math.max(1, x.att)).toFixed(1)}  ${(x.safeAtThrow / Math.max(1, x.att)).toFixed(1).padStart(5)}  ${med(x.ttt).toFixed(2)} ${pct(x.late, x.att).padStart(6)} ${pct(x.past, x.att).padStart(6)}  ${[...x.routes].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}`);
});
const t = tailStats;
const m = (x: number) => (x / Math.max(1, t.n)).toFixed(1);
console.log(`\n40+ completions: ${t.n} of ${comps} (${pct(t.n, comps)}); air ${m(t.air)} yac ${m(t.yac)} sep ${m(t.sep)}; nearest deep defender ${m(t.safeThrow)} yd from the aim at the throw, ${m(t.safeCatch)} from him at the catch; hang ${(t.hang / Math.max(1, t.n)).toFixed(2)} s; over the shoulder ${pct(t.over, t.n)}`);
console.log('routes: ' + [...t.routes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
if (process.argv.includes('--list')) console.log(tail.join('\n'));
