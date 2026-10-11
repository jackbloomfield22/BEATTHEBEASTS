// Screens against every call (the weak-spot pass: screens against zone were
// near-useless). Per call: completion, yards a throw, where it was caught
// (air yards, behind the line), yards after the catch, the nearest defender
// at the catch, snap to release and to the catch, the spread of the gains,
// and the convoy's blocks (engaged, whiffed in space, shed).
//   node tools/run-ts.mjs tools/sim/screens.ts [reps=60] [--play=doubles-rb-screen,bunch-bubble] [--def=cover2] [--who] [--dump=k]
// --who: who made the tackle, by slot. --dump=k: the k-th rep only, every
// 0.1 s from 0.6 s after the snap: each defender's spot, speed and block,
// each lineman and receiver's block and target, then the play's events.
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { dist } from '../../src/sim/vec.ts';

/** The ball on the left hash, the middle and the right hash in turn (outcomes.ts HASHES). */
const HASHES = [3.08, 0, -3.08];
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 60);
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const plays = (arg('play') ?? 'doubles-rb-screen,bunch-bubble').split(',');
const defs = arg('def')?.split(',');
const dumpK = arg('dump') !== undefined ? Number(arg('dump')) : -1;
const showWho = process.argv.includes('--who');
const f1 = (x: number) => x.toFixed(1).padStart(5);

for (const pid of plays) {
  const play = playById(pid);
  console.log(`\n${pid}`);
  for (const def of DEF_CALLS) {
    if (defs && !defs.includes(def.id)) continue;
    let att = 0;
    let cmp = 0;
    let yds = 0;
    let yac = 0;
    let air = 0;
    let sepC = 0;
    let catchT = 0;
    let relSum = 0;
    let ints = 0;
    let cEng = 0;
    let cWhiff = 0;
    let cShed = 0;
    const tacklers = new Map<string, number>();
    // Completions by gain: no gain or a loss, 1–4, 5–9, 10+.
    const hist = [0, 0, 0, 0];
    for (let k = 0; k < N; k++) {
      if (dumpK >= 0 && k !== dumpK) continue;
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      let cT = -1;
      let cSep = NaN;
      let relT = -1;
      while (!s.result && s.tick < 2400) {
        stepPlay(s, NEUTRAL);
        if (relT < 0 && s.ball.mode === 'air') relT = s.t;
        if (cT < 0 && s.phase === 'carrier' && s.pass?.complete) {
          cT = s.t;
          const c = s.agents[s.carrier]!;
          cSep = Math.min(...s.def.map((i) => (s.agents[i]!.down ? 99 : dist(s.agents[i]!.pos, c.pos))));
        }
        if (dumpK >= 0 && s.snapT >= 0 && s.tick % 6 === 0 && s.t - s.snapT > 0.6) {
          const ref = s.carrier >= 0 ? s.agents[s.carrier]! : s.agents[s.icons[0]!]!;
          console.log(`t=${(s.t - s.snapT).toFixed(2)} ${s.phase} ball ${s.ball.mode} ref ${ref.slot} (${ref.pos.x.toFixed(1)},${ref.pos.y.toFixed(1)}) v=${Math.hypot(ref.vel.x, ref.vel.y).toFixed(1)}`);
          for (const i of s.def) {
            const d = s.agents[i]!;
            const b = s.blocks.find((q) => q.d === i);
            const by = b ? `${s.agents[b.b]!.slot}:${b.kind}:${b.lev.toFixed(2)}` : '';
            console.log(`   ${d.slot.padEnd(4)} (${f1(d.pos.x)},${f1(d.pos.y)}) d=${f1(dist(d.pos, ref.pos))} v=${Math.hypot(d.vel.x, d.vel.y).toFixed(1)} ${d.down ? 'DOWN' : ''} ${by} ${d.mem.screenLetIn ? 'letIn' : ''}`);
          }
          for (const i of s.off) {
            const a = s.agents[i]!;
            if (a.slot === 'QB' || a.slot === 'RB') continue;
            const b = s.blocks.find((q) => q.b === i);
            const tg = (a.mem.target as number | undefined) ?? -1;
            console.log(`   ${a.slot.padEnd(4)} (${f1(a.pos.x)},${f1(a.pos.y)}) v=${Math.hypot(a.vel.x, a.vel.y).toFixed(1)} ${b ? `on ${s.agents[b.d]!.slot} ${b.kind}` : '-'} busy ${a.busy}${tg >= 0 ? ` tgt ${s.agents[tg]!.slot}` : ''}`);
          }
        }
      }
      for (const e of s.events) {
        if (s.snapT < 0 || e.t < s.snapT + (play.screen?.release ?? 0)) continue;
        const b = e.type === 'engage' ? e.who![0]! : e.type === 'shed' ? e.who![1]! : -1;
        if (b < 0 || !s.agents[b]!.mem.convoy) continue;
        if (e.type === 'engage') cEng++;
        else if (e.data?.whiff) cWhiff++;
        else cShed++;
      }
      const r = s.result!;
      if (dumpK >= 0) console.log(JSON.stringify(r), s.events.filter((e) => e.type !== 'engage').map((e) => `${(e.t - s.snapT).toFixed(2)} ${e.type} ${(e.who ?? []).map((w) => s.agents[w]!.slot).join('/')}`).join(' | '));
      if (!r.pass?.attempted) continue;
      att++;
      relSum += relT - s.snapT;
      if (r.pass.intercepted) ints++;
      if (!r.pass.complete || r.pass.intercepted) continue;
      cmp++;
      yds += r.yards;
      hist[r.yards <= 0 ? 0 : r.yards < 5 ? 1 : r.yards < 10 ? 2 : 3]!++;
      const cx = s.events.find((e) => e.type === 'catch')?.at?.x ?? s.setup.los;
      air += cx - s.setup.los;
      yac += r.yards - (cx - s.setup.los);
      sepC += cSep;
      catchT += cT - s.snapT;
      const tk = [...s.events].reverse().find((e) => e.type === 'tackle' || e.type === 'outOfBounds' || e.type === 'touchdown');
      const who = tk?.type === 'tackle' ? s.agents[tk.who![0]!]!.slot : (tk?.type ?? '?');
      tacklers.set(who, (tacklers.get(who) ?? 0) + 1);
    }
    const n = Math.max(1, cmp);
    const tk = [...tacklers].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(
      `${def.id.padEnd(12)} att ${String(att).padStart(3)} cmp ${((100 * cmp) / Math.max(1, att)).toFixed(0).padStart(3)}% ypa ${f1(yds / Math.max(1, att))} air ${f1(air / n)} yac ${f1(yac / n)} ` +
        `sep@catch ${(sepC / n).toFixed(2)} rel@ ${(relSum / Math.max(1, att)).toFixed(2)}s catch@ ${(catchT / n).toFixed(2)}s int ${ints} ` +
        `[<=0 ${hist[0]} 1-4 ${hist[1]} 5-9 ${hist[2]} 10+ ${hist[3]}]` +
        (play.screen ? ` convoy eng ${cEng} whiff ${cWhiff} shed ${cShed}` : '') +
        (showWho ? `  tackled by: ${tk}` : ''),
    );
  }
}
