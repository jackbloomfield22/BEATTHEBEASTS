// The draft's catalog load survives a dropped request: fetchJsonRetry tries
// again (a busy server or a network blip used to leave the draft on its
// loading screen for good, the cached load promise rejected forever).

import { describe, expect, it } from 'vitest';
import { fetchJsonRetry } from '@/app/draftStore';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

describe('fetchJsonRetry', () => {
  it('returns the body once a dropped request succeeds on a retry', async () => {
    let n = 0;
    const get = async () => {
      n++;
      if (n === 1) throw new TypeError('Failed to fetch');
      if (n === 2) return bad(503);
      return ok({ numbers: 1 });
    };
    expect(await fetchJsonRetry('x.json', 3, 1, get)).toEqual({ numbers: 1 });
    expect(n).toBe(3);
  });

  it('gives up after its tries with the last error', async () => {
    let n = 0;
    const get = async () => {
      n++;
      throw new TypeError('Failed to fetch');
    };
    await expect(fetchJsonRetry('x.json', 2, 1, get)).rejects.toThrow('Failed to fetch');
    expect(n).toBe(2);
  });
});
