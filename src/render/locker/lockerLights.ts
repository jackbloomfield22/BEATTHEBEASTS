import * as THREE from 'three';

// The lockers are the room's light (M6 brief: "dark, warm, premium; the
// lockers are the light source"). Each stall has a light strip under its
// shelf washing down over the jersey, an underlight in the position's
// color at its toe kick washing the floor, and a ceiling washer grazing its
// face (so a bare stall still reads). That's twenty-seven lights; as real
// three.js lights every lit pixel in the room would loop over all of them
// with shadows off but the full light-loop cost, and adding or removing one
// recompiles every program. Instead the room's materials share one small
// uniform block and run their own loop through three's physical BRDF
// (RE_Direct, so the helmet's clearcoat-like gloss and the carpet's matte
// both come out right). The positions are fixed; only colors change.

/** 9 stall lamps, 9 underlights, 9 ceiling wall-washers (one per stall). */
export const LK_N = 27;

export const lockerLightUniforms = {
  /** View-space positions (updated per frame from the world positions). */
  uLkPos: { value: Array.from({ length: LK_N }, () => new THREE.Vector3()) },
  /** View-space direction each light faces. */
  uLkDir: { value: Array.from({ length: LK_N }, () => new THREE.Vector3(0, -1, 0)) },
  /** Linear color × intensity. */
  uLkCol: { value: Array.from({ length: LK_N }, () => new THREE.Vector3()) },
  /** x: cos at the cone's edge, y: cos where it's full, z: falloff (1/m²). */
  uLkCone: { value: Array.from({ length: LK_N }, () => new THREE.Vector3(0, 0.5, 1)) },
};

/** The same lights in world space (the room writes these; `updateLockerLights` projects them). */
export const lockerLightsWorld = Array.from({ length: LK_N }, () => ({
  pos: new THREE.Vector3(),
  dir: new THREE.Vector3(0, -1, 0),
  color: new THREE.Color(0, 0, 0),
  intensity: 0,
}));

const _m3 = new THREE.Matrix3();

export function updateLockerLights(camera: THREE.Camera): void {
  const u = lockerLightUniforms;
  _m3.setFromMatrix4(camera.matrixWorldInverse);
  lockerLightsWorld.forEach((l, i) => {
    u.uLkPos.value[i]!.copy(l.pos).applyMatrix4(camera.matrixWorldInverse);
    u.uLkDir.value[i]!.copy(l.dir).applyMatrix3(_m3).normalize();
    u.uLkCol.value[i]!.set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
  });
}

const PARS = /* glsl */ `
#define LK_N ${LK_N}
uniform vec3 uLkPos[LK_N];
uniform vec3 uLkDir[LK_N];
uniform vec3 uLkCol[LK_N];
uniform vec3 uLkCone[LK_N];
`;

const LOOP = /* glsl */ `
for (int i = 0; i < LK_N; i++) {
  vec3 lkL = uLkPos[i] - geometryPosition;
  float lkD2 = max(dot(lkL, lkL), 1e-4);
  vec3 lkl = lkL * inversesqrt(lkD2);
  float lkCone = smoothstep(uLkCone[i].x, uLkCone[i].y, dot(-lkl, uLkDir[i]));
  vec3 lkC = uLkCol[i] * lkCone / (1.0 + lkD2 * uLkCone[i].z);
  if (lkC.r + lkC.g + lkC.b > 1e-4) {
    IncidentLight lkLight;
    lkLight.color = lkC;
    lkLight.direction = lkl;
    lkLight.visible = true;
    RE_Direct(lkLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }
}
`;

/**
 * Whether the patch is on. If a GPU's compiler rejects it (LockerRoom
 * watches the renderer's shader errors), the room falls back to three's
 * standard lighting and its self-lit surfaces rather than drawing black.
 */
export const lockerLitState = { enabled: true };

/** Patch a standard material to take the locker lights (chains any existing hook). */
export function lockerLit<M extends THREE.MeshStandardMaterial>(mat: M): M {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    if (!lockerLitState.enabled) return;
    Object.assign(shader.uniforms, lockerLightUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${LOOP}`);
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|locker-lit${lockerLitState.enabled ? '' : '-off'}`;
  return mat;
}
