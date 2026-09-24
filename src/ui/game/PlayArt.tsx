import { blockRoles, ROUTES, type BlockRole, type OffPlay, type OffSlot } from '@/sim';

// A play's art on a mini field (GDD §10.1): the formation, every route with
// its read number, the back's path on runs and fakes, and every block (a
// line ending in a bar, the way a coach draws it). Drawn from the same data
// the sim runs (ROUTES for the routes, blockRoles for the blocking, the run's
// aiming point and the fake's), so the art can't disagree with the play.

const POS_COLOR: Record<string, string> = { QB: '#ffd400', RB: '#ff2a6d', WR: '#00e5ff', TE: '#bd6bff', OL: '#8f88b3' };
const SLOT_POS: Record<OffSlot, string> = { QB: 'QB', RB: 'RB', X: 'WR', Z: 'WR', SLOT: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL' };

const W = 400;
const H = 300;
const HALF = 160 / 6; // field half-width, yd
const BACK = 9; // yards shown behind the line
const DEEP = 24; // yards shown past it
const sx = (y: number) => W / 2 - (y / HALF) * (W / 2); // +y (offense's left) draws to the left
const sy = (d: number) => H - ((d + BACK) / (BACK + DEEP)) * H;

interface P {
  d: number;
  y: number;
}

const path = (pts: P[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.y).toFixed(1)},${sy(p.d).toFixed(1)}`).join(' ');

/** Clip a polyline at the top of the art. */
function clip(pts: P[]): P[] {
  const out: P[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const q = out[out.length - 1]!;
    if (p.d <= DEEP - 1) out.push(p);
    else {
      const k = (DEEP - 1 - q.d) / (p.d - q.d);
      out.push({ d: DEEP - 1, y: q.y + (p.y - q.y) * k });
      break;
    }
  }
  return out;
}

/** A route from a start point, in the route's stem coordinates (outside = away from the ball). */
function routeFrom(start: P, name: keyof typeof ROUTES, out: number): P[] {
  return [start, ...ROUTES[name].map((q) => ({ d: start.d + q.d, y: start.y + q.o * out }))];
}

/** A block: the line he takes and a bar across its end. */
function Block({ pts, color, dashed }: { pts: P[]; color: string; dashed?: boolean }) {
  const a = pts[pts.length - 2]!;
  const b = pts[pts.length - 1]!;
  const dx = sx(b.y) - sx(a.y);
  const dy = sy(b.d) - sy(a.d);
  const m = Math.hypot(dx, dy) || 1;
  const nx = (-dy / m) * 6;
  const ny = (dx / m) * 6;
  const ex = sx(b.y);
  const ey = sy(b.d);
  return (
    <g>
      <path d={path(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={dashed ? '4 3' : undefined} />
      <line x1={ex - nx} y1={ey - ny} x2={ex + nx} y2={ey + ny} stroke={color} strokeWidth={2.4} />
    </g>
  );
}

/** Where a blocker goes, by his role (yd relative to the ball). */
function blockPath(role: BlockRole, at: P, side: number, hole: number, screenY: number): { pts: P[]; dashed?: boolean } | null {
  switch (role) {
    case 'pass':
      return { pts: [at, { d: at.d - 1.2, y: at.y }] };
    case 'release':
      return { pts: [at, { d: at.d - 1.2, y: at.y }, { d: at.d + 2, y: at.y + (screenY - at.y) * 0.5 }], dashed: true };
    case 'zone':
      return { pts: [at, { d: at.d + 1.6, y: at.y + side * 1.2 }] };
    case 'reach':
      return { pts: [at, { d: at.d + 1.1, y: at.y + side * 2 }] };
    case 'down':
      return { pts: [at, { d: at.d + 1.4, y: at.y - side * 1.3 }] };
    case 'hinge':
      return { pts: [at, { d: at.d - 0.7, y: at.y - side * 1.1 }] };
    case 'kick':
      return { pts: [at, { d: -1.2, y: at.y + side * 0.6 }, { d: -1.2, y: hole + side * 0.4 }, { d: 0.8, y: hole + side * 2 }] };
    case 'lead':
      return { pts: [at, { d: -1.2, y: at.y + side * 0.6 }, { d: -1.2, y: hole - side * 0.4 }, { d: 3.5, y: hole }] };
    case 'climb':
      return { pts: [at, { d: 4, y: hole }] };
    case 'stalk':
      return { pts: [at, { d: at.d + 2.5, y: at.y }] };
  }
}

export function PlayArt({ play }: { play: OffPlay }) {
  const align = play.formation.align;
  const roles = blockRoles(play);
  const run = play.run;
  const side = (run?.aim ?? play.pa?.aim ?? -1) >= 0 ? 1 : -1;
  const hole = run?.aim ?? 0;
  const qb = align.QB;
  const screenTo = (Object.keys(play.assign) as OffSlot[]).find((k) => {
    const a = play.assign[k];
    return a.kind === 'route' && a.read === 1;
  });
  const screenY = screenTo ? align[screenTo].dy : 0;

  const routes = (Object.keys(play.assign) as OffSlot[]).flatMap((k): { slot: OffSlot; read: number; fake: P[] | null; pts: P[]; sit: boolean }[] => {
    const a = play.assign[k];
    if (a.kind !== 'route') return [];
    const at = { d: align[k].dx, y: align[k].dy };
    const out = at.y >= 0 ? 1 : -1;
    // The play-action back carries out his fake first, then runs his route from there.
    if (play.pa && k === 'RB') {
      const fakeEnd = { d: -0.5, y: play.pa.aim * 0.9 };
      return [{ slot: k, read: a.read, fake: [at, fakeEnd], pts: clip(routeFrom(fakeEnd, a.route, fakeEnd.y >= 0 ? 1 : -1)), sit: ROUTES[a.route].some((q) => q.sit) }];
    }
    return [{ slot: k, read: a.read, fake: null, pts: clip(routeFrom(at, a.route, out)), sit: ROUTES[a.route].some((q) => q.sit) }];
  });

  // The back's path on a run: to the mesh, through the aiming point, and upfield (counter: the jab first; draw: he waits).
  const rbPath: P[] | null = run
    ? (() => {
        const rb = { d: align.RB.dx, y: align.RB.dy };
        const mesh = { d: qb.dx + 0.3, y: qb.dy + run.aim * 0.25 };
        const jab = run.scheme === 'counter' ? [{ d: rb.d + 0.4, y: rb.y - side * 1.1 }] : [];
        return [rb, ...jab, mesh, { d: 1, y: run.aim }, { d: 6, y: run.aim * (run.scheme === 'outsideZone' ? 1.3 : 1.05) }];
      })()
    : null;

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
      {(Object.keys(roles) as OffSlot[]).map((k) => {
        const r = blockPath(roles[k]!, { d: align[k].dx, y: align[k].dy }, side, hole, screenY);
        return r ? <Block key={`b-${k}`} pts={r.pts} color={POS_COLOR[SLOT_POS[k]]!} dashed={r.dashed} /> : null;
      })}
      {rbPath ? <path d={path(rbPath)} fill="none" stroke={POS_COLOR.RB} strokeWidth={2.6} strokeLinejoin="round" strokeDasharray={run?.scheme === 'draw' ? '6 3' : undefined} markerEnd="url(#arrow)" /> : null}
      {routes.map((r) => {
        const color = POS_COLOR[SLOT_POS[r.slot]]!;
        const end = r.pts[r.pts.length - 1]!;
        return (
          <g key={r.slot}>
            {r.fake ? <path d={path(r.fake)} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3" /> : null}
            <path d={path(r.pts)} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" markerEnd={r.sit ? undefined : 'url(#arrow)'} />
            {r.sit ? <line x1={sx(end.y) - 6} x2={sx(end.y) + 6} y1={sy(end.d)} y2={sy(end.d)} stroke={color} strokeWidth={2.4} /> : null}
          </g>
        );
      })}
      {play.pa ? <path d={path([{ d: qb.dx, y: qb.dy }, { d: -3.2, y: play.pa.aim * 0.3 }, { d: -play.drop.depth, y: 0 }])} fill="none" stroke={POS_COLOR.QB} strokeWidth={1.8} strokeDasharray="3 3" /> : null}
      {(Object.keys(align) as OffSlot[]).map((k) => {
        const a = align[k];
        const pos = SLOT_POS[k];
        const color = POS_COLOR[pos]!;
        const as = play.assign[k];
        const x = sx(a.dy);
        const y = sy(a.dx);
        return (
          <g key={k}>
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
