// Find the plays for the passing videos (docs/passing/PASSING.md): one per
// moment of the passing game a fan would watch for, played with the concept
// script (src/game/clips.ts concept()) the way the browser plays it.
//   node tools/run-ts.mjs tools/sim/findpassing.ts [seeds] [--only=dig,touch]
// Prints the best few per moment; the chosen ones go in PASSING (clips.ts).
import { readFileSync } from 'node:fs';
import { createPlay, defById, DEF_CALLS, playById, practiceRosters, runToWhistle, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { concept, type ConceptPlan } from '../../src/game/clips.ts';
import { dist } from '../../src/sim/vec.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const SEEDS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 20);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

interface Seen {
  s: PlayState;
  /** At the release: the QB's speed, the pressure factor on the cone, the LB under the ball's path. */
  qbSpeed: number;
  fPressure: number;
  fMoving: number;
  under: boolean;
  kind: string;
  air: number;
}
interface Spec {
  id: string;
  plays: [string, number][];
  ats: number[];
  plan?: Partial<ConceptPlan>;
  /** Keep it (and a score: higher is better), or null. */
  keep(v: Seen): number | null;
}
const range = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, k) => a + k * step);
const done = (v: Seen) => v.s.result?.pass;
const caught = (v: Seen) => !!done(v)?.complete;

const SPECS: Spec[] = [
  // The dig: a 12–16 yd in-breaker caught over the middle, on time.
  { id: 'dig', plays: [['doubles-dagger', 1], ['empty-levels', 1], ['singleback-drive', 2], ['bunch-flood', 4], ['h-chip-flat', 1]], ats: range(60, 110, 5), keep: (v) => (caught(v) && v.air >= 10 && v.air <= 18 && Math.abs(v.s.agents[done(v)!.target]!.pos.y) < 9 ? -Math.abs((done(v)!.sep ?? 0) - 1.8) : null) },
  // The deep post: 25+ yd in the air, caught.
  { id: 'post', plays: [['singleback-pa-post', 1], ['iform-pa-deep-shot', 1], ['singleback-pa-yankee', 2], ['trips-y-cross', 3]], ats: range(80, 150, 5), plan: { hold: 12 }, keep: (v) => (caught(v) && v.air >= 24 ? v.air / 10 - Math.abs((done(v)!.sep ?? 0) - 2) : null) },
  // Touch over a linebacker: a lofted ball with an underneath defender under its path, caught behind him.
  { id: 'touch', plays: [['trips-four-verts', 1], ['trips-four-verts', 2], ['ace-te-seam', 1], ['doubles-hitch-seam', 3], ['doubles-dagger', 3]], ats: range(60, 110, 5), plan: { hold: 20 }, keep: (v) => (caught(v) && v.kind === 'touch' && v.under && v.air >= 12 ? -Math.abs(v.air - 18) / 5 : null) },
  // On the run: the boot, thrown on the move outside the pocket.
  { id: 'onrun', plays: [['pistol-pa-boot', 1], ['pistol-pa-boot', 2], ['pistol-pa-boot', 3]], ats: range(80, 130, 4), keep: (v) => (caught(v) && v.qbSpeed > 3 && v.fMoving > 1.05 ? v.qbSpeed : null) },
  // Under pressure: a rusher on him as he lets it go.
  { id: 'pressure', plays: [['trips-four-verts', 1], ['doubles-dagger', 1], ['doubles-smash', 1], ['doubles-curls', 1], ['trips-y-cross', 1]], ats: range(110, 200, 6), keep: (v) => (done(v)?.attempted && v.fPressure > 1.6 ? v.fPressure + (caught(v) ? 0 : 0.3) : null) },
  // The contested catch: a defender on him at the ball, caught.
  { id: 'contested', plays: [['trips-four-verts', 3], ['trips-four-verts', 4], ['doubles-dagger', 2], ['doubles-curls', 1], ['doubles-smash', 1]], ats: range(50, 110, 5), plan: { call: 'aggressive' }, keep: (v) => (caught(v) && (done(v)!.contest ?? 0) > 0.6 ? done(v)!.contest! : null) },
  // The drop: an open ball off his hands.
  { id: 'drop', plays: [['doubles-slants', 1], ['doubles-curls', 1], ['trips-stick', 1], ['doubles-quick-outs', 1], ['doubles-dagger', 1], ['empty-levels', 1]], ats: range(30, 100, 5), keep: (v) => (v.s.events.some((e) => e.type === 'drop' && e.who?.[0] === done(v)?.target) && (done(v)?.sep ?? 0) > 1.2 ? done(v)!.sep! : null) },
];

