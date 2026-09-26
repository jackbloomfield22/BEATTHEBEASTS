// M6.5 #8: why the run game has no home-run threat. Follows every carry of
// the run harness through time and measures the four suspects in the brief:
//   lane     blocks that never spring one: at the line, how many defenders
//            are free (not in a block) near the carrier, and how wide the gap
//   fill     second-level defenders who always fill right: who makes first
//            contact, and where; how far the linebackers are from him as he
//            crosses the line
//   leverage safeties who never lose it: of the carries that get past the
//            linebackers, how many get past the last safety too
//   speed    a carrier who can't get to top speed before contact: his speed
//            (share of his top speed) at the line and at first contact
//   node tools/run-ts.mjs tools/sim/rundiag.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, RUN_PLAYS } from '../../src/sim/plays.ts';
import { createPlay, type PlayState } from '../../src/sim/state.ts';
import { stepPlay } from '../../src/sim/play.ts';
import { NEUTRAL } from '../../src/sim/input.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = Number(process.argv[2] ?? 10);
const HASHES = [3.08, 0, -3.08];
const plays = RUN_PLAYS.filter((p) => !p.situ);

interface Carry {
  play: string;
  yards: number;
  /** Carrier speed / his vmax: when he crosses the line, at first contact. */
  vLos: number;
  vContact: number;
  /** Seconds from the handoff to the line. */
  tLos: number;
  /** At the line: defenders not in a block within 3 yd of him; the nearest one's distance. */
  free3: number;
  nearFree: number;
  /** At the line: share of the run blocks the defender is winning (lev > 0.3). */
  blocksLost: number;
  /** Who made first contact (slot) and how far past the line; whether he was still in a block the tick before. */
  firstBy: string;
  firstEngaged: boolean;
  /** What that first contact was: hit (down), brokenTackle, missedTackle. */
  firstOut: string;
  firstX: number;
  /** Nearest linebacker to him as he crosses the line (yd). */
  lbDist: number;
  /** Got 5 yd past the line; got past every linebacker; then got past every safety (x beyond them) without being touched. */
  past5: boolean;
  pastLbs: boolean;
  pastSafeties: boolean;
  /** Tackled by (slot). */
  tackler: string;
  /** From the handoff to first contact: heading turned per second (deg/s, while moving), and the mean speed share. */
  turnRate: number;
  vMean: number;
}

const out: Carry[] = [];
const sp = (s: PlayState, i: number) => Math.hypot(s.agents[i]!.vel.x, s.agents[i]!.vel.y) / s.agents[i]!.fx.vmax;
for (const play of plays)
  for (const def of DEF_CALLS)
    for (let k = 0; k < N; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      const los = s.setup.los;
      const c: Partial<Carry> = { play: play.id, pastLbs: false, pastSafeties: false, past5: false };
      let crossed = false;
      let contacted = false;
      let turn = 0;
      let tMove = 0;
      let vSum = 0;
      let vN = 0;
      let lastH: number | null = null;
      let engagedPrev = new Set<number>();
      for (let t = 0; t < 60 * 40 && !s.result; t++) {
        stepPlay(s, NEUTRAL);
        const ci = s.carrier;
        if (ci < 0 || s.agents[ci]!.side !== 'off' || s.runReadT < 0) continue;
        const a = s.agents[ci]!;
        if (!contacted) {
          const v = Math.hypot(a.vel.x, a.vel.y);
          vSum += v / a.fx.vmax;
          vN++;
          if (v > 1.5) {
            const h = Math.atan2(a.vel.y, a.vel.x);
            if (lastH !== null) turn += Math.abs(Math.atan2(Math.sin(h - lastH), Math.cos(h - lastH)));
            lastH = h;
            tMove += 1 / 60;
          } else lastH = null;
        }
        if (!crossed && a.pos.x >= los) {
          crossed = true;
          c.vLos = sp(s, ci);
          c.tLos = s.t - s.runReadT;
          const inBlock = new Set(s.blocks.map((b) => b.d));
          const free = s.def.filter((d) => !inBlock.has(d) && !s.agents[d]!.down);
          const dists = free.map((d) => Math.hypot(s.agents[d]!.pos.x - a.pos.x, s.agents[d]!.pos.y - a.pos.y));
          c.free3 = dists.filter((x) => x < 3).length;
          c.nearFree = dists.length ? Math.min(...dists) : 99;
          const runBlocks = s.blocks.filter((b) => b.kind === 'run');
          c.blocksLost = runBlocks.length ? runBlocks.filter((b) => b.lev > 0.3).length / runBlocks.length : 0;
          const lbs = s.def.filter((d) => s.agents[d]!.p.pos === 'LB');
          c.lbDist = lbs.length ? Math.min(...lbs.map((d) => Math.hypot(s.agents[d]!.pos.x - a.pos.x, s.agents[d]!.pos.y - a.pos.y))) : 99;
        }
        if (!contacted) {
          const e = s.events.find((ev) => (ev.type === 'hit' || ev.type === 'brokenTackle' || ev.type === 'missedTackle' || ev.type === 'tackle') && ev.t > s.runReadT);
          if (e) {
            contacted = true;
            c.vContact = sp(s, ci);
            const firstContactIdx = e.who?.find((w) => s.agents[w]!.side === 'def') ?? -1;
            c.firstBy = firstContactIdx >= 0 ? s.agents[firstContactIdx]!.slot : '?';
            c.firstEngaged = engagedPrev.has(firstContactIdx);
            c.firstOut = e.type;
            c.firstX = (e.at?.x ?? a.pos.x) - los;
          }
        }
        if (a.pos.x >= los + 5) c.past5 = true;
        engagedPrev = new Set(s.blocks.map((b) => b.d));
        const beyond = (pos: string) => s.def.filter((d) => s.agents[d]!.p.pos === pos).every((d) => s.agents[d]!.pos.x < a.pos.x - 0.5);
        if (!c.pastLbs && beyond('LB')) c.pastLbs = true;
        if (c.pastLbs && !c.pastSafeties && beyond('S')) c.pastSafeties = true;
      }
      const r = s.result!;
      c.yards = r.offenseBall ? r.yards : 0;
      const tk = [...s.events].reverse().find((e) => e.type === 'tackle');
      const ti = tk?.who?.find((w) => s.agents[w]!.side === 'def');
      c.tackler = ti !== undefined ? s.agents[ti]!.slot : r.reason;
      c.vLos ??= 0;
      c.vContact ??= sp(s, s.carrier >= 0 ? s.carrier : s.slot.RB!);
      c.firstBy ??= 'none';
      c.firstEngaged ??= false;
      c.firstOut ??= 'none';
      c.firstX ??= c.yards;
      c.tLos ??= -1;
      c.free3 ??= 0;
      c.nearFree ??= 99;
      c.blocksLost ??= 0;
      c.lbDist ??= 99;
      c.turnRate = tMove > 0.2 ? (turn * 180) / Math.PI / tMove : 0;
      c.vMean = vN ? vSum / vN : 0;
      out.push(c as Carry);
    }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const f2 = (x: number) => x.toFixed(2);
