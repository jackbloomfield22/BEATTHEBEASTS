// Frame statistics shared by the FPS counter and the hidden perf screen.
// Written from inside the render loop (no React state), read by the overlays
// on their own timers.

const HISTORY = 240;

export const perfStats = {
  frameMs: new Float32Array(HISTORY),
  cursor: 0,
  count: 0,
  lastT: 0,
  drawCalls: 0,
  triangles: 0,
  lines: 0,
  points: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  dpr: 1,
  width: 0,
  height: 0,
  gpu: '',
  quality: '',
  preset: '',
};

export function recordFrame(now: number): void {
  if (perfStats.lastT > 0) {
    perfStats.frameMs[perfStats.cursor] = now - perfStats.lastT;
    perfStats.cursor = (perfStats.cursor + 1) % HISTORY;
    perfStats.count = Math.min(HISTORY, perfStats.count + 1);
  }
  perfStats.lastT = now;
}

export function frameSummary(): { fps: number; avg: number; p95: number; p99: number; max: number; min: number } {
  const n = perfStats.count;
  if (n === 0) return { fps: 0, avg: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const arr = Array.from(perfStats.frameMs.slice(0, n)).sort((a, b) => a - b);
  const avg = arr.reduce((s, x) => s + x, 0) / n;
  const q = (p: number) => arr[Math.min(n - 1, Math.floor(p * n))]!;
  return { fps: 1000 / avg, avg, p95: q(0.95), p99: q(0.99), max: arr[n - 1]!, min: arr[0]! };
}

/** Last N frame times in chronological order (for the graph). */
export function recentFrames(n = HISTORY): number[] {
  const out: number[] = [];
  const count = Math.min(n, perfStats.count);
  for (let i = count; i > 0; i--) out.push(perfStats.frameMs[(perfStats.cursor - i + HISTORY) % HISTORY]!);
  return out;
}

export function jsHeapMB(): { used: number; total: number; limit: number } | null {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!m) return null;
  return { used: m.usedJSHeapSize / 1048576, total: m.totalJSHeapSize / 1048576, limit: m.jsHeapSizeLimit / 1048576 };
}
