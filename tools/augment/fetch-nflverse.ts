// Download the nflverse datasets the augmentation pipeline reads.
//
//   node --experimental-strip-types tools/augment/fetch-nflverse.ts [--force]
//
// Files land in tools/augment/cache/ (gitignored; ~270 MB). Existing files are
// skipped unless --force. The manifest (file, url, bytes, sha256, fetched
// date) is written to data/augment/sources.json, which IS committed so every
// derived value can be traced to an exact dataset version.
//
// Downloads shell out to `curl` (it honours HTTPS_PROXY and the system CA
// store everywhere; Node 22's fetch does not read proxy variables).
//
// Source: https://github.com/nflverse/nflverse-data/releases (CC-BY-4.0).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = join(ROOT, 'tools', 'augment', 'cache');
export const SOURCES_PATH = join(ROOT, 'data', 'augment', 'sources.json');

const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download';

/** First season with nflverse roster data (the NFL/AFL 1960 season). */
export const FIRST_ROSTER_SEASON = 1960;
/** First season with nflverse play-by-play derived player stats. */
export const FIRST_STATS_SEASON = 1999;
/**
 * Last completed season the pipeline reads. The legacy data already contains
 * 2025-only stints (Sam Darnold SEA, Cooper Kupp SEA, George Pickens DAL), so
 * the 2020s decade runs 2020–2025 here.
 */
export const LAST_SEASON = 2025;

export interface SourceFile {
  /** Path under tools/augment/cache/. */
  readonly file: string;
  readonly url: string;
  readonly dataset: string;
}

export function sourceFiles(): SourceFile[] {
  const files: SourceFile[] = [
    { file: 'players.csv', url: `${RELEASES}/players/players.csv`, dataset: 'players' },
    { file: 'combine.csv', url: `${RELEASES}/combine/combine.csv`, dataset: 'combine' },
    { file: 'games.csv', url: `${RELEASES}/schedules/games.csv`, dataset: 'schedules' },
  ];
  for (let y = FIRST_ROSTER_SEASON; y <= LAST_SEASON; y++) {
    files.push({ file: `rosters/roster_${y}.csv`, url: `${RELEASES}/rosters/roster_${y}.csv`, dataset: 'rosters' });
  }
  for (let y = FIRST_STATS_SEASON; y <= LAST_SEASON; y++) {
    files.push({
      file: `stats_player/stats_player_week_${y}.csv`,
      url: `${RELEASES}/stats_player/stats_player_week_${y}.csv`,
      dataset: 'stats_player_week',
    });
  }
  return files;
}

export interface ManifestEntry {
  readonly file: string;
  readonly url: string;
  readonly dataset: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly fetched: string;
}

export interface Manifest {
  readonly note: string;
  readonly license: string;
  readonly files: readonly ManifestEntry[];
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readManifest(): Map<string, ManifestEntry> {
  const out = new Map<string, ManifestEntry>();
  if (!existsSync(SOURCES_PATH)) return out;
  const m = JSON.parse(readFileSync(SOURCES_PATH, 'utf8')) as Manifest;
  for (const e of m.files) out.set(e.file, e);
  return out;
}

function main(): void {
  const force = process.argv.includes('--force');
  const previous = readManifest();
  const today = new Date().toISOString().slice(0, 10);
  const entries: ManifestEntry[] = [];
  let downloaded = 0;
  for (const src of sourceFiles()) {
    const path = join(CACHE_DIR, src.file);
    mkdirSync(dirname(path), { recursive: true });
    let fetched = previous.get(src.file)?.fetched ?? today;
    if (force || !existsSync(path)) {
      const tmp = `${path}.part`;
      process.stdout.write(`fetch ${src.url}\n`);
      execFileSync('curl', ['-sSL', '--fail', '--retry', '3', '-o', tmp, src.url], { stdio: 'inherit' });
      renameSync(tmp, path);
      fetched = today;
      downloaded++;
    }
    const bytes = statSync(path).size;
    const hash = sha256(path);
    const prev = previous.get(src.file);
    // A re-download with identical bytes keeps its original fetch date.
    if (prev && prev.sha256 === hash) fetched = prev.fetched;
    entries.push({ file: src.file, url: src.url, dataset: src.dataset, bytes, sha256: hash, fetched });
  }
  const manifest: Manifest = {
    note: 'Raw nflverse files read by tools/augment/build.ts. Cached in tools/augment/cache/ (not committed); re-fetch with tools/augment/fetch-nflverse.ts.',
    license: 'CC-BY-4.0 (nflverse-data releases, https://github.com/nflverse/nflverse-data)',
    files: entries,
  };
  mkdirSync(dirname(SOURCES_PATH), { recursive: true });
  writeFileSync(SOURCES_PATH, `${JSON.stringify(manifest, null, 1)}\n`);
  process.stdout.write(`${entries.length} files (${downloaded} downloaded) → ${SOURCES_PATH}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
