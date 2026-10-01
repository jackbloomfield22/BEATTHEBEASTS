// Per-throw dumps of the on-time slant (docs/m66/SLANTS.md, the second pass):
// where the ball was meant and aimed, where lead() said he'd be, and where he
// really was when it arrived, in his run's frame (along / across). With
// --ticks, every tick of the flight for the first few throws.
//   node tools/run-ts.mjs tools/sim/slantdump.ts [reps=20] [--man] [--ticks=N] [--def=cover3]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { lead } from '../../src/sim/passing.ts';
import { dist } from '../../src/sim/vec.ts';
import { CALLED, isMan, ON_TIME, slantInput, type SlantScript } from './slants.ts';

const HASHES = [3.08, 0, -3.08];
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 20);
const man = process.argv.includes('--man');
const ticksFor = Number(process.argv.find((a) => a.startsWith('--ticks='))?.slice(8) ?? 0);
const only = process.argv.find((a) => a.startsWith('--def='))?.slice(6);
const lateAt = process.argv.find((a) => a.startsWith('--late='))?.slice(7);
const sc: SlantScript = lateAt ? { id: 'late', at: 24 + Number(lateAt), backFrom: 24 } : ON_TIME;

const r2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2).padStart(6);
interface Row { def: string; how: string; kind: string; hang: number; along: number; across: number; meantAlong: number; meantAcross: number; leadErr: number; leadAlong: number; leadAcross: number; ok: boolean; idxRel: number; leg: number; busy: number; spRel: number; spArr: number }
const rows: Row[] = [];
let shown = 0;
for (const def of DEF_CALLS) {
  if (isMan(def) !== man) continue;
  if (only && def.id !== only) continue;
  const play = playById(CALLED.play);
  for (let k = 0; k < N; k++) {
    const icon = CALLED.icons[k % 3]!;
    const sd = sidesFor(rosters, play, def);
    const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: Math.floor(k / 3) % 2 === 1, toGo: 10, user: true });
    const script = slantInput(sc, icon);
    let rel = false;
    let pred = { x: 0, y: 0 };
    let row: Partial<Row> | null = null;
    let arrived = false;
    let tgt = -1;
    let aim0 = { x: 0, y: 0, z: 0 };
    let meant0 = { x: 0, y: 0 };
    let last = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
    const trace: string[] = [];
    for (let t = 0; t < 60 * 12 && !s.result; t++) {
      stepPlay(s, script(s));
      if (!rel && s.ball.mode === 'air') {
        rel = true;
        tgt = s.ball.target;
        aim0 = { ...s.ball.aim };
        meant0 = { ...s.ball.meant };
        const r = s.agents[tgt]!;
        // What lead() says now, for the hang the throw got (the plan used his state a tick earlier).
        pred = lead(r, s.ball.arrive - s.t);
        row = { def: def.id, kind: s.ball.kind ?? '', hang: s.ball.arrive - s.ball.releaseT, idxRel: r.route?.idx ?? -1, leg: (r.mem.catchLeg as number) ?? -9, busy: r.busy, spRel: Math.hypot(r.vel.x, r.vel.y) };
      }
      if (rel && tgt >= 0) {
        const r = s.agents[tgt]!;
        if (!arrived && s.ball.mode === 'air') last = { pos: { ...r.pos }, vel: { ...r.vel } };
        if (shown < ticksFor && s.ball.mode === 'air') {
          const near = Math.min(...s.def.map((i) => dist(s.agents[i]!.pos, r.pos)));
          trace.push(`  t+${((s.t - s.ball.releaseT) * 60).toFixed(0).padStart(3)} pos ${r2(r.pos.x)} ${r2(r.pos.y)} vel ${r2(r.vel.x)} ${r2(r.vel.y)} sp ${r2(Math.hypot(r.vel.x, r.vel.y))} idx ${r.route?.idx} busy ${r.busy} near ${r2(near)} aim ${r2(s.ball.aim.x)} ${r2(s.ball.aim.y)} meant ${r2(s.ball.meant.x)} ${r2(s.ball.meant.y)}`);
        }
        // At the ball's arrival, or the last tick it was in the air (a hand got to it first).
        const ending = s.ball.mode === 'air' && s.t + 1 / 60 >= s.ball.arrive - 1e-9;
        if (!arrived && row && (ending || s.ball.mode !== 'air')) {
          arrived = true;
          const at = s.ball.mode === 'air' ? { pos: r.pos, vel: r.vel } : last;
          const v = Math.hypot(at.vel.x, at.vel.y);
          const ux = v > 0.5 ? at.vel.x / v : 1;
          const uy = v > 0.5 ? at.vel.y / v : 0;
          const fr = (p: { x: number; y: number }) => {
            const dx = p.x - at.pos.x;
            const dy = p.y - at.pos.y;
            return [dx * ux + dy * uy, -dx * uy + dy * ux] as const;
          };
          const [al, ac] = fr(aim0);
          const [ma, mc] = fr(meant0);
          const [la, lc] = fr(pred);
          Object.assign(row, { along: al, across: ac, meantAlong: ma, meantAcross: mc, leadErr: dist(pred, at.pos), leadAlong: la, leadAcross: lc, spArr: v });
        }
      }
    }
    const res = s.result!;
    if (!row || !arrived) continue;
    const complete = !!res.pass?.complete && !res.pass?.intercepted;
    const first = s.events.find((e) => e.type === 'catch' || e.type === 'deflection' || e.type === 'drop' || e.type === 'interception');
    row.how = complete ? 'catch' : res.pass?.intercepted ? 'int' : !first ? 'miss' : first.type === 'drop' ? 'drop' : res.pass?.sep !== undefined ? 'pbu' : 'tip';
    row.ok = complete;
    rows.push(row as Row);
    if (shown < ticksFor) {
      shown++;
      console.log(`${def.id} k${k} icon ${icon} ${row.kind} hang ${r2(row.hang!)} idxRel ${row.idxRel} leg ${row.leg} -> ${row.how}`);
      console.log(trace.join('\n'));
    }
  }
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const share = (f: (r: Row) => boolean) => `${((100 * rows.filter(f).length) / Math.max(1, rows.length)).toFixed(0)}%`;
console.log(`n ${rows.length} cmp ${share((r) => r.ok)} touch ${share((r) => r.kind === 'touch')} hang ${avg(rows.map((r) => r.hang)).toFixed(2)}`);
console.log(`ball off him (aim): along ${avg(rows.map((r) => r.along)).toFixed(2)} |across| ${avg(rows.map((r) => Math.abs(r.across))).toFixed(2)} >1yd ${share((r) => Math.hypot(r.along, r.across) > 1)}`);
console.log(`meant off him:      along ${avg(rows.map((r) => r.meantAlong)).toFixed(2)} |across| ${avg(rows.map((r) => Math.abs(r.meantAcross))).toFixed(2)} >1yd ${share((r) => Math.hypot(r.meantAlong, r.meantAcross) > 1)}`);
console.log(`lead() off him:     along ${avg(rows.map((r) => r.leadAlong)).toFixed(2)} |across| ${avg(rows.map((r) => Math.abs(r.leadAcross))).toFixed(2)} err ${avg(rows.map((r) => r.leadErr)).toFixed(2)}`);
console.log(`speed at release ${avg(rows.map((r) => r.spRel)).toFixed(2)} at arrival ${avg(rows.map((r) => r.spArr)).toFixed(2)}; busy at release ${share((r) => r.busy > 0)}; idx at release ${JSON.stringify(rows.reduce((m, r) => ({ ...m, [r.idxRel]: (m[r.idxRel] ?? 0) + 1 }), {} as Record<number, number>))} leg ${JSON.stringify(rows.reduce((m, r) => ({ ...m, [r.leg]: (m[r.leg] ?? 0) + 1 }), {} as Record<number, number>))}`);
for (const kind of ['driven', 'touch']) {
  const xs = rows.filter((r) => r.kind === kind);
  console.log(`${kind.padEnd(6)} n ${xs.length} cmp ${((100 * xs.filter((r) => r.ok).length) / Math.max(1, xs.length)).toFixed(0)}% meant along ${avg(xs.map((r) => r.meantAlong)).toFixed(2)} |across| ${avg(xs.map((r) => Math.abs(r.meantAcross))).toFixed(2)} aim off ${avg(xs.map((r) => Math.hypot(r.along, r.across))).toFixed(2)} hang ${avg(xs.map((r) => r.hang)).toFixed(2)}`);
}
for (const how of ['catch', 'miss', 'tip', 'pbu', 'drop', 'int']) {
  const xs = rows.filter((r) => r.how === how);
  if (xs.length) console.log(`  ${how.padEnd(5)} ${String(xs.length).padStart(3)} meant along ${avg(xs.map((r) => r.meantAlong)).toFixed(2)} |across| ${avg(xs.map((r) => Math.abs(r.meantAcross))).toFixed(2)}  aim off ${avg(xs.map((r) => Math.hypot(r.along, r.across))).toFixed(2)} hang ${avg(xs.map((r) => r.hang)).toFixed(2)}`);
}