const groups: [string, (c: Carry) => boolean][] = [
  ['all', () => true],
  ['stuff (<1)', (c) => c.yards < 1],
  ['short (1–4)', (c) => c.yards >= 1 && c.yards < 4],
  ['mid (4–10)', (c) => c.yards >= 4 && c.yards < 10],
  ['10+', (c) => c.yards >= 10],
];
console.log(`carries ${out.length}`);
console.log('group          n     speed@LOS speed@contact t→LOS  free≤3yd nearFree blocksLost lbDist firstContact(x)');
for (const [name, f] of groups) {
  const g = out.filter(f);
  console.log(
    `${name.padEnd(14)} ${String(g.length).padStart(4)}  ${f2(mean(g.map((c) => c.vLos))).padStart(8)} ${f2(mean(g.map((c) => c.vContact))).padStart(12)} ${f2(mean(g.filter((c) => c.tLos >= 0).map((c) => c.tLos))).padStart(6)} ${f2(mean(g.map((c) => c.free3))).padStart(8)} ${f2(mean(g.map((c) => Math.min(c.nearFree, 15)))).padStart(8)} ${f2(mean(g.map((c) => c.blocksLost))).padStart(10)} ${f2(mean(g.map((c) => Math.min(c.lbDist, 15)))).padStart(6)} ${f2(mean(g.map((c) => c.firstX))).padStart(8)}`,
  );
}
const by = (key: (c: Carry) => string, rows: Carry[]) => {
  const m = new Map<string, number>();
  for (const c of rows) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, rows.length)}`).join(', ');
};
console.log('group          turn°/s  vMean(handoff→contact)');
for (const [name, f] of groups) {
  const g = out.filter(f);
  console.log(`${name.padEnd(14)} ${mean(g.map((c) => c.turnRate)).toFixed(0).padStart(6)}  ${f2(mean(g.map((c) => c.vMean)))}`);
}
console.log(`first contact by: ${by((c) => c.firstBy.replace(/^[LR]/, ''), out)}`);
console.log(`tackled by: ${by((c) => c.tackler.replace(/^[LR]/, ''), out)}`);
const p5 = out.filter((c) => c.past5);
const pl = out.filter((c) => c.pastLbs);
const ps = out.filter((c) => c.pastSafeties);
console.log(`reach 5 yd past the line: ${pct(p5.length, out.length)}; past every LB: ${pct(pl.length, out.length)}; then past every S: ${pct(ps.length, pl.length)} of those`);
console.log(`past the LBs → yards: mean ${f2(mean(pl.map((c) => c.yards)))}, 20+ ${pct(pl.filter((c) => c.yards >= 20).length, pl.length)}`);
console.log(`speed at the line ≥ 0.8 of top: ${pct(out.filter((c) => c.vLos >= 0.8).length, out.length)}; at contact ≥ 0.8: ${pct(out.filter((c) => c.vContact >= 0.8).length, out.length)}`);
console.log(`at the line, a free defender within 1.5 yd: ${pct(out.filter((c) => c.nearFree < 1.5).length, out.length)}; none within 3 yd: ${pct(out.filter((c) => c.free3 === 0).length, out.length)}`);
for (const [name, f] of groups) {
  const g = out.filter(f);
  console.log(`${name.padEnd(14)} first contact: ${by((c) => c.firstBy.replace(/^[LR]/, ''), g)}`);
  console.log(`${' '.repeat(14)} tackled by:    ${by((c) => c.tackler.replace(/^[LR]/, ''), g)}`);
}
const ac = (g: Carry[]) => mean(g.map((c) => c.yards - Math.max(0, c.firstX)));
console.log(`yards after first contact by first-contact position: ${['DT', 'E', 'LB', 'MLB', 'CB', 'SS', 'FS'].map((k) => `${k} ${f2(ac(out.filter((c) => c.firstBy.replace(/^[LR]/, '') === k || (k === 'LB' && /^[WS]LB$/.test(c.firstBy)))))}`).join(', ')}`);
for (const [name, f] of groups) {
  const g = out.filter(f);
  console.log(`${name.padEnd(14)} first contact by a defender still in a block: ${pct(g.filter((c) => c.firstEngaged).length, g.length)}`);
}
for (const [name, f] of groups) {
  const g = out.filter((c) => f(c) && c.firstEngaged);
  console.log(`${name.padEnd(14)} engaged first contact →  ${by((c) => c.firstOut, g)}`);
}
