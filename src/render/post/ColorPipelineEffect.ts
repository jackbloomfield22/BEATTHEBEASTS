import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';
import type { Grade } from '../lighting/presets';

// One pass for the whole display transform: exposure -> AgX (filmic tone
// mapping, three.js's AgX fit) -> per-preset grade (lift/gamma/gain,
// saturation, contrast) -> vignette. Kept as one effect so it costs a single
// fullscreen read; bloom runs before it in HDR, SMAA after it.

const frag = /* glsl */ `
uniform float exposure;
uniform vec3 lift;
uniform vec3 gammaV;
uniform vec3 gain;
uniform float saturation;
uniform float contrast;
uniform float vignette;
uniform float fade;

// AgX (Troy Sobotka), matrices and polynomial fit as in three.js (MIT).
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 AgXInsetMatrix = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AgXOutsetMatrix = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float AgxMinEv = -12.47393;
  const float AgxMaxEv = 4.026069;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxDefaultContrastApprox(color);
  color = AgXOutsetMatrix * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp(color, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = agx(inputColor.rgb * exposure);
  // Grade in a perceptual-ish space.
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = g * gain + lift * (1.0 - g);
  g = pow(max(g, 0.0), 1.0 / gammaV);
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, saturation);
  g = (g - 0.5) * contrast + 0.5;
  c = pow(clamp(g, 0.0, 1.0), vec3(2.2));
  // Vignette: gentle, wide.
  vec2 d = uv - 0.5;
  d.x *= 1.15;
  float v = 1.0 - vignette * smoothstep(0.35, 0.95, length(d) * 1.35);
  c *= v;
  outputColor = vec4(c * fade, inputColor.a);
}
`;

export class ColorPipelineEffect extends Effect {
  constructor() {
    super('ColorPipelineEffect', frag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['lift', new THREE.Uniform(new THREE.Vector3())],
        ['gammaV', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['vignette', new THREE.Uniform(0.35)],
        ['fade', new THREE.Uniform(1)],
      ]),
    });
  }

  setGrade(g: Grade, exposure: number): void {
    const u = this.uniforms;
    u.get('exposure')!.value = exposure;
    (u.get('lift')!.value as THREE.Vector3).fromArray(g.lift);
    (u.get('gammaV')!.value as THREE.Vector3).fromArray(g.gamma);
    (u.get('gain')!.value as THREE.Vector3).fromArray(g.gain);
    u.get('saturation')!.value = g.saturation;
    u.get('contrast')!.value = g.contrast;
  }

  set vignette(v: number) {
    this.uniforms.get('vignette')!.value = v;
  }

  set fade(v: number) {
    this.uniforms.get('fade')!.value = v;
  }
}
