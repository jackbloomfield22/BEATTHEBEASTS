// Passing round 8 (docs/passing/PASSING8.md): where the sim takes the ball
// against the catcher's body. For every completion in the AI book (and the
// player's cue throws with --cue): the ball at the catch tick against his
// centre, along his run (+ ahead) and across it, its height (m), and the
// drawn style. Prints the share taken beyond what a drawn arm reaches.
//   node tools/run-ts.mjs tools/sim/p8_catchrel.ts [playsPerCell] [--cue] [--seeds=N]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, NEUTRAL, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, PASS_PLAYS } from '../../src/sim/plays.ts';
import { throwCue } from '../../src/sim/cue.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const n = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 8);
const CUE = process.argv.includes('--cue');
const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.slice(8) ?? 8);
const HASHES = [3.08, 0, -3.08];
const PASS_BASE = PASS_PLAYS.filter((p) => !p.situ && !p.unlock);
const YD = 0.9144;
interface Row { tag: string; along: number; across: number; z: number; out: string; h: number }
const rows: Row[] = [];

function watch(s: PlayState, f: () => InputFrame, tag: string): void {
  let tgt = -1;
  for (let t = 0; t < 60 * 40 && !s.result; t++) {
    if (s.ball.mode === 'air' && s.ball.target >= 0 && s.agents[s.ball.target]!.side === 'off') tgt = s.ball.target;
    const r = tgt >= 0 ? s.agents[tgt]! : null;
    const pre = r ? { x: r.pos.x, y: r.pos.y, vx: r.vel.x, vy: r.vel.y } : null;
    const wasAir = s.ball.mode === 'air';
    const before = s.events.length;
    stepPlay(s, f());
    if (!wasAir || !r || !pre) continue;
    const ev = s.events.slice(before).find((e) => (e.type === 'catch' || e.type === 'drop' || e.type === 'deflection' || e.type === 'bobble') && e.who?.includes(tgt));
    if (!ev) continue;
    const sp = Math.hypot(pre.vx, pre.vy);
    const ux = sp > 1 ? pre.vx / sp : Math.cos(r.face);
    const uy = sp > 1 ? pre.vy / sp : Math.sin(r.face);
    const rel = (r.mem.catchRel as { x: number; y: number } | undefined) ?? { x: s.ball.pos.x - r.pos.x, y: s.ball.pos.y - r.pos.y };
    const z = ev.type === 'catch' ? (r.mem.catchRelZ as number) : s.ball.pos.z;
    rows.push({ tag, along: (rel.x * ux + rel.y * uy) * YD, across: Math.abs(-rel.x * uy + rel.y * ux) * YD, z: z * YD, out: ev.type, h: r.fx.height * YD });
    return;
  }
}

if (!CUE) {
  for (const play of PASS_BASE)
    for (const def of DEF_CALLS)
      for (let k = 0; k < n; k++) {
        const sd = sidesFor(rosters, play, def);
        const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
        watch(s, () => NEUTRAL, 'ai');
      }
} else {
  const CASES = [
    { id: 'slant', play: 'doubles-slants', icon: 1 },
    { id: 'cross', play: 'trips-y-cross', icon: 1 },
    { id: 'dig', play: 'singleback-drive', icon: 2 },
    { id: 'go', play: 'trips-four-verts', icon: 4 },
    { id: 'post', play: 'singleback-pa-post', icon: 1 },
    { id: 'corner', play: 'doubles-smash', icon: 1 },
    { id: 'curl', play: 'doubles-curls', icon: 1 },
  ];
  for (const c of CASES)
    for (const def of ['cover3', 'cover1', 'cover2', 'cover4'])
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
        let press = -1;
        watch(s, () => {
          if (s.phase === 'presnap') return input({ snap: true });
          if (s.phase !== 'carrier' && s.phase !== 'dead' && s.ball.mode !== 'air') {
            const a = s.agents[s.icons[c.icon - 1]!]!;
            const q = throwCue(s, a);
            if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t;
          }
          return input({ throwHeld: press >= 0 && s.t < press + 4 / 60 ? c.icon : 0 });
        }, c.id);
      }
}
const tags = [...new Set(rows.map((r) => r.tag))];
const q = (v: number[], p: number) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]! : NaN; };
for (const tag of ['all', ...tags]) {
  const rs = rows.filter((r) => tag === 'all' || r.tag === tag);
  const c = rs.filter((r) => r.out === 'catch');
  const al = c.map((r) => r.along);
  const over = (lim: number) => ((100 * c.filter((r) => r.along > lim).length) / Math.max(1, c.length)).toFixed(1);
  console.log(`${tag.padEnd(7)} n ${String(rs.length).padStart(5)} caught ${String(c.length).padStart(5)}  along p10 ${q(al, 0.1).toFixed(2)} p50 ${q(al, 0.5).toFixed(2)} p90 ${q(al, 0.9).toFixed(2)} max ${Math.max(...al).toFixed(2)} m  >0.85 ${over(0.85)}% >0.95 ${over(0.95)}% >1.05 ${over(1.05)}%  across p90 ${q(c.map((r) => r.across), 0.9).toFixed(2)}  z<0.9m ${((100 * c.filter((r) => r.z < 0.9).length) / Math.max(1, c.length)).toFixed(1)}%`);
}
const outs = new Map<string, number>();
for (const r of rows) outs.set(r.out, (outs.get(r.out) ?? 0) + 1);
console.log('outcomes at his hands:', [...outs].map(([k, v]) => `${k} ${v}`).join(', '));
