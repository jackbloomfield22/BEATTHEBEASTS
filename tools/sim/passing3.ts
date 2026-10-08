// Passing round 3 (docs/passing/PASSING3.md): the player's own throws, as
// the owner plays them. The receiver key tapped (a driven ball) or held
// (touch) at three moments against each route (before his break, on it,
// after it), on the practice rosters, and per throw:
//   - the timing: the press, the release, the target's break, the arrival;
//   - the lead: where the ball was meant against where he was at the
//     release (did it lead him?) and where he really was when it got there
//     (the lead's own error, before the cone);
//   - the target's run in the air: his speed at the release, the slowest he
//     ran while it was up, at the arrival, and how far he left the path he'd
//     have run with no throw (the same play run to the whistle unthrown);
//   - everyone else's routes in the air: the same, for the other route runners;
//   - the catch: how far from him the ball was when it reached his hands,
//     and his speed at the catch and 0.3 s on (the run after it).
//   node tools/run-ts.mjs tools/sim/passing3.ts [--seeds=N] [--detail] [--case=slant]
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 8);
const DETAIL = args.has('detail');
const ONLY = args.get('case');
const DEFS = (args.get('defs') ?? 'cover3,cover1,cover2,cover4').split(',');

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);

interface Case {
  id: string;
  play: string;
  icon: number;
  hot?: RouteName;
  /** The route point whose passing is his break (index into the route's points). */
  brk: number;
  /** Hold (ticks): touch. */
  hold?: number;
}
const CASES: Case[] = [
  { id: 'slant', play: 'doubles-slants', icon: 1, brk: 0 },
  { id: 'out', play: 'doubles-curls', icon: 1, hot: 'out', brk: 0 },
  { id: 'dig', play: 'singleback-drive', icon: 2, brk: 0 },
  { id: 'curl', play: 'doubles-curls', icon: 1, brk: 0 },
  { id: 'post', play: 'singleback-pa-post', icon: 1, brk: 0, hold: 14 },
  { id: 'go', play: 'trips-four-verts', icon: 4, brk: -1, hold: 16 },
  { id: 'cross', play: 'trips-y-cross', icon: 1, brk: 1 },
  { id: 'comeback', play: 'doubles-curls', icon: 1, hot: 'comeback', brk: 0 },
].filter((c) => !ONLY || c.id === ONLY);

const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));

