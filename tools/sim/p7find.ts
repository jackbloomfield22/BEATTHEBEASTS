// Passing round 7: clips for the videos. The player's tap on the cue (p6lead.ts)
// to each case against a call, by seed: the tick (since the snap) it was
// pressed, how it ended and the gain. src/game/clips.ts PASSING7 uses them.
//   node tools/run-ts.mjs tools/sim/p7find.ts [--cases=slant,cross] [--defs=cover3] [--seeds=16]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const ALL: { id: string; play: string; icon: number; hot?: RouteName }[] = [
  { id: 'slant', play: 'doubles-slants', icon: 1 },
  { id: 'slant2', play: 'doubles-slants', icon: 2 },
  { id: 'cross', play: 'trips-y-cross', icon: 1 },
  { id: 'dig', play: 'singleback-drive', icon: 2 },
  { id: 'drag', play: 'doubles-mesh', icon: 1 },
  { id: 'corner', play: 'doubles-smash', icon: 1 },
  { id: 'post', play: 'singleback-pa-post', icon: 1 },
  { id: 'go', play: 'trips-four-verts', icon: 4 },
  { id: 'curl', play: 'doubles-curls', icon: 1 },
  { id: 'comeback', play: 'doubles-curls', icon: 2, hot: 'comeback' },
  { id: 'hitch', play: 'doubles-hitch-seam', icon: 1 },
  { id: 'stick', play: 'trips-stick', icon: 1 },
];
const want = (args.get('cases') ?? 'slant,cross,dig,drag').split(',');
const SEEDS = Number(args.get('seeds') ?? 16);
const LATE = Number(args.get('late') ?? 0);
for (const c of ALL.filter((x) => want.includes(x.id)))
  for (const def of (args.get('defs') ?? 'cover3').split(','))
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s: PlayState = createPlay({ seed, offense: base.offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
      let press = -1;
      let at = -1;
      for (let k = 0; k < 1200 && !s.result; k++) {
        let f: InputFrame;
        if (s.phase === 'presnap') f = input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
        else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
        else {
          const a = s.agents[s.icons[c.icon - 1]!]!;
          const q = throwCue(s, a);
          if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9 + LATE / 60) {
            press = s.t;
            at = Math.round((s.t - s.snapT) * 60);
          }
          f = input({ throwHeld: press >= 0 && s.t < press + 4 / 60 ? c.icon : 0 });
        }
        stepPlay(s, f);
      }
      const p = s.result?.pass;
      const ev = s.events.find((e) => ['drop', 'deflection', 'interception', 'bobble'].includes(e.type));
      const look = s.events.find((e) => e.type === 'catch')?.data?.look ?? '';
      console.log(`${c.id} ${def} seed ${seed} at ${at} ${p?.complete ? 'CATCH' : p?.intercepted ? 'INT' : (ev?.type ?? 'inc')} ${look} gain ${s.result ? (s.result.yards ?? '').toString() : ''} sep ${p?.sep ?? ''}`);
    }
