import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CELEBRATIONS, pickChoices, roleOf, type ScorerRole } from '@/game/celebration';

// M7 touchdown celebrations (Playtest 1 #7): a pool of twelve, three on
// offer seeded by the play (the same play, the same three), fitting the
// scorer, and every one a clip that's in the library and passed its gates.

const meta = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as { clips: Record<string, { kind: string; events?: Record<string, number>; gates: { pass: boolean } }> };
const ROLES: ScorerRole[] = ['receiver', 'back', 'qb', 'big'];

describe('touchdown celebrations', () => {
  it('has a pool of twelve, each an in-house clip in the library that passed its gates', () => {
    expect(CELEBRATIONS).toHaveLength(12);
    for (const c of CELEBRATIONS) {
      const m = meta.clips[c.clip];
      expect(m, c.clip).toBeDefined();
      expect(m!.kind, c.clip).toBe('transition');
      expect(m!.gates.pass, c.clip).toBe(true);
      // A ball the clip lets go of (or moves to the other hand) has the frame it happens on.
      if (c.ball === 'release') expect(m!.events?.release, c.clip).toBeGreaterThan(0);
      if (c.ball === 'left') expect(m!.events?.left, c.clip).toBeGreaterThan(0);
    }
    for (const n of ['cel_mate_point', 'cel_five_r', 'cel_five_l']) expect(meta.clips[n]?.gates.pass, n).toBe(true);
  });

  it('offers three different ones, the same three for the same play', () => {
    for (const role of ROLES) {
      for (let seed = 0; seed < 40; seed++) {
        const a = pickChoices(seed, role, true);
        expect(a).toHaveLength(3);
        expect(new Set(a).size).toBe(3);
        expect(pickChoices(seed, role, true)).toEqual(a);
      }
    }
  });

  it('varies from play to play and fits the scorer', () => {
    const seen = (role: ScorerRole) => {
      const n = new Map<string, number>();
      for (let seed = 0; seed < 400; seed++) for (const id of pickChoices(seed * 7919, role, true)) n.set(id, (n.get(id) ?? 0) + 1);
      return n;
    };
    const big = seen('big');
    const wr = seen('receiver');
    // Every one of the twelve comes up for someone.
    expect(new Set([...big.keys(), ...wr.keys()]).size).toBe(12);
    // A big man flexes far more often than a receiver; a receiver points to the crowd more than a big man.
    expect(big.get('flex')!).toBeGreaterThan(2 * (wr.get('flex') ?? 0));
    expect(wr.get('point')!).toBeGreaterThan(2 * (big.get('point') ?? 0));
  });

  it('leads with the best fit of the three (the one that plays if nothing is pressed)', () => {
    for (const role of ROLES) {
      for (let seed = 0; seed < 50; seed++) {
        const [first, ...rest] = pickChoices(seed, role, true).map((id) => CELEBRATIONS.find((c) => c.id === id)!.fits[role]);
        for (const r of rest) expect(first!).toBeGreaterThanOrEqual(r);
      }
    }
  });

  it('only offers the chest bump when a team-mate is close enough to come over', () => {
    for (let seed = 0; seed < 200; seed++) expect(pickChoices(seed, 'big', false)).not.toContain('chestBump');
  });

  it("doesn't offer last time's again straight away as often", () => {
    let repeats = 0;
    let fresh = 0;
    for (let seed = 0; seed < 300; seed++) {
      const a = pickChoices(seed, 'receiver', true);
      const b = pickChoices(seed + 1, 'receiver', true, a);
      const b0 = pickChoices(seed + 1, 'receiver', true);
      repeats += b.filter((id) => a.includes(id)).length;
      fresh += b0.filter((id) => a.includes(id)).length;
    }
    expect(repeats).toBeLessThan(fresh * 0.7);
  });

  it('reads the scorer: receivers, backs, quarterbacks and big men', () => {
    expect(roleOf({ pos: 'WR', weightLb: 190 })).toBe('receiver');
    expect(roleOf({ pos: 'TE', weightLb: 255 })).toBe('receiver');
    expect(roleOf({ pos: 'RB', weightLb: 215 })).toBe('back');
    expect(roleOf({ pos: 'QB', weightLb: 225 })).toBe('qb');
    expect(roleOf({ pos: 'OL', weightLb: 310 })).toBe('big');
    expect(roleOf({ pos: 'RB', weightLb: 285 })).toBe('big');
  });
});
