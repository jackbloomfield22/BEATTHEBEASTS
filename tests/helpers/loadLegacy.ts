// Loads the ORIGINAL legacy functions straight from legacy/beat-the-beasts.jsx
// (the file is only read, never modified):
//
//   1. read the source;
//   2. replace the two import lines (react, lucide-react) with inert stubs
//      declaring the same names, so nothing outside the file is needed;
//   3. append `export { ...names }` for the top-level declarations we test;
//   4. esbuild-transform the JSX (loader 'jsx'), write a temp .mjs, and
//      dynamic-import it.
//
// Module-level code in legacy only builds data and helper tables, so importing
// it runs no UI. The legacy module shares this realm's globals, which lets a
// test swap Math.random for a seeded stream around a legacy call.

import { transformSync } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type * as Port from '@/engine/legacy';
import type * as Rng from '@/engine/rng';

export const LEGACY_FILE = fileURLToPath(new URL('../../legacy/beat-the-beasts.jsx', import.meta.url));

/** Untyped legacy data entry (as the legacy module holds it). */
export type LegacyEntry = Record<string, unknown> & { n: string; p: string; t: string; d: string; imp: number };

export interface LegacyModule {
  PLAYERS: LegacyEntry[];
  DEFENSE: LegacyEntry[];
  UNITS: LegacyEntry[];
  makeRng: typeof Rng.makeRng;
  seedFromDate: typeof Rng.seedFromDate;
  todayKey: (d?: { getFullYear(): number; getMonth(): number; getDate(): number }) => string;
  gaussNoise: typeof Rng.gaussNoise;
  matchupSeed: typeof Rng.matchupSeed;
  clampN: typeof Port.clampN;
  round1: typeof Port.round1;
  pct: typeof Port.pct;
  ratio: typeof Port.ratio;
  eraEquiv: typeof Port.eraEquiv;
  deriveProfile: typeof Port.deriveProfile;
  calculateOffensivePF: typeof Port.calculateOffensivePF;
  assembleBeastsOnce: () => ReturnType<typeof Port.assembleBeastsOnce>;
  assembleBeasts: () => ReturnType<typeof Port.assembleBeasts>;
  assembleBeastsSeeded: typeof Port.assembleBeastsSeeded;
  rateBeasts: typeof Port.rateBeasts;
  buildDailySequence: typeof Port.buildDailySequence;
  computePerfectTeam: typeof Port.computePerfectTeam;
  computeTopLineups: typeof Port.computeTopLineups;
  getDailyChallenge: typeof Port.getDailyChallenge;
  rateOffense: typeof Port.rateOffense;
  rateDefenders: typeof Port.rateDefenders;
  buildMatchups: typeof Port.buildMatchups;
  simulateBeatdown: typeof Port.simulateBeatdown;
  getInitials: typeof Port.getInitials;
  getOpenPositions: typeof Port.getOpenPositions;
  getAvailablePicks: typeof Port.getAvailablePicks;
  lastNameOf: typeof Port.lastNameOf;
  getValidPairs: typeof Port.getValidPairs;
  targetSlotFor: typeof Port.targetSlotFor;
  scoreToGrade: typeof Port.scoreToGrade;
  gradeColor: typeof Port.gradeColor;
  gradeQB: typeof Port.gradeQB;
  gradeRush: typeof Port.gradeRush;
  gradeRec: typeof Port.gradeRec;
  situFor: typeof Port.situFor;
  captionFor: typeof Port.captionFor;
  bannerFor: typeof Port.bannerFor;
  generateBeatdownAnalysis: typeof Port.generateBeatdownAnalysis;
}

