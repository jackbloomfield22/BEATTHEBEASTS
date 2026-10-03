// The coordinator's traits, measured (the trait catalog): Efficiency King
// ("the coordinator AI's suggested play for him is right 10% more often (it
// reads his best matchups)") and Volume TE ("first read on the coordinator
// AI's suggested plays; the QB's progression starts with him").
//
// "Right" is the standard success rate: the play gains 40% of the distance
// on 1st down, 60% on 2nd, all of it on 3rd and 4th. For a grid of downs,
// distances and spots, the coordinator's top `TOP` suggestions are each run
// by the AI against the Beasts' own call for the situation (callDefense at
// Pro, a fresh seeded call per rep), with and without the trait.
//   node tools/run-ts.mjs tools/sim/coordfx.ts [reps] [top]
import { readFileSync } from 'node:fs';
import { deriveStream } from '../../src/engine/rng/index.ts';
import { callDefense, createPlay, defenseFor, NEUTRAL, offenseFor, playById, practiceRosters, runToWhistle, suggestPlays, type ContendersRoster, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import type { SimPlayer } from '../../src/sim/types.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv[2] ?? 24);
const TOP = Number(process.argv[3] ?? 3);

const SITS: { down: number; toGo: number; los: number }[] = [];
for (const los of [25, 45, 65]) for (const [down, toGo] of [[1, 10], [2, 4], [2, 8], [3, 3], [3, 7], [3, 11]] as const) SITS.push({ down, toGo, los });

const without = (p: SimPlayer, id: string): SimPlayer => ({ ...p, traits: (p.traits ?? []).filter((t) => t !== id) });
const withT = (p: SimPlayer, id: string): SimPlayer => ({ ...p, traits: [...(p.traits ?? []), id] });

function run(team: ContendersRoster, label: string, ek: boolean): void {
  let n = 0;
  let ok = 0;
  let yds = 0;
  let teTargets = 0;
  let targets = 0;
  const calls = new Map<string, number>();
  SITS.forEach((sit, si) => {
    const ids = suggestPlays(sit, team, 10, ek ? base.beasts : undefined).slice(0, TOP);
    for (const id of ids) {
      calls.set(id, (calls.get(id) ?? 0) + 1);
      const play = playById(id);
      for (let k = 0; k < REPS; k++) {
        const rng = deriveStream(1000 * si + k, 'coordfx');
        const call = callDefense(sit, 'pro', undefined, rng);
        const s = createPlay({ seed: (si * 7919 + k * 104729 + id.length) >>> 0, offense: offenseFor(play, team), defense: defenseFor(call, base.beasts), play, def: call, los: sit.los, ballY: [3.08, 0, -3.08][k % 3], toGo: sit.toGo, down: sit.down, user: false, flip: k % 2 === 1 });
        runToWhistle(s, () => NEUTRAL);
        const r = s.result!;
        const y = r.offenseBall ? r.yards : -10;
        n++;
        yds += Math.max(-10, y);
        if (y >= sit.toGo * (sit.down === 1 ? 0.4 : sit.down === 2 ? 0.6 : 1)) ok++;
        if (s.pass?.attempted && s.ball.target >= 0) {
          targets++;
          if (s.agents[s.ball.target]!.p.pos === 'TE') teTargets++;
        }
      }
    }
  });
  console.log(`${label.padEnd(44)} success ${((100 * ok) / n).toFixed(1)}%  ${(yds / n).toFixed(2)} yd a play  TE ${((100 * teTargets) / Math.max(1, targets)).toFixed(0)}% of targets (${n} plays)`);
  console.log(`  calls: ${[...calls].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

const team = base.team;
console.log(`Efficiency King (the coordinator's top ${TOP}, ${REPS} reps each)`);
run({ ...team, QB: without(team.QB, 'efficiency-king') }, 'Montana without Efficiency King', true);
run(team, 'Montana (Efficiency King): reads the matchups', true);
const kelce = simPlayer(findStint(snap, 'Travis Kelce', 'TE')!, 87);
console.log(`\nVolume TE`);
run({ ...team, TE: without(kelce, 'volume-te') }, 'Kelce without Volume TE', false);
run({ ...team, TE: kelce }, 'Kelce (Volume TE)', false);
void withT;
