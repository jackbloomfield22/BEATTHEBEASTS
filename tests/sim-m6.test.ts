import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASE_PLAYS,
  callDefense,
  createPlay,
  DEF_CALLS,
  defById,
  defenseFor,
  emptyTendencies,
  favouriteTarget,
  FIELD_HALF_W,
  FORMATIONS,
  input,
  mirrorPlay,
  NEUTRAL,
  offenseFor,
  PERSONNEL,
  playById,
  PLAYS,
  practiceRosters,
  recordPlay,
  runToWhistle,
  stepPlay,
  suggestPlays,
  type DefCall,
  type OffPlay,
  type PlayState,
  type SnapshotLike,
} from '@/sim';
import { routePoints } from '@/sim/ai';
import { rushPlan } from '@/sim/blocks';
import { sidesFor } from '@/sim/outcomes';
import { makeRng } from '@/engine/rng';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const HASHES = [3.08, 0, -3.08];

/** A play set up the way the harness sets it: the play's personnel, the Beasts' package for it. */
const at = (play: OffPlay, def: DefCall, seed: number, ballY = 0, flip = false, user = false) => {
  const sd = sidesFor(rosters, play, def);
  return createPlay({ seed, offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY, flip, toGo: 10, user });
};

describe('M6: personnel, formations and the book', () => {
  it('has 30+ plays in 6+ formations, I-Form Pro (21), Pistol and Heavy (22) among them', () => {
    expect(PLAYS.length).toBeGreaterThanOrEqual(30);
    const forms = new Set(PLAYS.map((p) => p.formation.name));
    expect(forms.size).toBeGreaterThanOrEqual(6);
    expect(FORMATIONS.iForm!.personnel).toBe('21');
    expect(FORMATIONS.heavy!.personnel).toBe('22');
    expect(FORMATIONS.pistol!.name).toBe('Pistol');
    expect(new Set(PLAYS.map((p) => p.id)).size).toBe(PLAYS.length);
  });

  it('fills the eleven from the nine by grouping: the second tight end, the fullback, both', () => {
    const t = rosters.team;
    const o12 = offenseFor(playById('ace-te-seam'), t);
    expect(o12.SLOT).toBe(t.TE2);
    expect(o12.TE).toBe(t.TE);
    const o21 = offenseFor(playById('iform-iso'), t);
    expect(o21.SLOT).toBe(t.RB2);
    expect(o21.X).toBe(t.WR1);
    const o22 = offenseFor(playById('heavy-power'), t);
    expect(o22.SLOT).toBe(t.RB2);
    expect(o22.Z).toBe(t.TE2);
    const o11 = offenseFor(playById('trips-stick'), t);
    expect([o11.X, o11.Z, o11.SLOT]).toEqual([t.WR1, t.WR2, t.WR3]);
    expect(o11.LT).toBe(t.OL[0]);
    expect(o11.RT).toBe(t.OL[4]);
    for (const g of Object.values(PERSONNEL)) expect(Object.keys(g).sort()).toEqual(['RB', 'SLOT', 'TE', 'X', 'Z']);
    // The practice roster's second back and tight end are real players, and the old eleven still works.
    expect(t.RB2.pos).toBe('RB');
    expect(t.TE2.pos).toBe('TE');
    expect(rosters.offense.X).toBe(t.WR1);
  });

  it('a flipped play is the mirror image: skill players, the aim and the fake across, the line where it is', () => {
    const p = playById('iform-power');
    const m = mirrorPlay(p);
    expect(m.run!.aim).toBe(-p.run!.aim);
    expect(m.formation.align.TE.dy).toBe(-p.formation.align.TE.dy);
    expect(m.formation.align.LT).toEqual(p.formation.align.LT);
    expect(mirrorPlay(playById('pistol-pa-boot')).drop.boot).toBe(-playById('pistol-pa-boot').drop.boot!);
  });

  it('every play runs cleanly against every call, from both hashes and the middle, flipped and not', () => {
    for (const play of PLAYS) {
      for (const def of DEF_CALLS) {
        for (let k = 0; k < 6; k++) {
          const s = runToWhistle(at(play, def, 200 + k * 37, HASHES[k % 3], k % 2 === 1), () => NEUTRAL);
          expect(s.result, `${play.id} vs ${def.id}`).not.toBeNull();
          expect(s.result!.reason, `${play.id} vs ${def.id}`).not.toBe('timeout');
          expect(s.t).toBeLessThan(15);
        }
      }
    }
  }, 240_000);

  it('the new schemes do what they say: the sneak keeps it, the toss pitches it, the fullback leads, the boot rolls out', () => {
    const sneak = runToWhistle(at(playById('heavy-sneak'), defById('cover1'), 3), () => NEUTRAL);
    expect(sneak.carrier).toBe(sneak.qb);
    expect(sneak.events.some((e) => e.type === 'handoff')).toBe(false);
    const toss = at(playById('iform-toss'), defById('cover3'), 3);
    let pitched = false;
    for (let t = 0; t < 120 && !toss.result; t++) {
      stepPlay(toss, NEUTRAL);
      if (toss.pitch && toss.ball.holder !== toss.qb && toss.t - toss.pitch.t < 0.2) {
        // The ball is between the QB and the back while the pitch is in the air.
        const rb = toss.agents[toss.slot.RB!]!;
        pitched = pitched || Math.hypot(toss.ball.pos.x - rb.pos.x, toss.ball.pos.y - rb.pos.y) > 0.5;
      }
    }
    expect(pitched).toBe(true);
    const iso = at(playById('iform-iso'), defById('cover3'), 3);
    stepPlay(iso, NEUTRAL);
    stepPlay(iso, NEUTRAL);
    const fb = iso.agents[iso.slot.SLOT!]!;
    expect(fb.mem.pull).toBeTruthy();
    expect(fb.mem.target).toBeGreaterThanOrEqual(0);
    const boot = at(playById('pistol-pa-boot'), defById('cover3'), 3);
    for (let t = 0; t < 110; t++) stepPlay(boot, NEUTRAL);
    expect(boot.agents[boot.qb]!.pos.y).toBeGreaterThan(4);
  });
});

