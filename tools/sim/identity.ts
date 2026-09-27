// The identity harness (Playtest 2, CLAUDE.md "Every player is himself"):
// twenty pairs of well-known players at the same position with clear
// real-world contrasts, each put in the same practice-roster slot and run
// through the same plays. Reported in numbers a fan knows (top speed in mph,
// separation at the break, yards after the catch and after contact, time to
// throw, catch rate in traffic, tackles broken and missed, pressure). A pair
// fails when a difference it should show is small or goes the wrong way.
//   node tools/run-ts.mjs tools/sim/identity.ts [reps] [--only=Tyreek]
// Runs every milestone; tests/identity.test.ts holds the fastest pairs to it.
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, NEUTRAL, PLAYS, practiceRosters, runToWhistle, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed } from '../../src/sim/outcomes.ts';
import { manOf, type PlayState } from '../../src/sim/state.ts';
import type { DefSlot, OffSlot } from '../../src/sim/types.ts';
import type { SimPlayer } from '../../src/sim/index.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 6);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const YDS_TO_MPH = 3600 / 1760;

type Side = 'off' | 'def';
type Metric = 'topSpeed' | 'sepBreak' | 'yac' | 'trafficCatch' | 'yacContact' | 'broken' | 'missed' | 'truckShare' | 'ttt' | 'offTarget' | 'scramble' | 'cmpAllowed' | 'sepAllowed' | 'tackleRate' | 'pressure' | 'rushWin';
const LABEL: Record<Metric, [string, string, number]> = {
  // [what a fan calls it, unit, the smallest difference that shows]
  topSpeed: ['top speed', 'mph', 0.8],
  sepBreak: ['separation at the break', 'yd', 0.25],
  yac: ['yards after the catch', 'yd', 0.8],
  trafficCatch: ['catch rate in traffic', '%', 8],
  yacContact: ['yards after contact', 'yd', 0.4],
  broken: ['tackles broken a carry', '', 0.04],
  missed: ['tacklers made to miss a carry', '', 0.04],
  truckShare: ['broken tackles that are trucks', '%', 10],
  ttt: ['time to throw', 's', 0.08],
  offTarget: ['throws off target (1+ yd)', '%', 4],
  scramble: ['scramble yards', 'yd', 1],
  cmpAllowed: ['completions allowed', '%', 6],
  sepAllowed: ['separation allowed', 'yd', 0.2],
  tackleRate: ['tackles finished', '%', 8],
  pressure: ['pressure rate', '%', 3],
  rushWin: ['beats his blocker', '%', 5],
};

interface Pair {
  a: [string, string];
  b: [string, string];
  side: Side;
  slot: OffSlot | DefSlot;
  /** Metric → the direction a − b should go (+1: a higher). */
  expect: Partial<Record<Metric, 1 | -1>>;
  why: string;
}

