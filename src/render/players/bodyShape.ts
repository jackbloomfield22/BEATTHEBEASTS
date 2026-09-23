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

/** Inches and pounds (the ratings data) → meters and kilograms. */
export function bodyFromImperial(heightIn: number, weightLb: number): { heightM: number; weightKg: number } {
  return { heightM: heightIn * 0.0254, weightKg: weightLb * 0.45359237 };
}
