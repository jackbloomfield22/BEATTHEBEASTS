// Per-player variety (M4.5): two players of the same size still look like
// different people. From a player's position, height and weight and a seed
// (their name), pick body proportions and gear. Pure and deterministic
// (tested in tests/variety.test.ts); Player applies the result.
//
// Position conventions follow what shows on an NFL field: linemen wear big
// pads, closed cage facemasks, long arm sleeves and taped wrists; receivers
// and defensive backs slim pads, open masks, often visors and arm sleeves;
// quarterbacks a two-bar mask and a towel at the waist.

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S' | 'K';
export type MaskStyle = 'skill' | 'cage' | 'qb';
export type GearColor = 'kit' | 'black' | 'white' | 'trim';

export interface Variety {
  mask: MaskStyle;
  visor: boolean;
  towel: boolean;
  /** Compression sleeve per arm. */
  sleeves: { l: boolean; r: boolean };
  sleeveColor: GearColor;
  /** Athletic tape above the glove cuff. */
  tape: boolean;
  gloveColor: GearColor;
  /** Stripes around the sock (0, 1 or 2). */
  sockStripes: number;
  /** Morph influences (tools/blender/lib/shapes.py). */
  morph: { pads: number; neck: number; waist: number; calves: number; arms: number };
  /** Skeleton: extra shoulder half-width (m) and arm length (factor). */
  shoulder: number;
  arm: number;
}

/** mulberry32: small, fast, well-distributed; seeded from a string hash. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINE = new Set<Position>(['OL', 'DL']);
const SKILL = new Set<Position>(['WR', 'CB', 'S']);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Weighted pick from [value, weight] pairs with one uniform draw. */
function pick<T>(u: number, table: [T, number][]): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = u * total;
  for (const [v, w] of table) {
    if ((x -= w) < 0) return v;
  }
  return table[table.length - 1]![0];
}

export function playerVariety(pos: Position, heightM: number, weightKg: number, seed: string): Variety {
  const r = rng(`${seed}|${pos}`);
  const bmi = weightKg / (heightM * heightM);
  const line = LINE.has(pos);
  const skill = SKILL.has(pos);
  // Facemasks by position (closed cages up front, open masks at the skill spots).
  const mask = pick<MaskStyle>(
    r(),
    line
      ? [['cage', 0.9], ['skill', 0.1]]
      : pos === 'QB' || pos === 'K'
        ? [['qb', 0.7], ['skill', 0.3]]
        : skill
          ? [['skill', 0.75], ['qb', 0.25]]
          : [['skill', 0.6], ['cage', 0.4]],
  );
  const visor = r() < (line ? 0.1 : skill || pos === 'RB' ? 0.38 : 0.2);
  const towel = r() < (pos === 'QB' ? 0.85 : pos === 'RB' || pos === 'WR' ? 0.35 : line ? 0.25 : 0.12);
  const sleeveRoll = r();
  const sleeveP = line ? 0.55 : skill || pos === 'RB' ? 0.6 : 0.35;
  const both = sleeveRoll < sleeveP * 0.7;
  const one = !both && sleeveRoll < sleeveP;
  const side = r() < 0.5;
  const sleeves = { l: both || (one && side), r: both || (one && !side) };
  const sleeveColor = pick<GearColor>(r(), [['kit', 0.45], ['black', 0.3], ['white', 0.15], ['trim', 0.1]]);
  const tape = r() < (line ? 0.75 : 0.4);
  const gloveColor = pick<GearColor>(r(), line ? [['kit', 0.5], ['black', 0.35], ['white', 0.15]] : [['kit', 0.7], ['white', 0.2], ['black', 0.1]]);
  const sockStripes = pick(r(), [[0, 0.5], [1, 0.3], [2, 0.2]]);
  const n = () => (r() - 0.5) * 2; // -1..1
  // Body proportions: position sets the base, the draw spreads it.
  const base = {
    pads: line ? 1 : pos === 'LB' || pos === 'TE' ? 0.45 : pos === 'RB' ? 0.15 : pos === 'QB' || pos === 'K' ? -0.3 : -0.8,
    neck: line ? 0.9 : pos === 'LB' || pos === 'TE' ? 0.6 : pos === 'RB' || pos === 'S' ? 0.4 : 0.1,
    arms: line ? 0.7 : pos === 'LB' || pos === 'TE' || pos === 'RB' ? 0.55 : 0.2,
    calves: pos === 'RB' ? 0.8 : line || pos === 'LB' ? 0.55 : 0.35,
  };
  const morph = {
    pads: clamp(base.pads + 0.2 * n(), -1, 1.2),
    neck: clamp(base.neck + 0.25 * n(), 0, 1.2),
    // Waist follows mass relative to height (BMI ~23 lean corner to ~40 nose tackle).
    waist: clamp((bmi - 29) / 8 + 0.25 * n(), -1, 1),
    calves: clamp(base.calves + 0.3 * n(), 0, 1.2),
    arms: clamp(base.arms + 0.3 * n(), 0, 1.2),
  };
  // Frames: linemen broad through the shoulders; arm length ±3% (wingspan
  // varies ~6% at a given height across NFL combine measurements).
  const shoulder = (line ? 0.012 : pos === 'LB' || pos === 'TE' ? 0.007 : skill ? -0.004 : 0.002) + 0.004 * n();
  const arm = 1 + 0.03 * n();
  return { mask, visor, towel, sleeves, sleeveColor, tape, gloveColor, sockStripes, morph, shoulder, arm };
}

/** Roster positions (legacy data uses the same short codes, plus a few extras). */
export function toPosition(code: string): Position {
  const c = code.toUpperCase();
  if (['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'].includes(c)) return c as Position;
  if (['T', 'G', 'C', 'OT', 'OG'].includes(c)) return 'OL';
  if (['DE', 'DT', 'NT'].includes(c)) return 'DL';
  if (['OLB', 'ILB', 'MLB'].includes(c)) return 'LB';
  if (['FS', 'SS', 'DB'].includes(c)) return 'S';
  if (['FB', 'HB'].includes(c)) return 'RB';
  if (['P', 'PK'].includes(c)) return 'K';
  return 'WR';
}
