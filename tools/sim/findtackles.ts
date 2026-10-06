// Find the plays for the tackling videos (docs/physics/TACKLING.md): each
// moment the physics is about, on a play the browser sets up exactly as
// Node does (the clip's swap, seed and coverage; src/game/clips.ts PHYSICS).
// Prints the best few seeds per moment.
//   node tools/run-ts.mjs tools/sim/findtackles.ts [seeds] [--only=tackle-gang]
import { input, NEUTRAL, type PlayState, type SimEvent } from '../../src/sim/index.ts';
import { concept, runAtBody, type Swap } from '../../src/game/clips.ts';
import { playClip } from './findidentity.ts';

const SEEDS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 60);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

interface Spec {
  id: string;
  swap: Swap;
  plays: string[];
  defs: string[];
  user: boolean;
  script(playId: string): (s: PlayState) => ReturnType<typeof input>;
  score(s: PlayState): number | null;
  note(s: PlayState): string;
}

const RUNS = ['iform-power', 'singleback-inside-zone', 'heavy-power', 'singleback-power', 'iform-iso', 'heavy-dive', 'singleback-counter', 'iform-toss', 'pistol-stretch'];
const DEFS = ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man', 'firezone'];
const ai = () => () => NEUTRAL;
const ev = (s: PlayState, type: SimEvent['type']) => s.events.filter((e) => e.type === type);
const tackle = (s: PlayState) => ev(s, 'tackle').at(-1);
const firstHit = (s: PlayState) => s.events.find((e) => e.type === 'hit' && !e.data?.join);
const yards = (s: PlayState) => s.result?.yards ?? 0;

