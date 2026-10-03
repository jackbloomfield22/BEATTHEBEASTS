import { blockRoles, PERSONNEL, ROUTES, type BlockRole, type OffPlay, type OffSlot } from '@/sim';
import { padGlyph, promptCode } from '@/input/prompts';
import { useBindings, usePromptDevice } from '../components/Glyph';

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

/** Clip a polyline at the top of the art (`top` yd past the line). */
function clip(pts: P[], top = DEEP - 1): P[] {
  const out: P[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const q = out[out.length - 1]!;
    if (p.d <= top) out.push(p);
    else {
      const k = (top - q.d) / (p.d - q.d);
      out.push({ d: top, y: q.y + (p.y - q.y) * k });
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
  // Who fills a skill slot in this grouping (personnel.ts): the second tight end in 12 (the H-back too), the fullback in 21 and 22.
  const posOf = (k: OffSlot): string => {
    const who = (PERSONNEL[play.formation.personnel] as Partial<Record<OffSlot, string>>)[k];
    return who ? (who.startsWith('WR') ? 'WR' : who.startsWith('TE') ? 'TE' : 'RB') : SLOT_POS[k];
  };
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
  const rbPath: P[] | null = run && play.assign.RB.kind === 'carry'
    ? (() => {
        const rb = { d: align.RB.dx, y: align.RB.dy };
        const mesh = { d: qb.dx + 0.3, y: qb.dy + run.aim * 0.25 };
        const jab = run.scheme === 'counter' ? [{ d: rb.d + 0.4, y: rb.y - side * 1.1 }] : [];
        return [rb, ...jab, mesh, { d: 1, y: run.aim }, { d: 6, y: run.aim * (run.scheme === 'outsideZone' ? 1.3 : 1.05) }];
      })()
    : null;
  // A Designed Runner's own runs: the QB draw up the middle after his show, the zone read's keep round the read end (dashed: his option).
  const qbPath: P[] | null =
    run?.scheme === 'qbDraw'
      ? [{ d: qb.dx, y: qb.dy }, { d: qb.dx - 1, y: qb.dy }, { d: 1, y: run.aim }, { d: 6, y: run.aim }]
      : run?.scheme === 'zoneRead'
        ? [{ d: qb.dx, y: qb.dy }, { d: qb.dx + 0.5, y: -side * 2.5 }, { d: -0.5, y: -side * 6.6 }, { d: 5, y: -side * 7.2 }]
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
        return r ? <Block key={`b-${k}`} pts={r.pts} color={POS_COLOR[posOf(k)]!} dashed={r.dashed} /> : null;
      })}
      {rbPath ? <path d={path(rbPath)} fill="none" stroke={POS_COLOR.RB} strokeWidth={2.6} strokeLinejoin="round" strokeDasharray={run?.scheme === 'draw' ? '6 3' : undefined} markerEnd="url(#arrow)" /> : null}
      {qbPath ? <path d={path(qbPath)} fill="none" stroke={POS_COLOR.QB} strokeWidth={2.6} strokeLinejoin="round" strokeDasharray={run?.scheme === 'zoneRead' ? '6 3' : undefined} markerEnd="url(#arrow)" /> : null}
      {routes.map((r) => {
        const color = POS_COLOR[posOf(r.slot)]!;
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
        const pos = posOf(k);
        const color = POS_COLOR[pos]!;
        const as = play.assign[k];
        const x = sx(a.dy);
        const y = sy(a.dx);
        return (
          <g key={k}>
            <circle cx={x} cy={y} r={pos === 'OL' ? 5 : 6.5} fill={pos === 'OL' ? 'none' : color} stroke={color} strokeWidth={2} />
            {/* The screen's target (Playtest 1): ringed and labelled on the play call. */}
            {play.type === 'screen' && k === screenTo ? (
              <g className="art-screen">
                <circle cx={x} cy={y} r={11} fill="none" stroke="var(--lime)" strokeWidth={2.5} />
                <text x={x} y={y - 16} className="art-screen-label" fill="var(--lime)">
                  SCREEN
                </text>
              </g>
            ) : null}
            {as.kind === 'route' ? <ReadMark x={x} y={y + 20} read={as.read} color={color} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A route's read mark under the man: his read number on a keyboard (the key
 * that throws to him), the button's glyph on a pad (M6.6: never a number on
 * a controller), a small face button or bumper drawn into the art.
 */
function ReadMark({ x, y, read, color }: { x: number; y: number; read: number; color: string }) {
  const device = usePromptDevice();
  const { kb, pad } = useBindings();
  const code = device === 'pad' ? promptCode(`pocket.throw${read}`, 'pad', kb, pad) : null;
  const spec = code ? padGlyph(code) : null;
  if (!spec) {
    return (
      <text x={x} y={y} className="art-read" fill={color}>
        {read}
      </text>
    );
  }
  const cy = y - 5;
  if (spec.kind === 'face') {
    return (
      <g className="art-read-pad">
        <circle cx={x} cy={cy} r={8.2} fill="#15131f" stroke={spec.color} strokeWidth={1.6} />
        <text x={x} y={cy + 3.6} textAnchor="middle" fontSize={10} fontWeight={800} fill={spec.color}>
          {spec.letter}
        </text>
      </g>
    );
  }
  const label = spec.kind === 'bumper' || spec.kind === 'trigger' ? spec.label : code!.slice(4);
  return (
    <g className="art-read-pad">
      <rect x={x - 11} y={cy - 7} width={22} height={14} rx={5} fill="#15131f" stroke="rgba(244,240,255,.72)" strokeWidth={1.4} />
      <text x={x} y={cy + 3.4} textAnchor="middle" fontSize={8.6} fontWeight={800} fill="#f4f0ff">
        {label}
      </text>
    </g>
  );
}

/**
 * One route's shape, small (the hot-route grid, Playtest 2): the stem from
 * the receiver (the dot) as the sim runs it (ROUTES), outside drawn toward
 * his own sideline (`side`: +1 for a receiver on the offense's left), deep
 * routes cut off at the top with an arrowhead.
 */
export function RouteGlyph({ route, side }: { route: keyof typeof ROUTES; side: number }) {
  // Stem yards shown: 12 across each way, 2 behind to 28 past the line, the
  // first 10 at full scale and the rest compressed, so a post's break and a
  // corner's both read against a go.
  const pts = clip([{ d: 0, y: 0 }, ...ROUTES[route].map((q) => ({ d: q.d, y: q.o }))], 28);
  // Across: 1.3 px a yard, less for a route that runs wider than the cell (the drag's 22 yd).
  const wide = Math.max(...pts.map((p) => Math.abs(p.y)));
  const kx = Math.min(1.3, 15 / Math.max(1, wide));
  const xy = pts.map((p) => [18 - p.y * side * kx, 36 - (p.d <= 10 ? p.d * 1.8 : 18 + (p.d - 10) * 0.8)] as [number, number]);
  // A settle (curl, comeback, hitch) is a short step back: drawn at least 6 px across and 8 back, so the
  // hook back (in for a curl, out for a comeback) stands off the stem and its arrowhead reads.
  const n = xy.length;
  if (n > 2 && ROUTES[route].at(-1)?.sit) {
    const [ax, ay] = xy[n - 2]!;
    const [bx, by] = xy[n - 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    xy[n - 1] = [ax + (Math.abs(dx) > 0.3 ? Math.sign(dx) * Math.max(6, Math.abs(dx)) : dx), ay + (Math.abs(dy) > 0.3 ? Math.sign(dy) * Math.max(8, Math.abs(dy)) : dy)];
  }
  const gx = (o: number) => 18 - o * side * kx;
  const gy = (d: number) => 36 - (d <= 10 ? d * 1.8 : 18 + (d - 10) * 0.8);
  const dpath = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="route-glyph" viewBox="0 0 36 40" width="36" height="40" aria-hidden="true">
      <defs>
        <marker id="rg-tip" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="3.4" markerHeight="3.4" orient="auto-start-reverse">
          <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
        </marker>
      </defs>
      <path d={dpath} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" markerEnd="url(#rg-tip)" />
      <circle cx={gx(0)} cy={gy(0)} r="2.6" fill="currentColor" />
    </svg>
  );
}