export const PAIRS: Pair[] = [
  { a: ['Tyreek Hill', 'WR'], b: ['Wes Welker', 'WR'], side: 'off', slot: 'X', expect: { topSpeed: 1, yac: 1 }, why: 'Tyreek runs away from everyone; Welker lives underneath' },
  { a: ['Randy Moss', 'WR'], b: ['Hines Ward', 'WR'], side: 'off', slot: 'X', expect: { topSpeed: 1, yac: 1 }, why: 'Moss is gone deep; Ward is the tough possession man' },
  { a: ['DeSean Jackson', 'WR'], b: ['Anquan Boldin', 'WR'], side: 'off', slot: 'X', expect: { topSpeed: 1, trafficCatch: -1 }, why: 'DeSean is speed; Boldin catches it in a crowd' },
  { a: ['Calvin Johnson', 'WR'], b: ['Keenan Allen', 'WR'], side: 'off', slot: 'X', expect: { topSpeed: 1, trafficCatch: 1 }, why: 'Megatron is bigger and faster over the top; Allen wins with routes' },
  { a: ['Larry Fitzgerald', 'WR'], b: ['DeSean Jackson', 'WR'], side: 'off', slot: 'X', expect: { trafficCatch: 1, topSpeed: -1 }, why: 'Fitz catches through contact; DeSean outruns it' },
  { a: ['Barry Sanders', 'RB'], b: ['Jerome Bettis', 'RB'], side: 'off', slot: 'RB', expect: { topSpeed: 1, missed: 1 }, why: 'Barry makes a man miss in a phone booth; the Bus runs through him' },
  { a: ['Chris Johnson', 'RB'], b: ['Christian Okoye', 'RB'], side: 'off', slot: 'RB', expect: { topSpeed: 1, missed: 1 }, why: 'CJ2K is the fastest back there is; the Nigerian Nightmare runs people over' },
  { a: ['Marshall Faulk', 'RB'], b: ['Larry Csonka', 'RB'], side: 'off', slot: 'RB', expect: { topSpeed: 1, missed: 1 }, why: 'Faulk cuts and catches; Csonka pounds it' },
  { a: ['Jamaal Charles', 'RB'], b: ['Brandon Jacobs', 'RB'], side: 'off', slot: 'RB', expect: { missed: 1, truckShare: -1 }, why: 'Charles slips tackles; Jacobs trucks them' },
  { a: ['Dan Marino', 'QB'], b: ['Michael Vick', 'QB'], side: 'off', slot: 'QB', expect: { ttt: -1, scramble: -1, offTarget: -1 }, why: 'Marino gets it out before the rush arrives; Vick runs' },
  { a: ['Peyton Manning', 'QB'], b: ['Lamar Jackson', 'QB'], side: 'off', slot: 'QB', expect: { scramble: -1 }, why: 'Manning from the pocket; Lamar with his legs (their releases rate 98 and 92: the legs are the contrast)' },
  { a: ['Tom Brady', 'QB'], b: ['Steve Young', 'QB'], side: 'off', slot: 'QB', expect: { scramble: -1 }, why: 'Brady stands in; Young takes off' },
  { a: ['Joe Montana', 'QB'], b: ['Joe Namath', 'QB'], side: 'off', slot: 'QB', expect: { offTarget: -1 }, why: 'Montana puts it on the hands; Namath sprays it' },
  { a: ['Rob Gronkowski', 'TE'], b: ['Tony Gonzalez', 'TE'], side: 'off', slot: 'TE', expect: { topSpeed: 1, yac: 1 }, why: 'Gronk runs and breaks tackles after the catch; Gonzalez is the route runner' },
  { a: ['Antonio Gates', 'TE'], b: ['Dave Casper', 'TE'], side: 'off', slot: 'TE', expect: { topSpeed: 1 }, why: 'Gates moves like a big receiver; Casper is the 70s in-line tight end' },
  { a: ['Deion Sanders', 'CB'], b: ['Kam Chancellor', 'S'], side: 'def', slot: 'LCB', expect: { cmpAllowed: -1, sepAllowed: -1 }, why: 'Prime Time shuts down half the field; Kam is a box hitter out of place at corner' },
  { a: ['Darrelle Revis', 'CB'], b: ['Ty Law', 'CB'], side: 'def', slot: 'LCB', expect: { cmpAllowed: -1, sepAllowed: -1 }, why: 'Revis Island' },
  { a: ['Ed Reed', 'S'], b: ['Kam Chancellor', 'S'], side: 'def', slot: 'SS', expect: { tackleRate: -1 }, why: 'Reed is the ballhawk who misses tackles; Kam finishes' },
  { a: ['Reggie White', 'DE'], b: ['Howie Long', 'DE'], side: 'def', slot: 'LE', expect: { rushWin: 1 }, why: 'The Minister of Defense runs through the tackle' },
  { a: ['Lawrence Taylor', 'LB'], b: ['Mike Singletary', 'LB'], side: 'def', slot: 'WLB', expect: { rushWin: 1 }, why: 'LT on the edge; Singletary in the middle (both rushing on the fire zone)' },
];

