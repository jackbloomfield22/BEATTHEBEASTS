// Passing round 5 (docs/passing/PASSING5.md): the clip finder for the catch
// videos (src/game/clips.ts PASSING5). Runs the AI's plays (or a scripted
// throw) seed by seed from the Practice set-up and prints, for every catch,
// how it's drawn (sim/catchstyle.ts) and where the ball got to him.
//   node tools/run-ts.mjs tools/sim/p5find.ts [--plays=a,b] [--defs=a,b] [--seeds=N] [--style=hands] [--swap=X:Name:WR] [--user=icon,at,hold,aimX,aimY,call]
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, NEUTRAL, offenseFor, PASS_PLAYS, practiceRosters, playById, stepPlay, type CatchType, type SnapshotLike } from '../../src/sim/index.ts';
import { concept, withSwap, type Swap } from '../../src/game/clips.ts';
import { arrivalOf, catchStyle, contactAt } from '../../src/sim/catchstyle.ts';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const plays = arg('plays')?.split(',') ?? PASS_PLAYS.filter((p) => !p.situ && !p.unlock && !p.screen).map((p) => p.id);
const defs = arg('defs')?.split(',') ?? ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man', 'tampa2', 'firezone'];
const seeds = Number(arg('seeds') ?? 20);
const want = arg('style');
const sw = arg('swap')?.split(':');
const u = arg('user')?.split(',');
const script = u ? concept({ icon: Number(u[0]), at: Number(u[1]), hold: Number(u[2] ?? 4), aim: { x: Number(u[3] ?? 0), y: Number(u[4] ?? 0) }, call: (u[5] || undefined) as CatchType | undefined }) : () => NEUTRAL;
for (const play of plays) {
  const swap: Swap | undefined = sw ? { off: sw[0] as Swap['off'], name: sw[1]!, pos: sw[2]! } : undefined;
  const r = swap ? withSwap({ team: base.team, beasts: base.beasts }, play, swap, snap) : null;
  for (const def of defs) {
    for (let seed = 1; seed <= seeds; seed++) {
      const off = r ? offenseFor(playById(play), r.team) : base.offense;
      const dfn = r ? defenseFor(defById(def), r.beasts) : base.defense;
      const s = createPlay({ seed, offense: off, defense: dfn, play: playById(play), def: defById(def), los: 30, toGo: 10, user: !!u });
      let line = '';
      for (let k = 0; k < 60 * 20 && !s.result; k++) {
        if (!line && s.ball.mode === 'air' && s.ball.target >= 0 && s.agents[s.ball.target]!.side === 'off' && s.ball.arrive - s.t <= 0.3) {
          const a = s.agents[s.ball.target]!;
          const st = catchStyle(s, a);
          const ar = arrivalOf(s, a);
          const c = contactAt(s, a);
          line = `${st.padEnd(12)} ${a.slot.padEnd(4)} ${a.p.name.padEnd(18)} z ${ar.z.toFixed(2)} across ${ar.across.toFixed(2).padStart(5)} ahead ${ar.ahead.toFixed(2).padStart(5)} air ${(s.ball.aim.x - s.setup.los).toFixed(0).padStart(3)}${c ? ` contact ${c.p.name}` : ''}`;
        }
        stepPlay(s, script(s));
      }
      if (!line) continue;
      const out = s.result?.pass?.complete ? `CATCH ${s.result.yards.toFixed(0).padStart(3)}` : s.result?.pass?.intercepted ? 'INT      ' : 'inc      ';
      if (want && !line.startsWith(want)) continue;
      console.log(`${play.padEnd(22)} ${def.padEnd(10)} seed ${String(seed).padStart(2)} ${out} ${line}`);
    }
  }
}
