// The usage traits, measured (the trait catalog's lines that change who gets
// the ball and how a man runs his job, src/sim/usage.ts and ai.ts): each is
// the same player with and without the trait, the AI QB over the same book
// against the same calls and seeds, in numbers a fan would see.
//   node tools/run-ts.mjs tools/sim/usagefx.ts [reps] [--only=receiving|third|slot|volume|patient|hback|maestro]
import { readFileSync } from 'node:fs';
import { BASE_PLAYS, createPlay, DEF_CALLS, defById, input, NEUTRAL, playById, practiceRosters, runToWhistle, stepPlay, type ContendersRoster, type OffPlay, type PlayState, type SnapshotLike, type SimPlayer } from '../../src/sim/index.ts';
import { findStint, simPlayer } from '../../src/sim/roster.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { dist } from '../../src/sim/vec.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const REPS = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 6);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const HASH = [3.08, 0, -3.08];

const p = (name: string, pos: string): SimPlayer => simPlayer(findStint(snap, name, pos)!, 1);
const strip = (q: SimPlayer, ...ids: string[]): SimPlayer => ({ ...q, traits: (q.traits ?? []).filter((t) => !ids.includes(t)) });
const add = (q: SimPlayer, ...ids: string[]): SimPlayer => ({ ...q, traits: [...(q.traits ?? []), ...ids] });
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;

interface Snap {
  play: OffPlay;
  s: PlayState;
}
/** Every play of `plays` against every call in `calls`, REPS each, the AI on both sides (the harness's hashes and flips); `hot` calls hot routes at the line. */
function book(team: ContendersRoster, plays: OffPlay[], calls = DEF_CALLS, hot?: (s: PlayState) => { icon: number; route: import('../../src/sim/index.ts').RouteName } | null, watch?: (s: PlayState) => void, down = 1): Snap[] {
  const out: Snap[] = [];
  for (const play of plays) {
    for (const def of calls) {
      for (let k = 0; k < REPS; k++) {
        const sd = sidesFor({ ...base, team }, play, def);
        const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASH[k % 3], toGo: 10, down, user: false, flip: k % 2 === 1, autoSnap: !hot });
        if (hot) {
          const h = hot(s);
          stepPlay(s, input({ hotRoute: h ?? undefined }));
          stepPlay(s, input({ snap: true }));
        }
        runToWhistle(s, (st) => {
          watch?.(st);
          return NEUTRAL;
        });
        out.push({ play, s });
      }
    }
  }
  return out;
}
const target = (s: PlayState) => (s.pass?.attempted && s.ball.target >= 0 ? s.agents[s.ball.target]! : null);
const caught = (s: PlayState) => s.events.some((e) => e.type === 'catch' && e.who?.[0] === s.ball.target);
const yards = (s: PlayState) => (s.result!.offenseBall ? s.result!.yards : 0);

function receivers(label: string, snaps: Snap[], who: (s: PlayState) => boolean): void {
  let att = 0;
  let tg = 0;
  let c = 0;
  let y = 0;
  let sacks = 0;
  for (const { s } of snaps) {
    const t = target(s);
    if (s.pass?.attempted) att++;
    if (s.result?.sack) sacks++;
    if (!t || !who(s)) continue;
    tg++;
    if (caught(s)) {
      c++;
      y += yards(s);
    }
  }
  console.log(`  ${label.padEnd(40)} his targets ${pct(tg, att)} of throws (${tg}), caught ${pct(c, tg)}, ${(y / Math.max(1, tg)).toFixed(2)} yd a target; sacks ${pct(sacks, snaps.length)} of snaps`);
}

const PASS = BASE_PLAYS.filter((q) => !q.run);
const RUNS = BASE_PLAYS.filter((q) => q.run);
const team = base.team;

