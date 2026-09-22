import * as THREE from 'three';
import { patchMaterial, atmosphereUniforms } from '../sky/atmosphere';
import { NOISE_GLSL } from '../sky/SkyDome';

// Milestone 1 stadium materials. The seating shader fakes a packed crowd per
// seat (shirt palette weighted to Beasts crimson and black, heads, small
// movements) so the bowl reads full from flyover distances; milestone 3
// replaces it with the instanced VAT crowd.

export const stadiumUniforms = {
  uLights: { value: 0.5 }, // stadium light level 0..1
  uCrowdEnergy: { value: 0.3 },
};

export function createSeatingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms, { uTime: atmosphereUniforms.uTime });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aux;\nvarying vec3 vAux;\nvarying vec2 vSeatUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux; vSeatUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vAux;
          varying vec2 vSeatUv;
          uniform float uTime;
          uniform float uLights;
          uniform float uCrowdEnergy;
          ${NOISE_GLSL}
          vec3 crowdEmissive;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float row = vAux.x + vAux.y * 40.0;
            float isRiser = vAux.z;
            float seatW = 0.52;
            float seat = floor(vSeatUv.x / seatW);
            float fx = fract(vSeatUv.x / seatW);
            vec2 id = vec2(seat, row);
            float h = hash12(id);
            float h2 = hash12(id + 17.3);
            float h3 = hash12(id + 91.7);
            // Section-level variation (blocks of fans, supporters' ends).
            float section = floor(vSeatUv.x / 22.0);
            float secH = hash12(vec2(section, floor(row / 12.0)));
            float occupied = step(0.035 + 0.05 * step(0.8, secH), h);
            // Shirt palette: crimson, black, white, charcoal, occasional color.
            vec3 shirt;
            float pick = h2 + (secH - 0.5) * 0.25;
            if (pick < 0.30) shirt = mix(vec3(0.3, 0.018, 0.028), vec3(0.48, 0.04, 0.05), h3);
            else if (pick < 0.62) shirt = vec3(0.018 + 0.03 * h3);
            else if (pick < 0.74) shirt = vec3(0.55 + 0.2 * h3);
            else if (pick < 0.90) shirt = vec3(0.1 + 0.08 * h3, 0.1 + 0.06 * h3, 0.11 + 0.05 * h3);
            else shirt = hsv2rgb(vec3(h3, 0.55, 0.35 + 0.3 * h2));
            vec3 skin = mix(vec3(0.16, 0.09, 0.05), vec3(0.62, 0.43, 0.32), hash12(id + 5.1));
            vec3 seatCol = vec3(0.05, 0.01, 0.014); // empty seat: dark crimson
            // Figure silhouette: shoulders across the seat, head above. At a
            // distance (seat smaller than ~2 px) fade to the seat's average
            // color to avoid moire.
            float v = vSeatUv.y;
            float lod = smoothstep(0.035, 0.16, fwidth(vSeatUv.x / seatW));
            float body = smoothstep(0.02, 0.1, fx) * smoothstep(0.98, 0.9, fx);
            float head = smoothstep(0.3, 0.16, abs(fx - 0.5 - (h - 0.5) * 0.2));
            float bob = sin(uTime * (1.5 + h * 2.0) + h * 40.0) * 0.5 + 0.5;
            float headMask = isRiser > 0.5 ? step(0.66 - bob * 0.1 * uCrowdEnergy, v / 0.43) * head : head * step(0.62, v / 0.86);
            vec3 person = mix(shirt, skin, headMask);
            float cover = isRiser > 0.5 ? body : body * step(v / 0.86, 0.9);
            vec3 detailed = mix(seatCol, person, occupied * cover);
            vec3 average = mix(seatCol, mix(shirt, skin, 0.18), occupied * 0.9);
            vec3 c = mix(detailed, average, lod);
            // Row shadowing: the back of each tread and the base of each riser are darker.
            c *= mix(mix(0.55, 1.0, isRiser > 0.5 ? smoothstep(0.0, 0.2, v) : smoothstep(0.86, 0.3, v)), 0.85, lod);
            diffuseColor.rgb = c;
            // Phone lights and flashes at night.
            float flash = step(0.9993, hash12(id + floor(uTime * 1.3))) * uLights;
            crowdEmissive = vec3(1.0, 0.95, 0.85) * flash * 3.0;
          }`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += crowdEmissive;');
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }`,
      );
    },
    'seating',
  );
}

