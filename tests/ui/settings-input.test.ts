import { describe, expect, it } from 'vitest';
import { ACTIONS, defaultBindings, findConflicts, inputLabel } from '@/input/actions';
import { validateCharacterization } from '@/engine/data/characterizationSchema';
import bundled from '@data/characterization.json';

describe('action map', () => {
  it('has unique action ids', () => {
    const ids = ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no default keyboard conflicts within a context (or against global)', () => {
    const kb = defaultBindings('kb');
    const clashes: string[] = [];
    for (const a of ACTIONS) for (const code of kb[a.id] ?? []) for (const c of findConflicts(kb, a.id, code)) clashes.push(`${a.id}~${c}:${code}`);
    // Global Esc/Backspace pause/replay intentionally overlap with menu back only
    // in the menu context, where global gameplay actions never fire.
    expect(clashes.filter((c) => !c.includes('menu.'))).toEqual([]);
  });

  it('matches the GDD §8.1 key defaults', () => {
    const kb = defaultBindings('kb');
    expect(kb['preSnap.snap']).toEqual(['Space']);
    expect(kb['pocket.throw1']).toEqual(['Digit1']);
    expect(kb['carrier.jukeLeft']).toEqual(['KeyQ']);
    expect(kb['carrier.truck']).toEqual(['KeyR']);
    expect(kb['global.replay']).toEqual(['KeyP', 'Backspace']);
  });

  it('labels inputs readably', () => {
    expect(inputLabel('KeyW')).toBe('W');
    expect(inputLabel('Digit3')).toBe('3');
    expect(inputLabel('Mouse2')).toBe('Right Click');
    expect(inputLabel('Pad:RT')).toBe('RT');
  });
});

describe('characterization file', () => {
  it('bundled data file is valid', () => {
    expect(() => validateCharacterization(bundled)).not.toThrow();
  });
  it('rejects out-of-range tones and sorts keys', () => {
    expect(() => validateCharacterization({ version: 1, entries: { X: { skin: 5 } } })).toThrow();
    const v = validateCharacterization({ version: 1, entries: { b: { skin: 1 }, a: { skin: 0 } } });
    expect(Object.keys(v.entries)).toEqual(['a', 'b']);
  });
});
