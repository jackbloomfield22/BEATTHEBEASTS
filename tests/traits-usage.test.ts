import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPlay,
  defById,
  defenseFor,
  input,
  NEUTRAL,
  offenseFor,
  personalize,
  playById,
  playUnlocked,
  practiceRosters,
  runToWhistle,
  stepPlay,
  suggestPlays,
  type ContendersRoster,
  type DefCall,
  type OffPlay,
  type PlayState,
  type SimPlayer,
  type SnapshotLike,
} from '@/sim';
import { findStint, simPlayer } from '@/sim/roster';
import { blockOf } from '@/sim/blocks';
import { fullbackSlot } from '@/sim/plays';
import { blockRoles, readUntil } from '@/sim/runs';
import { FILM } from '@/sim/film';
import { audiblePlay, audiblesFor } from '@/game/audible';
import { backFor } from '@/game/rotation';
import { afterSnap, emptyFatigue, fatigueOf, type Snap } from '@/game/fatigue';
import { blitzersShown, hotRouteHoldsClock, shellFor } from '@/game/presnap';

// The traits the playbook, the coordinator and the usage read (Playtest 2,
// "every attribute and every trait must have a visible, feelable effect in
// play"): each against the same man without it. The numbers at scale are
// tools/sim/qbruns.ts, usagefx.ts and coordfx.ts.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const base = practiceRosters(snap);
const team = base.team;
const who = (name: string, pos: string): SimPlayer => simPlayer(findStint(snap, name, pos)!, 1);
const strip = (p: SimPlayer, ...ids: string[]): SimPlayer => ({ ...p, traits: (p.traits ?? []).filter((t) => !ids.includes(t)) });
const add = (p: SimPlayer, ...ids: string[]): SimPlayer => ({ ...p, traits: [...(p.traits ?? []), ...ids] });
const vick = who('Michael Vick', 'QB');

/** A play with the drafted nine against the Beasts in the call's package. */
function play(t: ContendersRoster, id: string, def: string, seed: number, o: { user?: boolean; flip?: boolean; ballY?: number } = {}): PlayState {
  const p = playById(id);
  const d: DefCall = defById(def);
  return createPlay({ seed, offense: offenseFor(p, t), defense: defenseFor(d, base.beasts), play: p, def: d, los: 35, ballY: o.ballY ?? 0, toGo: 10, down: 1, user: o.user ?? false, flip: o.flip });
}
const stepTo = (s: PlayState, t: number) => {
  while (!s.result && s.t < t) stepPlay(s, NEUTRAL);
  return s;
};

describe('Designed Runner: the QB draw and the zone read', () => {
  it('unlocks the two plays for him only: the book, the coordinator and the audibles', () => {
    const dr = { ...team, QB: vick };
    for (const id of ['doubles-qb-draw', 'doubles-zone-read']) {
      expect(playUnlocked(playById(id), dr)).toBe(true);
      expect(playUnlocked(playById(id), team)).toBe(false);
    }
    const all = (t: ContendersRoster) => suggestPlays({ down: 1, toGo: 10, los: 35 }, t, 60);
    expect(all(dr)).toContain('doubles-zone-read');
    expect(all(team)).not.toContain('doubles-zone-read');
    expect(all(team)).not.toContain('doubles-qb-draw');
    const sit = { down: 1, toGo: 10, los: 35 };
    for (let k = 0; k < 4; k++) expect(['doubles-qb-draw', 'doubles-zone-read']).not.toContain(audiblePlay(playById('doubles-slants'), 'run', { ...sit, los: 30 + k }, team)?.id);
  });
  it('the QB draw: he shows pass, then he carries it, a designed run (no slide)', () => {
    const s = stepTo(play({ ...team, QB: vick }, 'doubles-qb-draw', 'cover3', 3), 1.2);
    expect(s.carrier).toBe(s.qb);
    expect(s.agents[s.qb]!.mem.designed).toBe(true);
    expect(s.events.some((e) => e.type === 'handoff')).toBe(false);
  });
  it('the zone read: the backside end is left unblocked and read; he keeps it on some snaps and hands off on others', () => {
    let keeps = 0;
    let gives = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const s = stepTo(play({ ...team, QB: vick }, 'doubles-zone-read', 'cover3', seed), 0.05);
      const end = s.agents[s.qb]!.mem.readEnd as number;
      expect(end).toBeGreaterThanOrEqual(0);
      // Nobody's assigned to him at the snap.
      expect(s.off.some((i) => s.agents[i]!.mem.target === end)).toBe(false);
      stepTo(s, 0.9);
      if (s.carrier === s.qb) keeps++;
      else if (s.carrier >= 0) gives++;
    }
    expect(keeps).toBeGreaterThan(2);
    expect(gives).toBeGreaterThan(2);
  });
  it('Run-Pass Nightmare: his keeper freezes the read end 0.1 s longer', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = stepTo(play({ ...team, QB: vick }, 'doubles-zone-read', 'cover3', seed), 0.8);
      if (s.carrier !== s.qb) continue;
      const qb = s.agents[s.qb]!;
      const end = s.agents[qb.mem.readEnd as number]!;
      const rpn = readUntil(s, end);
      qb.p = strip(add(qb.p, 'dual-threat', 'designed-runner'), 'run-pass-nightmare');
      expect(rpn - readUntil(s, end)).toBeCloseTo(0.1, 6);
      return;
    }
    throw new Error('no keep in 30 seeds');
  });
  it('ball security on QB runs: a Designed Runner carries it like a back (72), a passer at the default (50)', () => {
    const run = (qb: SimPlayer) => stepTo(play({ ...team, QB: qb }, 'doubles-qb-draw', 'cover3', 3), 1.2).agents[0]!.fx.a('ballSecurity');
    expect(run(vick) * 99).toBeCloseTo(72, 5);
    expect(run(strip(vick, 'run-pass-nightmare')) * 99).toBeCloseTo(50, 5);
    // ...on the run only: in the pocket he's the default.
    expect(play({ ...team, QB: vick }, 'doubles-slants', 'cover3', 3).agents[0]!.fx.a('ballSecurity') * 99).toBeCloseTo(50, 5);
  });
});

