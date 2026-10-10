// Passing round 6: where a fast man's yards after the catch go. The identity harness's throws to the X (Tyreek Hill, then Wes Welker), and for each catch: its look, his speed at the catch, the nearest defender then, and the yards after it.
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, runToWhistle, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
for (const name of ['Tyreek Hill', 'Wes Welker']) {
  const off = { ...base.offense, X: simPlayer(findStint(snap, name, 'WR')!, 99) };
  const looks: Record<string, number> = {};
  let n = 0, yac = 0, v = 0, near = 0, busy = 0;
  for (const id of ['doubles-slants', 'doubles-quick-outs', 'doubles-curls', 'singleback-pa-post'])
    for (const def of ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'].map(defById))
      for (let k = 0; k < 18; k++)
        for (const at of [45, 70, 95]) {
          const play = PLAYS.find((p) => p.id === id)!;
          const s: PlayState = createPlay({ seed: cellSeed(play, def, k), offense: off, defense: base.defense, play, def, los: 35, toGo: 10, user: true });
          const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
          let cv = 0, cn = 0;
          runToWhistle(s, (st) => {
            const t = Math.round((st.t - st.snapT) * 60);
            if (st.phase === 'carrier' && cv === 0) {
              const c = st.agents[st.carrier]!;
              cv = Math.hypot(c.vel.x, c.vel.y);
              cn = Math.min(...st.def.map((i) => Math.hypot(st.agents[i]!.pos.x - c.pos.x, st.agents[i]!.pos.y - c.pos.y)));
            }
            if (st.phase === 'air') return input({ catchType: 'rac' });
            if (st.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
            return input({ snap: st.phase === 'presnap', throwHeld: st.snapT >= 0 && t >= at && t < at + 3 ? icon : 0 });
          });
          const p = s.result?.pass;
          if (!p?.complete || p.target !== s.agents.find((a) => a.slot === 'X')!.i) continue;
          const look = String(s.events.find((e) => e.type === 'catch')?.data?.look);
          looks[look] = (looks[look] ?? 0) + 1;
          n++;
          yac += s.result!.yards - p.airYards;
          v += cv;
          near += cn;
          if (s.events.some((e) => e.type === 'move' && e.data?.move === 'secureDown')) busy++;
        }
  console.log(`${name}: ${n} catches, yac ${(yac / n).toFixed(2)}, speed at catch ${(v / n).toFixed(2)}, nearest ${(near / n).toFixed(2)}, secureDown ${busy}, looks ${JSON.stringify(looks)}`);
}