function make(c: Case, seed: number, def: string): PlayState {
  return createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
}
function script(c: Case, at: number) {
  return (s: PlayState): InputFrame => {
    if (s.phase === 'presnap') return input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
    const t = since(s);
    if (s.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
    return input({ throwHeld: at >= 0 && t >= at && t < at + (c.hold ?? 4) ? c.icon : 0 });
  };
}
type Pos = { x: number; y: number; vx: number; vy: number; idx: number };
function run(c: Case, seed: number, def: string, at: number): { s: PlayState; tr: Pos[][] } {
  const s = make(c, seed, def);
  const f = script(c, at);
  const tr: Pos[][] = [];
  for (let k = 0; k < 60 * 12 && !s.result; k++) {
    stepPlay(s, f(s));
    tr.push(s.agents.map((a) => ({ x: a.pos.x, y: a.pos.y, vx: a.vel.x, vy: a.vel.y, idx: a.route?.idx ?? -1 })));
  }
  return { s, tr };
}
const sp = (p: Pos) => Math.hypot(p.vx, p.vy);
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-');

interface Row {
  c: string;
  when: string;
  pressT: number;
  relT: number;
  brkT: number;
  T: number;
  lead: number;
  leadRun: number;
  leadErr: number;
  along: number;
  across: number;
  ballErr: number;
  v0: number;
  vmin: number;
  vArr: number;
  vmax: number;
  dev: number;
  othersDev: number;
  othersSlow: number;
  catchOff: number;
  catchEarly: number;
  vCatch: number;
  vAfter: number;
  out: string;
  yds: number;
}
const rows: Row[] = [];
for (const c of CASES) {
  for (const def of DEFS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      // The unthrown play: his break, and everyone's path with no throw.
      const base = run(c, seed, def, -1);
      const s0 = base.s;
      const tgt = s0.icons[c.icon - 1]!;
      let brkTick = -1;
      if (c.brk >= 0) {
        for (let k = 1; k < base.tr.length; k++) if (base.tr[k]![tgt]!.idx > c.brk && base.tr[k - 1]![tgt]!.idx <= c.brk) {
          brkTick = k;
          break;
        }
      }
      const snapTick = Math.round(s0.snapT * 60);
      const rel = Math.round(60 * 0.36); // ~ the practice QB's release (s), for the press times
      const set = Math.round(s0.setup.play.drop.set * 60);
      const brk = brkTick >= 0 ? brkTick - snapTick : set + 30;
      const whens: [string, number][] = [
        ['early', brk - rel - 15],
        ['onTime', brk - rel],
        ['late', brk + 20],
      ];
      for (const [when, at0] of whens) {
        const at = Math.max(22, at0);
        const { s, tr } = run(c, seed, def, at);
        const th = s.events.find((e) => e.type === 'throw');
        if (!th) continue;
        const relTick = Math.round(th.t * 60);
        const T = s.ball.releaseT >= 0 ? 0 : 0;
        void T;
        const meant = { x: Number(th.data?.meantX), y: Number(th.data?.meantY) };
        const aimed = th.at!;
        const P = (tick: number, i: number) => tr[Math.min(tr.length - 1, Math.max(0, tick - 1))]![i]!;
        const Pb = (tick: number, i: number) => base.tr[Math.min(base.tr.length - 1, Math.max(0, tick - 1))]![i]!;
        const ce = s.events.find((e) => e.who?.[0] !== undefined && ['catch', 'drop', 'deflection', 'interception', 'bobble'].includes(e.type));
        // The arrival as planned: the release plus the flight (the throw event doesn't carry T; arrive is overwritten by a bobble).
        let arrTick = -1;
        // Find the planned arrival from the flight: the tick the ball's z first crosses down through the aim's height near the aim.
        const flightT = Number(th.data?.T ?? NaN);
        void flightT;
        const atRel = P(relTick, tgt);
        // Reconstruct T: replay to the release and read ball.arrive.
        {
          const g = make(c, seed, def);
          const f = script(c, at);
          while (!g.result && g.events.every((e) => e.type !== 'throw')) stepPlay(g, f(g));
          arrTick = Math.round(g.ball.arrive * 60);
        }
        const Tf = (arrTick - relTick) / 60;
        const atArr = P(arrTick, tgt);
        const baseArr = Pb(arrTick, tgt);
        const v = sp(atArr) > 0.5 ? { x: atArr.vx / sp(atArr), y: atArr.vy / sp(atArr) } : { x: 1, y: 0 };
        const ex = meant.x - atArr.x;
        const ey = meant.y - atArr.y;
        let vmin = Infinity;
        for (let k = relTick; k <= Math.min(arrTick, tr.length); k++) vmin = Math.min(vmin, sp(P(k, tgt)));
        // Everyone else's routes in the air.
        let odev = 0;
        let oslow = 0;
        let n = 0;
        for (const j of s.icons) {
          if (j === tgt) continue;
          const a = s.agents[j]!;
          if (!a.route) continue;
          const end = Math.min(arrTick, tr.length);
          odev += d2(P(end, j), Pb(end, j));
          oslow += sp(P(end, j)) / Math.max(1, sp(Pb(end, j)));
          n++;
        }
        const catchTick = ce ? Math.round(ce.t * 60) : -1;
        const res = s.result!;
        const out = res.pass?.complete ? 'catch' : res.pass?.intercepted ? 'INT' : ce?.type ?? 'inc';
        rows.push({
          c: `${c.id}/${def}/${seed}`,
          when,
          pressT: at / 60,
          relT: (relTick - snapTick) / 60,
          brkT: brkTick >= 0 ? (brkTick - snapTick) / 60 : NaN,
          T: Tf,
          lead: d2(meant, atRel),
          leadRun: sp(atRel) * Tf,
          leadErr: Math.hypot(ex, ey),
          along: ex * v.x + ey * v.y,
          across: -ex * v.y + ey * v.x,
          ballErr: d2(aimed, atArr),
          v0: sp(atRel),
          vmin,
          vArr: sp(atArr),
          vmax: s.agents[tgt]!.fx.vmax,
          dev: d2(atArr, baseArr),
          othersDev: n ? odev / n : NaN,
          othersSlow: n ? oslow / n : NaN,
          catchOff: catchTick >= 0 ? (ce!.at ? d2(ce!.at, { x: s.ball.pos.x, y: s.ball.pos.y }) : NaN) : NaN,
          catchEarly: catchTick >= 0 ? (arrTick - catchTick) / 60 : NaN,
          vCatch: catchTick >= 0 ? sp(P(catchTick, tgt)) : NaN,
          vAfter: catchTick >= 0 && catchTick + 18 <= tr.length ? sp(P(catchTick + 18, tgt)) : NaN,
          out,
          yds: res.yards,
        });
        if (DETAIL) {
          const rr = rows[rows.length - 1]!;
          console.log(
            `${rr.c.padEnd(20)} ${when.padEnd(6)} press ${f2(rr.pressT)} rel ${f2(rr.relT)} brk ${f2(rr.brkT)} T ${f2(rr.T)} | lead ${f1(rr.lead)} (run ${f1(rr.leadRun)}) err ${f2(rr.leadErr)} along ${f2(rr.along)} across ${f2(rr.across)} ball ${f2(rr.ballErr)} | v ${f1(rr.v0)}→min ${f1(rr.vmin)}→${f1(rr.vArr)} /${f1(rr.vmax)} dev ${f1(rr.dev)} | others dev ${f1(rr.othersDev)} pace ${f2(rr.othersSlow)} | catch early ${f2(rr.catchEarly)} v ${f1(rr.vCatch)}→${f1(rr.vAfter)} | ${out} ${f1(rr.yds)}`,
          );
        }
      }
    }
  }
}

