import { describe, expect, it } from 'vitest';
import { ACTIONS, defaultBindings, findConflicts, inputLabel, KB_DEFAULTS_V2, KB_DEFAULTS_V3, KB_DEFAULTS_V4 } from '@/input/actions';
import { defaultSettings, migrate } from '@/app/settings';
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
    expect(kb['carrier.truck']).toEqual(['Digit4', 'KeyR']);
    expect(kb['global.replay']).toEqual(['KeyP', 'Backspace']);
  });

  it('plays on the arrows with the left hand on 1–5, 1–3 and Q–F (settings v3)', () => {
    const kb = defaultBindings('kb');
    for (const p of ['pocket.move', 'carrier.']) {
      const up = p === 'carrier.' ? 'up' : 'Up';
      expect(kb[p + up]).toEqual(['ArrowUp']);
    }
    expect(kb['carrier.right']).toEqual(['ArrowRight']);
    expect(kb['carrier.sprint']).toEqual(['ShiftRight', 'ShiftLeft']);
    expect([kb['air.aggressive'], kb['air.possession'], kb['air.rac']]).toEqual([['Digit1'], ['Digit2'], ['Digit3']]);
    // The number row first (v5), the letters as second keys.
    expect([kb['carrier.juke'], kb['carrier.stiffArm'], kb['carrier.spin']]).toEqual([['Digit1', 'KeyQ'], ['Digit2', 'KeyW'], ['Digit3', 'KeyE']]);
    expect([kb['carrier.truck'], kb['carrier.dive'], kb['carrier.protect']]).toEqual([['Digit4', 'KeyR'], ['Digit5', 'KeyF'], ['Digit6', 'KeyC']]);
    expect(kb['pocket.scramble']).toEqual(['ShiftLeft', 'ShiftRight']);
    // The directional jukes stay on the right stick only.
    expect(kb['carrier.jukeLeft']).toEqual([]);
    expect(defaultBindings('pad')['carrier.jukeLeft']).toEqual(['Pad:RSLeft']);
  });

  it('v2 settings move to the new keys, but keep a key the player rebound', () => {
    const old = defaultSettings({ ...defaultBindings('kb'), ...KB_DEFAULTS_V2, 'carrier.spin': ['KeyX'] }, defaultBindings('pad'));
    (old as { version: number }).version = 2;
    const m = migrate(old);
    expect(m.version).toBe(5);
    // Still on the old default: dropped, so the merge with the defaults fills in the new one.
    expect(m.controls.keyboard['carrier.up']).toBeUndefined();
    expect(m.controls.keyboard['air.possession']).toBeUndefined();
    // Rebound by the player: kept.
    expect(m.controls.keyboard['carrier.spin']).toEqual(['KeyX']);
  });

  it('v3 settings free Tab for the route preview (flip moves to F), keeping a rebound flip', () => {
    const old = defaultSettings({ ...defaultBindings('kb'), ...KB_DEFAULTS_V3 }, defaultBindings('pad'));
    (old as { version: number }).version = 3;
    expect(migrate(old).controls.keyboard['preSnap.flip']).toBeUndefined();
    const rebound = defaultSettings({ ...defaultBindings('kb'), 'preSnap.flip': ['KeyL'] }, defaultBindings('pad'));
    (rebound as { version: number }).version = 3;
    expect(migrate(rebound).controls.keyboard['preSnap.flip']).toEqual(['KeyL']);
    expect(defaultBindings('kb')['preSnap.routes']).toEqual(['Tab']);
    expect(defaultBindings('pad')['preSnap.routes']).toEqual(['Pad:RT']);
  });

  it('v4 settings put the carrier moves on the number row, keeping a rebound move', () => {
    const old = defaultSettings({ ...defaultBindings('kb'), ...KB_DEFAULTS_V4, 'carrier.spin': ['KeyX'] }, defaultBindings('pad'));
    (old as { version: number }).version = 4;
    const m = migrate(old);
    expect(m.controls.keyboard['carrier.juke']).toBeUndefined();
    expect(m.controls.keyboard['carrier.spin']).toEqual(['KeyX']);
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
