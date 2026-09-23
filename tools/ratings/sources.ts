// Loads every data file the ratings read (node only). Used by the build
// script (tools/ratings/build.ts) and the ratings tests. The engine itself
// (src/engine/ratings) stays pure and takes these as arguments.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFENSE, OL_UNITS, PLAYERS } from '../../data/legacy/index.ts';
import type { Defender, Player } from '../../data/legacy/types.ts';
import { applyAddedStints, FIRST_NFLVERSE_STATS_SEASON, type AddedStintRecord, type AddedStintsFile } from '../../src/engine/data/addedStints.ts';
import { applyCorrections, validateCorrectionsFile, type AppliedCorrection } from '../../src/engine/data/corrections.ts';
import type { AccoladeRecord, AirYardsRecord, FortyRecord, BigArmRecord, EstimatedDefStint, EstimatedStats, InputSources, NflverseEntry, PhysicalRecord } from '../../src/engine/ratings/inputs.ts';

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
  /** Stints added by data/augment/added_stints.json (validated). */
  added: AddedStintRecord[];
  /** Files that weren't present (the engine regresses those inputs to priors). */
  missing: string[];
}

/** `forty: false` leaves out data/augment/forty_times.json (tools/augment/forty.ts picks its targets without it). */
export function loadSources(opts: { forty?: boolean } = {}): LoadedSources {
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
  const arm = opt('data/augment/arm_strength.json') as { airYards?: Record<string, AirYardsRecord>; bigArm?: BigArmRecord[] };
  const S: LoadedSources = {
    players: p.entries,
    defense: d.entries,
    olUnits: u.entries,
    excluded,
    applied: [...p.applied, ...d.applied, ...u.applied],
    added: [],
    people: body(people, 'entries'),
    nflverse: body(nflverse, 'entries'),
    olRosters: body(ol, 'units'),
    estStats: body(opt('data/augment/estimated_stats_pre1999.json')),
    estDef: body(opt('data/augment/estimated_def_stints_pre1999.json')),
    accolades: body(opt('data/augment/accolades.json'), 'people'),
    physical: body(opt('data/augment/estimated_physical.json'), 'people'),
    baselines: body(baselines, 'seasons'),
    arm: arm.airYards || arm.bigArm ? { airYards: body<AirYardsRecord>(arm, 'airYards'), bigArm: arm.bigArm ?? [] } : undefined,
    forty: opts.forty === false ? undefined : body<FortyRecord>(opt('data/augment/forty_times.json'), 'people'),
    missing,
  };
  addStints(S, opt('data/augment/added_stints.json') as unknown as AddedStintsFile);
  return S;
}

/**
 * Added stints (data/augment/added_stints.json, validated by
 * src/engine/data/addedStints.ts): the new entry joins the defensive or
 * offensive pool and borrows what belongs to the person, not the stint, from
 * his existing entry (`personOf`): person id, body and birth date, combine,
 * cited honors, measurables. The stint's own seasons, games and stats come
 * from the record: pre-1999 seasons from the cited table (at its source's
 * confidence), 1999+ seasons from nflverse (verified), exactly as a legacy
 * stint reads them.
 */
function addStints(S: LoadedSources, file: AddedStintsFile): void {
  if (!file?.stints?.length) return;
  const { entries, offense, records } = applyAddedStints(file, S.defense, S.players);
  const made = new Map<string, Defender | Player>([...entries, ...offense].map((e) => [e.id, e]));
  const people = S.people as Record<string, { personId: string; method: string; conf: 'verified' }>;
  const nflverse = S.nflverse as Record<string, NflverseEntry>;
  for (const r of records) {
    const e = made.get(r.id)!;
    const src = `${r.source.title} (${r.source.permalink})`;
    if ('ea' in e) (S.players as Player[]).push(e);
    else (S.defense as Defender[]).push(e);
    if (people[r.personOf]) people[e.id] = people[r.personOf]!;
    const nv = nflverse[r.personOf];
    const pre = r.seasons.filter((y) => y < FIRST_NFLVERSE_STATS_SEASON);
    // Games per season: cited before 1999, nflverse (games with a recorded stat, as for legacy stints) from 1999.
    const games = Object.fromEntries(r.seasons.map((y) => [String(y), y < FIRST_NFLVERSE_STATS_SEASON ? r.bySeason[String(y)]!.games! : r.nflverse!.games[String(y)]!]));
    nflverse[e.id] = {
      personId: nv?.personId ?? people[e.id]?.personId ?? `added:${e.id}`,
      ...(nv?.physical ? { physical: nv.physical } : {}),
      ...(nv?.combine ? { combine: nv.combine } : {}),
      seasons: { list: [...r.seasons], games, src: r.nflverse ? `${src} + nflverse:rosters+nflverse:stats_player_week` : src, conf: r.conf },
      ...(r.nflverse ? { stats: r.nflverse.stats } : {}),
    } as NflverseEntry;
    if (pre.length) {
      // The pre-1999 part: games and stats from the cited lines (for a stint
      // spanning 1999 these are the pre-1999 seasons only; nflverse has the rest).
      const [a, b] = [pre[0]!, pre[pre.length - 1]!];
      const tot = (f: string) => pre.reduce((s, y) => s + (r.bySeason[String(y)]![f] ?? 0), 0);
      if ('ea' in e) {
        const rec = tot('rec');
        (S.estStats as Record<string, EstimatedStats>)[e.id] = { name: e.n, seasons: [a, b], games: tot('games'), recPerGame: rec / Math.max(1, tot('games')), ...(rec > 0 ? { yardsPerRec: tot('yds') / rec } : {}), src, conf: r.conf };
      } else {
        // Games for pre-1999 seasons are read from the estimated-stats slot; here they are the cited games.
        (S.estStats as Record<string, EstimatedStats>)[e.id] = { name: e.n, seasons: [a, b], games: tot('games'), src, conf: r.conf };
        (S.estDef as Record<string, EstimatedDefStint>)[e.id] = { name: e.n, seasons: [a, b], sk: tot('sk'), int: tot('int'), fr: tot('fr'), td: tot('td'), src, conf: r.conf, file: 'data/augment/added_stints.json' };
      }
    }
    for (const rec of Object.values(S.accolades as Record<string, AccoladeRecord>)) if (rec?.entries?.includes(r.personOf)) rec.entries = [...rec.entries, e.id];
    for (const rec of Object.values(S.physical as Record<string, PhysicalRecord>)) if (rec?.entries?.includes(r.personOf)) rec.entries = [...rec.entries, e.id];
  }
  S.added = records;
}