function run(play: string, icon: number, def: string, seed: number, at: number, plan: Partial<ConceptPlan> = {}): Seen {
  const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true });
  const script = concept({ icon, at, ...plan });
  const v: Seen = { s, qbSpeed: 0, fPressure: 1, fMoving: 1, under: false, kind: '', air: 0 };
  let thrown = false;
  runToWhistle(s, (st) => {
    if (!thrown && st.phase === 'air') {
      thrown = true;
      const qb = st.agents[st.qb]!;
      v.qbSpeed = Math.hypot(qb.vel.x, qb.vel.y);
      const th = st.events.find((e) => e.type === 'throw');
      v.fPressure = Number(th?.data?.fPressure ?? 1);
      v.fMoving = Number(th?.data?.fMoving ?? 1);
      v.kind = String(th?.data?.kind ?? '');
      v.air = Number(th?.data?.air ?? 0);
      // An underneath defender (a linebacker or nickel) within 1.5 yd of the ball's ground track, 30–80% of the way.
      const b = st.ball;
      for (const i of st.def) {
        const d = st.agents[i]!;
        if (d.p.pos !== 'LB' && d.p.pos !== 'CB' && d.p.pos !== 'S') continue;
        for (const u of [0.3, 0.45, 0.6, 0.75]) {
          const px = b.pos.x + (b.aim.x - b.pos.x) * u;
          const py = b.pos.y + (b.aim.y - b.pos.y) * u;
          if (dist(d.pos, { x: px, y: py }) < 1.5 && d.p.pos === 'LB') v.under = true;
        }
      }
    }
    return script(st);
  });
  return v;
}

for (const spec of SPECS.filter((x) => !ONLY || ONLY.split(',').includes(x.id))) {
  const hits: { play: string; icon: number; def: string; seed: number; at: number; score: number; yards: number; air: number; sep: number; why: string }[] = [];
  for (const d of DEF_CALLS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const at of spec.ats) {
        for (const [play, icon] of spec.plays) {
          const v = run(play, icon, d.id, seed, at, spec.plan);
          const sc = spec.keep(v);
          if (sc === null) continue;
          const p = v.s.result!.pass!;
          const th = v.s.events.find((e) => e.type === 'throw');
          hits.push({ play, icon, def: d.id, seed, at, score: sc, yards: v.s.result!.yards, air: p.airYards, sep: p.sep ?? -1, why: `${v.kind} press ${v.fPressure.toFixed(2)} mov ${v.fMoving.toFixed(2)} qbv ${v.qbSpeed.toFixed(1)} contest ${(p.contest ?? 0).toFixed(2)} ${th?.data?.why ?? ''}${p.complete ? ' caught' : p.intercepted ? ' INT' : ' inc'}` });
        }
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  console.log(`\n${spec.id}: ${hits.length} candidates`);
  for (const h of hits.slice(0, 6)) console.log(`  ${h.play.padEnd(22)} ${h.def.padEnd(12)} seed ${String(h.seed).padStart(3)} at ${h.at} icon ${h.icon}: ${h.yards.toFixed(1)} yd (air ${h.air.toFixed(1)}), sep ${h.sep.toFixed(2)} | ${h.why}`);
}