/** Board-formed concrete with panel joints and weathering; the facade gets vertical fins. */
export function createConcreteMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aux;\nvarying vec3 vAux;\nvarying vec2 vCUv;\nvarying vec3 vCWorld;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux; vCUv = uv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vAux;\nvarying vec2 vCUv;\nvarying vec3 vCWorld;\nuniform float uLights;\n${NOISE_GLSL}\nvec3 concreteEmissive;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float part = vAux.z;
            float n = fbm(vCWorld.xz * 0.15 + vCWorld.y * 0.2, 4);
            vec3 c = mix(vec3(0.46, 0.44, 0.41), vec3(0.6, 0.58, 0.54), n);
            concreteEmissive = vec3(0.0);
            if (part > 1.5 && part < 2.5) {
              // Padded pitch wall: dark crimson padding with a lime rule at the top.
              c = vec3(0.07, 0.012, 0.016);
              float top = smoothstep(2.05, 2.1, vCWorld.y) * smoothstep(2.3, 2.25, vCWorld.y);
              c = mix(c, vec3(0.45, 0.85, 0.05), top);
              concreteEmissive = vec3(0.35, 0.7, 0.02) * top * (0.2 + uLights);
            } else if (part > 4.5 && part < 5.5) {
              // Exterior facade: vertical precast fins, darker recesses, streaking.
              float fin = smoothstep(0.35, 0.45, abs(fract(vCUv.x / 3.2) - 0.5));
              c *= mix(1.0, 0.55, fin);
              c *= mix(0.85, 1.0, smoothstep(-2.0, 12.0, vCWorld.y));
              c *= 0.9 + 0.1 * fbm(vec2(vCUv.x * 2.0, vCWorld.y * 0.05), 3);
              // Warm concourse glow through the facade slots at night.
              float slot = step(0.47, abs(fract(vCUv.x / 3.2) - 0.5)) * step(14.0, vCWorld.y) * step(vCWorld.y, 16.5);
              concreteEmissive = vec3(1.0, 0.72, 0.4) * slot * uLights * 1.6;
            } else if (part > 9.5) {
              c *= 0.8;
            }
            // Horizontal pour joints.
            c *= 1.0 - 0.18 * smoothstep(0.04, 0.0, abs(fract(vCWorld.y / 1.2) - 0.5) - 0.46);
            diffuseColor.rgb = c;
          }`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += concreteEmissive;');
    },
    'concrete',
  );
}

export function createGlassMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.12, metalness: 0.15, side: THREE.DoubleSide });
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vGUv;\nuniform float uLights;\n${NOISE_GLSL}`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            // Club-level interiors: warm, uneven, with mullions.
            float mull = step(0.04, abs(fract(vGUv.x / 2.4) - 0.5) * 2.0 - 0.9);
            float room = hash12(vec2(floor(vGUv.x / 7.2), 1.0));
            totalEmissiveRadiance += vec3(1.0, 0.72, 0.45) * (0.01 + 0.12 * uLights) * (0.4 + room) * (1.0 - mull);
          }`,
        );
    },
    'glass',
  );
}

export function createRoofMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
  return patchMaterial(
    mat,
    (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aux;\nvarying vec3 vAux;\nvarying vec2 vRUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux; vRUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAux;\nvarying vec2 vRUv;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Underside: pale steel trusses; top: dark standing-seam metal; lip: crimson fascia.
            float part = vAux.z;
            if (part > 7.5 && part < 8.5) {
              float truss = step(0.9, fract(vRUv.x / 6.0)) + step(0.92, fract(vRUv.y / 4.0));
              diffuseColor.rgb = mix(vec3(0.5, 0.5, 0.52), vec3(0.2), min(truss, 1.0));
            } else if (part > 8.5) {
              diffuseColor.rgb = vec3(0.16, 0.015, 0.02);
            } else {
              diffuseColor.rgb = vec3(0.09, 0.09, 0.1) * (0.85 + 0.15 * step(0.5, fract(vRUv.x / 0.6)));
            }
          }`,
        );
    },
    'roof',
  );
}

export function createLightBankMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.93, 0.82), emissiveIntensity: 4, roughness: 0.4 });
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLights;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uLights;');
    },
    'lightbank',
  );
}
