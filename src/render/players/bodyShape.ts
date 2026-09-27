// Height and weight → the base body's scale and blend-shape weights.
//
// The base mesh is a 1.88 m, 98 kg athlete (tools/blender/lib/skeleton.py).
// Height scales the whole body. Weight is judged relative to height: body
// mass index at the base is 98 / 1.88² ≈ 27.7. The roster runs from ~23
// (a 5'9" 170 lb corner) to ~41 (a 6'3" 340 lb nose tackle), so:
//   BMI ≤ 27.7 → `lean` rises to 1 at BMI 23;
//   BMI ≥ 27.7 → `heavy` rises to 1 at BMI 36, and `belly` starts at BMI 32
//   (the lineman gut) and reaches 1 at BMI 41.
// Pure function; tested in tests/body-shape.test.ts.

export const BASE_HEIGHT = 1.88;
export const BASE_BMI = 98 / (1.88 * 1.88);

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
    lean: clamp01((BASE_BMI - bmi) / (BASE_BMI - 23)),
    heavy: clamp01((bmi - BASE_BMI) / (36 - BASE_BMI)),
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
 * (about 2.5 on a real lineman). So: 5% more head on the base body (7.05
 * heads), and the head scales with only the square root of stature (a
 * 5'9" back is 6.85 heads, a 6'5" tackle 7.2; helmets 0.26 to 0.28 m
 * tall across the roster).
 */
export const HEAD_BASE = 1.05;
export const HEAD_STATURE_EXP = 0.5;

/** The head bone's scale for a body of this overall scale (bodyShape().scale). */
export function headScale(scale: number): number {
  return HEAD_BASE * Math.pow(scale, -HEAD_STATURE_EXP);
}

/** Inches and pounds (the ratings data) → meters and kilograms. */
export function bodyFromImperial(heightIn: number, weightLb: number): { heightM: number; weightKg: number } {
  return { heightM: heightIn * 0.0254, weightKg: weightLb * 0.45359237 };
}
