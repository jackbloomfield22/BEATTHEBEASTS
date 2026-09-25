// Thin, failure-proof wrapper over localStorage for per-device preferences
// (settings, keybinds, quality tier). Anything that must travel across devices
// (e.g. skin-tone assignments) lives in repo data files instead.

const PREFIX = 'btb3d:';

export function loadJSON<T>(key: string): T | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** saveJSON that says whether it stuck (false: storage full or blocked). */
export function trySaveJSON(key: string, value: unknown): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: settings stay in memory for this session */
  }
}
