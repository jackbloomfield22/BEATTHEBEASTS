import type { TraitIconId } from '@/engine/ratings/traits';

// Trait icons: a small in-house set of geometric line glyphs on a 24×24 grid
// (no third-party icon pack). Each is a list of shapes drawn with the current
// text color, so a badge's color carries polarity and tier.

type Shape = readonly ['p', string] | readonly ['c', number, number, number];
const p = (d: string): Shape => ['p', d];
const c = (cx: number, cy: number, r: number): Shape => ['c', cx, cy, r];

const ICONS: Record<TraitIconId, readonly Shape[]> = {
  rocket: [p('M14 4c3-1 5-1 6 0 1 1 1 3 0 6l-7 7-6-6z'), p('M8 12l-3 1-2 3 4-1'), p('M12 16l-1 3-3 2 1-4'), c(15.5, 8.5, 1.5)],
  target: [c(12, 12, 9), c(12, 12, 5), c(12, 12, 1)],
  feather: [p('M20 4C11 4 6 9 6 18'), p('M6 18L20 4'), p('M9 14h6'), p('M12 10h5')],
  crosshair: [c(12, 12, 7), p('M12 2v5M12 17v5M2 12h5M17 12h5')],
  stopwatch: [c(12, 13, 8), p('M12 13V9M10 2h4M12 2v3M18 6l1.5-1.5')],
  escape: [p('M14 4H4v16h10'), p('M10 12h11'), p('M18 9l3 3-3 3')],
  dual: [p('M4 8h13'), p('M14 5l3 3-3 3'), p('M20 16H7'), p('M10 13l-3 3 3 3')],
  tilt: [p('M4 18L18 6'), p('M13 6h5v5'), p('M3 21h10')],
  pillar: [p('M6 3h12M6 21h12M9 3v18M15 3v18')],
  climb: [p('M6 20l6-6 6 6'), p('M6 14l6-6 6 6'), p('M6 8l6-6 6 6')],
  runner: [c(15, 4, 2), p('M13 8l-3 5 4 3v5'), p('M10 13l-4 1'), p('M13 8l4 3 3-1'), p('M14 16l-4 5')],
  scalpel: [p('M3 21l10-10'), p('M13 11l6-6a2 2 0 013 3l-6 6z')],
  crown: [p('M3 19h18'), p('M3 17l2-10 5 5 2-7 2 7 5-5 2 10z')],
  clipboard: [p('M8 3h8v4H8z'), p('M6 5H5v16h14V5h-1'), p('M8 12h8M8 16h5')],
  snowflake: [p('M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17'), p('M9 4l3 3 3-3M9 20l3-3 3 3')],
  eye: [p('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z'), c(12, 12, 3)],
  hook: [p('M16 3v10a5 5 0 01-10 0v-2'), p('M4 13l2-2 2 2')],
  flame: [p('M12 22c4 0 7-3 7-7 0-5-4-7-5-12-2 3-3 5-3 7-1-1-2-2-2-4-2 2-4 5-4 9 0 4 3 7 7 7z')],
  stack: [p('M4 7l8-4 8 4-8 4z'), p('M4 12l8 4 8-4'), p('M4 17l8 4 8-4')],
  percent: [p('M19 5L5 19'), c(7, 7, 2.5), c(17, 17, 2.5)],
  flag: [p('M5 22V3'), p('M5 4h13l-3 4 3 4H5')],
  metronome: [p('M6 21h12L14 3h-4z'), p('M12 16l6-10')],
  warning: [p('M12 3l10 18H2z'), p('M12 10v5M12 18h.01')],
  magnet: [p('M5 3v9a7 7 0 0014 0V3h-4v9a3 3 0 01-6 0V3z'), p('M5 7h4M15 7h4')],
  feet: [p('M7 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z'), p('M17 9c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z'), p('M6 16h2M16 22h2')],
  twig: [p('M4 20L20 4'), p('M11 13L8 8'), p('M15 9l4 1')],
  bomb: [c(10, 14, 7), p('M15 9l3-3'), p('M18 6l1-1'), p('M20 2v2M22 4h-2')],
  house: [p('M3 11l9-8 9 8'), p('M5 9v12h14V9'), p('M10 21v-6h4v6')],
  dice: [p('M4 4h16v16H4z'), c(8.5, 8.5, 1), c(15.5, 15.5, 1), c(12, 12, 1)],
  baton: [p('M5 19L19 5'), c(4.5, 19.5, 1.5), p('M16 3l5 5')],
  bolt: [p('M13 2L4 14h7l-1 8 9-12h-7z')],
  burst: [p('M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19')],
  ram: [p('M3 12h12'), p('M11 8l4 4-4 4'), p('M19 3v18')],
  palm: [p('M7 12V5a1.5 1.5 0 013 0v5M10 10V3.5a1.5 1.5 0 013 0V10M13 10V4.5a1.5 1.5 0 013 0V11M16 11V7a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-1a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.5L7 14')],
  shatter: [p('M12 2l-2 7 4 3-3 10'), p('M3 6l7 3M21 8l-7 4M3 17l8-5')],
  anvil: [p('M4 7h15a4 4 0 01-4 4h-2v5h3v3H8v-3h3v-5H9a5 5 0 01-5-4z')],
  train: [p('M6 3h12v12H6z'), p('M6 10h12'), c(9, 12.5, 0.5), c(15, 12.5, 0.5), p('M8 18l-2 3M16 18l2 3')],
  zigzag: [p('M3 20l5-8 5 6 5-10 3 4')],
  spiral: [p('M12 12a2 2 0 102 2 4 4 0 10-4-4 6 6 0 106 6 8 8 0 10-8-8')],
  hurdle: [p('M5 21V12h14v9M5 15h14'), p('M7 8c2-4 8-4 10 0'), p('M15 6l2 2 2-2')],
  cut: [p('M4 21l8-8-5-9'), p('M12 13l8 2'), p('M17 12l3 3-3 2')],
  hourglass: [p('M6 2h12M6 22h12'), p('M7 2c0 6 10 7 10 10s-10 4-10 10'), p('M17 2c0 6-10 7-10 10s10 4 10 10')],
  battery: [p('M3 7h16v10H3z'), p('M21 10v4'), p('M6 10v4M9 10v4M12 10v4')],
  split: [p('M12 22V12'), p('M12 12L5 4'), p('M12 12l7-8'), p('M5 4v4M5 4h4M19 4v4M19 4h-4')],
  hand: [p('M18 12V6a2 2 0 00-4 0v5M14 10V4a2 2 0 00-4 0v6M10 10.5V6a2 2 0 00-4 0v8a8 8 0 0016 0v-2a2 2 0 00-4 0')],
  shield: [p('M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z')],
  grind: [c(12, 12, 3.5), p('M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5L19 19M5 19l2.5-2.5M16.5 7.5L19 5')],
  star: [p('M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z')],
  drop: [p('M12 2s7 8 7 13a7 7 0 01-14 0c0-5 7-13 7-13z'), p('M9 15a3 3 0 003 3')],
  rail: [p('M3 12h17'), p('M16 8l4 4-4 4'), p('M3 8v8')],
  sway: [p('M8 3c-4 4 8 5 4 9s-8 5-4 9'), p('M16 3c-4 4 8 5 4 9s-8 5-4 9')],
  ruler: [p('M3 17L17 3l4 4L7 21z'), p('M7 13l2 2M10 10l2 2M13 7l2 2')],
  weight: [p('M8 8a4 4 0 118 0'), p('M5 10h14l-2 11H7z')],
  tower: [p('M9 22V8l3-6 3 6v14'), p('M6 22h12'), p('M9 13h6')],
  spring: [p('M5 21h14'), p('M7 17l10-3M7 13l10-3M7 9l10-3'), p('M12 3v3')],
  route: [p('M6 21V10l5-4h8'), p('M15 2l4 4-4 4')],
  release: [p('M4 3v18'), p('M8 12h12'), p('M16 8l4 4-4 4')],
  slot: [p('M3 21h18'), p('M6 21V10M18 21V10'), p('M12 18V5'), p('M9 8l3-3 3 3')],
  arrowUp: [p('M12 21V3'), p('M5 10l7-7 7 7')],
  glove: [c(12, 9, 4), p('M4 13c2 5 5 8 8 8s6-3 8-8')],
  toe: [p('M19 3v18'), p('M5 17h9l2-2'), p('M5 17v-4')],
  sparkle: [p('M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z')],
  fist: [p('M6 10h11a3 3 0 013 3v2a6 6 0 01-6 6h-4a4 4 0 01-4-4z'), p('M6 10V6a2 2 0 014 0v4M10 8a2 2 0 014 0v2M14 9a2 2 0 014 0v1')],
  yac: [p('M3 18h6l3-6 3 3 6-9'), p('M17 6h4v4')],
  chain: [p('M9 15l6-6'), p('M10 6l1-1a4 4 0 016 6l-1 1'), p('M14 18l-1 1a4 4 0 01-6-6l1-1')],
  alpha: [p('M20 7c-2 0-3 10-6 10a5 5 0 110-10c3 0 4 10 6 10')],
  plow: [p('M3 8h7v8H3z'), p('M10 12h5'), p('M15 5l6 2v10l-6 2z')],
  link: [p('M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1'), p('M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1')],
  blocker: [c(8, 5, 2), p('M8 9v6l-3 6M8 15l3 6'), p('M8 11h7'), p('M17 6v10')],
  wall: [p('M3 5h18v14H3z'), p('M3 12h18'), p('M9 5v7M15 12v7')],
  lock: [p('M5 11h14v10H5z'), p('M8 11V7a4 4 0 018 0v4'), p('M12 15v2')],
  sack: [p('M12 3v12'), p('M7 10l5 5 5-5'), p('M4 20h16')],
  claw: [p('M5 21c0-8 3-14 8-17'), p('M9 21c0-7 3-12 8-14'), p('M13 21c0-5 3-9 7-11')],
  motor: [p('M6 8a4 4 0 100 8c4 0 8-8 12-8a4 4 0 110 8c-4 0-8-8-12-8z')],
  hawk: [p('M2 9c4-2 7-1 10 2 3-3 6-4 10-2-3 1-6 3-7 6l-3 4-3-4c-1-3-4-5-7-6z')],
  net: [p('M4 4h16v16H4z'), p('M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16')],
  eyeRadar: [c(12, 12, 9), c(12, 12, 4), p('M12 12l6-6')],
  pick: [p('M5 19C3 13 7 5 19 5c2 6-2 14-14 14z'), p('M9 15l6-6'), p('M10 11l3 3')],
  broom: [p('M19 3L10 12'), p('M10 12l-6 3 1 6 6-1 3-6z')],
  boulder: [p('M3 19l2-8 6-6 7 3 3 11z'), p('M8 12l3 2')],
  punch: [p('M3 12h7'), p('M10 8h6a3 3 0 013 3v2a3 3 0 01-3 3h-6z'), p('M21 5l1.5-1.5M21 19l1.5 1.5')],
  missile: [p('M4 20l4-4'), p('M8 16l9-9a3 3 0 014 4l-9 9z'), p('M6 12l6 6'), p('M13 8l3 3')],
  swing: [p('M4 19c0-8 5-13 13-13'), p('M14 3l3 3-3 3')],
  ice: [p('M4 8l8-4 8 4v8l-8 4-8-4z'), p('M4 8l8 4 8-4'), p('M12 12v8')],
  turnstile: [p('M4 12h16'), p('M12 4v16'), p('M6 6l12 12')],
  gauge: [p('M4 17a8 8 0 1116 0'), p('M12 17l-4-5'), c(12, 17, 1)],
  brain: [p('M12 5a3 3 0 00-5 2 3 3 0 00-2 5 3 3 0 002 5 3 3 0 005 2z'), p('M12 5a3 3 0 015 2 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-5 2'), p('M12 5v14')],
  loop: [p('M4 13c0-4 3-7 7-7s5 3 5 5-2 4-4 4-3-2-3-4'), p('M17 12l4 2-4 2')],
  combo: [c(9, 12, 6), c(15, 12, 6)],
};

export function TraitIcon({ id, size = 16, title }: { id: TraitIconId | string; size?: number; title?: string }) {
  const shapes = ICONS[id as TraitIconId] ?? ICONS.star;
  return (
    <svg className="trait-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {shapes.map((s, i) => (s[0] === 'p' ? <path key={i} d={s[1]} /> : <circle key={i} cx={s[1]} cy={s[2]} r={s[3]} />))}
    </svg>
  );
}

export const ICON_IDS = Object.keys(ICONS) as TraitIconId[];
