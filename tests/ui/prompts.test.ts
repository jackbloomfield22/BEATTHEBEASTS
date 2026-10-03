import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultBindings, inputLabel } from '@/input/actions';
import { padGlyph, parsePadHint, promptCode, promptText } from '@/input/prompts';

// M6.6 (Playtest 1): with a controller, every prompt shows the button, never
// a number or a key.

const kb = defaultBindings('kb');
const pad = defaultBindings('pad');

/** Every action a prompt on the field, the play call or the menus names. */
const PROMPTED = [
  'preSnap.snap',
  'preSnap.routes',
  'preSnap.hotRoute',
  'preSnap.audible',
  ...[1, 2, 3, 4, 5].map((n) => `pocket.throw${n}`),
  'pocket.pumpFake',
  'pocket.throwAway',
  'pocket.scramble',
  'air.auto',
  'air.aggressive',
  'air.rac',
  'carrier.auto',
  'carrier.option1',
  'carrier.option2',
  'carrier.option3',
  'carrier.protect',
  'carrier.truck',
  'carrier.jukeLeft',
  'carrier.jukeRight',
  ...[1, 2, 3, 4, 5].map((n) => `hot.n${n}`),
  'hot.cancel',
  'menu.confirm',
  'menu.back',
  'menu.tabPrev',
  'menu.tabNext',
  'menu.alt',
  'menu.alt2',
  'menu.alt3',
  'global.pause',
  // The instant replay (M7): the result card's offer, and the replay's deck.
  'global.replay',
  'replay.playPause',
  'replay.slowmo',
  'replay.scrubBack',
  'replay.scrubForward',
  'replay.frameBack',
  'replay.frameForward',
  'replay.start',
  'replay.key',
  'replay.camera',
  'replay.focus',
  'replay.close',
  // The Beasts' drive montage (M7): skipped with the confirm or back binding (and Start, global.pause).
  'menu.confirm',
  'menu.back',
];

describe('prompt labels per device', () => {
  it('draws every prompted action as a pad glyph on a controller', () => {
    for (const a of PROMPTED) {
      const code = promptCode(a, 'pad', kb, pad);
      expect(code, a).toMatch(/^Pad:/);
      expect(padGlyph(code!), a).not.toBeNull();
      // Never a number.
      expect(promptText(a, 'pad', kb, pad), a).not.toMatch(/^\d/);
    }
  });

  it('keeps the keys on a keyboard: the receivers and the move options are the number row', () => {
    expect([1, 2, 3, 4, 5].map((n) => promptText(`pocket.throw${n}`, 'kb', kb, pad))).toEqual(['1', '2', '3', '4', '5']);
    expect(['carrier.option1', 'carrier.option2', 'carrier.option3'].map((a) => promptText(a, 'kb', kb, pad))).toEqual(['1', '2', '3']);
    expect(promptCode('preSnap.snap', 'kb', kb, pad)).toBe('Space');
  });

  it("skips the Beasts' drive montage with A or B on a pad, Enter or Esc on a keyboard", () => {
    expect(promptCode('menu.confirm', 'pad', kb, pad)).toBe('Pad:A');
    expect(promptCode('menu.back', 'pad', kb, pad)).toBe('Pad:B');
    expect(promptCode('menu.confirm', 'kb', kb, pad)).toBe('Enter');
    expect(promptCode('menu.back', 'kb', kb, pad)).toBe('Escape');
    expect(promptCode('global.pause', 'pad', kb, pad)).toBe('Pad:Menu');
  });

  it('follows a rebinding', () => {
    const p2 = { ...pad, 'pocket.throw1': ['Pad:LB'] };
    expect(promptCode('pocket.throw1', 'pad', kb, p2)).toBe('Pad:LB');
    expect(padGlyph('Pad:LB')).toEqual({ kind: 'bumper', label: 'LB' });
  });

  it('knows how each pad input is drawn', () => {
    expect(padGlyph('Pad:A')).toMatchObject({ kind: 'face', letter: 'A' });
    expect(padGlyph('Pad:Y')).toMatchObject({ kind: 'face', letter: 'Y' });
    expect(padGlyph('Pad:RT')).toEqual({ kind: 'trigger', label: 'RT' });
    expect(padGlyph('Pad:LSUp')).toEqual({ kind: 'stick', side: 'L', dir: 'up', click: false });
    expect(padGlyph('Pad:RS')).toEqual({ kind: 'stick', side: 'R', dir: null, click: true });
    expect(padGlyph('Pad:Left')).toEqual({ kind: 'dpad', dir: 'left' });
    expect(padGlyph('Pad:Menu')).toEqual({ kind: 'menu' });
    expect(padGlyph('KeyW')).toBeNull();
    expect(padGlyph('Digit1')).toBeNull();
  });

  it('reads the written pad hints as glyphs', () => {
    expect(parsePadHint('A')).toEqual([{ code: 'Pad:A' }]);
    expect(parsePadHint('LB / RB')).toEqual([{ code: 'Pad:LB' }, { code: 'Pad:RB' }]);
    expect(parsePadHint('Hold A')).toEqual(['Hold', { code: 'Pad:A' }]);
    expect(parsePadHint('D-Pad', '↑↓')).toEqual([{ code: 'Pad:DPadV' }]);
    expect(parsePadHint('D-Pad', '← →')).toEqual([{ code: 'Pad:DPadH' }]);
    expect(parsePadHint('Stick')).toEqual([{ code: 'Pad:LStick' }]);
    expect(parsePadHint('—')).toBeNull();
  });

  it('every pad hint written in the screens draws as glyphs (no stray words but "Hold" and the kick\'s "Release")', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.tsx')) files.push(join(d, e.name));
      }
    };
    walk('src/ui');
    const hints = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/pad(?::\s*|=)["']([^"']*)["']/g)].map((m) => m[1]!));
    expect(hints.length).toBeGreaterThan(30);
    for (const h of hints) {
      const parts = parsePadHint(h);
      if (parts === null) continue; // no pad input: the hint is left off on a pad
      for (const p of parts) if (typeof p === 'string') expect(['Hold', 'Release'], `hint "${h}"`).toContain(p);
    }
  });

  it('labels stay readable as text where a glyph cannot go', () => {
    expect(inputLabel('Pad:LB')).toBe('LB');
    expect(inputLabel('Pad:RSLeft')).toBe('R-Stick ←');
  });
});
