// Run a TypeScript tool that imports src/ modules (extensionless imports and
// the @/@data aliases need a bundler; plain `node --experimental-strip-types`
// can't resolve them).
//
//   node tools/run-ts.mjs tools/ratings/build.ts [args...]

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = process.argv[2];
if (!entry) {
  console.error('usage: node tools/run-ts.mjs <entry.ts> [args...]');
  process.exit(2);
}
const outDir = path.join(root, 'node_modules/.cache/run-ts');
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, path.basename(entry).replace(/\.ts$/, '') + '.mjs');
await build({
  entryPoints: [path.resolve(root, entry)],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  alias: { '@data': path.join(root, 'data'), '@': path.join(root, 'src') },
  // Keep import.meta.url pointing at the source file so relative paths resolve.
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.resolve(root, entry)).href) },
  logLevel: 'warning',
  sourcemap: 'inline',
});
process.argv.splice(1, 1);
await import(pathToFileURL(outfile).href);
