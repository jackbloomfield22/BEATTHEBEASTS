// Loads every data file the ratings read (node only). Used by the build
// script (tools/ratings/build.ts) and the ratings tests. The engine itself
// (src/engine/ratings) stays pure and takes these as arguments.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFENSE, OL_UNITS, PLAYERS } from '../../data/legacy/index.ts';
import { applyCorrections, validateCorrectionsFile, type AppliedCorrection } from '../../src/engine/data/corrections.ts';
import type { InputSources } from '../../src/engine/ratings/inputs.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function readJson<T>(rel: string, fallback?: T): T {
  const p = ROOT + rel;
  if (!existsSync(p)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${rel}`);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

/** Strip a `_meta` key from a keyed data file. */
function body<T>(obj: Record<string, unknown>, key?: string): Record<string, T> {
  const o = (key ? obj[key] : obj) as Record<string, T>;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (!k.startsWith('_')) out[k] = v;
  return out;
}

export interface LoadedSources extends InputSources {
  applied: AppliedCorrection[];
  /** Files that weren't present (the engine regresses those inputs to priors). */
  missing: string[];
}

export function loadSources(): LoadedSources {
  const missing: string[] = [];
  const opt = (rel: string): Record<string, unknown> => {
    if (!existsSync(ROOT + rel)) {
      missing.push(rel);
      return {};
    }
    return readJson<Record<string, unknown>>(rel);
  };
  const corrections = validateCorrectionsFile(readJson('data/corrections.json'));
  const p = applyCorrections(PLAYERS, corrections);
  const d = applyCorrections(DEFENSE, corrections);
  const u = applyCorrections(OL_UNITS, corrections);
  const excluded = new Set([...p.excluded, ...d.excluded, ...u.excluded]);
  const people = readJson<Record<string, unknown>>('data/augment/people.json');
  const nflverse = readJson<Record<string, unknown>>('data/augment/nflverse_entries.json');
  const ol = readJson<Record<string, unknown>>('data/augment/ol_rosters.json');
  const baselines = readJson<Record<string, unknown>>('data/era_baselines.json');
  return {
    players: p.entries,
    defense: d.entries,
    olUnits: u.entries,
    excluded,
    applied: [...p.applied, ...d.applied, ...u.applied],
    people: body(people, 'entries'),
    nflverse: body(nflverse, 'entries'),
    olRosters: body(ol, 'units'),
    estStats: body(opt('data/augment/estimated_stats_pre1999.json')),
    estDef: body(opt('data/augment/estimated_def_stints_pre1999.json')),
    accolades: body(opt('data/augment/accolades.json'), 'people'),
    physical: body(opt('data/augment/estimated_physical.json'), 'people'),
    baselines: body(baselines, 'seasons'),
    missing,
  };
}
