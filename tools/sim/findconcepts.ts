// Find the plays for the ten broadcast concept videos (M6.5): for each
// concept, its play and target, every coverage, a range of seeds and throw
// times, played with the concept script (src/game/clips.ts concept()) the
// way the browser plays it. Keeps the ones a coach would show: the target
// caught it, on his route after the break (the ball on time: it arrives
// within 0.6 s of the break), open (1.2+ yd), and gained at least the
// route's depth. Prints the best few per concept.
//   node tools/run-ts.mjs tools/sim/findconcepts.ts [seeds] [--only=slant]
import { readFileSync } from 'node:fs';
import { createPlay, defById, DEF_CALLS, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { concept, type ConceptPlan } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const SEEDS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 24);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

export interface ConceptSpec {
  id: string;
  play: string;
  icon: number;
  /** Throw times to try (ticks after the snap). */
  ats: number[];
  /** Least gain (yd). */
  min: number;
  plan?: Partial<ConceptPlan>;
  /** The catch must come off the break (timing routes): the ball arrives within this long after it (s). A go or a screen has none. */
  timing?: number;
  /** Back-shoulder placement must show (the throw's place). */
  backShoulder?: boolean;
  scramble?: boolean;
}
const range = (a: number, b: number, step: number) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, k) => a + k * step);

export const SPECS: ConceptSpec[] = [
  { id: 'slant', play: 'doubles-slants', icon: 1, ats: range(30, 80, 4), min: 6, timing: 0.7 },
  { id: 'out', play: 'doubles-quick-outs', icon: 1, ats: range(30, 90, 4), min: 5, timing: 0.7 },
  { id: 'curl', play: 'doubles-curls', icon: 1, ats: range(60, 130, 5), min: 10, timing: 0.7, plan: { call: 'possession' } },
  { id: 'go', play: 'trips-four-verts', icon: 3, ats: range(70, 140, 5), min: 25, plan: { hold: 16 } },
  { id: 'post', play: 'singleback-pa-post', icon: 1, ats: range(80, 160, 5), min: 18, timing: 1.5, plan: { hold: 10 } },
  { id: 'corner', play: 'doubles-smash', icon: 1, ats: range(60, 140, 5), min: 14, timing: 1.5, plan: { hold: 14 } },
  { id: 'crosser', play: 'trips-y-cross', icon: 1, ats: range(80, 150, 5), min: 12, timing: 1.2 },
  { id: 'screen', play: 'doubles-rb-screen', icon: 1, ats: range(60, 120, 4), min: 6 },
  { id: 'back-shoulder', play: 'trips-four-verts', icon: 4, ats: range(70, 130, 5), min: 12, backShoulder: true, plan: { aim: { x: -1, y: -0.2 }, call: 'aggressive' } },
  { id: 'scramble-drill', play: 'trips-y-cross', icon: 0, ats: range(150, 230, 8), min: 8, scramble: true },
];

interface Hit { id: string; def: string; seed: number; at: number; icon: number; yards: number; sep: number; lag: number; air: number; td: boolean; plan: ConceptPlan }

export function tryOne(spec: ConceptSpec, def: string, seed: number, at: number, icon: number, dir = 1): Hit | null {
  const plan: ConceptPlan = { icon, at, ...spec.plan, ...(spec.scramble ? { scramble: { at: 110, dir: { x: 0.25, y: dir } } } : {}) };
  const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(spec.play), def: defById(def), los: 30, toGo: 10, user: true });
  const tgt = s.icons[icon - 1]!;
  let breakT = -1;
  const script = concept(plan);
  // The break: the first time after his release that his run turns 22°+ within a quarter second at speed.
  const hist: { x: number; y: number }[] = [];
  runToWhistle(s, (st) => {
    const a = st.agents[tgt]!;
    if (st.snapT >= 0 && st.phase !== 'carrier') {
      hist.push({ x: a.vel.x, y: a.vel.y });
      const was = hist[hist.length - 16];
      const sp = Math.hypot(a.vel.x, a.vel.y);
      if (breakT < 0 && was && st.t - st.snapT > 0.5 && sp > 3 && Math.hypot(was.x, was.y) > 3) {
        const cos = (was.x * a.vel.x + was.y * a.vel.y) / (Math.hypot(was.x, was.y) * sp);
        if (cos < Math.cos((22 * Math.PI) / 180)) breakT = st.t;
      }
    }
    return script(st);
  });
  const res = s.result;
  const p = res?.pass;
  if (!res || !p?.complete || p.target !== tgt) return null;
  const c = s.events.find((e) => e.type === 'catch');
  if (!c) return null;
  const th = s.events.find((e) => e.type === 'throw');
  if (spec.backShoulder && !(Number(th?.data?.place ?? 0) < -0.5)) return null;
  if (spec.scramble && !(s.scrambleT > 0)) return null;
  const lag = breakT < 0 ? 9 : c.t - breakT;
  if (spec.timing && (breakT < 0 || lag < 0 || lag > spec.timing)) return null;
  if (p.sep === undefined || p.sep < 1.2 || res.yards < spec.min) return null;
  return { id: spec.id, def, seed, at, icon, yards: res.yards, sep: p.sep, lag, air: p.airYards, td: res.touchdown, plan };
}

if (process.argv[1]?.endsWith('findconcepts.ts')) {
  for (const spec of SPECS.filter((x) => !ONLY || x.id === ONLY)) {
    const hits: Hit[] = [];
    for (const d of DEF_CALLS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const at of spec.ats) {
          for (const icon of spec.scramble ? [1, 2, 3, 4, 5] : [spec.icon]) {
            for (const dir of spec.scramble ? [1, -1] : [1]) {
              const h = tryOne(spec, d.id, seed, at, icon, dir);
              if (h) hits.push(h);
            }
          }
        }
      }
    }
    // A clean look: open but not wide open, on time, a real gain but not a 70-yard fluke (unless it's the go).
    const score = (h: Hit) => -Math.abs(h.sep - 2.5) - (spec.timing ? h.lag * 3 : 0) - Math.max(0, h.yards - spec.min - 25) * 0.1;
    hits.sort((a, b) => score(b) - score(a));
    console.log(`\n${spec.id} (${spec.play}): ${hits.length} candidates`);
    for (const h of hits.slice(0, 5)) console.log(`  ${h.def.padEnd(12)} seed ${String(h.seed).padStart(3)} at ${h.at} icon ${h.icon}${h.plan.scramble ? ` scramble ${JSON.stringify(h.plan.scramble.dir)}` : ''}: ${h.yards.toFixed(1)} yd (air ${h.air.toFixed(1)}), sep ${h.sep.toFixed(2)}, ball ${h.lag.toFixed(2)} s after the break${h.td ? ' TD' : ''}`);
  }
}
