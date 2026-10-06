// The passing game's identity pairs (docs/passing/PASSING.md, CLAUDE.md
// "Every player is himself"): the arm, the release, the placement and the
// hands, each pair the same man in the same slot on the same throws, in
// numbers a fan sees on the broadcast. A pair fails when the difference it
// should show is smaller than the smallest a fan would notice.
//   node tools/run-ts.mjs tools/sim/passidentity.ts [reps]
// tests/passidentity.test.ts holds the fast ones to it.
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, PLAYS, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import type { PlayState } from '../../src/sim/state.ts';
import type { OffSlot } from '../../src/sim/types.ts';
import type { SimPlayer } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 8);
const MPH = 3600 / 1760;

const player = (name: string, pos: string): SimPlayer => {
  const e = findStint(snap, name, pos);
  if (!e) throw new Error(`passidentity: ${name} (${pos}) not in the snapshot`);
  return simPlayer(e, 99);
};
const withOff = (slot: OffSlot, p: SimPlayer) => ({ ...base.offense, [slot]: p }) as Record<OffSlot, SimPlayer>;
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const COVERS = ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'];

/** A scripted throw to icon `icon` at tick `at` (held `hold` ticks: touch), then a catch-and-run. Calls `seen` once the ball is out. */
function throwScript(icon: number, at: number, hold: number, seen: (s: PlayState) => void, wound?: (w: number) => void) {
  let out = false;
  let wd = false;
  return (s: PlayState) => {
    if (!wd && s.windup) {
      wd = true;
      wound?.(s.windup.at - s.windup.from);
    }
    if (s.phase === 'air') {
      if (!out) {
        out = true;
        seen(s);
      }
      return input({ catchType: 'rac' });
    }
    if (s.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
    const t = since(s);
    return input({ snap: s.phase === 'presnap', throwHeld: t >= at && t < at + hold ? icon : 0 });
  };
}

interface Flight {
  mph: number;
  hang: number;
  dist: number;
  off: number;
  spiral: number;
  rpm: number;
  windup: number;
}
/** Every throw `qb` makes on these plays: its launch speed, hang, distance and how far off it was. */
function flights(qb: SimPlayer, plays: [string, number, number, number][]): Flight[] {
  const off = withOff('QB', qb);
  const out: Flight[] = [];
  for (const [id, icon, at, hold] of plays) {
    const play = PLAYS.find((p) => p.id === id)!;
    for (const d of COVERS) {
      for (let k = 1; k <= REPS; k++) {
        const s = createPlay({ seed: 7000 + k * 31, offense: off, defense: base.defense, play, def: defById(d), los: 30, toGo: 10, user: true });
        let windup = 0;
        runToWhistle(
          s,
          throwScript(
            icon,
            at,
            hold,
            (st) => {
              const b = st.ball;
              const th = [...st.events].reverse().find((e) => e.type === 'throw');
              const v = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
              out.push({ mph: v * MPH, hang: b.arrive - b.releaseT, dist: Math.hypot(b.aim.x - b.pos.x, b.aim.y - b.pos.y), off: Number(th?.data?.off ?? 0), spiral: Number(th?.data?.spiral ?? 1), rpm: Number(th?.data?.rpm ?? 0), windup });
            },
            (w) => (windup = w),
          ),
        );
      }
    }
  }
  return out;
}

/** Drops by a receiver at X: the share of balls that reached his hands open (no defender within 1.5 yd) and went down. */
function drops(rec: SimPlayer): { n: number; rate: number } {
  const off = withOff('X', rec);
  let n = 0;
  let dropped = 0;
  for (const [id, at] of [['doubles-slants', 30], ['doubles-curls', 60], ['doubles-quick-outs', 34], ['singleback-drive', 90]] as [string, number][]) {
    const play = PLAYS.find((p) => p.id === id)!;
    for (const d of COVERS) {
      for (let k = 1; k <= REPS * 5; k++) {
        const s = createPlay({ seed: 9000 + k * 17, offense: off, defense: base.defense, play, def: defById(d), los: 30, toGo: 10, user: true });
        const icon = s.icons.findIndex((i) => s.agents[i]!.slot === 'X') + 1;
        runToWhistle(s, throwScript(icon, at, 3, () => {}));
        const p = s.result?.pass;
        const x = s.agents.find((a) => a.slot === 'X')!;
        if (!p?.attempted || p.target !== x.i || p.sep === undefined || p.sep < 1.5) continue;
        // Reached his hands: caught, or a drop event (not a ball that sailed past him).
        const drop = s.events.some((e) => e.type === 'drop' && e.who?.[0] === x.i);
        if (!p.complete && !drop) continue;
        n++;
        if (drop) dropped++;
      }
    }
  }
  return { n, rate: (100 * dropped) / Math.max(1, n) };
}

interface Row {
  pair: string;
  metric: string;
  a: number;
  b: number;
  need: number;
  /** +1: a should be higher. */
  dir: 1 | -1;
}
const rows: Row[] = [];
const MARINO = player('Dan Marino', 'QB');
const MONTANA = player('Joe Montana', 'QB');
const WINSTON = player('Jameis Winston', 'QB');
const NAMATH = player('Joe Namath', 'QB');

// The arm: the same go and post, driven and layered. Marino's ball gets there faster, on a flatter line.
const DEEP: [string, number, number, number][] = [
  ['trips-four-verts', 3, 90, 3],
  ['trips-four-verts', 3, 90, 16],
  ['singleback-pa-post', 1, 90, 3],
];
const fMar = flights(MARINO, DEEP).filter((f) => f.dist > 28);
const fMon = flights(MONTANA, DEEP).filter((f) => f.dist > 28);
rows.push({ pair: 'Arm: Marino (96) vs Montana (72)', metric: 'deep ball launch speed (mph)', a: mean(fMar.map((f) => f.mph)), b: mean(fMon.map((f) => f.mph)), need: 4, dir: 1 });
rows.push({ pair: 'Arm: Marino (96) vs Montana (72)', metric: 'deep ball hang per 10 yd (s)', a: mean(fMar.map((f) => (10 * f.hang) / f.dist)), b: mean(fMon.map((f) => (10 * f.hang) / f.dist)), need: 0.04, dir: -1 });
rows.push({ pair: 'Arm: Marino (96) vs Montana (72)', metric: 'spiral (rpm)', a: mean(fMar.map((f) => f.rpm)), b: mean(fMon.map((f) => f.rpm)), need: 40, dir: 1 });
// The release: the same big arm, a quick trigger against a long windup.
// Placement: the same intermediate throws.
const MID: [string, number, number, number][] = [
  ['doubles-curls', 1, 60, 3],
  ['singleback-drive', 2, 90, 3],
];
rows.push({ pair: 'Release: Marino (98) vs Winston (75)', metric: 'windup to release (s)', a: mean(flights(MARINO, MID).map((f) => f.windup)), b: mean(flights(WINSTON, MID).map((f) => f.windup)), need: 0.08, dir: -1 });
const pMon = flights(MONTANA, MID);
const pNam = flights(NAMATH, MID);
rows.push({ pair: 'On the hands: Montana vs Namath', metric: 'ball off the meant spot (yd)', a: mean(pMon.map((f) => f.off)), b: mean(pNam.map((f) => f.off)), need: 0.25, dir: -1 });
rows.push({ pair: 'On the hands: Montana vs Namath', metric: 'spiral (tight 1 … duck 0)', a: mean(pMon.map((f) => f.spiral)), b: mean(pNam.map((f) => f.spiral)), need: 0.03, dir: 1 });
// The hands: open balls that reach him.
const dH = drops(player('Marvin Harrison', 'WR'));
const dS = drops(player('Darius Slayton', 'WR'));
rows.push({ pair: `Hands: Harrison (97) vs Slayton (59, Drops) [${dH.n}/${dS.n} balls]`, metric: 'open balls dropped (%)', a: dH.rate, b: dS.rate, need: 3, dir: -1 });

let pass = 0;
for (const r of rows) {
  const d = r.a - r.b;
  const ok = d * r.dir >= r.need;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.pair.padEnd(54)} ${r.metric.padEnd(30)} ${r.a.toFixed(3).padStart(8)} vs ${r.b.toFixed(3).padStart(8)}  (needs ${r.dir > 0 ? '+' : '−'}${r.need})`);
}
console.log(`\n${pass} of ${rows.length} passing identity checks pass`);