if (!ONLY || ONLY === 'receiving') {
  // Receiving Back: Roger Craig (also a Third-Down Back) with and without it, the whole pass book.
  console.log('Receiving Back (Roger Craig, the pass book)');
  for (const [label, rb] of [['Craig without Receiving Back', strip(team.RB, 'receiving-back')], ['Craig (Receiving Back)', team.RB]] as const) receivers(label, book({ ...team, RB: rb }, PASS), (s) => s.agents[s.ball.target]!.slot === 'RB');
}
if (!ONLY || ONLY === 'third') {
  // Third-Down Back against the blitz calls: does the pressure get home?
  console.log('Third-Down Back (Roger Craig against Cover 1 Blitz and the Fire Zone, the drop-backs, 3rd and 10)');
  const blitz = ['cover1blitz', 'firezone'].map(defById);
  const drops = PASS.filter((q) => q.type === 'dropback' || q.type === 'shot' || q.type === 'quick');
  for (const [label, rb] of [['Craig without Third-Down Back', strip(team.RB, 'third-down-back')], ['Craig (Third-Down Back)', team.RB]] as const) {
    const snaps = book({ ...team, RB: rb }, drops, blitz, undefined, undefined, 3);
    let pressured = 0;
    let picked = 0;
    for (const { s } of snaps) {
      if (s.pressureT >= 0 && s.pressureT - s.snapT < 2.0) pressured++;
      if (s.agents[s.slot.RB!]!.mem.pickup !== undefined) picked++;
    }
    receivers(label, snaps, (s) => s.agents[s.ball.target]!.slot === 'RB');
    console.log(`    pressure inside 2 s ${pct(pressured, snaps.length)}; he picked up a blitzer on ${pct(picked, snaps.length)} of snaps`);
  }
}
if (!ONLY || ONLY === 'slot') {
  // Slot Weapon: Wes Welker in the slot on the plays where the slot runs a
  // short breaking route; the player throws to him a beat after his break
  // (the same tick rule with and without the trait), against man and zone.
  console.log('Slot Weapon (Wes Welker in the slot: stick, hitch, quick out, quick in, spot; thrown to a beat after his break)');
  const welker = p('Wes Welker', 'WR');
  const plays = PASS.filter((q) => {
    const a = q.assign.SLOT;
    return a.kind === 'route' && ['stick', 'hitch', 'qout', 'qin', 'spot'].includes(a.route);
  });
  console.log(`    plays: ${plays.map((q) => q.id).join(', ')}`);
  for (const calls of [['cover1', 'cover1off', 'cover2man', 'cover1blitz'], ['cover3', 'cover2', 'cover4', 'tampa2']]) {
    for (const [label, wr] of [['Welker without Slot Weapon', strip(welker, 'slot-weapon')], ['Welker (Slot Weapon)', welker]] as const) {
      let n = 0;
      let c = 0;
      let y = 0;
      let sepRel = 0;
      for (const play of plays) {
        for (const d of calls.map(defById)) {
          for (let k = 0; k < REPS * 2; k++) {
            const sd = sidesFor({ ...base, team: { ...team, WR3: wr } }, play, d);
            const s = createPlay({ seed: cellSeed(play, d, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASH[k % 3], toGo: 10, user: true, flip: k % 2 === 1 });
            const icon = s.icons.indexOf(s.slot.SLOT!) + 1;
            const a = s.agents[s.slot.SLOT!]!;
            let fireAt = -1;
            let rel = -1;
            runToWhistle(s, (st) => {
              if (st.phase === 'presnap') return input({ snap: true });
              if (st.phase === 'air') {
                if (rel < 0) rel = Math.min(...st.def.map((i) => dist(st.agents[i]!.pos, a.pos)));
                return input({ catchType: 'rac' });
              }
              if (st.phase === 'carrier') return input({ move: { x: 1, y: 0 } });
              // A beat after his break: heading to his last point.
              if (fireAt < 0 && a.route && a.route.idx >= a.route.pts.length - 1) fireAt = st.tick + 6;
              return input({ throwHeld: fireAt > 0 && st.tick >= fireAt && st.tick < fireAt + 3 ? icon : 0 });
            });
            if (rel < 0 || s.ball.target !== a.i) continue;
            n++;
            sepRel += rel;
            const caughtIt = s.events.some((e) => e.type === 'catch' && e.who?.[0] === a.i);
            if (caughtIt) {
              c++;
              y += yards(s);
            }
          }
        }
      }
      console.log(`  ${`${label} vs ${calls[0]!.startsWith('cover1') ? 'man' : 'zone'}`.padEnd(40)} thrown to: caught ${pct(c, n)} of ${n}, ${(y / Math.max(1, n)).toFixed(2)} yd a throw; nearest defender at the release ${(sepRel / Math.max(1, n)).toFixed(2)} yd`);
      // The AI QB on the same plays: he throws to the slot when he's open, so this is what the read buys a drive.
      const snaps = book({ ...team, WR3: wr }, plays, calls.map(defById));
      let ty = 0;
      let ok = 0;
      for (const { s } of snaps) {
        ty += yards(s);
        if (yards(s) >= 4) ok++;
      }
      receivers('  the AI QB:', snaps, (st) => st.agents[st.ball.target]!.slot === 'SLOT');
      console.log(`      the plays: ${(ty / snaps.length).toFixed(2)} yd a snap, 4+ yd on ${pct(ok, snaps.length)}`);
    }
  }
}
if (!ONLY || ONLY === 'volume') {
  console.log('Volume TE (Travis Kelce, KC 2020s, the pass book)');
  const kelce = p('Travis Kelce', 'TE');
  for (const [label, te] of [['Kelce without Volume TE', strip(kelce, 'volume-te')], ['Kelce (Volume TE)', kelce]] as const) receivers(label, book({ ...team, TE: te }, PASS), (s) => s.agents[s.ball.target]!.p.id === kelce.id);
}
if (!ONLY || ONLY === 'patient') {
  console.log('Patient Runner (Roger Craig, the run book)');
  for (const [label, rb] of [['Craig without Patient Runner', strip(team.RB, 'patient-runner')], ['Craig (Patient Runner)', team.RB]] as const) {
    // Where he crossed the line (y): a cutback crosses on the far side of the aiming point.
    const snaps = book({ ...team, RB: rb }, RUNS, DEF_CALLS, undefined, (st) => {
      const c = st.carrier >= 0 ? st.agents[st.carrier]! : null;
      if (c && c.slot === 'RB' && c.mem.crossY === undefined && c.pos.x >= st.setup.los) c.mem.crossY = c.pos.y;
    });
    let y = 0;
    let stuffed = 0;
    let cut = 0;
    let cutY = 0;
    let ten = 0;
    for (const { s, play } of snaps) {
      const g = yards(s);
      y += g;
      if (g <= 0) stuffed++;
      if (g >= 10) ten++;
      // A cutback: he crossed the line on the far side of the aiming point from where the play was going.
      const aim = (s.setup.ballY ?? 0) + s.setup.play.run!.aim;
      const side = s.setup.play.run!.aim >= 0 ? 1 : -1;
      const cross = s.agents[s.slot.RB!]!.mem.crossY as number | undefined;
      void play;
      if (cross !== undefined && (cross - aim) * side < -1) {
        cut++;
        cutY += g;
      }
    }
    console.log(`  ${label.padEnd(40)} ypc ${(y / snaps.length).toFixed(2)}  stuffed ${pct(stuffed, snaps.length)}  10+ ${pct(ten, snaps.length)}  cutbacks ${pct(cut, snaps.length)} for ${(cutY / Math.max(1, cut)).toFixed(2)} yd`);
  }
}
if (!ONLY || ONLY === 'hback') {
  console.log('H-Back (Russ Francis in the H spot)');
  const francis = team.TE2;
  for (const [label, te2] of [['Francis without H-Back (H Iso as a plain iso)', strip(francis, 'h-back')], ['Francis (H-Back)', francis]] as const) {
    const snaps = book({ ...team, TE2: te2 }, [playById('h-iso')]);
    const y = snaps.reduce((t, { s }) => t + yards(s), 0);
    console.log(`  ${label.padEnd(40)} H Iso ypc ${(y / snaps.length).toFixed(2)}`);
  }
  for (const id of ['singleback-inside-zone', 'iform-iso', 'h-iso']) {
    const snaps = book(team, [playById(id)]);
    console.log(`  ${id.padEnd(40)} ypc ${(snaps.reduce((t, { s }) => t + yards(s), 0) / snaps.length).toFixed(2)}`);
  }
  // The chip: H Chip with the chip against the same play with the H straight to the flat.
  const chip = playById('h-chip-flat');
  const noChip: OffPlay = { ...chip, id: 'h-chip-flat', assign: { ...chip.assign, SLOT: { kind: 'route', route: 'flat', read: 3 } } };
  for (const [label, play] of [['H Chip, the H straight to the flat', noChip], ['H Chip (the chip, then the flat)', chip]] as const) {
    const snaps = book(team, [play]);
    let pressured = 0;
    let sacks = 0;
    for (const { s } of snaps) {
      if (s.pressureT >= 0 && s.pressureT - s.snapT < 2.5) pressured++;
      if (s.result?.sack) sacks++;
    }
    console.log(`  ${label.padEnd(40)} pressure inside 2.5 s ${pct(pressured, snaps.length)}, sacks ${pct(sacks, snaps.length)}`);
  }
}
if (!ONLY || ONLY === 'maestro') {
  // Maestro: a hot route (the X to a slant) against the blitzes; does a blitzer come free?
  console.log('Maestro (Joe Montana, a hot route against Cover 1 Blitz and the Fire Zone)');
  const blitz = ['cover1blitz', 'firezone'].map(defById);
  const drops = PASS.filter((q) => q.type === 'dropback' || q.type === 'shot');
  for (const [label, qb] of [['Montana, the parts only (no Maestro)', add(strip(team.QB, 'maestro'), 'surgeon', 'field-general')], ['Montana (Maestro)', team.QB]] as const) {
    const snaps = book({ ...team, QB: qb }, drops, blitz, (s) => ({ icon: 1 + (s.icons.length > 1 ? 1 : 0), route: 'slant' }));
    let free = 0;
    let sacks = 0;
    for (const { s } of snaps) {
      // A blitzer nobody blocked: a rusher off the second level with no blocker ever on him.
      const rushers = s.def.filter((i) => s.setup.def.assign[s.agents[i]!.slot as keyof typeof s.setup.def.assign].kind === 'rush' && !['DE', 'DT'].includes(s.agents[i]!.p.pos));
      if (rushers.some((i) => !s.off.some((j) => s.agents[j]!.mem.man === i))) free++;
      if (s.result?.sack) sacks++;
    }
    console.log(`  ${label.padEnd(40)} a blitzer unaccounted for ${pct(free, snaps.length)}, sacks ${pct(sacks, snaps.length)}`);
  }
}
