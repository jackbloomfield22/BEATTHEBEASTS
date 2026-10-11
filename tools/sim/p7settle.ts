// Passing round 7 (docs/passing/PASSING7.md): the settle routes with the
// ball in the air. Every throw of every base pass play against every call
// (the AI book), and the player's tap on the cue to the curl, the comeback,
// the hitch and the stick: for the man it's thrown to on a route that
// settles (a curl, a hitch, a comeback, a stick, a spot, a sit, a
// checkdown), how long he stood (under 1.5 yd/s with the ball more than a
// quarter second away), how long he'd been sat at the release, and his pace
// back to the QB at the catch (+ coming back to the ball).
//   node tools/run-ts.mjs tools/sim/p7settle.ts [--seeds=4] [--detail=curl]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, defById, input, PASS_PLAYS, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '../../src/sim/index.ts';
import { throwCue } from '../../src/sim/cue.ts';
import type { OffSlot } from '../../src/sim/types.ts';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const SEEDS = Number(args.get('seeds') ?? 4);
const DETAIL = args.get('detail');
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
interface Row {
  route: string;
  stood: number;
  satAtRel: number;
  back: number;
  sp: number;
  out: string;
  id: string;
}
function routeOf(s: PlayState, slot: OffSlot): string {
  const hot = (s.hot as Partial<Record<OffSlot, RouteName>>)[slot];
  const as = s.setup.play.assign[slot as keyof typeof s.setup.play.assign] as { route?: string } | undefined;
  return hot ?? as?.route ?? '?';
}
function follow(s: PlayState, step: (s: PlayState) => InputFrame, id: string): Row | null {
  let tgt = -1;
  let stood = 0;
  let satAtRel = 0;
  let satSince = -1;
  let row: Row | null = null;
  for (let k = 0; k < 1200 && !s.result; k++) {
    const f = step(s);
    // Sat since (any receiver: the one it's thrown to is known at the release).
    if (s.phase === 'air' && s.ball.target >= 0 && tgt < 0) {
      tgt = s.ball.target;
      const r = s.agents[tgt]!;
      satAtRel = satSince >= 0 && r.route && r.route.idx >= r.route.pts.length ? s.t - satSince : 0;
    }
    if (tgt < 0) {
      // Track the earliest moment every route runner reached the end of a settle route (for the one it's thrown to).
      for (const a of s.agents) if (a.side === 'off' && a.route && a.route.idx >= a.route.pts.length && a.route.sit[a.route.pts.length - 1] && (a.mem.p7sat as number | undefined) === undefined) a.mem.p7sat = s.t;
    }
    if (tgt >= 0 && satSince < 0) satSince = (s.agents[tgt]!.mem.p7sat as number | undefined) ?? -1;
    if (tgt >= 0 && satSince >= 0 && satAtRel === 0 && s.phase === 'air') satAtRel = Math.max(0, s.ball.releaseT - satSince);
    const wasAir = s.phase === 'air' && s.ball.target === tgt && tgt >= 0;
    let pre: { vx: number; vy: number } | null = null;
    if (wasAir) {
      const r = s.agents[tgt]!;
      const sp = Math.hypot(r.vel.x, r.vel.y);
      if (sp < 1.5 && s.ball.arrive - s.t > 0.25) stood += 1 / 60;
      pre = { vx: r.vel.x, vy: r.vel.y };
    }
    stepPlay(s, f);
    if (wasAir && !row && (s.phase !== 'air' || s.ball.target !== tgt)) {
      const r = s.agents[tgt]!;
      const qb = s.agents[s.ball.thrower] ?? s.agents[s.qb]!;
      const dx = qb.pos.x - r.pos.x;
      const dy = qb.pos.y - r.pos.y;
      const k2 = Math.hypot(dx, dy) || 1;
      row = { route: routeOf(s, r.slot as OffSlot), stood, satAtRel, back: (pre!.vx * dx + pre!.vy * dy) / k2, sp: Math.hypot(pre!.vx, pre!.vy), out: '', id };
    }
  }
  while (!s.result) stepPlay(s, input({}));
  if (!row || !s.result?.pass?.attempted) return null;
  row.out = s.result.pass.complete ? 'C' : s.result.pass.intercepted ? 'I' : 'X';
  return row;
}
const SETTLE = ['curl', 'hitch', 'comeback', 'stick', 'spot', 'sit', 'checkdown', 'flat', 'qout', 'out'];
const book: Row[] = [];
for (const play of PASS_PLAYS.filter((p) => !p.hailMary && p.type !== 'screen'))
  for (const def of DEF_CALLS)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = createPlay({ seed, offense: base.offense, defense: base.defense, play, def, los: 30, toGo: 10, user: false });
      const r = follow(s, () => input({}), `${play.id}/${def.id}/${seed}`);
      if (r && SETTLE.includes(r.route)) book.push(r);
    }
