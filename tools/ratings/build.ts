// Build the ratings snapshot.
//
//   node tools/run-ts.mjs tools/ratings/build.ts [--check | --inputs-only]
//
// Reads legacy data + corrections + data/augment/* + data/era_baselines.json,
// assembles the sourced inputs, rates everyone, and writes:
//   data/ratings/inputs.v1.json   assembled RatingInputs; the Ratings Explorer rates these
//                                 live. Generated (gitignored): predev/prebuild make it.
//   data/ratings/ratings.v1.json  compact snapshot the game reads (values, conf, traits,
//                                 OVR). Committed: the Daily pins a ratings version.
// --check fails if ratings.v1.json would change (npm run check runs it).
// --inputs-only writes just the inputs file (fast, used before dev/build).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { snapshot } from '../../src/engine/ratings/snapshot.ts';
import { loadSources, ROOT } from './sources.ts';

const S = loadSources();
if (S.missing.length) console.warn(`missing (inputs regress to priors): ${S.missing.join(', ')}`);
const { inputs, notes } = buildInputs(S);
const inputsOnly = process.argv.includes('--inputs-only');
const run = inputsOnly ? undefined : rateAll(inputs);
if (notes.length) console.warn(`${notes.length} build notes, e.g. ${notes.slice(0, 3).join('; ')}`);

const RATINGS_VERSION = 1;
const inputsFile: [string, string] = ['data/ratings/inputs.v1.json', JSON.stringify({ version: RATINGS_VERSION, applied: S.applied, inputs }) + '\n'];
const files: [string, string][] = run ? [inputsFile, ['data/ratings/ratings.v1.json', JSON.stringify(snapshot(run, RATINGS_VERSION)) + '\n']] : [inputsFile];

if (process.argv.includes('--check')) {
  let stale = false;
  for (const [rel, text] of files.filter(([r]) => r.includes('ratings.v'))) {
    let cur = '';
    try {
      cur = readFileSync(ROOT + rel, 'utf8');
    } catch {
      /* missing */
    }
    if (cur !== text) {
      console.error(`${rel} is stale: run npm run ratings`);
      stale = true;
    }
  }
  process.exit(stale ? 1 : 0);
}
mkdirSync(ROOT + 'data/ratings', { recursive: true });
for (const [rel, text] of files) {
  writeFileSync(ROOT + rel, text);
  console.log(`wrote ${rel} (${(text.length / 1024).toFixed(0)} KB)`);
}
if (run) console.log(`${run.entries.length} rated entries`);
