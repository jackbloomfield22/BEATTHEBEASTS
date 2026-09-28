// The Practice Field's rosters from the shipped ratings snapshot, loaded once.

import ratingsUrl from '@data/ratings/ratings.v1.json?url';
import { practiceRosters, type SnapshotLike } from '@/sim';

let snapshot: Promise<SnapshotLike> | null = null;
let pending: Promise<ReturnType<typeof practiceRosters>> | null = null;

/** The ratings snapshot itself (the identity clips swap men in from it). */
export function loadSnapshot(): Promise<SnapshotLike> {
  snapshot ??= fetch(ratingsUrl).then((r) => r.json() as Promise<SnapshotLike>);
  return snapshot;
}

export function loadPracticeRosters(): Promise<ReturnType<typeof practiceRosters>> {
  pending ??= loadSnapshot().then((snap) => practiceRosters(snap));
  return pending;
}