function with_(side: Side, slot: OffSlot | DefSlot, p: SimPlayer) {
  return side === 'off' ? { offense: { ...base.offense, [slot]: p } as Record<OffSlot, SimPlayer>, defense: base.defense } : { offense: base.offense, defense: { ...base.defense, [slot]: p } as Record<DefSlot, SimPlayer> };
}
const slotAgent = (s: PlayState, slot: string) => s.agents.find((a) => a.slot === slot)!;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) * 60));

/** Throw to the man in `slot` on his break (a tap), a catch-and-run call, upfield after. */
function throwTo(s: PlayState, slot: string, at: number) {
  const icon = s.icons.findIndex((i) => s.agents[i]!.slot === slot) + 1;
  return (st: PlayState) => {
    const t = since(st);
    if (st.phase === 'air') return input({ catchType: 'rac' });
    if (st.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
    return input({ snap: st.phase === 'presnap', throwHeld: icon > 0 && t >= at && t < at + 3 ? icon : 0 });
  };
}

/** Everything one player produces in his slot, in fan numbers. */
export function profile(side: Side, slot: OffSlot | DefSlot, name: string, pos: string): Partial<Record<Metric, number>> {
  const e = findStint(snap, name, pos);
  if (!e) throw new Error(`identity: ${name} (${pos}) not in the snapshot`);
  const r = with_(side, slot, simPlayer(e, 99));
  const out: Partial<Record<Metric, number>> = {};
  const passPlays = PLAYS.filter((p) => !p.run && !p.hailMary);
  const runPlays = PLAYS.filter((p) => p.run && p.run.scheme !== 'sneak');
  const covers = ['cover1', 'cover2', 'cover3', 'cover4', 'cover2man'].map(defById);
  const mk = (play: (typeof PLAYS)[number], def: (typeof covers)[number], k: number, user: boolean) => createPlay({ seed: cellSeed(play, def, k), offense: r.offense, defense: r.defense, play, def, los: 35, toGo: 10, user });

  if (slot === 'X' || slot === 'TE' || slot === 'RB') {
    // Top speed: the fastest he runs in the first 4 s of a play (a go or seam for receivers, runs for backs).
    const speeds: number[] = [];
    const plays = slot === 'RB' ? runPlays : [PLAYS.find((p) => p.id === (slot === 'TE' ? 'ace-te-seam' : 'trips-four-verts'))!];
    for (const play of plays) for (const def of covers) for (let k = 0; k < REPS; k++) {
      const s = mk(play, def, k, false);
      const a = slotAgent(s, slot);
      let top = 0;
      while (!s.result && s.t < 4) {
        stepPlay(s, NEUTRAL);
        top = Math.max(top, Math.hypot(a.vel.x, a.vel.y));
      }
      speeds.push(top);
    }
    out.topSpeed = [...speeds].sort((x, y) => x - y)[Math.floor(speeds.length * 0.9)]! * YDS_TO_MPH;
  }
  if (slot === 'X' || slot === 'TE') {
    // Thrown to on his break (a tap): the catch in traffic (1.5 yd or less), the yards after the catch, separation at the break.
    const traffic: number[] = [];
    const yac: number[] = [];
    const sep: number[] = [];
    const plays = slot === 'TE' ? ['ace-te-seam', 'trips-y-cross', 'heavy-pa-te-leak', 'trips-stick'] : ['doubles-slants', 'doubles-quick-outs', 'doubles-curls', 'singleback-pa-post'];
    for (const id of plays) for (const def of covers) for (let k = 0; k < REPS; k++) for (const at of [45, 70, 95]) {
      const play = PLAYS.find((p) => p.id === id);
      if (!play) continue;
      const s = mk(play, def, k, true);
      runToWhistle(s, throwTo(s, slot, at));
      const p = s.result?.pass;
      if (!p?.attempted || p.target !== slotAgent(s, slot).i || p.sep === undefined) continue;
      sep.push(p.sep);
      if (p.sep < 1.5) traffic.push(p.complete ? 1 : 0);
      if (p.complete) yac.push(s.result!.yards - p.airYards);
    }
    out.trafficCatch = 100 * mean(traffic);
    out.yac = mean(yac);
    out.sepBreak = mean(sep);
  }
  if (slot === 'RB') {
    // Carries: yards after first contact, tackles broken and missed a carry.
    let carries = 0;
    let trucks = 0;
    let broken = 0;
    let missed = 0;
    const after: number[] = [];
    for (const play of runPlays) for (const def of covers) for (let k = 0; k < REPS; k++) {
      const s = runToWhistle(mk(play, def, k, false), () => NEUTRAL);
      const rb = slotAgent(s, 'RB');
      if (!s.events.some((ev) => ev.type === 'handoff' && ev.who?.includes(rb.i)) && s.carrier !== rb.i) continue;
      carries++;
      const hits = s.events.filter((ev) => (ev.type === 'hit' || ev.type === 'brokenTackle' || ev.type === 'missedTackle') && ev.who?.includes(rb.i));
      const br = s.events.filter((ev) => ev.type === 'brokenTackle' && ev.who?.[0] === rb.i);
      broken += br.length;
      trucks += br.filter((ev) => ev.data?.move === 'truck').length;
      missed += s.events.filter((ev) => ev.type === 'missedTackle' && ev.who?.[1] === rb.i).length;
      if (hits[0]?.at && s.result) after.push(s.result.spot - hits[0].at.x);
    }
    out.broken = broken / Math.max(1, carries);
    out.missed = missed / Math.max(1, carries);
    out.truckShare = (100 * trucks) / Math.max(1, broken);
    out.yacContact = mean(after);
  }
  if (slot === 'QB') {
    // The AI's dropbacks: time to throw, throws off target; the player's scramble.
    const ttt: number[] = [];
    let thrown = 0;
    let off = 0;
    for (const play of passPlays) for (const def of covers) for (let k = 0; k < Math.max(2, REPS >> 1); k++) {
      const s = runToWhistle(mk(play, def, k, false), () => NEUTRAL);
      const th = s.events.find((ev) => ev.type === 'throw');
      if (!th) continue;
      ttt.push(th.t - s.snapT);
      thrown++;
      if (Number(th.data?.off ?? 0) > 1) off++;
    }
    out.ttt = mean(ttt);
    out.offTarget = (100 * off) / Math.max(1, thrown);
    const scr: number[] = [];
    for (const id of ['trips-four-verts', 'doubles-dagger', 'doubles-slants', 'trips-stick']) for (const def of covers) for (let k = 0; k < REPS; k++) for (const dy of [0.6, -0.6]) {
      const s = mk(PLAYS.find((p) => p.id === id)!, def, k, true);
      runToWhistle(s, (st) => {
        const t = since(st);
        return input({ snap: st.phase === 'presnap', scramble: t === 90, move: t >= 90 ? { x: 1, y: dy } : { x: 0, y: 0 } });
      });
      if (s.result) scr.push(s.result.yards);
    }
    out.scramble = mean(scr);
  }
  if (side === 'def' && (slot === 'LCB' || slot === 'SS')) {
    // Throws at the man he covers (man calls), and every tackle he tries.
    let at = 0;
    let cmp = 0;
    const sep: number[] = [];
    let tries = 0;
    let made = 0;
    for (const play of passPlays) for (const def of ['cover1', 'cover2man', 'cover1off'].map(defById)) for (let k = 0; k < REPS; k++) {
      const s = mk(play, def, k, false);
      const me = slotAgent(s, slot);
      const man = manOf(s, me);
      runToWhistle(s, () => NEUTRAL);
      // His tackle rolls: won (a hit that isn't him joining a pile), missed, or broken.
      for (const ev of s.events) {
        if (ev.type === 'hit' && ev.who?.[0] === me.i && !ev.data?.join) {
          tries++;
          made++;
        }
        if (ev.type === 'missedTackle' && ev.who?.[0] === me.i) tries++;
        if (ev.type === 'brokenTackle' && ev.who?.[1] === me.i) tries++;
      }
      const p = s.result?.pass;
      if (!man || !p?.attempted || p.target !== man.i) continue;
      at++;
      cmp += p.complete ? 1 : 0;
      if (p.sep !== undefined) sep.push(p.sep);
    }
    out.cmpAllowed = (100 * cmp) / Math.max(1, at);
    out.sepAllowed = mean(sep);
    out.tackleRate = (100 * made) / Math.max(1, tries);
  }
  if (side === 'def' && (slot === 'LE' || slot === 'WLB')) {
    let drops = 0;
    let press = 0;
    let wins = 0;
    for (const play of passPlays) for (const def of (slot === 'WLB' ? ['firezone'] : ['cover1', 'cover3', 'cover2']).map(defById)) for (let k = 0; k < REPS; k++) {
      const s = mk(play, def, k, false);
      const me = slotAgent(s, slot);
      runToWhistle(s, () => NEUTRAL);
      drops++;
      if (s.pressures.some((p) => p.by === me.i)) press++;
      // Beat his man: shed a block, or never blocked, before the ball's out (or the whistle).
      const out = s.events.find((ev) => ev.type === 'throw')?.t ?? Infinity;
      if (s.events.some((ev) => ev.type === 'shed' && ev.who?.[0] === me.i && ev.t < out) || s.pressures.some((p) => p.by === me.i && p.beat < 0)) wins++;
    }
    out.pressure = (100 * press) / Math.max(1, drops);
    out.rushWin = (100 * wins) / Math.max(1, drops);
  }
  return out;
}

export interface PairResult { pair: Pair; a: Partial<Record<Metric, number>>; b: Partial<Record<Metric, number>>; checks: { m: Metric; diff: number; ok: boolean }[] }

export function runPair(p: Pair): PairResult {
  const a = profile(p.side, p.slot, ...p.a);
  const b = profile(p.side, p.slot, ...p.b);
  const checks = (Object.entries(p.expect) as [Metric, 1 | -1][]).map(([m, dir]) => {
    const diff = (a[m] ?? NaN) - (b[m] ?? NaN);
    return { m, diff, ok: diff * dir >= LABEL[m][2] };
  });
  return { pair: p, a, b, checks };
}

if (process.argv[1]?.endsWith('identity.ts')) {
  let pass = 0;
  const fmt = (m: Metric, v: number | undefined) => (v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(LABEL[m][1] === '%' || LABEL[m][1] === 'mph' ? 1 : 2)}${LABEL[m][1] === '%' ? '%' : LABEL[m][1] ? ' ' + LABEL[m][1] : ''}`);
  for (const p of PAIRS.filter((x) => !ONLY || x.a[0].includes(ONLY) || x.b[0].includes(ONLY))) {
    const r = runPair(p);
    const ok = r.checks.every((c) => c.ok);
    pass += ok ? 1 : 0;
    console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${p.a[0]} vs ${p.b[0]} (${p.slot}): ${p.why}`);
    for (const m of Object.keys({ ...r.a, ...r.b }) as Metric[]) {
      const c = r.checks.find((x) => x.m === m);
      console.log(`   ${LABEL[m][0].padEnd(32)} ${fmt(m, r.a[m]).padStart(10)}  ${fmt(m, r.b[m]).padStart(10)}${c ? `   ${c.ok ? 'ok' : 'FAILS'} (needs ${p.expect[m]! > 0 ? '+' : '−'}${LABEL[m][2]})` : ''}`);
    }
  }
  console.log(`\n${pass} of ${ONLY ? 'the selected' : PAIRS.length} pairs pass`);
}