describe('Volume TE and Receiving Back: the play as these eleven run it', () => {
  const kelce = who('Travis Kelce', 'TE');
  it('a Volume TE is the first read wherever he runs a route; the rest keep their order behind him', () => {
    const slants = playById('doubles-slants');
    const own = personalize(slants, offenseFor(slants, { ...team, TE: kelce }));
    expect(own.assign.TE).toMatchObject({ kind: 'route', read: 1 });
    expect(own.assign.X).toMatchObject({ read: 2 });
    expect(own.assign.RB).toMatchObject({ read: 5 });
    expect(personalize(slants, offenseFor(slants, { ...team, RB: strip(team.RB, 'receiving-back'), TE: strip(kelce, 'volume-te') }))).toBe(slants);
    const s = play({ ...team, TE: kelce }, 'doubles-slants', 'cover3', 1);
    expect(s.agents[s.icons[0]!]!.p.id).toBe(kelce.id);
  });
  it("the coordinator calls the plays he's out on", () => {
    const outOn = (t: ContendersRoster) =>
      suggestPlays({ down: 2, toGo: 7, los: 40 }, t).filter((id) => {
        const p = playById(id);
        return !p.run && p.assign.TE.kind === 'route';
      }).length;
    expect(outOn({ ...team, TE: kelce })).toBeGreaterThanOrEqual(outOn({ ...team, TE: strip(kelce, 'volume-te') }));
  });
  it("a Receiving Back's outlets are routes: the angle (quick game), the option (drop-backs) and the wheel (play action)", () => {
    const route = (id: string, rb: SimPlayer) => {
      const p = playById(id);
      return (personalize(p, offenseFor(p, { ...team, RB: rb })).assign.RB as { route: string }).route;
    };
    expect(route('trips-stick', team.RB)).toBe('angle');
    expect(route('doubles-smash', team.RB)).toBe('option');
    expect(route('singleback-pa-post', team.RB)).toBe('wheel');
    const plain = strip(team.RB, 'receiving-back');
    expect(route('trips-stick', plain)).toBe('checkdown');
    expect(route('singleback-pa-post', plain)).toBe('arrow');
  });
});

describe('Third-Down Back: the blitz pickup, then the release', () => {
  it('he picks up the blitzing linebacker that nobody else has; without the trait he never stays in', () => {
    let picked = 0;
    let plain = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = stepTo(play(team, 'doubles-smash', 'cover1blitz', seed), 1.2);
      const rb = s.agents[s.slot.RB!]!;
      if (rb.mem.pickup !== undefined) {
        picked++;
        expect(s.agents[rb.mem.pickup as number]!.p.pos).not.toMatch(/DE|DT/);
      }
      const t = stepTo(play({ ...team, RB: strip(team.RB, 'third-down-back') }, 'doubles-smash', 'cover1blitz', seed), 1.2);
      if (t.agents[t.slot.RB!]!.mem.pickup !== undefined) plain++;
    }
    expect(picked).toBeGreaterThan(3);
    expect(plain).toBe(0);
  });
  it('nobody comes: he holds for his read, then leaks out on his route', () => {
    const s = play(team, 'doubles-smash', 'cover3', 2);
    const rb = s.agents[s.slot.RB!]!;
    stepTo(s, 0.45);
    expect(rb.route!.idx).toBe(0);
    expect(rb.anim).toBe('block');
    stepTo(s, 1.4);
    expect(rb.mem.pickup).toBeUndefined();
    expect(rb.pos.x).toBeGreaterThan(s.setup.los - 3);
  });
  it('the rotation: only the starter holds it, so he keeps the passing downs', () => {
    const sit = { down: 3, toGo: 8, los: 40, ballY: 0 };
    const p = playById('doubles-smash');
    expect(backFor(p, sit, 1, team).back).toBe('RB2');
    expect(backFor(p, sit, 1, { ...team, RB2: strip(team.RB2, 'third-down-back') }).back).toBe('RB');
    expect(backFor(p, sit, 1, { ...team, RB: strip(team.RB, 'third-down-back') }).back).toBe('RB2');
  });
});

