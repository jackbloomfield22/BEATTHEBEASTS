// Polite, cached, serial client for the English Wikipedia MediaWiki Action API
// (https://en.wikipedia.org/w/api.php), used by tools/augment/arm.ts to find
// and verify the sentence that describes a quarterback's arm.
//
// - Identifies itself with a User-Agent (Wikimedia's API etiquette).
// - Serial, at most one request per 1.5 s, `maxlag=5`; backs off on 429
//   (honouring Retry-After), 5xx and maxlag errors.
// - Page text is fetched 50 titles per request and cached per title in
//   tools/augment/cache/wiki/pages/ (gitignored), so reruns never refetch.
//   Offline mode reads the cache only.
//
// Downloads shell out to `curl` for the same reason as fetch-nflverse.ts
// (it honours HTTPS_PROXY and the system CA store; Node 22's fetch does not).
//
// Text is CC BY-SA 4.0. Only short attributed quotes (≤ 20 words) and the
// page URL + revision id end up in the committed data.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from './fetch-nflverse.ts';

const API = 'https://en.wikipedia.org/w/api.php';
export const USER_AGENT = 'BeatTheBeasts-DataBuilder/0.1 (https://github.com/jackbloomfield22/BEATTHEBEASTS)';
const WIKI_CACHE = join(CACHE_DIR, 'wiki');
/** Wikimedia asks unauthenticated clients to stay serial; one request per 1.5 s is well inside that. */
const MIN_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 8;
/** Titles per revisions query (the API maximum for anonymous clients). */
const BATCH = 50;

export interface WikiPage {
  readonly title: string;
  readonly pageid: number;
  readonly revid: number;
  /** Revision timestamp (ISO). */
  readonly revTimestamp: string;
  /** Wikitext of that revision. */
  readonly wikitext: string;
  /** When this page was fetched (ISO date). */
  readonly retrieved: string;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function hashKey(params: Record<string, string>): string {
  const canon = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha256').update(canon).digest('hex').slice(0, 24);
}

type RevisionsResponse = {
  continue?: Record<string, string>;
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: {
      title: string;
      pageid?: number;
      missing?: boolean;
      revisions?: { revid: number; timestamp: string; slots?: { main?: { content?: string } } }[];
    }[];
  };
};

export class WikiClient {
  private lastRequest = 0;
  requests = 0;
  cacheHits = 0;

  private readonly offline: boolean;
  private readonly log: (s: string) => void;

  constructor(offline: boolean, log: (s: string) => void = () => {}) {
    this.offline = offline;
    this.log = log;
    mkdirSync(WIKI_CACHE, { recursive: true });
  }

  /** GET the API with `params` (format=json added), cached by params. Null on an offline cache miss. */
  get(params: Record<string, string>): { retrieved: string; response: unknown } | null {
    const full = { ...params, format: 'json', formatversion: '2' };
    const path = join(WIKI_CACHE, `${hashKey(full)}.json`);
    if (existsSync(path)) {
      this.cacheHits++;
      return JSON.parse(readFileSync(path, 'utf8')) as { retrieved: string; response: unknown };
    }
    if (this.offline) return null;
    const rec = { retrieved: new Date().toISOString(), response: this.request(full) };
    writeFileSync(path, JSON.stringify(rec));
    return rec;
  }

