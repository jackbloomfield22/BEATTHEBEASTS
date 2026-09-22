// Dev-server endpoint for the skin-tone (characterization) editor.
// In `npm run dev`, saving in the editor writes data/characterization.json directly,
// so assignments live in the repo and travel with every build. Production saves go
// through api/characterization.ts (commits the same file via the GitHub API).
import type { Plugin } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateCharacterization } from '../../src/engine/data/characterizationSchema.ts';

const FILE = resolve(import.meta.dirname, '../../data/characterization.json');

export function characterizationDevApi(): Plugin {
  return {
    name: 'btb-characterization-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/characterization', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const body = await readFile(FILE, 'utf8');
            res.setHeader('content-type', 'application/json');
            res.end(body);
            return;
          }
          if (req.method === 'PUT') {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const data = validateCharacterization(parsed);
            await writeFile(FILE, JSON.stringify(data, null, 2) + '\n');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, mode: 'dev-file' }));
            return;
          }
          res.statusCode = 405;
          res.end();
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
    },
  };
}