describe('Slot Weapon and the option route: the leverage read', () => {
  const welker = who('Wes Welker', 'WR');
  /** The slot's read on Empty Quick (his quick out from the slot) for each seed. */
  const reads = (wr: SimPlayer, def: string) =>
    Array.from({ length: 8 }, (_, k) => {
      const s = stepTo(play({ ...team, WR3: wr }, 'empty-quick', def, k + 1), 2.0);
      return s.agents[s.slot.SLOT!]!.mem.optBreak as string | undefined;
    });
  it('from the slot he reads the man over him: in or out, away from his leverage; against a zone, away from a man sitting on the break', () => {
    const man = reads(welker, 'cover1').filter(Boolean);
    expect(man.length).toBeGreaterThan(4);
    for (const r of man) expect(['in', 'out']).toContain(r);
    const zone = reads(welker, 'cover3').filter(Boolean);
    expect(zone.length).toBeGreaterThan(4);
    for (const r of zone) expect(['in', 'out', 'drawn']).toContain(r);
  });
  it('without the trait he runs the quick out as drawn', () => {
    expect(reads(strip(welker, 'slot-weapon'), 'cover1').every((r) => r === undefined)).toBe(true);
  });
});

describe('Safety Blanket: he breaks open toward a flushed QB 0.2 s sooner', () => {
  it('the scramble drill starts for him 0.2 s before the same man without the trait', () => {
    // Brent Jones, with and without it (the same man: only the trait differs).
    const drillAt = (te: SimPlayer) => {
      const s = play({ ...team, TE: te }, 'trips-y-cross', 'cover3', 4, { user: true });
      let at = -1;
      runToWhistle(s, (st) => {
        const a = st.agents[st.slot.TE!]!;
        if (at < 0 && a.mem.drill) at = st.t;
        return input({ snap: st.phase === 'presnap', scramble: st.t > 1.3 && st.t < 1.4, move: st.t > 1.3 ? { x: 0.3, y: 1 } : { x: 0, y: 0 } });
      }, 60 * 4);
      return at;
    };
    const blanket = drillAt(add(team.TE, 'safety-blanket'));
    const plain = drillAt(team.TE);
    expect(blanket).toBeGreaterThan(0);
    expect(plain - blanket).toBeCloseTo(0.2, 1);
  });
});

describe('Patient Runner: the cutback lane holds', () => {
  it("his backside run blocks start 0.2 s of leverage to the good; the play side's are the same", () => {
    const first = (rb: SimPlayer) => {
      const s = play({ ...team, RB: rb }, 'singleback-inside-zone', 'cover3', 5);
      const lev = new Map<number, number>();
      while (s.t < 0.9) {
        stepPlay(s, NEUTRAL);
        for (const b of s.blocks) if (b.kind === 'run' && !lev.has(b.d) && b.t < 0.02) lev.set(b.d, b.lev);
      }
      return { lev, s };
    };
    const a = first(team.RB);
    const b = first(strip(team.RB, 'patient-runner'));
    const aim = a.s.setup.play.run!.aim;
    let back = 0;
    for (const [d, l] of a.lev) {
      const m = b.lev.get(d);
      if (m === undefined) continue;
      const backside = (a.s.agents[d]!.pos.y - aim) * Math.sign(aim) < 0;
      if (backside) {
        back++;
        expect(l).toBeLessThan(m - 0.05);
      }
    }
    expect(back).toBeGreaterThan(0);
  });
});

describe('H-Back: he lines up in the backfield, leads, chips and swings', () => {
  it('the tight end who holds it takes the H spot, and it makes him the lead blocker on H Iso', () => {
    const h = playById('h-iso');
    expect(fullbackSlot(h.formation)).toBe('SLOT');
    expect(blockRoles(h).SLOT).toBe('lead');
    const swapped = { ...team, TE: team.TE2, TE2: team.TE };
    expect(offenseFor(h, swapped).SLOT.id).toBe(team.TE2.id);
    expect(playUnlocked(h, { ...team, TE2: strip(team.TE2, 'h-back') })).toBe(false);
  });
  it('the chip: he knocks the edge rusher off his line before he releases', () => {
    let chips = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = stepTo(play(team, 'h-chip-flat', 'cover3', seed), 1.2);
      const e = s.events.find((x) => x.type === 'chip');
      if (!e) continue;
      chips++;
      expect(s.agents[e.who![1]!]!.side).toBe('def');
      expect(blockOf(s, e.who![0]!)).toBeUndefined();
    }
    expect(chips).toBeGreaterThan(4);
  });
});