  /** One polite API request (no cache): serial, spaced, retried on 429/5xx/maxlag. */
  private request(params: Record<string, string>): unknown {
    const url = `${API}?${new URLSearchParams({ ...params, maxlag: '5' }).toString()}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const gap = Date.now() - this.lastRequest;
      if (gap < MIN_INTERVAL_MS) sleepMs(MIN_INTERVAL_MS - gap);
      this.lastRequest = Date.now();
      this.requests++;
      let status = 0;
      let body = '';
      let retryAfter = 0;
      const headerFile = join(WIKI_CACHE, '.last-headers');
      try {
        const out = execFileSync(
          'curl',
          ['-sS', '-A', USER_AGENT, '-H', 'Accept-Encoding: identity', '-D', headerFile, '-w', '\n%{http_code}', url],
          { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
        );
        const cut = out.lastIndexOf('\n');
        body = out.slice(0, cut);
        status = Number(out.slice(cut + 1));
        const m = /^retry-after:\s*(\d+)/im.exec(readFileSync(headerFile, 'utf8'));
        if (m) retryAfter = Number(m[1]);
      } catch (e) {
        this.log(`[wiki] curl failed (${String(e)}); attempt ${attempt}`);
      }
      if (status === 200) {
        const json = JSON.parse(body) as { error?: { code?: string; info?: string } };
        if (!json.error) return json;
        // maxlag: the servers are lagged, retry after the back-off below.
        if (json.error.code !== 'maxlag') throw new Error(`Wikipedia API error ${json.error.code}: ${json.error.info ?? ''}`);
      } else if (!(status === 0 || status === 429 || status >= 500)) {
        throw new Error(`Wikipedia API HTTP ${status} for ${url}`);
      }
      // Honour Retry-After when the server sends one, else back off exponentially.
      const wait = Math.max(retryAfter, Math.min(60, 5 * 2 ** (attempt - 1)));
      this.log(`[wiki] HTTP ${status || 'error'}; attempt ${attempt}, backing off ${wait}s`);
      sleepMs(wait * 1000);
    }
    throw new Error(`Wikipedia API: gave up after ${MAX_ATTEMPTS} attempts: ${url}`);
  }

  /**
   * Current wikitext of each title (redirects followed), cached per requested
   * title in tools/augment/cache/wiki/pages/. Titles missing from the cache are
   * fetched 50 per request. Offline, cache misses are left out of the result.
   */
  pages(titles: readonly string[]): Map<string, WikiPage | null> {
    const dir = join(WIKI_CACHE, 'pages');
    mkdirSync(dir, { recursive: true });
    const file = (t: string): string => join(dir, `${hashKey({ title: t })}.json`);
    const out = new Map<string, WikiPage | null>();
    const todo: string[] = [];
    for (const t of new Set(titles)) {
      if (existsSync(file(t))) {
        this.cacheHits++;
        out.set(t, (JSON.parse(readFileSync(file(t), 'utf8')) as { page: WikiPage | null }).page);
      } else if (!this.offline) todo.push(t);
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const got = new Map<string, WikiPage>();
      const alias = new Map<string, string>();
      const retrieved = new Date().toISOString().slice(0, 10);
      let cont: Record<string, string> = {};
      for (;;) {
        const r = this.request({
          action: 'query',
          prop: 'revisions',
          rvprop: 'ids|timestamp|content',
          rvslots: 'main',
          redirects: '1',
          titles: batch.join('|'),
          format: 'json',
          formatversion: '2',
          ...cont,
        }) as RevisionsResponse;
        for (const n of r.query?.normalized ?? []) alias.set(n.from, n.to);
        for (const n of r.query?.redirects ?? []) alias.set(n.from, n.to);
        for (const p of r.query?.pages ?? []) {
          const rev = p.revisions?.[0];
          const text = rev?.slots?.main?.content;
          if (p.missing || p.pageid === undefined || !rev || text === undefined) continue;
          got.set(p.title, { title: p.title, pageid: p.pageid, revid: rev.revid, revTimestamp: rev.timestamp, wikitext: text, retrieved });
        }
        if (!r.continue) break;
        cont = r.continue;
      }
      for (const t of batch) {
        let cur = t;
        for (let k = 0; k < 3 && alias.has(cur); k++) cur = alias.get(cur)!;
        const page = got.get(cur) ?? null;
        writeFileSync(file(t), JSON.stringify({ requested: t, page }));
        out.set(t, page);
      }
    }
    return out;
  }
}

/** Wikitext → plain text close enough to match a quoted phrase (comments, refs, templates, link and bold/italic markup removed). */
export function wikiPlain(w: string): string {
  let s = w
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  for (let i = 0; i < 6; i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  return s
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
}

export function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2C/g, ',').replace(/%3A/g, ':')}`;
}

export function permalink(title: string, revid: number): string {
  return `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&oldid=${revid}`;
}

/** Collapse whitespace and fold typographic quotes/dashes so quotes can be matched against page text. */
export function normText(s: string): string {
  return s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