describe('M6: the field has edges for everyone', () => {
  it('no route point is within 1.5 yd of a sideline: every play and split, flipped or not, from both hashes and the middle', () => {
    for (const play of PLAYS) {
      for (const ballY of HASHES) {
        for (const flip of [false, true]) {
          const s = at(play, DEF_CALLS[0]!, 1, ballY, flip);
          for (const i of s.off) {
            const r = routePoints(s, s.agents[i]!);
            if (!r) continue;
            for (const q of r.pts) expect(Math.abs(q.y), `${play.id} ${s.agents[i]!.slot} ${r.name} hash ${ballY} flip ${flip}`).toBeLessThanOrEqual(FIELD_HALF_W - 1.5 + 1e-9);
          }
        }
      }
    }
  });

  it('a route runner never runs out: he turns upfield along the boundary; nobody steps out on his own', () => {
    for (const play of PLAYS) {
      for (const def of DEF_CALLS) {
        for (let k = 0; k < 6; k++) {
          const s = at(play, def, 50 + k, HASHES[k % 3], k % 2 === 1);
          while (!s.result && s.tick < 2400) {
            stepPlay(s, NEUTRAL);
            if (s.phase !== 'dropback' && s.phase !== 'pocket') continue;
            for (const i of s.off) {
              const a = s.agents[i]!;
              if (a.route) expect(Math.abs(a.pos.y), `${play.id} vs ${def.id} ${a.slot}`).toBeLessThan(FIELD_HALF_W - 0.5);
            }
          }
          // Only a block can put a man out of bounds (the carrier's lines are the whistle's).
          for (const a of s.agents) if (a.mem.outOfPlay) expect(a.p.pos === 'OL' || a.side === 'def' || !a.route, `${play.id} vs ${def.id} ${a.slot}`).toBe(true);
        }
      }
    }
  }, 240_000);

  /** A throw to icon 1 on a stick with the receiver set out of the play first. */
  const outThen = (who: 'receiver' | 'defender') => {
    const s = at(playById('trips-stick'), defById('cover3'), 9, 0, false, true);
    stepPlay(s, input({ snap: true }));
    for (let t = 0; t < 60; t++) stepPlay(s, NEUTRAL);
    const r = s.agents[s.icons[0]!]!;
    if (who === 'receiver') r.mem.outOfPlay = true;
    else for (const i of s.def) s.agents[i]!.mem.outOfPlay = true;
    runToWhistle(s, (st) => input({ throwHeld: st.hold.ticks < 4 && st.phase === 'pocket' && !st.windup ? 1 : 0 }));
    return s;
  };
  it('a receiver who stepped out can’t be the first to touch a pass: it’s incomplete', () => {
    const s = outThen('receiver');
    expect(s.events.some((e) => e.type === 'throw')).toBe(true);
    expect(s.result!.reason).toBe('incomplete');
    expect(s.pass?.complete).toBe(false);
  });
  it('defenders who stepped out can’t make a play: no interception, no deflection, no tackle', () => {
    const s = outThen('defender');
    expect(s.events.some((e) => e.type === 'interception' || e.type === 'hit' || e.type === 'tackle')).toBe(false);
  });
});