const cue: Row[] = [];
const CUE: { id: string; play: string; icon: number; hot?: RouteName }[] = [
  { id: 'curl', play: 'doubles-curls', icon: 1 },
  { id: 'comeback', play: 'doubles-curls', icon: 2, hot: 'comeback' },
  { id: 'hitch', play: 'doubles-hitch-seam', icon: 1 },
  { id: 'stick', play: 'trips-stick', icon: 1 },
];
for (const c of CUE)
  for (const def of ['cover3', 'cover1', 'cover2', 'cover4'])
    for (let seed = 1; seed <= 16; seed++) {
      const s = createPlay({ seed, offense: base.offense, defense: base.defense, play: playById(c.play), def: defById(def), los: 30, toGo: 10, user: true });
      let press = -1;
      const r = follow(
        s,
        (st) => {
          if (st.phase === 'presnap') return input({ snap: true, hotRoute: c.hot ? { icon: c.icon, route: c.hot } : null });
          if (st.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
          const a = st.agents[st.icons[c.icon - 1]!]!;
          const q = throwCue(st, a);
          if (press < 0 && q && st.t >= q.ballOut - q.release - 1e-9) press = st.t;
          return input({ throwHeld: press >= 0 && st.t < press + 4 / 60 ? c.icon : 0 });
        },
        `${c.id}/${def}/${seed}`,
      );
      if (r) cue.push({ ...r, route: `cue ${c.id}` });
    }
function table(title: string, rows: Row[]): void {
  console.log(title);
  console.log('route          n   stood>0.2s  mean stood  sat at release  back at catch  speed  cmp');
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.route, [...(by.get(r.route) ?? []), r]);
  for (const [k, R] of [...by].sort((a, b) => b[1].length - a[1].length)) {
    const m = (g: (r: Row) => number) => R.reduce((a, r) => a + g(r), 0) / R.length;
    console.log(`${k.padEnd(13)} ${String(R.length).padStart(4)}   ${((100 * R.filter((r) => r.stood > 0.2).length) / R.length).toFixed(0).padStart(4)}%      ${m((r) => r.stood).toFixed(2)}        ${m((r) => r.satAtRel).toFixed(2)}         ${m((r) => r.back).toFixed(2).padStart(5)}      ${m((r) => r.sp).toFixed(1)}   ${((100 * R.filter((r) => r.out === 'C').length) / R.length).toFixed(0)}%`);
    if (DETAIL && k.endsWith(DETAIL)) for (const r of R) console.log(`    ${r.id} stood ${r.stood.toFixed(2)} sat ${r.satAtRel.toFixed(2)} back ${r.back.toFixed(2)} sp ${r.sp.toFixed(1)} ${r.out}`);
  }
}
table('AI book (settle routes)', book);
table('Player on the cue', cue);
const curlish = book.filter((r) => ['curl', 'hitch', 'comeback', 'stick'].includes(r.route));
console.log(`AI book curl/hitch/comeback/stick: ${curlish.length} throws, stood > 0.2 s on ${((100 * curlish.filter((r) => r.stood > 0.2).length) / Math.max(1, curlish.length)).toFixed(0)}%`);
