// Passing round 7 (docs/passing/PASSING7.md): the deep corner. The player's
// tap on the cue to the corner (doubles-smash, the slot) against four calls,
// and for each throw where the ball was put against the receiver's run
// (ahead, and across: + toward his sideline) and against the men on him:
// the nearest defender and the deepest one inside him (the safety) at the
// release, and where each was from the ball when it came down.
//   node tools/run-ts.mjs tools/sim/p7corner.ts [--seeds=16] [--detail]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 16);
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const DEFS = (args.get('defs') ?? 'cover3,cover1,cover2,cover4').split(',');
const rows: { out: string; along: number; out_: number; near: number; saf: number; sepAtCatch: number }[] = [];
for (const def of DEFS)
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s: PlayState = createPlay({ seed, offense: base.offense, defense: base.defense, play: playById('doubles-smash'), def: defById(def), los: 30, toGo: 10, user: true });
    let press = -1;
    let rel: { along: number; out_: number } | null = null;
    let tgt = -1;
    let land: { x: number; y: number } | null = null;
    for (let k = 0; k < 1200 && !s.result; k++) {
      let f: InputFrame;
      if (s.phase === 'presnap') f = input({ snap: true });
      else if (s.phase === 'carrier') f = input({ move: { x: 1, y: 0 } });
      else {
        const a = s.agents[s.icons[0]!]!;
        const q = throwCue(s, a);
        if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
        f = input({ throwHeld: press >= 0 && s.t < press + 4 / 60 ? 1 : 0 });
      }
      const wasAir = s.phase === 'air';
      stepPlay(s, f);
      if (s.phase === 'air' && !wasAir) {
        const r = s.agents[s.ball.target]!;
        tgt = r.i;
        // His run at the catch: from the throw's meant point back to where he is now isn't it; use his route's last leg.
        const rt = r.route!;
        const n = rt.pts.length;
        const a0 = rt.pts[Math.max(0, n - 2)]!;
        const a1 = rt.pts[n - 1]!;
        const L = Math.hypot(a1.x - a0.x, a1.y - a0.y);
        const ux = (a1.x - a0.x) / L;
        const uy = (a1.y - a0.y) / L;
        const side = Math.sign(r.pos.y) || 1;
        const lead = { x: r.pos.x + r.vel.x * (s.ball.arrive - s.t), y: r.pos.y + r.vel.y * (s.ball.arrive - s.t) };
        const dx = s.ball.meant.x - lead.x;
        const dy = s.ball.meant.y - lead.y;
        let px = -uy;
        let py = ux;
        if (py * side < 0) {
          px = -px;
          py = -py;
        }
        rel = { along: dx * ux + dy * uy, out_: dx * px + dy * py };
        land = s.ball.aim;
      }
      if (wasAir && s.phase !== 'air' && land) break;
    }
    while (!s.result && s.t < 30) stepPlay(s, s.phase === 'carrier' ? input({ move: { x: 1, y: 0 } }) : input({}));
    if (!rel || !land || tgt < 0) continue;
    // Where the defenders were from the ball when it came down.
    let near = 99;
    let saf = 99;
    for (const i of s.def) {
      const d = s.agents[i]!;
      const k = Math.hypot(d.pos.x - land.x, d.pos.y - land.y);
      near = Math.min(near, k);
      if (d.p.pos === 'S') saf = Math.min(saf, k);
    }
    const p = s.result?.pass;
    const ev = s.events.find((e) => ['drop', 'deflection', 'interception'].includes(e.type));
    rows.push({ out: p?.complete ? 'C' : p?.intercepted ? 'I' : (ev?.type ?? 'inc'), along: rel.along, out_: rel.out_, near, saf, sepAtCatch: p?.sep ?? -1 });
    if (args.has('detail')) console.log(`${def}/${seed} meant vs his run: ahead ${rel.along.toFixed(2)} outside ${rel.out_.toFixed(2)} | sep ${p?.sep ?? '-'} | ${rows.at(-1)!.out}`);
  }
const m = (f: (r: (typeof rows)[0]) => number) => rows.reduce((a, r) => a + f(r), 0) / Math.max(1, rows.length);
console.log(`corner on the cue: n ${rows.length} cmp ${((100 * rows.filter((r) => r.out === 'C').length) / rows.length).toFixed(0)}% INT ${rows.filter((r) => r.out === 'I').length} | meant vs his run: ahead ${m((r) => r.along).toFixed(2)} outside ${m((r) => r.out_).toFixed(2)} (outside on ${((100 * rows.filter((r) => r.out_ > 0.2).length) / rows.length).toFixed(0)}%, inside on ${((100 * rows.filter((r) => r.out_ < -0.2).length) / rows.length).toFixed(0)}%) | sep at the catch ${m((r) => Math.max(0, r.sepAtCatch)).toFixed(2)}`);