const mean = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
};
console.log('\ncase      when    n  press  rel   brk   T    | lead  run   leadErr along across ball  | v0   vmin  vArr  dev  | oDev oPace | cEarly vC   vAfter | cmp   yds');
for (const c of CASES)
  for (const when of ['early', 'onTime', 'late']) {
    const R = rows.filter((x) => x.c.startsWith(c.id + '/') && x.when === when);
    if (!R.length) continue;
    const m = (k: keyof Row) => mean(R.map((x) => x[k] as number));
    const cmp = R.filter((x) => x.out === 'catch').length / R.length;
    console.log(
      `${c.id.padEnd(9)} ${when.padEnd(6)} ${String(R.length).padStart(3)}  ${f2(m('pressT'))} ${f2(m('relT'))} ${f2(m('brkT'))} ${f2(m('T'))} | ${f1(m('lead')).padStart(5)} ${f1(m('leadRun')).padStart(5)} ${f2(m('leadErr')).padStart(6)} ${f2(m('along')).padStart(5)} ${f2(m('across')).padStart(5)} ${f2(m('ballErr')).padStart(5)} | ${f1(m('v0')).padStart(4)} ${f1(m('vmin')).padStart(5)} ${f1(m('vArr')).padStart(5)} ${f1(m('dev')).padStart(4)} | ${f1(m('othersDev')).padStart(4)} ${f2(m('othersSlow')).padStart(5)} | ${f2(m('catchEarly')).padStart(5)} ${f1(m('vCatch')).padStart(4)} ${f1(m('vAfter')).padStart(5)} | ${(cmp * 100).toFixed(0).padStart(3)}% ${f1(m('yds')).padStart(5)}`,
    );
  }