describe('M6: the touch-pass threshold is the player’s', () => {
  const throwWith = (tapMax: number | undefined) => {
    const s = createPlay({ seed: 5, offense: rosters.offense, defense: rosters.defense, play: playById('trips-stick'), def: defById('cover3'), los: 35, toGo: 10, user: true, ...(tapMax !== undefined ? { tapMax } : {}) });
    stepPlay(s, input({ snap: true }));
    for (let t = 0; t < 60; t++) stepPlay(s, NEUTRAL);
    // Hold icon 1 for 15 ticks (0.25 s), then let go.
    for (let t = 0; t < 15; t++) stepPlay(s, input({ throwHeld: 1 }));
    stepPlay(s, NEUTRAL);
    return s.windup?.charge ?? -1;
  };
  it('a 0.25 s hold is touch at the default (0.18 s) and a driven ball with a 0.3 s setting', () => {
    expect(throwWith(undefined)).toBeGreaterThan(0);
    expect(throwWith(0.3)).toBe(0);
  });
});

describe('M6: the Beasts’ packages and coordinator', () => {
  const b = rosters.beasts;
  it('nickel puts the sub corner in the slot the call names; dime adds the sub safety', () => {
    const c1 = defById('cover1');
    const nick = defenseFor({ ...c1, package: 'nickel' }, b);
    expect(nick[c1.nickel]).toBe(b.nickel);
    expect(nick.MLB).toBe(b.base.MLB);
    const dime = defenseFor({ ...c1, package: 'dime' }, b);
    expect(dime[c1.nickel]).toBe(b.nickel);
    expect(dime[c1.dime]).toBe(b.dime);
    expect(defenseFor({ ...c1, package: 'base' }, b)).toEqual(b.base);
  });

  it('the sub corner lines up like one: over the slot receiver, not at linebacker depth', () => {
    const s = at(playById('doubles-smash'), defById('cover3'), 1);
    const nickel = s.agents[s.slot[defById('cover3').nickel]!]!;
    expect(nickel.p.pos).toBe('CB');
    expect(Math.abs(nickel.pos.y)).toBeGreaterThan(5);
  });

  it('calls a package by situation: nickel on 1st and 10 against three receivers, base against 22, dime on 3rd and long', () => {
    const rng = makeRng(7);
    expect(callDefense({ down: 1, toGo: 10, los: 35, personnel: '11' }, 'pro', undefined, rng).package).toBe('nickel');
    expect(callDefense({ down: 1, toGo: 10, los: 35, personnel: '22' }, 'pro', undefined, rng).package).toBe('base');
    expect(callDefense({ down: 3, toGo: 12, los: 35, personnel: '11' }, 'pro', undefined, rng).package).toBe('dime');
    expect(callDefense({ down: 3, toGo: 1, los: 97, personnel: '22' }, 'pro', undefined, rng).package).toBe('base');
  });

  it('mixes its coverages, is deterministic in its stream, and saves simulated pressure for Beast', () => {
    const ids = (d: 'pro' | 'beast') => {
      const rng = makeRng(11);
      return Array.from({ length: 300 }, () => callDefense({ down: 2, toGo: 7, los: 50, personnel: '11' }, d, undefined, rng).id);
    };
    const pro = ids('pro');
    expect(new Set(pro).size).toBeGreaterThanOrEqual(8);
    expect(pro).toEqual(ids('pro'));
    expect(pro.includes('simpressure')).toBe(false);
    expect(ids('beast').includes('simpressure')).toBe(true);
  });

  it('learns the receiver the offense keeps throwing to and brackets him, by difficulty', () => {
    let t = emptyTendencies();
    const rice = rosters.team.WR1.id;
    for (let k = 0; k < 8; k++) t = recordPlay(t, { targetId: k < 6 ? rice : rosters.team.TE.id, playId: 'trips-stick', type: 'quick', down: 1, toGo: 10, yards: 12 });
    expect(t.plays).toBe(8);
    expect(t.targets[rice]).toBe(6);
    expect(favouriteTarget(t, 'rookie')).toBeNull();
    expect(favouriteTarget(t, 'legend')!.id).toBe(rice);
    const count = (d: 'rookie' | 'pro' | 'legend' | 'beast') => {
      const rng = makeRng(3);
      let n = 0;
      for (let k = 0; k < 200; k++) if (callDefense({ down: 1, toGo: 10, los: 35, personnel: '11' }, d, t, rng).bracket?.id === rice) n++;
      return n;
    };
    expect(count('rookie')).toBe(0);
    expect(count('pro')).toBeGreaterThan(0);
    expect(count('beast')).toBeGreaterThan(count('pro'));
    // recordPlay is pure.
    expect(emptyTendencies().plays).toBe(0);
  });

  it('a bracket shows on the field: the safety shades to him, the robber sits on him', () => {
    const rice = rosters.team.WR1.id;
    const plain = at(playById('doubles-smash'), defById('cover3'), 1);
    const shaded = at(playById('doubles-smash'), { ...defById('cover3'), bracket: { id: rice, by: 'FS', how: 'shade' } }, 1);
    const x = plain.agents[plain.slot.X!]!.pos.y;
    expect(Math.abs(shaded.agents[shaded.slot.FS!]!.pos.y - x)).toBeLessThan(Math.abs(plain.agents[plain.slot.FS!]!.pos.y - x));
    expect(shaded.bracket?.r).toBe(shaded.slot.X);
  });

  it('disguises at the higher difficulties: a shell before the snap that rotates to the call', () => {
    const shells = (d: 'rookie' | 'legend') => {
      const rng = makeRng(5);
      return Array.from({ length: 200 }, () => callDefense({ down: 1, toGo: 10, los: 35 }, d, undefined, rng)).filter((c) => c.shell).length;
    };
    expect(shells('rookie')).toBe(0);
    expect(shells('legend')).toBeGreaterThan(40);
    // Cover 3 showing a two-high shell: the free safety starts wide, then gets to the middle.
    const s = at(playById('doubles-smash'), { ...defById('cover3'), shell: 'cover2' }, 1);
    const fs = s.agents[s.slot.FS!]!;
    expect(Math.abs(fs.pos.y)).toBeGreaterThan(5);
    for (let t = 0; t < 150; t++) stepPlay(s, NEUTRAL);
    expect(Math.abs(fs.pos.y)).toBeLessThan(Math.abs(s.agents[s.slot.FS!]!.hist[0]!.pos.y) + 5);
  });

  it('man coverage follows the formation: a corner takes the widest man on his side, flipped or not', () => {
    for (const flip of [false, true]) {
      const s = at(playById('trips-four-verts'), defById('cover1'), 1, 0, flip);
      const lcb = s.agents[s.slot.LCB!]!;
      const widestLeft = s.off.map((i) => s.agents[i]!).filter((a) => a.pos.y > 5).sort((p, q) => q.pos.y - p.pos.y)[0]!;
      expect(s.man.LCB).toBe(widestLeft.slot);
      expect(Math.abs(lcb.pos.y - widestLeft.pos.y)).toBeLessThan(2);
    }
  });

  it('rush plans come from traits: a speed rusher opens with speed, a power rusher with the bull', () => {
    const s = at(playById('trips-stick'), defById('cover3'), 1);
    const d = s.agents[s.slot.LE!]!;
    const speed = rushPlan({ ...d, p: { ...d.p, traits: ['speed-rusher'] } });
    expect(speed.open).toContain('speed');
    expect(speed.counters).toContain('spin');
    const power = rushPlan({ ...d, p: { ...d.p, traits: ['power-rusher'] } });
    expect(power.open).toContain('bull');
    expect(power.open).toContain('longArm');
  });
});

