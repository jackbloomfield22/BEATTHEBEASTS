import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useSettings } from '@/app/settings';
import { frameSummary, jsHeapMB, perfStats, recentFrames } from './perfStats';

// FPS counter (Settings → Display → FPS counter) and the hidden performance
// screen (backquote key, or ?perf), laid out to be screenshot-friendly.

export function FpsCounter() {
  const show = useSettings((s) => s.settings.display.showFps);
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!show) return;
    const t = setInterval(() => setFps(frameSummary().fps), 500);
    return () => clearInterval(t);
  }, [show]);
  if (!show) return null;
  return <div className={`fps-counter ${fps < 50 ? 'warn' : ''}`}>{fps.toFixed(0)} FPS</div>;
}

export function PerfScreen() {
  const open = useApp((s) => s.perfOpen);
  const [, tick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      tick((x) => x + 1);
      drawGraph(canvas.current);
    }, 250);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;
  const f = frameSummary();
  const heap = jsHeapMB();
  const internalW = Math.round(perfStats.width * perfStats.dpr);
  const internalH = Math.round(perfStats.height * perfStats.dpr);
  const rows: [string, string][] = [
    ['FPS (avg)', f.fps.toFixed(1)],
    ['Frame time avg', `${f.avg.toFixed(2)} ms`],
    ['Frame time p95 / p99', `${f.p95.toFixed(2)} / ${f.p99.toFixed(2)} ms`],
    ['Frame time min / max', `${f.min.toFixed(2)} / ${f.max.toFixed(2)} ms`],
    ['Draw calls', perfStats.drawCalls.toLocaleString()],
    ['Triangles', perfStats.triangles.toLocaleString()],
    ['Geometries / textures', `${perfStats.geometries} / ${perfStats.textures}`],
    ['Shader programs', String(perfStats.programs)],
    ['JS heap', heap ? `${heap.used.toFixed(0)} / ${heap.total.toFixed(0)} MB (limit ${heap.limit.toFixed(0)})` : 'n/a (Chromium only)'],
    ['Canvas / internal res', `${perfStats.width}×${perfStats.height} / ${internalW}×${internalH} (dpr ${perfStats.dpr.toFixed(2)})`],
    ['Dynamic resolution', `${Math.round(perfStats.dynScale * 100)}% of the resolution scale`],
    ['Quality / lighting', `${perfStats.quality} / ${perfStats.preset}`],
    ['GPU', perfStats.gpu],
    ['Browser', navigator.userAgent.replace(/^Mozilla\/5.0 /, '')],
  ];
  return (
    <div className="perf-screen">
      <div className="perf-head">
        <span>Performance</span>
        <span className="perf-close">` to close</span>
      </div>
      <canvas ref={canvas} width={560} height={120} className="perf-graph" />
      <div className="perf-legend">
        <span className="l60">16.7 ms (60 fps)</span>
        <span className="l30">33.3 ms (30 fps)</span>
      </div>
      <dl className="perf-rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <button
        className="btn"
        tabIndex={-1}
        onClick={() => void navigator.clipboard?.writeText(rows.map(([k, v]) => `${k}: ${v}`).join('\n'))}
      >
        Copy report
      </button>
    </div>
  );
}

function drawGraph(c: HTMLCanvasElement | null) {
  if (!c) return;
  const ctx = c.getContext('2d')!;
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);
  const maxMs = 50;
  const y = (ms: number) => h - (Math.min(ms, maxMs) / maxMs) * h;
  ctx.strokeStyle = 'rgba(170,255,0,0.35)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, y(16.7));
  ctx.lineTo(w, y(16.7));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,90,90,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, y(33.3));
  ctx.lineTo(w, y(33.3));
  ctx.stroke();
  ctx.setLineDash([]);
  const frames = recentFrames();
  const bw = w / Math.max(frames.length, 1);
  frames.forEach((ms, i) => {
    ctx.fillStyle = ms > 33.3 ? '#ff4d5e' : ms > 17.5 ? '#ffd400' : '#aaff00';
    ctx.fillRect(i * bw, y(ms), Math.max(1, bw - 0.5), h - y(ms));
  });
}
