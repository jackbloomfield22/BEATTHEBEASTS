import * as THREE from 'three';
import { patchMaterial } from '../sky/atmosphere';
import { NOISE_GLSL } from '../sky/SkyDome';
import { FIELD_SAMPLE_GLSL } from './field';

// Near-camera turf: shell texturing. A stack of horizontal layers over a
// patch of field around the camera's focus; each layer keeps only the pixels
// inside a blade at that height, so short turf gets real depth and a fuzzy
// silhouette at grazing angles, for a few million pixels instead of millions
// of blade triangles. Blades take their color from the field function
// (paint included), lean with the mowing direction, and darken toward the
// root. The stack fades out with distance, where the flat field (same
// albedo) takes over, and is skipped when the camera is high.

/** Natural-grass game turf is mown to ~2.5-3.8 cm; blades reach a little above. */
const TURF_H = 0.045;
/** Shell patch size (m): turf blades are sub-pixel much beyond ~14 m anyway. */
const PATCH = 32;

// Shell count per grass-detail tier. Off on Low and Medium: a full-screen
// stack of alpha-tested layers at field level is too expensive for them
// (CLAUDE.md rule 9); the flat field carries the same color and stripes.
export const GRASS_SHELLS = { low: 0, medium: 0, high: 8, ultra: 12 } as const;

export interface GrassShells {
  mesh: THREE.Mesh;
  setShells(n: number): void;
  /** Move the patch under the camera's focus (world xz), clamped to the field. */
  update(camera: THREE.Camera): void;
}

export function createGrassShells(paint: THREE.Texture, maxShells = GRASS_SHELLS.ultra): GrassShells {
  const plane = new THREE.PlaneGeometry(PATCH, PATCH, 1, 1).rotateX(-Math.PI / 2);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.attributes.position!);
  g.setAttribute('normal', plane.attributes.normal!);
  g.setAttribute('uv', plane.attributes.uv!);
  const shell = new Float32Array(maxShells);
  for (let i = 0; i < maxShells; i++) shell[i] = i;
  g.setAttribute('aShell', new THREE.InstancedBufferAttribute(shell, 1));
  g.instanceCount = maxShells;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);

  const center = new THREE.Vector3();
  const uniforms = { uPaint: { value: paint }, uCenter: { value: center }, uCount: { value: maxShells as number } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.userData.porosity = 0.85;
  // Alpha-to-coverage turns the blade cutout into MSAA coverage (soft edges
  // instead of shimmering stairs) when the composer renders multisampled.
  mat.alphaToCoverage = true;
  patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aShell;\nuniform vec3 uCenter;\nuniform float uCount;\nvarying float vShell;\nvarying vec3 vGWorld;')
        .replace(
          '#include <begin_vertex>',
          `// Shell i of the active count sits at height (i + 1) / count of the turf.
          float tShell = (aShell + 1.0) / uCount;
          vec3 transformed = vec3(position.x + uCenter.x, 0.02 + tShell * ${TURF_H.toFixed(3)}, position.z + uCenter.z);
          // Shells beyond the active count collapse out of view.
          if (aShell >= uCount) transformed.y = -1e4;
          vShell = tShell;
          vGWorld = transformed;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D uPaint;\nvarying float vShell;\nvarying vec3 vGWorld;\n${NOISE_GLSL}\nfloat grassRough;`)
        // After the atmosphere pars (patchMaterial puts them right after <common>).
        .replace('#include <color_pars_fragment>', `#include <color_pars_fragment>\n${FIELD_SAMPLE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 w = vGWorld;
            float dist = length(cameraPosition - w);
            // Fade the stack out between 8 and 14 m (blades turn sub-pixel).
            float fade = 1.0 - smoothstep(8.0, 14.0, dist);
            // Blades: one per ~9 mm cell, jittered; they lean along the
            // mowing direction of their 5-yard band (the stripe sheen).
            float cellSize = 0.009;
            float t = vShell;
            float band = mod(floor((w.z / 0.9144 + 60.0) / 5.0), 2.0) * 2.0 - 1.0;
            vec2 lean = vec2(0.15, band) * 0.0035 * t * t;
            vec2 p = (w.xz - lean) / cellSize;
            vec2 cell = floor(p);
            float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
            float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);
            vec2 c = vec2(0.25 + 0.5 * h1, 0.25 + 0.5 * h2);
            float height = 0.55 + 0.45 * fract(h1 * 7.13 + h2 * 3.1);
            float r = 0.3 * (1.0 - t / height);
            float inBlade = step(t, height) * step(length(fract(p) - c), r);
            // Only over the turf (the field plane is ±39 m × −71..67 m).
            float onTurf = step(abs(w.x), 39.0) * step(-71.0, w.z) * step(w.z, 67.0);
            float a = inBlade * fade * onTurf;
            if (a < 0.5) discard;
            FieldSample fs = fieldSample(vec3(w.x, 0.02, w.z));
            // Painted blades stay painted; root darker (self-shadowing turf).
            diffuseColor.rgb = fs.col * mix(0.45, 1.08, t) * (0.9 + 0.2 * h2);
            grassRough = fs.rough;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = grassRough;');
    },
    'grass-shells',
  );
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'grass-shells';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const focus = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return {
    mesh,
    setShells(n) {
      uniforms.uCount.value = n;
      mesh.visible = n > 0;
    },
    update(camera) {
      // Only field-level cameras see blades: skip above 25 m.
      const high = camera.position.y > 25;
      mesh.visible = uniforms.uCount.value > 0 && !high;
      if (high) return;
      // Center the patch a little ahead of the camera along its view, on the field.
      camera.getWorldDirection(dir);
      focus.copy(camera.position).addScaledVector(dir.setY(0).normalize(), PATCH * 0.3);
      center.set(THREE.MathUtils.clamp(focus.x, -36, 36), 0, THREE.MathUtils.clamp(focus.z, -68, 64));
    },
  };
}
