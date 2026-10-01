import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { playById, practiceRosters, type SnapshotLike } from '@/sim';
import { AUDIBLES, audiblePlay } from '@/game/audible';

// Playtest 2: audibles at the line. Each check stays in the personnel on the
// field (and the formation when the book has one), and never "checks" to the same play.

const team = practiceRosters(JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike).team;
const sit = { down: 1, toGo: 10, los: 35 };

describe('audibles (Playtest 2)', () => {
  it('from Shotgun Doubles: a quick pass and a run stay in the formation; every check keeps the personnel', () => {
    const from = playById('doubles-slants');
    const quick = audiblePlay(from, 'quick', sit, team)!;
    expect(quick.type).toBe('quick');
    expect(quick.id).not.toBe(from.id);
    expect(quick.formation.name).toBe('Shotgun Doubles');
    expect(audiblePlay(from, 'run', sit, team)!.id).toBe('doubles-draw');
    expect(audiblePlay(from, 'screen', sit, team)!.id).toBe('doubles-rb-screen');
    const pa = audiblePlay(from, 'paShot', sit, team)!;
    expect(pa.type).toBe('playAction');
    for (const a of AUDIBLES) expect(audiblePlay(from, a.kind, sit, team)?.formation.personnel).toBe('11');
  });
  it('a check the personnel has no play for is none (no quick game or screen from Heavy), and the sneak is never an audible', () => {
    const from = playById('heavy-dive');
    expect(audiblePlay(from, 'quick', sit, team)).toBeNull();
    expect(audiblePlay(from, 'screen', sit, team)).toBeNull();
    expect(audiblePlay(from, 'paShot', sit, team)!.id).toBe('heavy-pa-te-leak');
    expect(audiblePlay(from, 'run', { down: 3, toGo: 1, los: 60 }, team)!.id).toBe('heavy-power');
  });
  it('is deterministic', () => {
    const from = playById('trips-stick');
    for (const a of AUDIBLES) expect(audiblePlay(from, a.kind, sit, team)?.id).toBe(audiblePlay(from, a.kind, sit, team)?.id);
  });
});