export const SPECS: Spec[] = [
  {
    // A big back wrapped up falls forward for the extra yard (a solo tackle, from the front or side).
    id: 'tackle-fall-forward',
    swap: { off: 'RB', name: 'Jerome Bettis', pos: 'RB' },
    plays: RUNS,
    defs: DEFS,
    user: false,
    script: ai,
    score: (s) => {
      const t = tackle(s);
      const h = firstHit(s);
      if (!t || !h || t.data?.fall !== 'forward' || Number(t.data?.gang) !== 1 || ev(s, 'brokenTackle').length) return null;
      const after = (s.result?.spot ?? 0) - h.at!.x;
      if (after < 1.6 || yards(s) < 3 || yards(s) > 12) return null;
      return after + (h.data?.side === 'front' ? 1 : 0);
    },
    note: (s) => `${yards(s)} yd, hit ${firstHit(s)?.data?.kind} from the ${firstHit(s)?.data?.side}, after contact ${((s.result?.spot ?? 0) - (firstHit(s)?.at?.x ?? 0)).toFixed(1)}, ${tackle(s)?.data?.wrapT} s to the fall`,
  },
  {
    // Three men in on it; the pile moves.
    id: 'tackle-gang',
    swap: { off: 'RB', name: 'Derrick Henry', pos: 'RB' },
    plays: RUNS,
    defs: DEFS,
    user: false,
    script: ai,
    score: (s) => {
      const t = tackle(s);
      if (!t || Number(t.data?.gang) < 3) return null;
      return Number(t.data?.gang) * 2 + Number(t.data?.wrapT ?? 0);
    },
    note: (s) => `${yards(s)} yd, ${tackle(s)?.data?.gang} in on it, ${tackle(s)?.data?.wrapT} s from the first hold, fell ${tackle(s)?.data?.fall}`,
  },
  {
    // An arm tackle he runs through, and the run goes on.
    id: 'tackle-arm-broken',
    swap: { off: 'RB', name: 'Barry Sanders', pos: 'RB' },
    plays: RUNS,
    defs: DEFS,
    user: false,
    script: ai,
    score: (s) => {
      const b = ev(s, 'brokenTackle').find((e) => e.data?.how === 'runThrough' || e.data?.how === 'shed' || e.data?.how === 'runOver');
      if (!b || !s.result) return null;
      const on = s.result.spot - b.at!.x;
      // (A run that goes on 6–20 yd after it: the break is the moment, and a short video renders.)
      if (on < 6 || on > 20) return null;
      return 20 - Math.abs(on - 10) + (b.data?.flat ? 3 : 0);
    },
    note: (s) => {
      const b = ev(s, 'brokenTackle')[0];
      return `${yards(s)} yd, broke it (${b?.data?.how}${b?.data?.flat ? ', flat' : ''}) at ${(b?.at?.x ?? 0) - 30 > 0 ? '+' : ''}${((b?.at?.x ?? 0) - 30).toFixed(1)}`;
    },
  },
  {
    // A big hit from a Hit Power safety: stopped cold.
    id: 'tackle-big-hit',
    swap: { def: 'SS', name: 'Kam Chancellor', pos: 'S' },
    plays: [...RUNS, 'trips-stick', 'doubles-slants', 'doubles-curls'],
    defs: DEFS,
    user: false,
    script: ai,
    score: (s) => {
      const h = s.events.find((e) => e.type === 'hit' && e.data?.big);
      if (!h || !s.result) return null;
      const by = s.agents[h.who![0]!]!;
      if (by.slot !== 'SS') return null;
      return Number(h.data?.imp ?? 0) / 100 + (tackle(s)?.data?.fall === 'back' ? 3 : 0);
    },
    note: (s) => {
      const h = s.events.find((e) => e.type === 'hit' && e.data?.big);
      return `${yards(s)} yd, impulse ${h?.data?.imp} N·s, fell ${tackle(s)?.data?.fall}`;
    },
  },
  {
    // Over a man on the turf.
    id: 'tackle-hurdle',
    swap: { off: 'RB', name: 'Barry Sanders', pos: 'RB' },
    plays: RUNS,
    defs: DEFS,
    user: true,
    script: () => runAtBody,
    score: (s) => {
      const h = s.events.find((e) => e.type === 'move' && e.data?.move === 'hurdle' && e.data?.over !== undefined);
      return h ? 10 + yards(s) * 0.1 : null;
    },
    note: (s) => `${yards(s)} yd, hurdled ${s.events.find((e) => e.type === 'move' && e.data?.move === 'hurdle')?.data?.over}`,
  },
  {
    // A receiver met square by a safety coming downhill: driven back (the spot is his forward progress).
    id: 'tackle-driven-back',
    swap: { def: 'SS', name: 'Kam Chancellor', pos: 'S' },
    plays: ['doubles-slants', 'trips-stick', 'doubles-curls', 'bunch-bubble', 'doubles-quick-outs'],
    defs: DEFS,
    user: true,
    script: (p) => concept({ icon: 1, at: p === 'doubles-curls' ? 60 : 30 }),
    score: (s) => {
      const t = tackle(s);
      if (!t || t.data?.fall !== 'back' || !s.result?.pass?.complete) return null;
      const c = s.agents[t.who![1]!]!;
      if (c.p.pos !== 'WR') return null;
      return 5 - Math.abs(Number(t.data?.gang ?? 1) - 1);
    },
    note: (s) => `${yards(s)} yd, fell ${tackle(s)?.data?.fall}, ${tackle(s)?.data?.kind}`,
  },
];

if (process.argv[1]?.endsWith('findtackles.ts')) {
  for (const spec of SPECS) {
    if (ONLY && spec.id !== ONLY) continue;
    const found: { score: number; line: string }[] = [];
    for (const play of spec.plays) for (const def of spec.defs) for (let seed = 1; seed <= SEEDS; seed++) {
      let s: PlayState;
      try {
        s = playClip(play, def, seed, spec.user, spec.swap, spec.script(play));
      } catch {
        continue;
      }
      const sc = spec.score(s);
      if (sc !== null) found.push({ score: sc, line: `${play} ${def} seed ${seed}: ${spec.note(s)}` });
    }
    found.sort((a, b) => b.score - a.score);
    console.log(`== ${spec.id} (${found.length} found)`);
    for (const f of found.slice(0, 5)) console.log(`  ${f.score.toFixed(1)}  ${f.line}`);
  }
}