describe('M6: zones match the routes', () => {
  /** Step until `t` s after the snap. */
  const until = (s: PlayState, t: number) => {
    while (!s.result && (s.snapT < 0 || s.t - s.snapT < t)) stepPlay(s, NEUTRAL);
  };
  it('the curl-to-flat defender expands with #2 to the flat when #1 has gone deep (Cover 3 against stick)', () => {
    const s = at(playById('trips-stick'), defById('cover3'), 4);
    until(s, 1.6);
    const flat = s.agents[s.slot.SLOT!]!; // #2 to the trips side runs the flat
    const curlR = s.agents[s.slot.SS!]!; // the curl-flat player on that side
    expect(Math.hypot(flat.pos.x - curlR.pos.x, flat.pos.y - curlR.pos.y)).toBeLessThan(4);
  });
  it('with a curl and a flat on him he takes the flat and leaves the curl behind him: the high-low that beats Cover 3', () => {
    const s = at(playById('doubles-curls'), defById('cover3'), 4);
    until(s, 2.0);
    const curl = s.agents[s.slot.X!]!;
    const flat = s.agents[s.slot.SLOT!]!;
    const curlL = s.agents[s.slot[defById('cover3').nickel]!]!;
    expect(Math.hypot(flat.pos.x - curlL.pos.x, flat.pos.y - curlL.pos.y)).toBeLessThan(4);
    expect(Math.hypot(curl.pos.x - curlL.pos.x, curl.pos.y - curlL.pos.y)).toBeGreaterThan(6);
  });
  it('an underneath defender carries a seam until the deep help is over it, then passes it off', () => {
    const s = at(playById('doubles-hitch-seam'), defById('cover3'), 4);
    let carried = false;
    let passed = false;
    for (let t = 0; t < 220 && !s.result; t++) {
      stepPlay(s, NEUTRAL);
      for (const i of s.def) {
        const d = s.agents[i]!;
        const c = d.mem.carry as number | undefined;
        if (c !== undefined && c >= 0 && d.mem.mode === 'carry') carried = true;
        if (Object.keys(d.mem).some((k) => k.startsWith('po'))) passed = true;
      }
    }
    expect(carried).toBe(true);
    expect(passed).toBe(true);
  });
});

