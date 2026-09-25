import { create } from 'zustand';
import { isReadableRecord, type GameRecord } from '@/game/record';
import { loadJSON, trySaveJSON } from './storage';

// Every finished game, newest first (the results screen, the Locker Room's
// "Last Game" panel and History read it). Per device, in localStorage under
// a versioned key; bounded so it never outgrows the browser's quota. The
// newest record is saved the moment a match ends, before any navigation,
// so a game's results survive leaving, a crash or a reload.

const KEY = 'history.v1';
/** Games kept. */
export const HISTORY_MAX = 100;
/** Replays kept (the play of the game's inputs are the bulk of a record): the newest this many. */
const REPLAYS_KEPT = 30;

interface HistoryStore {
  records: GameRecord[];
  /** The record the results screen shows (null: the newest). */
  viewing: string | null;
  /** How the results screen was opened: straight from the game, or to look back at one. */
  from: 'game' | 'history' | 'locker';
}

function load(): GameRecord[] {
  const raw = loadJSON<unknown[]>(KEY);
  return Array.isArray(raw) ? raw.filter(isReadableRecord) : [];
}

export const useHistory = create<HistoryStore>(() => ({ records: load(), viewing: null, from: 'game' }));

/** Add (or replace) a record and persist the list. */
export function saveRecord(r: GameRecord): void {
  const records = [r, ...useHistory.getState().records.filter((x) => x.id !== r.id)].slice(0, HISTORY_MAX);
  useHistory.setState({ records });
  persist(records);
}

function persist(records: GameRecord[]): void {
  const lean = records.map((r, i) => (i < REPLAYS_KEPT || !r.playOfGame?.replay.capsule ? r : { ...r, playOfGame: { ...r.playOfGame, replay: { flagged: true as const, capsule: null } } }));
  // Out of room: drop the oldest games until it fits (the newest is the one that matters).
  for (let n = lean.length; n > 0; n = Math.floor(n * 0.75)) if (trySaveJSON(KEY, lean.slice(0, n))) return;
}

export function lastRecord(): GameRecord | null {
  return useHistory.getState().records[0] ?? null;
}

export function recordById(id: string | null): GameRecord | null {
  const rs = useHistory.getState().records;
  return (id ? rs.find((r) => r.id === id) : rs[0]) ?? null;
}

/** Open the results screen on a record (null: the newest). */
export function viewRecord(id: string | null, from: HistoryStore['from']): void {
  useHistory.setState({ viewing: id, from });
}

if (import.meta.env.DEV) Object.assign(globalThis, { __btbHistory: useHistory });
