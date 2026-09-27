import { describe, expect, it } from 'vitest';
import { CONTENDER_KITS, CONTENDERS_DEFAULT_KIT, isDarkKit, kitAgainst, kitLuminance, KITS } from '@/render/players/kits';

// M6.6 (Playtest 1 decision 5): the Beasts keep black and crimson; the
// Contenders default to white with lime trim and black numbers; black stays
// a preset; never two dark kits on the field.

const contrast = (a: string, b: string) => {
  const [x, y] = [kitLuminance(a), kitLuminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe('kits', () => {
  it('dresses the Contenders in white and lime with black numbers by default', () => {
    const k = KITS[CONTENDERS_DEFAULT_KIT]!;
    expect(CONTENDER_KITS[0]).toBe(CONTENDERS_DEFAULT_KIT);
    expect(isDarkKit(k)).toBe(false);
    expect(kitLuminance(k.jersey)).toBeGreaterThan(0.85);
    expect(kitLuminance(k.number)).toBeLessThan(0.02);
    expect(k.trim).toMatch(/^#9ee600$/i);
  });

  it('keeps black available as a preset, and the Beasts in black and crimson', () => {
    expect(CONTENDER_KITS).toContain('blackoutLime');
    expect(isDarkKit(KITS.blackoutLime!)).toBe(true);
    expect(isDarkKit(KITS.beasts!)).toBe(true);
    expect(KITS.beasts!.helmetStripe).toBe('#9e0f1c');
  });

  it('numbers and names read on white (WCAG contrast well past 7:1)', () => {
    const k = KITS[CONTENDERS_DEFAULT_KIT]!;
    expect(contrast(k.number, k.jersey)).toBeGreaterThan(12);
  });

  it('never puts two dark kits on the field: a dark Contenders kit changes to white against the Beasts', () => {
    for (const id of CONTENDER_KITS) {
      const worn = kitAgainst(id, 'beasts');
      expect(isDarkKit(worn) && isDarkKit(KITS.beasts!), id).toBe(false);
    }
    expect(kitAgainst('blackoutLime', 'beasts').id).toBe(CONTENDERS_DEFAULT_KIT);
    expect(kitAgainst('royal', 'beasts').id).toBe(CONTENDERS_DEFAULT_KIT);
    // A light kit is kept as picked.
    expect(kitAgainst('arctic', 'beasts').id).toBe('arctic');
    expect(kitAgainst('heritage', 'beasts').id).toBe('heritage');
    // Against a light opponent, black is fine.
    expect(kitAgainst('blackoutLime', 'arctic').id).toBe('blackoutLime');
    expect(kitAgainst('nonsense', 'beasts').id).toBe(CONTENDERS_DEFAULT_KIT);
  });
});
