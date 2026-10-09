// Passing round 5 (docs/passing/PASSING5.md): what the catches are, in the AI
// book. For every completed pass: the look the sim called (catchLook), where
// the ball got to him (its height, how far across his run, ahead or behind),
// whether a defender was on him at the catch point, his Catching and his
// catch traits. Prints the spread of looks, of ball heights and of offsets,
// and (with --seeds) the plays that show each kind of catch, for the clips.
//   node tools/run-ts.mjs tools/sim/p5catch.ts [playsPerCell] [--seeds]
import { readFileSync } from 'node:fs';
import { createPlay, NEUTRAL, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, PASS_PLAYS } from '../../src/sim/plays.ts';
import { catchStyle, type CatchStyle } from '../../src/sim/catchstyle.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const n = Number(process.argv[2] ?? 12);
const HASHES = [3.08, 0, -3.08];
// outcomes.ts PASS_BASE: the base pass plays.
const PASS_BASE = PASS_PLAYS.filter((p) => !p.situ && !p.unlock);
const looks = new Map<string, number>();
const styles = new Map<string, number>();
const zs: number[] = [];
let caught = 0;
const seeds = new Map<string, string[]>();
for (const play of PASS_BASE) {
  for (const def of DEF_CALLS) {
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let style: CatchStyle | null = null;
      let z = NaN;
      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        // The render's choice a beat before the arrival (choreo's look-ahead), as the clip is started.
        if (s.ball.mode === 'air' && s.ball.target >= 0 && s.agents[s.ball.target]!.side === 'off' && style === null && s.ball.arrive - s.t <= 0.5) {
          style = catchStyle(s, s.agents[s.ball.target]!);
          z = s.ball.aim.z;
        }
        stepPlay(s, NEUTRAL);
      }
      const c = s.events.find((e) => e.type === 'catch');
      if (!c || !s.result?.pass?.complete) continue;
      caught++;
      const look = String(c.data?.look);
      looks.set(look, (looks.get(look) ?? 0) + 1);
      if (style) {
        styles.set(style, (styles.get(style) ?? 0) + 1);
        const list = seeds.get(style) ?? [];
        if (list.length < 6) list.push(`${play.id}/${def.id}#${k}`);
        seeds.set(style, list);
      }
      if (Number.isFinite(z)) zs.push(z);
    }
  }
}
const pct = (v: number) => `${((100 * v) / Math.max(1, caught)).toFixed(1)}%`;
console.log(`${caught} catches`);
console.log('sim look:', [...looks].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
console.log('drawn style:', [...styles].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
const bands = [0, 0.55, 1.0, 1.4, 1.75, 2.35, 9];
console.log('ball height at the catch (yd):', bands.slice(0, -1).map((lo, j) => `${lo}-${bands[j + 1]} ${pct(zs.filter((v) => v >= lo && v < bands[j + 1]!).length)}`).join(', '));
if (process.argv.includes('--seeds')) for (const [k, v] of seeds) console.log(`${k.padEnd(14)} ${v.join('  ')}`);
