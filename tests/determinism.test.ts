import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { practiceRosters, type SnapshotLike } from '@/sim';
import { simHashes } from '@/game/determinism';

// The hashes Node produces for the fixed plays (src/game/determinism.ts).
// The browser test (e2e/practice.spec.ts) must reproduce them exactly.
// Regenerate after an intended sim change: BTB_UPDATE_GOLDEN=1 npx vitest run tests/determinism.test.ts
const GOLDEN = 'tests/golden/sim-hashes.json';

describe('sim: determinism golden', () => {
  it('matches the pinned hashes', () => {
    const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
    const got = simHashes(practiceRosters(snap));
    if (process.env.BTB_UPDATE_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
    const want = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof got;
    expect(got).toEqual(want);
    // Every case reached a whistle.
    for (const g of got) expect(g.reason, g.key).not.toBe('none');
  });
});