const EXPORTS: readonly (keyof LegacyModule)[] = [
  'PLAYERS', 'DEFENSE', 'UNITS',
  'makeRng', 'seedFromDate', 'todayKey', 'gaussNoise', 'matchupSeed',
  'clampN', 'round1', 'pct', 'ratio', 'eraEquiv', 'deriveProfile', 'calculateOffensivePF',
  'assembleBeastsOnce', 'assembleBeasts', 'assembleBeastsSeeded', 'rateBeasts',
  'buildDailySequence', 'computePerfectTeam', 'computeTopLineups', 'getDailyChallenge',
  'rateOffense', 'rateDefenders', 'buildMatchups', 'simulateBeatdown',
  'getInitials', 'getOpenPositions', 'getAvailablePicks', 'lastNameOf', 'getValidPairs', 'targetSlotFor',
  'scoreToGrade', 'gradeColor', 'gradeQB', 'gradeRush', 'gradeRec',
  'situFor', 'captionFor', 'bannerFor', 'generateBeatdownAnalysis',
];

const IMPORT_RE = /^import\s+(.+?)\s+from\s+['"](react|lucide-react)['"];?\s*$/gm;

/** Turns `React, { a, b }` / `{ a, b }` into stub declarations. */
function stubFor(clause: string, from: string): string {
  const names: string[] = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces?.[1]) for (const part of braces[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.push(n); }
  const def = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  const lines: string[] = [];
  if (def) lines.push(`const ${def} = { createElement: () => null, Fragment: null, useRef: (v) => ({ current: v }) };`);
  for (const n of names) {
    lines.push(from === 'react' ? `const ${n} = () => { throw new Error('legacy stub: ${n}'); };` : `const ${n} = () => null;`);
  }
  return lines.join(' ');
}

/** The transformed legacy module source (exported for inspection in tests). */
export function buildLegacyModuleSource(): string {
  const src = readFileSync(LEGACY_FILE, 'utf8');
  let replaced = 0;
  const stubbed = src.replace(IMPORT_RE, (_m, clause: string, from: string) => { replaced++; return stubFor(clause, from); });
  if (replaced !== 2) throw new Error(`expected 2 stubbed imports in legacy, found ${replaced}`);
  const withExports = `${stubbed}\nexport { ${EXPORTS.join(', ')} };\n`;
  return transformSync(withExports, { loader: 'jsx', format: 'esm', target: 'es2022', sourcefile: 'beat-the-beasts.jsx' }).code;
}

let cached: Promise<LegacyModule> | null = null;

export function loadLegacy(): Promise<LegacyModule> {
  if (!cached) {
    cached = (async () => {
      const dir = mkdtempSync(join(tmpdir(), 'btb-legacy-'));
      const file = join(dir, 'beat-the-beasts.legacy.mjs');
      writeFileSync(file, buildLegacyModuleSource());
      try {
        return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as LegacyModule;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    })();
  }
  return cached;
}

/** Runs `fn` with Math.random replaced by `rand`, restoring it afterwards. */
export function withMathRandom<T>(rand: () => number, fn: () => T): T {
  const orig = Math.random;
  Math.random = rand;
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
}

/**
 * The only normalization applied to port outputs before comparing with
 * legacy: every object that carries BOTH `id` and `legacyIndex` (i.e. a port
 * data entry, or an object spread from one such as `{ ...player, idx }`) has
 * those two keys removed. Nothing else is touched: all other keys, key order,
 * numbers (including -0 and NaN), strings, undefined-valued keys and array
 * order are compared as-is.
 */
export function stripPortIds<T>(value: T): T {
  const seen = new Map<object, unknown>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (const x of v) out.push(walk(x));
      return out;
    }
    const obj = v as Record<string, unknown>;
    const strip = 'id' in obj && 'legacyIndex' in obj;
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const k of Object.keys(obj)) {
      if (strip && (k === 'id' || k === 'legacyIndex')) continue;
      out[k] = walk(obj[k]);
    }
    return out;
  };
  return walk(value) as T;
}

/**
 * Order-sensitive serialization (keys in insertion order) that keeps what
 * JSON drops: undefined, NaN, ±Infinity and -0. Used alongside toStrictEqual
 * so key order is compared too.
 */
export function orderedSerialize(value: unknown): string {
  const walk = (v: unknown): string => {
    if (v === undefined) return 'undefined';
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
    const obj = v as Record<string, unknown>;
    return '{' + Object.keys(obj).map((k) => JSON.stringify(k) + ':' + walk(obj[k])).join(',') + '}';
  };
  return walk(value);
}
