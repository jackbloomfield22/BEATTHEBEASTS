// The Practice Field's rosters from the shipped ratings snapshot, loaded once.

import ratingsUrl from '@data/ratings/ratings.v1.json?url';
import { practiceRosters, type SnapshotLike } from '@/sim';

let pending: Promise<ReturnType<typeof practiceRosters>> | null = null;

export function loadPracticeRosters(): Promise<ReturnType<typeof practiceRosters>> {
  pending ??= fetch(ratingsUrl)
    .then((r) => r.json() as Promise<SnapshotLike>)
    .then((snap) => practiceRosters(snap));
  return pending;
}