describe('M6: the offensive coordinator suggests plays', () => {
  const t = rosters.team;
  it('suggests runs and the sneak on 3rd and 1, passes that reach the sticks on 3rd and long', () => {
    const short = suggestPlays({ down: 3, toGo: 1, los: 50 }, t, 5).map(playById);
    expect(short.some((p) => p.type === 'run')).toBe(true);
    const long = suggestPlays({ down: 3, toGo: 12, los: 50 }, t, 5).map(playById);
    expect(long.every((p) => p.type !== 'run' || p.run?.scheme === 'draw')).toBe(true);
    expect(long.some((p) => p.type === 'dropback' || p.type === 'shot')).toBe(true);
  });
  it('the Hail Mary only at the end of a half, from far out; the heavy set at the goal line', () => {
    expect(suggestPlays({ down: 1, toGo: 10, los: 45, secondsLeft: 5 }, t, 3)[0]).toBe('doubles-hail-mary');
    expect(suggestPlays({ down: 1, toGo: 10, los: 45 }, t, 10)).not.toContain('doubles-hail-mary');
    const gl = suggestPlays({ down: 2, toGo: 2, los: 98 }, t, 5).map(playById);
    expect(gl.some((p) => p.formation.personnel === '22')).toBe(true);
  });
  it('is deterministic, returns n distinct plays, and leans on the roster: a deep threat and a big arm favour shots', () => {
    const a = suggestPlays({ down: 1, toGo: 10, los: 35 }, t, 6);
    expect(a).toEqual(suggestPlays({ down: 1, toGo: 10, los: 35 }, t, 6));
    expect(new Set(a).size).toBe(6);
    const weakArm = { ...t, QB: { ...t.QB, attrs: { ...t.QB.attrs, throwPower: 60, deepAcc: 60 }, traits: [] } };
    const cannon = { ...t, QB: { ...t.QB, attrs: { ...t.QB.attrs, throwPower: 99, deepAcc: 99 }, traits: ['cannon'] } };
    const shots = (team: typeof t) => suggestPlays({ down: 1, toGo: 10, los: 50 }, team, 8).map(playById).filter((p) => p.type === 'shot' || (p.type === 'playAction' && /post|go/.test(JSON.stringify(p.assign)))).length;
    expect(shots(cannon)).toBeGreaterThan(shots(weakArm));
  });
  it('the everyday book leaves out the situational plays', () => {
    expect(BASE_PLAYS.some((p) => p.situ)).toBe(false);
    expect(PLAYS.filter((p) => p.situ).map((p) => p.id).sort()).toEqual(['doubles-hail-mary', 'heavy-sneak']);
  });
});
