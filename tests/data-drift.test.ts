// Drift test: the generated data/legacy modules must equal a fresh parse of
// legacy/beat-the-beasts.jsx, value for value. Counts, per-dataset SHA-256 of a
// canonical (sorted-key) JSON serialization with the added id/legacyIndex
// fields stripped, a deterministic 60-entry field-by-field spot check (key
// order included), and the frozen id list.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as data from '@data/legacy';
import { canonicalJson, ID_DATASETS, makeIds, parseLegacyFile, sha256Hex, stripAdded } from '../tools/extract/parseLegacy';
import type { Literal } from '../tools/extract/parseLegacy';
import { makeRng } from '@/engine/rng';

const fresh = parseLegacyFile();
const K = fresh.constants as Record<string, Literal>;
const arr = (name: string) => K[name] as Record<string, Literal>[];

const hashOf = (v: unknown) => sha256Hex(canonicalJson(v));

describe('legacy data drift', () => {
  it('generated files come from the current legacy file', () => {
    expect(data.LEGACY_SHA256).toBe(fresh.sha256);
  });

  it('entry counts per dataset and position', () => {
    expect(data.PLAYERS.length).toBe(3064);
    const byPos: Record<string, number> = {};
    for (const p of data.PLAYERS) byPos[p.p] = (byPos[p.p] ?? 0) + 1;
    expect(byPos).toEqual({ QB: 649, RB: 844, WR: 992, TE: 579 });
    expect(data.DEFENSE.length).toBe(386);
    const defPos: Record<string, number> = {};
    for (const p of data.DEFENSE) defPos[p.p] = (defPos[p.p] ?? 0) + 1;
    expect(defPos).toEqual({ DE: 99, DT: 54, LB: 107, CB: 69, S: 57 });
    expect(data.OL_UNITS.length).toBe(184);
    expect(data.DEF_UNITS.length).toBe(71);
    expect(data.LEGACY_UNITS_LENGTH).toBe(255);
    expect(Object.keys(data.YEAR_DEFENSES).length).toBe(55);
    expect(Object.keys(data.YEAR_DEFENSES).map(Number)).toEqual(Array.from({ length: 55 }, (_, i) => 1970 + i));
    // and the fresh parse agrees
    expect(arr('PLAYERS').length).toBe(3064);
    expect(arr('DEFENSE').length).toBe(386);
    expect(arr('UNITS').length).toBe(255);
  });

  it('dataset hashes match a fresh parse (id/legacyIndex stripped)', () => {
    const pairs: [string, unknown, unknown][] = [
      ['PLAYERS', stripAdded(data.PLAYERS), K.PLAYERS],
      ['DEFENSE', stripAdded(data.DEFENSE), K.DEFENSE],
      ['OL_UNITS', stripAdded(data.OL_UNITS), arr('UNITS').filter((u) => u.p === 'OL')],
      ['DEF_UNITS', stripAdded(data.DEF_UNITS), arr('UNITS').filter((u) => u.p === 'DEF')],
      ['YEAR_DEFENSES', data.YEAR_DEFENSES, K.YEAR_DEFENSES],
      ['ERA_BASE', data.ERA_BASE, K.ERA_BASE],
      ['DEF_ERA_BASE', data.DEF_ERA_BASE, K.DEF_ERA_BASE],
      ['LEAGUE_AVG_PA', data.LEAGUE_AVG_PA, K.LEAGUE_AVG_PA],
      ['SCORE_K', data.SCORE_K, K.SCORE_K],
      ['REF_ERA', data.REF_ERA, K.REF_ERA],
      ['TEAM_COLORS', data.TEAM_COLORS, K.TEAM_COLORS],
      ['TEAM_NICKS', data.TEAM_NICKS, K.TEAM_NICKS],
      ['SKIN_TONES', data.SKIN_TONES, K.SKIN_TONES],
      ['POS_HEX', data.POS_HEX, K.POS_HEX],
      ['DECADE_HEX', data.DECADE_HEX, K.DECADE_HEX],
      ['C', data.C, K.C],
      ['DECADES', data.DECADES, K.DECADES],
      ['SLOT_ORDER', data.SLOT_ORDER, K.SLOT_ORDER],
      ['POSITIONS', data.POSITIONS, K.POSITIONS],
      ['ROUNDS', data.ROUNDS, K.ROUNDS],
      ['NUM_DRIVES', data.NUM_DRIVES, K.NUM_DRIVES],
      ['TEAM_NAME', data.TEAM_NAME, K.TEAM_NAME],
    ];
    for (const [name, gen, legacy] of pairs) {
      expect(legacy, name).toBeDefined();
      expect(hashOf(gen), name).toBe(hashOf(legacy));
    }
  });

  it('OL_UNITS + DEF_UNITS reassemble legacy UNITS exactly (order via legacyIndex)', () => {
    const merged = [...data.OL_UNITS, ...data.DEF_UNITS].sort((a, b) => a.legacyIndex - b.legacyIndex);
    expect(merged.map((u) => u.legacyIndex)).toEqual(Array.from({ length: 255 }, (_, i) => i));
    expect(hashOf(stripAdded(merged))).toBe(hashOf(K.UNITS));
  });

  it('legacyIndex is the index in the legacy array', () => {
    data.PLAYERS.forEach((p, i) => expect(p.legacyIndex).toBe(i));
    data.DEFENSE.forEach((p, i) => expect(p.legacyIndex).toBe(i));
  });

  it('60 sampled entries match field by field (key order included)', () => {
    const rng = makeRng(0xd1f7);
    const sets: [string, readonly Record<string, unknown>[], Record<string, Literal>[]][] = [
      ['PLAYERS', data.PLAYERS as unknown as Record<string, unknown>[], arr('PLAYERS')],
      ['DEFENSE', data.DEFENSE as unknown as Record<string, unknown>[], arr('DEFENSE')],
      ['UNITS', [...data.OL_UNITS, ...data.DEF_UNITS].sort((a, b) => a.legacyIndex - b.legacyIndex) as unknown as Record<string, unknown>[], arr('UNITS')],
    ];
    const plan: [number, number][] = [[0, 36], [1, 14], [2, 10]]; // 60 in total
    let checked = 0;
    for (const [si, count] of plan) {
      const [name, gen, legacy] = sets[si]!;
      for (let k = 0; k < count; k++) {
        const i = Math.floor(rng() * legacy.length);
        const g = gen[i]!, l = legacy[i]!;
        const gKeys = Object.keys(g).filter((x) => x !== 'id' && x !== 'legacyIndex');
        expect(gKeys, `${name}[${i}] keys`).toEqual(Object.keys(l));
        for (const key of gKeys) {
          const gv = g[key], lv = l[key];
          if (lv !== null && typeof lv === 'object') {
            expect(Object.keys(gv as object), `${name}[${i}].${key} keys`).toEqual(Object.keys(lv));
            for (const sk of Object.keys(lv)) expect(Object.is((gv as Record<string, unknown>)[sk], (lv as Record<string, Literal>)[sk]), `${name}[${i}].${key}.${sk}`).toBe(true);
          } else {
            expect(Object.is(gv, lv), `${name}[${i}].${key}`).toBe(true);
          }
        }
        checked++;
      }
    }
    expect(checked).toBe(60);
  });

  it('ids are unique, match the frozen ids.json, and regenerate identically', () => {
    const frozen = JSON.parse(readFileSync(new URL('../data/legacy/ids.json', import.meta.url), 'utf8')) as Record<string, string[]>;
    const gen = {
      players: data.PLAYERS.map((p) => p.id),
      defense: data.DEFENSE.map((p) => p.id),
      olUnits: data.OL_UNITS.map((p) => p.id),
      defUnits: data.DEF_UNITS.map((p) => p.id),
    };
    expect(gen).toEqual(frozen);
    const all = Object.values(gen).flat();
    expect(new Set(all).size).toBe(all.length);
    const units = arr('UNITS') as unknown as { n: string; t: string; d: string; p: string }[];
    expect(makeIds(ID_DATASETS.players, 'person', arr('PLAYERS') as unknown as { n: string; t: string; d: string }[])).toEqual(frozen.players);
    expect(makeIds(ID_DATASETS.defense, 'person', arr('DEFENSE') as unknown as { n: string; t: string; d: string }[])).toEqual(frozen.defense);
    expect(makeIds(ID_DATASETS.olUnits, 'unit', units.filter((u) => u.p === 'OL'))).toEqual(frozen.olUnits);
    expect(makeIds(ID_DATASETS.defUnits, 'unit', units.filter((u) => u.p === 'DEF'))).toEqual(frozen.defUnits);
    // the one repeated natural key in legacy: the duplicated TEN 1990s OL unit
    expect(all.filter((id) => id.includes('~'))).toEqual(['ol-units:tennessee-oilers-titans:TEN:1990s~2']);
  });
});
