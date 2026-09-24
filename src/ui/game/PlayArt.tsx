import { ROUTES, type OffPlay, type OffSlot } from '@/sim';

// A play's art on a mini field (GDD §10.1): the formation, every route with
// its read number, blocking as short bars. Drawn from the same data the sim
// runs, so the art can't disagree with the play.

const POS_COLOR: Record<string, string> = { QB: '#ffd400', RB: '#ff2a6d', WR: '#00e5ff', TE: '#bd6bff', OL: '#8f88b3' };
const SLOT_POS: Record<OffSlot, string> = { QB: 'QB', RB: 'RB', X: 'WR', Z: 'WR', SLOT: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL' };

const W = 400;
const H = 300;
const HALF = 160 / 6; // field half-width, yd
const BACK = 9; // yards shown behind the line
const DEEP = 24; // yards shown past it
const sx = (y: number) => W / 2 - (y / HALF) * (W / 2); // +y (offense's left) draws to the left
const sy = (d: number) => H - ((d + BACK) / (BACK + DEEP)) * H;

export function PlayArt({ play }: { play: OffPlay }) {
  const align = play.formation.align;
  const routes = (Object.keys(play.assign) as OffSlot[]).flatMap((k) => {
    const a = play.assign[k];
    if (a.kind !== 'route') return [];
    const at = align[k];
    const out = at.dy >= 0 ? 1 : -1;
    const pts = [{ d: at.dx, y: at.dy }, ...ROUTES[a.route].map((q) => ({ d: at.dx + q.d, y: at.dy + q.o * out }))];
    // Clip at the top of the art.
    const clipped: { d: number; y: number }[] = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!;
      const q = clipped[clipped.length - 1]!;
      if (p.d <= DEEP - 1) clipped.push(p);
      else {
        const k2 = (DEEP - 1 - q.d) / (p.d - q.d);
        clipped.push({ d: DEEP - 1, y: q.y + (p.y - q.y) * k2 });
        break;
      }
    }
    return [{ slot: k, read: a.read, route: a.route, pts: clipped, sit: ROUTES[a.route].some((q) => q.sit) }];
  });
  return (
    <svg className="play-art" viewBox={`0 0 ${W} ${H}`} aria-label={`${play.name} play art`}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
      {/* Yard lines every 5 */}
      {Array.from({ length: 7 }, (_, i) => -5 + i * 5).map((d) => (
        <line key={d} x1={0} x2={W} y1={sy(d)} y2={sy(d)} className="art-yard" />
      ))}
      <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} className="art-los" />
      {routes.map((r) => {
        const color = POS_COLOR[SLOT_POS[r.slot]]!;
        const d = r.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.y).toFixed(1)},${sy(p.d).toFixed(1)}`).join(' ');
        const end = r.pts[r.pts.length - 1]!;
        return (
          <g key={r.slot}>
            <path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" markerEnd={r.sit ? undefined : 'url(#arrow)'} />
            {r.sit ? <line x1={sx(end.y) - 6} x2={sx(end.y) + 6} y1={sy(end.d)} y2={sy(end.d)} stroke={color} strokeWidth={2.4} /> : null}
          </g>
        );
      })}
      {(Object.keys(align) as OffSlot[]).map((k) => {
        const a = align[k];
        const pos = SLOT_POS[k];
        const color = POS_COLOR[pos]!;
        const as = play.assign[k];
        const x = sx(a.dy);
        const y = sy(a.dx);
        return (
          <g key={k}>
            {as.kind === 'passBlock' ? <line x1={x - 5} x2={x + 5} y1={y - 8} y2={y - 8} stroke={color} strokeWidth={2} /> : null}
            <circle cx={x} cy={y} r={pos === 'OL' ? 5 : 6.5} fill={pos === 'OL' ? 'none' : color} stroke={color} strokeWidth={2} />
            {as.kind === 'route' ? (
              <text x={x} y={y + 20} className="art-read" fill={color}>
                {as.read}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