describe('Ground and Pound: the Beasts front tires faster against the run', () => {
  const front = (gp: boolean): Snap => ({ id: 'dt', start: 1, end: 0.9, staminaAttr: 0.5, touched: false, dropback: false, traits: [], hit: 0, front: true, groundPound: gp });
  it('a run snap drains their front 10% more behind a Ground and Pound line, and it builds over the drive', () => {
    const drive = (gp: boolean, n: number) => {
      let f = emptyFatigue();
      for (let k = 0; k < n; k++) f = afterSnap(f, [front(gp)], false);
      return fatigueOf(f, 'dt');
    };
    expect(drive(true, 1) / drive(false, 1)).toBeCloseTo(1.1, 6);
    expect(drive(true, 10)).toBeGreaterThan(drive(false, 10));
    expect(drive(false, 10)).toBeGreaterThan(drive(false, 3));
  });
});

describe('Field General, Pre-Snap Wizard, Maestro: before the snap', () => {
  const fg = who('Randall Cunningham', 'QB');
  it('a Field General reads the shell on the play call and has a fifth audible', () => {
    expect(shellFor(fg, defById('cover3'))).toBe('single-high');
    expect(shellFor(fg, defById('cover4'))).toBe('two-high');
    expect(shellFor(fg, { ...defById('cover3'), shell: 'cover2' })).toBe('two-high');
    expect(shellFor(strip(team.QB, 'maestro'), defById('cover3'))).toBeNull();
    expect(audiblesFor(fg)).toHaveLength(5);
    expect(audiblesFor(strip(fg, 'field-general'))).toHaveLength(4);
    expect(audiblePlay(playById('doubles-slants'), 'dropback', { down: 1, toGo: 10, los: 35 }, team)?.type).toBe('dropback');
  });
  it("a Pre-Snap Wizard sees the real blitzers (not simulated pressure's walk-ups who drop), and his hot route costs no play clock", () => {
    const wiz = who('Tony Romo', 'QB');
    const mk = (qb: SimPlayer, def: string) => play({ ...team, QB: qb }, 'doubles-smash', def, 1);
    const s = mk(wiz, 'simpressure');
    expect(blitzersShown(s).map((i) => s.agents[i]!.slot)).toEqual(['MLB']);
    const f = mk(wiz, 'firezone');
    expect(blitzersShown(f).map((i) => f.agents[i]!.slot).sort()).toEqual(['SLB', 'WLB']);
    expect(blitzersShown(mk(strip(wiz, 'pre-snap-wizard'), 'firezone'))).toEqual([]);
    expect(hotRouteHoldsClock(wiz)).toBe(true);
    expect(hotRouteHoldsClock(strip(wiz, 'pre-snap-wizard'))).toBe(false);
  });
  it("a Maestro's hot route resets the protection: no blitzer is missed", () => {
    const missed = (qb: SimPlayer) => {
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const s = play({ ...team, QB: qb }, 'doubles-smash', 'firezone', seed, { user: true });
        stepPlay(s, input({ hotRoute: { icon: 1, route: 'slant' } }));
        stepPlay(s, input({ snap: true }));
        const rushers = s.def.filter((i) => s.setup.def.assign[s.agents[i]!.slot as keyof typeof s.setup.def.assign].kind === 'rush');
        if (rushers.some((i) => !s.off.some((j) => s.agents[j]!.mem.man === i))) n++;
      }
      return n;
    };
    expect(missed(team.QB)).toBe(0);
    expect(missed(add(strip(team.QB, 'maestro'), 'surgeon', 'field-general'))).toBeGreaterThan(0);
  });
});

describe('Efficiency King: the coordinator reads the film', () => {
  it('the film covers every everyday play against every call', () => {
    const plays = (Object.keys(FILM) as string[]).length;
    expect(plays).toBeGreaterThan(30);
    for (const cells of Object.values(FILM)) expect(Object.keys(cells).length).toBe(10);
  });
  it('with the Beasts known, his list ranks by what the film says works; without the trait it does not', () => {
    const sit = { down: 3, toGo: 7, los: 45 };
    const plain = { ...team, QB: strip(team.QB, 'efficiency-king', 'maestro') };
    expect(suggestPlays(sit, plain, 10, base.beasts)).toEqual(suggestPlays(sit, plain, 10));
    expect(suggestPlays(sit, team, 10, base.beasts)).not.toEqual(suggestPlays(sit, team, 10));
  });
});

void (null as unknown as OffPlay);
