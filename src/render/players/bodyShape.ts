// Height and weight → the base body's scale and blend-shape weights.
//
// The base mesh is a 1.88 m, 98 kg athlete (tools/blender/lib/skeleton.py).
// Height scales the whole body. Weight is judged relative to height: body
// mass index at the base is 98 / 1.88² ≈ 27.7. The roster runs from ~23
// (a 5'9" 170 lb corner) to ~41 (a 6'3" 340 lb nose tackle), so:
//   BMI ≤ 27.7 → `lean` rises to 1 at BMI 24.5;
//   BMI ≥ 27.7 → `heavy` rises to 1 at BMI 36 and on to HEAVY_MAX at BMI
//   40, and `belly` starts at BMI 32 (the lineman gut) and reaches 1 at 41.
// Round two (docs/characters/CHARACTERS2.md): receivers and corners sit at
// BMI 25-27, so with lean full only at 23 they drew within a few
// millimetres of the base body (a 5'9" 175 lb slot was lean 0.4); and
// every lineman over BMI 36 (most of them) drew the same heavy 1. Lean is
// full at 24.5 and heavy keeps growing to 1.3, so a 6'6" 320 lb tackle and
// a 5'9" 175 lb slot read as different men at broadcast distance.
// Pure function; tested in tests/body-shape.test.ts.

export const BASE_HEIGHT = 1.88;
export const BASE_BMI = 98 / (1.88 * 1.88);
export const LEAN_FULL_BMI = 24.5;
export const HEAVY_MAX = 1.3;

export interface BodyShape {
  scale: number;
  heavy: number;
  lean: number;
  belly: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function bodyShape(heightM: number, weightKg: number): BodyShape {
  const bmi = weightKg / (heightM * heightM);
  return {
    scale: heightM / BASE_HEIGHT,
    lean: clamp01((BASE_BMI - bmi) / (BASE_BMI - LEAN_FULL_BMI)),
    heavy: Math.min(HEAVY_MAX, Math.max(0, bmi < 36 ? (bmi - BASE_BMI) / (36 - BASE_BMI) : 1 + ((bmi - 36) / (40 - 36)) * (HEAVY_MAX - 1))),
    belly: clamp01((bmi - 32) / (41 - 32)),
  };
}

/**
 * The head's scale on the head bone (the helmet, facemask and visor ride on
 * it), M6.6. Playtest 1: "player heads are too small on the models".
 * Measured on the built player (tools/reports/head-size.mjs): the base body
 * stands 1.914 m to the helmet's crown with a 0.260 m head (crown to the
 * facemask's chin), 7.37 heads tall, at the small-head end of a real
 * player in pads and helmet (about 7 to 7.5), and the whole body, helmet
 * included, scaled with stature, so a 5'9" corner's helmet was 7% smaller
 * than a 6'2" receiver's (real adult helmets span a few percent), while the
 * heavy and pads shapes spread a lineman's shoulders to 2.9 helmet widths
 * (about 2.5 on a real lineman). So: 6% more head on the base body (7.0
 * heads; 5% was hard to see side by side at field level), and the head
 * scales with only the square root of stature (a 5'9" back is 6.8 heads,
 * a 6'5" tackle 7.1; helmets 0.265 to 0.28 m tall across the roster).
 */
export const HEAD_BASE = 1.06;
export const HEAD_STATURE_EXP = 0.5;

/** The head bone's scale for a body of this overall scale (bodyShape().scale). */
export function headScale(scale: number): number {
  return HEAD_BASE * Math.pow(scale, -HEAD_STATURE_EXP);
}

/** Inches and pounds (the ratings data) → meters and kilograms. */
export function bodyFromImperial(heightIn: number, weightLb: number): { heightM: number; weightKg: number } {
  return { heightM: heightIn * 0.0254, weightKg: weightLb * 0.45359237 };
}
