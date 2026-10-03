// Ground and Pound (the trait catalog: "late in drives the Beasts' front
// tires faster against the run (their stamina drain +10%)"): a drive of
// designed runs, AI on both sides, the fatigue carried snap to snap the way
// the game does (src/game/fatigue.ts), behind the 1980s 49ers' line with and
// without the trait. Reported: the Beasts' front's (linemen and linebackers)
// average fatigue going into each snap, and what it costs their top speed.
//   node tools/run-ts.mjs tools/sim/groundpound.ts [drives]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, defenseFor, NEUTRAL, offenseFor, playById, practiceRosters, runToWhistle, type ContendersRoster, type DefSlot, type OffSlot, type SnapshotLike } from '../../src/sim/index.ts';
import { afterSnap, defenseSnaps, emptyFatigue, fatigueOf, type Snap } from '../../src/game/fatigue.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const DRIVES = Number(process.argv[2] ?? 8);
const RUNS = ['singleback-inside-zone', 'iform-power', 'singleback-outside-zone', 'iform-iso', 'singleback-power', 'pistol-stretch'].map(playById);
const SNAPS = 12;

function drive(team: ContendersRoster, d: number): number[] {
  let f = emptyFatigue();
  const out: number[] = [];
  for (let k = 0; k < SNAPS; k++) {
    const play = RUNS[(k + d) % RUNS.length]!;
    const call = DEF_CALLS[(k * 3 + d) % DEF_CALLS.length]!;
    const offense = offenseFor(play, team);
    const defense = defenseFor(call, base.beasts);
    const fatigue: Partial<Record<OffSlot | DefSlot, number>> = {};
    for (const [slot, p] of [...Object.entries(offense), ...Object.entries(defense)]) if (fatigueOf(f, p.id) > 0) fatigue[slot as OffSlot] = fatigueOf(f, p.id);
    const front = Object.values(defense).filter((p) => ['DE', 'DT', 'LB'].includes(p.pos));
    out.push(front.reduce((t, p) => t + fatigueOf(f, p.id), 0) / front.length);
    const s = createPlay({ seed: 9000 + d * 101 + k, offense, defense, play, def: call, los: 35, toGo: 10, user: false, fatigue });
    runToWhistle(s, () => NEUTRAL);
    const snaps: Snap[] = s.off.map((i) => {
      const a = s.agents[i]!;
      return { id: a.p.id, start: Math.max(0.2, 1 - (fatigue[a.slot as OffSlot] ?? 0)), end: a.stamina, staminaAttr: a.fx.a('stamina'), touched: a.i === s.carrier, dropback: false, traits: a.p.traits ?? [], hit: 0 };
    });
    f = afterSnap(f, [...snaps, ...defenseSnaps(s)], false);
  }
  return out;
}

const withGp = (gp: boolean): ContendersRoster => {
  const ol = base.team.OL.map((p) => ({ ...p, traits: [...(p.traits ?? []).filter((t) => t !== 'ground-and-pound'), ...(gp ? ['ground-and-pound'] : [])] })) as ContendersRoster['OL'];
  return { ...base.team, OL: ol };
};
for (const gp of [false, true]) {
  const avg = Array.from({ length: SNAPS }, () => 0);
  for (let d = 0; d < DRIVES; d++) drive(withGp(gp), d).forEach((v, k) => (avg[k]! += v / DRIVES));
  const speed = (f: number) => `${(-14 * f).toFixed(1)}%`; // movement.ts: top speed × (0.86 + 0.14·stamina)
  console.log(`${gp ? 'Ground and Pound' : 'without the trait'}: the Beasts' front's fatigue into snaps 1, 4, 8, 12: ${[0, 3, 7, 11].map((k) => avg[k]!.toFixed(3)).join(', ')}  (top speed ${[3, 7, 11].map((k) => speed(avg[k]!)).join(', ')})`);
}
