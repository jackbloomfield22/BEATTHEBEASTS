// Find the plays for the passing round 2 videos (docs/passing/PASSING2.md):
// the drops and the hitch, the look-off, the receiver's head, the bobble and
// the arm, each played with the concept script the browser plays.
//   node tools/run-ts.mjs tools/sim/findpassing2.ts [seeds] [--only=bobble]
import { readFileSync } from 'node:fs';
import { createPlay, defById, playById, practiceRosters, runToWhistle, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { concept, type ConceptPlan } from '../../src/game/clips.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const SEEDS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 30);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const qb = (name: string) => ({ ...r.offense, QB: simPlayer(findStint(snap, name, 'QB')!, 16) });

interface Spec {
  id: string;
  play: string;
  defs: string[];
  plan: ConceptPlan;
  qbs?: string[];
  keep(s: PlayState): boolean;
}
const pass = (s: PlayState) => s.result?.pass;
const caught = (s: PlayState) => !!pass(s)?.complete;
const look = (s: PlayState) => String(s.events.find((e) => e.type === 'catch')?.data?.look ?? '');
const SPECS: Spec[] = [
  { id: 'drop5', play: 'singleback-drive', defs: ['cover3', 'cover4', 'cover2'], plan: { icon: 2, at: 100 }, keep: caught },
  { id: 'drop3', play: 'singleback-quick-outs', defs: ['cover3', 'cover4', 'cover1off'], plan: { icon: 1, at: 58 }, keep: caught },
  { id: 'drop7', play: 'iform-pa-deep-shot', defs: ['cover3', 'cover1', 'cover4'], plan: { icon: 1, at: 118 }, keep: caught },
  { id: 'gunslant', play: 'doubles-slants', defs: ['cover4', 'cover3', 'cover2'], plan: { icon: 1, at: 36 }, keep: caught },
  { id: 'shoulder', play: 'trips-four-verts', defs: ['cover3', 'firezone', 'cover1'], plan: { icon: 3, at: 90, hold: 16 }, keep: (s) => caught(s) && look(s) === 'overShoulder' },
  { id: 'lookoff', play: 'singleback-pa-post', defs: ['cover3', 'cover1', 'firezone'], plan: { icon: 1, at: 108 }, qbs: ['Dan Marino', 'Jameis Winston'], keep: (s) => !!pass(s)?.attempted },
  { id: 'arm', play: 'trips-four-verts', defs: ['firezone', 'cover3'], plan: { icon: 3, at: 90, hold: 16 }, qbs: ['Dan Marino', 'Joe Montana'], keep: (s) => !!pass(s)?.attempted },
];
// The bobble: any of these throws whose ball is juggled.
const BOBBLE: [string, number, number][] = [['doubles-slants', 1, 36], ['doubles-quick-outs', 1, 34], ['doubles-curls', 1, 60], ['singleback-drive', 2, 100], ['bunch-snag', 1, 46], ['empty-quick', 2, 40]];

for (const sp of SPECS) {
  if (ONLY && !ONLY.split(',').includes(sp.id)) continue;
  for (const def of sp.defs) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const runs = (sp.qbs ?? ['']).map((name) => runToWhistle(createPlay({ seed, offense: name ? qb(name) : r.offense, defense: r.defense, play: playById(sp.play), def: defById(def), los: 30, toGo: 10, user: true }), concept(sp.plan)));
      if (!runs.every((s) => sp.keep(s))) continue;
      const desc = runs.map((s) => {
        const p = pass(s)!;
        const th = s.events.find((e) => e.type === 'throw');
        const ev = s.events.filter((e) => ['catch', 'bobble', 'drop', 'deflection', 'interception'].includes(e.type)).map((e) => e.type + (e.data?.look ? `(${e.data.look})` : '')).join(' ');
        return `${p.complete ? 'caught' : p.intercepted ? 'INT' : 'inc'} ${s.result!.yards} yd air ${p.airYards} sep ${p.sep} T ${(s.ball.arrive - s.ball.releaseT).toFixed(2)} ${th?.data?.kind} | ${ev}`;
      });
      console.log(`${sp.id} ${def} seed ${seed}: ${desc.join('  ||  ')}`);
    }
  }
}
if (!ONLY || ONLY.includes('bobble')) {
  for (const [play, icon, at] of BOBBLE) {
    for (const def of ['cover3', 'cover4', 'cover2', 'cover1', 'tampa2']) {
      for (let seed = 1; seed <= SEEDS * 3; seed++) {
        const s = runToWhistle(createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play), def: defById(def), los: 30, toGo: 10, user: true }), concept({ icon, at }));
        if (!s.events.some((e) => e.type === 'bobble')) continue;
        console.log(`bobble ${play} ${def} seed ${seed} icon ${icon} at ${at}: ${caught(s) ? 'caught' : 'not caught'} ${s.result!.yards} yd | ${s.events.filter((e) => ['catch', 'bobble', 'drop', 'deflection', 'interception'].includes(e.type)).map((e) => e.type).join(' ')}`);
      }
    }
  }
}
