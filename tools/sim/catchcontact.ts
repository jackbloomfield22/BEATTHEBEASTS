// M6.5 #12: the bodies at the ball's arrival, for the render's contact
// response (src/render/game/contact.ts). For every targeted pass: the
// nearest defender's distance to the receiver and where he is (in front,
// beside, behind), and the air between their drawn trunks (the measured
// pad half-width and depth, tools/blender/measure_bodies.py) three ways:
// at the sim's spots, and with each chest moved by the animator's lean
// (anim/animator.ts: bank atan(v·ω/g) into a turn and pitch with the burst,
// each clamped) pivoting at the feet (as it did) or at the hips (as it does
// now). The turn rate and acceleration are the sim's over the last 0.1 s,
// as the render's eased yaw and speed see them. Read-only on the sim.
//   node tools/run-ts.mjs tools/sim/catchcontact.ts [seedsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, PASS_PLAYS, practiceRosters, stepPlay, type Agent, type SnapshotLike } from '../../src/sim/index.ts';
import { bodyExtent, trunkGap, type Trunk } from '../../src/render/game/contact.ts';
import { RENDER_POS } from '../../src/render/players/renderPos.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const N = Number(process.argv[2] ?? 6);
const YD = 0.9144;
const G = 9.81;
const WIN = 6; // ticks (0.1 s)
/** The chest's height over the feet, and over the hips (m, base body): what the lean swings. */
const CHEST_FEET = 1.44;
const CHEST_HIPS = 1.44 - 0.95;

interface Row {
  d: number;
  side: string;
  gap: [number, number, number];
  bank: number;
  pitch: number;
}
const rows: Row[] = [];

/** The drawn chest of an agent: its sim spot moved by the lean swinging `h` metres of body. */
function chest(a: Agent, hist: { h: number; v: number }[], h: number): { t: Trunk; bank: number; pitch: number } {
  const sp = Math.hypot(a.vel.x, a.vel.y) * YD;
  const head = Math.atan2(a.vel.y, a.vel.x);
  const old = hist[0] ?? { h: head, v: sp };
  const dt = Math.max(1, hist.length) / 60;
  const w = Math.max(-4, Math.min(4, Math.atan2(Math.sin(head - old.h), Math.cos(head - old.h)) / dt));
  const acc = Math.max(-12, Math.min(12, (sp - old.v) / dt));
  const bank = Math.max(-0.35, Math.min(0.35, Math.atan2(sp * w, G)));
  const pitch = Math.max(-0.15, Math.min(0.3, Math.atan2(acc, G) * 0.5));
  const fx = Math.cos(a.face);
  const fy = Math.sin(a.face);
  const s = (a.p.heightIn * 0.0254) / 1.88;
  // Into the turn (+ω turns left: the sim's y is to the left of x) and forward with the pitch.
  const lx = -fy * Math.sin(bank) + fx * Math.sin(pitch);
  const ly = fx * Math.sin(bank) + fy * Math.sin(pitch);
  return { t: { x: a.pos.x * YD + lx * h * s, z: a.pos.y * YD + ly * h * s, fx, fz: fy }, bank, pitch };
}

for (const play of PASS_PLAYS) {
  for (const def of DEF_CALLS) {
    for (let seed = 1; seed <= N; seed++) {
      const s = createPlay({ seed, offense: r.offense, defense: r.defense, play, def, los: 30, toGo: 10, user: false });
      const hist: { h: number; v: number }[][] = s.agents.map(() => []);
      for (let k = 0; k < 60 * 20 && !s.result; k++) {
        const tgt = s.ball.mode === 'air' ? s.ball.target : -1;
        const n0 = s.events.length;
        stepPlay(s, NEUTRAL);
        const ev = s.events.slice(n0).find((e) => e.type === 'catch' || e.type === 'deflection' || e.type === 'drop' || e.type === 'interception');
        if (ev && tgt >= 0) {
          const a = s.agents[tgt]!;
          let best = -1;
          let bd = 99;
          for (const i of s.def) {
            const o = s.agents[i]!;
            const d = Math.hypot(o.pos.x - a.pos.x, o.pos.y - a.pos.y);
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          const o = s.agents[best]!;
          const h = Math.atan2(a.vel.y, a.vel.x);
          const along = ((o.pos.x - a.pos.x) * Math.cos(h) + (o.pos.y - a.pos.y) * Math.sin(h)) / Math.max(1e-6, bd);
          const ea = bodyExtent(RENDER_POS[a.p.pos], a.p.heightIn * 0.0254, a.p.weightLb * 0.45359237);
          const eb = bodyExtent(RENDER_POS[o.p.pos], o.p.heightIn * 0.0254, o.p.weightLb * 0.45359237);
          const gaps = [0, CHEST_FEET, CHEST_HIPS].map((hh) => trunkGap(chest(a, hist[tgt]!, hh).t, ea, chest(o, hist[best]!, hh).t, eb)) as [number, number, number];
          const c = chest(a, hist[tgt]!, 0);
          rows.push({ d: bd, side: along > 0.5 ? 'front' : along < -0.5 ? 'behind' : 'beside', gap: gaps, bank: c.bank, pitch: c.pitch });
        }
        s.agents.forEach((a, i) => {
          const hh = hist[i]!;
          hh.push({ h: Math.atan2(a.vel.y, a.vel.x), v: Math.hypot(a.vel.x, a.vel.y) * YD });
          if (hh.length > WIN) hh.shift();
        });
      }
    }
  }
}
const n = rows.length;
const pct = (x: number) => ((100 * x) / n).toFixed(1);
const near = rows.filter((x) => x.d < 1.2);
console.log(`${n} arrivals; a defender within 1.2 yd: ${near.length} (${pct(near.length)}%): ${['front', 'beside', 'behind'].map((k) => `${k} ${near.filter((x) => x.side === k).length}`).join(', ')}`);
const q = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const banks = rows.map((x) => Math.abs(x.bank));
console.log(`receiver's bank at the arrival (rad): median ${q(banks, 0.5).toFixed(2)}, p90 ${q(banks, 0.9).toFixed(2)}; at the 0.35 clamp: ${pct(banks.filter((b) => b >= 0.349).length)}%`);
for (const [k, label] of [[0, 'at the sim spots'], [1, 'leaning about the feet'], [2, 'leaning about the hips']] as const) {
  const over = rows.filter((x) => x.gap[k] < 0);
  const touch = rows.filter((x) => x.gap[k] >= 0 && x.gap[k] < 0.1);
  console.log(`trunks ${label}: overlapping ${over.length} (${pct(over.length)}%, worst ${Math.min(0, ...rows.map((x) => x.gap[k])).toFixed(2)} m), within 10 cm ${touch.length} (${pct(touch.length)}%)`);
}
