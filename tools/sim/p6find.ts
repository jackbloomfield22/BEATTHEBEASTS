// Passing round 6: plays for the videos. The player's throw on the cue to
// each route (p6lead.ts's cases), per coverage and seed: the tick (since the
// snap) the key goes down, what happened and how the catch is drawn.
//   node tools/run-ts.mjs tools/sim/p6find.ts [--seeds=12] [--cases=go] [--defs=cover3] [--qb=Name]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { catchStyle } from '../../src/sim/catchstyle.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 12);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const QB = args.get('qb');
const offense = QB ? { ...base.offense, QB: simPlayer(findStint(snap, QB, 'QB')!, 16) } : base.offense;
const ALL: { id: string; play: string; icon: number; hot?: RouteName }[] = [
  { id: 'go', play: 'trips-four-verts', icon: 4 },
  { id: 'goz', play: 'trips-four-verts', icon: 3 },
  { id: 'post', play: 'singleback-pa-post', icon: 1 },
  { id: 'corner', play: 'doubles-smash', icon: 1 },
  { id: 'cross', play: 'trips-y-cross', icon: 1 },
  { id: 'out', play: 'doubles-curls', icon: 1, hot: 'out' },
  { id: 'outz', play: 'doubles-curls', icon: 2, hot: 'out' },
];
const want = args.get('cases')?.split(',');
const DEFS = (args.get('defs') ?? 'cover3,cover1,cover2,cover4').split(',');
const HOLD = Number(args.get('hold') ?? 4);
for (const c of want ? ALL.filter((x) => want.includes(x.id)) : ALL)
  for (const def of DEFS)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createPlay({ seed, offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
      let press = -1;
      let style = '';
      for (let k = 0; k < 900 && !s.result; k++) {
        let f: InputFrame;
        if (s.phase === 'presnap') f = input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
        else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
        else if (s.phase === 'air') {
          if (!style && s.ball.target >= 0 && s.ball.arrive - s.t <= 0.3) style = catchStyle(s, s.agents[s.ball.target]!);
          f = input({ catchType: 'rac' });
        } else {
          const a = s.agents[s.icons[c.icon - 1]!]!;
          const q = throwCue(s, a);
          if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.tick;
          f = input({ throwHeld: press >= 0 && s.tick < press + HOLD ? c.icon : 0 });
        }
        stepPlay(s, f);
      }
      const p = s.result?.pass;
      const bob = s.events.some((e) => e.type === 'bobble') ? ' (bobbled)' : '';
      const out = (!p?.attempted ? 'no throw' : p.complete ? `catch ${s.result!.yards} yd` : p.intercepted ? 'INT' : 'inc') + bob;
      const side = s.agents[s.icons[c.icon - 1]!]!.pos.y > 0 ? 'left' : 'right';
      console.log(`${c.id} ${def} seed ${seed}: press at ${press - Math.round(s.snapT * 60)} ticks after the snap, ${out}, ${style} (${side})`);
    }
