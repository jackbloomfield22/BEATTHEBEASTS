// Vercel Function: read and save the skin-tone assignments in
// data/characterization.json, straight in the GitHub repo, so edits made in the
// deployed game persist across sessions and devices (and ship with the next
// deploy). Configure in Vercel → Project → Settings → Environment Variables:
//   EDITOR_KEY    secret phrase the editor asks for before saving (required)
//   GITHUB_TOKEN  fine-grained token with Contents: read & write on this repo (required)
//   GITHUB_REPO   owner/name (default: jackbloomfield22/BEATTHEBEASTS)
//   CHARACTERIZATION_BRANCH  branch to commit to (default: the deployment's branch, else main)
import { timingSafeEqual } from 'node:crypto';
import { validateCharacterization } from '../src/engine/data/characterizationSchema';

const PATH = 'data/characterization.json';

function config() {
  return {
    token: process.env.GITHUB_TOKEN ?? '',
    key: process.env.EDITOR_KEY ?? '',
    repo: process.env.GITHUB_REPO ?? 'jackbloomfield22/BEATTHEBEASTS',
    branch: process.env.CHARACTERIZATION_BRANCH ?? process.env.VERCEL_GIT_COMMIT_REF ?? 'main',
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function readFile(c: ReturnType<typeof config>): Promise<{ data: unknown; sha: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${c.repo}/contents/${PATH}?ref=${encodeURIComponent(c.branch)}`, {
    headers: { authorization: `Bearer ${c.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { content: string; sha: string };
  return { data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')), sha: body.sha };
}

function keyMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(): Promise<Response> {
  const c = config();
  if (!c.token) return json(501, { ok: false, error: 'not configured' });
  const f = await readFile(c);
  if (!f) return json(502, { ok: false, error: 'could not read file' });
  return json(200, validateCharacterization(f.data));
}

export async function PUT(request: Request): Promise<Response> {
  const c = config();
  if (!c.token || !c.key) return json(501, { ok: false, error: 'not configured' });
  if (!keyMatches(request.headers.get('x-editor-key') ?? '', c.key)) return json(401, { ok: false, error: 'bad editor key' });
  let data;
  try {
    data = validateCharacterization(await request.json());
  } catch (e) {
    return json(400, { ok: false, error: String(e) });
  }
  const current = await readFile(c);
  const res = await fetch(`https://api.github.com/repos/${c.repo}/contents/${PATH}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${c.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `Update skin tones (${Object.keys(data.entries).length} players) from the in-game editor`,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64'),
      branch: c.branch,
      ...(current ? { sha: current.sha } : {}),
    }),
  });
  if (!res.ok) return json(502, { ok: false, error: `GitHub ${res.status}` });
  return json(200, { ok: true, mode: 'github', branch: c.branch });
}
