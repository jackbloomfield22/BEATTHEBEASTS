// Passing round 4 (docs/passing/PASSING4.md): does the throw-timing cue tell
// the truth? For each route, coverage and seed, the player presses the key
// the first tick the cue lights ("now": src/render/game/cueRing.ts cueAt),
// and we read when the ball really left his hand against when his man really
// came out of his break (the route point the cue times to). Three QBs: Joe
// Montana (the practice QB), Dan Marino (the quickest release) and Jameis
// Winston (a long one): the cue moves with the arm, the ball doesn't.
//   node tools/run-ts.mjs tools/sim/cuecheck.ts [--seeds=N]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 6);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const QBS = ['Joe Montana', 'Dan Marino', 'Jameis Winston'];
const CASES: { id: string; play: string; icon: number; hot?: RouteName; brk: number }[] = [
  { id: 'slant', play: 'doubles-slants', icon: 1, brk: 0 },
  { id: 'out', play: 'doubles-curls', icon: 1, hot: 'out', brk: 0 },
  { id: 'qout', play: 'singleback-quick-outs', icon: 1, brk: 0 },
  { id: 'dig', play: 'singleback-drive', icon: 2, brk: 0 },
  { id: 'curl', play: 'doubles-curls', icon: 1, brk: 0 },
  { id: 'post', play: 'singleback-pa-post', icon: 1, brk: 0 },
  { id: 'cross', play: 'trips-y-cross', icon: 1, brk: 1 },
  { id: 'comeback', play: 'doubles-curls', icon: 1, hot: 'comeback', brk: 0 },
];
const DEFS = ['cover3', 'cover1', 'cover2', 'cover4'];
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);
console.log('case      QB              n   press  ball out  break   ball − break (mean, |max|)');
for (const c of CASES) {
  for (const name of QBS) {
    const offense = { ...base.offense, QB: simPlayer(findStint(snap, name, 'QB')!, 16) };
    const rows: { press: number; rel: number; brk: number }[] = [];
    for (const def of DEFS)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s: PlayState = createPlay({ seed, offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
        let press = -1;
        let brk = -1;
        let tgt = -1;
        for (let k = 0; k < 600 && !s.result && s.phase !== 'air'; k++) {
          let f: InputFrame;
          if (s.phase === 'presnap') f = input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
          else {
            const a = s.agents[s.icons[c.icon - 1]!]!;
            tgt = a.i;
            const q = throwCue(s, a);
            if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
            f = input({ throwHeld: press >= 0 && s.t < press + 4 / 60 ? c.icon : 0 });
          }
          stepPlay(s, f);
          if (tgt >= 0 && brk < 0 && (s.agents[tgt]!.route?.idx ?? 0) > c.brk) brk = s.t;
        }
        const th = s.events.find((e) => e.type === 'throw');
        // (The break after the throw: run the unthrown man on? The thrown man runs his route through the break: read it on.)
        for (let k = 0; k < 200 && brk < 0 && !s.result; k++) {
          stepPlay(s, input({}));
          if ((s.agents[tgt]!.route?.idx ?? 0) > c.brk) brk = s.t;
        }
        if (!th || press < 0 || brk < 0) continue;
        rows.push({ press: press - s.snapT, rel: th.t - s.snapT, brk: brk - s.snapT });
      }
    const m = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
    const worst = rows.reduce((w, r) => Math.max(w, Math.abs(r.rel - r.brk)), 0);
    console.log(`${c.id.padEnd(9)} ${name.padEnd(15)} ${String(rows.length).padStart(2)}  ${m((r) => r.press).toFixed(2)}   ${m((r) => r.rel).toFixed(2)}     ${m((r) => r.brk).toFixed(2)}   ${f2(m((r) => r.rel - r.brk))} ${worst.toFixed(2)}`);
  }
}
