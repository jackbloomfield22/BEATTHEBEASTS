import * as THREE from 'three';
import { patchMaterial, atmosphereUniforms } from '../sky/atmosphere';
import { NOISE_GLSL } from '../sky/SkyDome';

// Stadium materials. The seating shader draws the seats and aisle steps; the
// people in them are the instanced crowd (crowd/crowd.ts).

export const stadiumUniforms = {
  uLights: { value: 0.5 }, // stadium light level 0..1
  uCrowdEnergy: { value: 0.3 },
};

export function createSeatingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.userData.porosity = 0.1; // molded plastic seats
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
          ${NOISE_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Seats and aisle steps under the crowd (crowd/crowd.ts puts the
            // people in them; the aisles match its AISLE_EVERY / AISLE_W).
            float row = vAux.x + vAux.y * 40.0;
            float isRiser = vAux.z;
            float v = vSeatUv.y;
            float aisle = step(mod(vSeatUv.x, 14.5), 1.1);
            float seatW = 0.55;
            float fx = fract(vSeatUv.x / seatW);
            float h = hash12(vec2(floor(vSeatUv.x / seatW), row));
            vec3 seatCol = vec3(0.06, 0.012, 0.016) * (0.8 + 0.4 * h);
            // Seat backs: a darker gap between seats; the riser face is the back.
            float gap = smoothstep(0.02, 0.08, fx) * smoothstep(0.98, 0.92, fx);
            vec3 c = mix(seatCol * 0.45, seatCol, gap);
            c = mix(c, vec3(0.2, 0.2, 0.19), aisle);
            // Row shadowing: the back of each tread and the base of each riser are darker.
            float lod = smoothstep(0.035, 0.16, fwidth(vSeatUv.x / seatW));
            c *= mix(mix(0.55, 1.0, isRiser > 0.5 ? smoothstep(0.0, 0.2, v) : smoothstep(0.86, 0.3, v)), 0.8, lod);
            diffuseColor.rgb = c;
          }`,
        );
    },
    'seating',
  );
}

/**
 * Board-formed concrete with panel joints and weathering. The exterior facade
 * is banded like a modern bowl: a dark stone plinth with gates, a concrete
 * lintel, the glazed concourse ribbon, charcoal metal fins over the upper
 * tier, and a crimson band under the roof with an LED line.
 */
export function createConcreteMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.userData.porosity = 0.6; // board-formed concrete
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aux;\nvarying vec3 vAux;\nvarying vec2 vCUv;\nvarying vec3 vCWorld;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAux = aux; vCUv = uv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vAux;\nvarying vec2 vCUv;\nvarying vec3 vCWorld;\nuniform float uLights;\n${NOISE_GLSL}\nvec3 concreteEmissive;\nfloat concreteRough;\nfloat concreteMetal;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float part = vAux.z;
            float n = fbm(vCWorld.xz * 0.15 + vCWorld.y * 0.2, 4);
            vec3 c = mix(vec3(0.46, 0.44, 0.41), vec3(0.6, 0.58, 0.54), n);
            concreteEmissive = vec3(0.0);
            concreteRough = 0.82;
            concreteMetal = 0.0;
            if (part > 1.5 && part < 2.5) {
              // Padded pitch wall: dark crimson padding with a lime rule at the top.
              c = vec3(0.07, 0.012, 0.016);
              float top = smoothstep(2.05, 2.1, vCWorld.y) * smoothstep(2.3, 2.25, vCWorld.y);
              c = mix(c, vec3(0.45, 0.85, 0.05), top);
              concreteEmissive = vec3(0.35, 0.7, 0.02) * top * (0.2 + uLights);
            } else if (part > 4.5 && part < 5.5) {
              float y = vCWorld.y;
              float s = vCUv.x;
              vec3 warm = vec3(1.0, 0.72, 0.42);
              if (y < 5.0) {
                // Plinth: dark basalt-faced base; gates every 14.5 m (on the
                // aisle lines), 5 m wide and 4 m tall, lit inside at night.
                c = vec3(0.07, 0.068, 0.07) * (0.85 + 0.3 * n);
                float g = abs(fract(s / 14.5 + 0.5) - 0.5) * 14.5;
                float gate = step(g, 2.5) * step(y, 4.0);
                c = mix(c, vec3(0.015), gate);
                // Interior light falls off from the ceiling of the gate.
                concreteEmissive = warm * gate * (0.01 + uLights * 0.12) * smoothstep(-0.5, 4.0, y);
                concreteRough = 0.6;
              } else if (y < 6.5) {
                // Concrete lintel band.
                c *= 1.05;
              } else if (y < 13.0) {
                // Concourse glazing: dark glass with mullions every 1.6 m and a transom.
                float mull = step(0.46, abs(fract(s / 1.6) - 0.5)) + step(abs(y - 10.4), 0.07);
                c = mix(vec3(0.012, 0.016, 0.02), vec3(0.16, 0.16, 0.17), min(mull, 1.0));
                concreteRough = mix(0.06, 0.4, min(mull, 1.0));
                concreteMetal = mix(0.0, 0.8, min(mull, 1.0));
                // Concourse interior at night: a bright ceiling light line,
                // darker below, and bays of varying brightness (some dim).
                float bay = fract(sin(floor(s / 6.4) * 91.7) * 43758.5);
                float ceiling = smoothstep(11.5, 12.8, y) + 0.35 * smoothstep(7.5, 11.0, y);
                concreteEmissive = warm * (1.0 - min(mull, 1.0)) * (0.004 + uLights * 0.1) * ceiling * mix(0.25, 1.0, bay);
              } else if (y < 33.5) {
                // Upper tier cladding: charcoal aluminum fins (0.9 m pitch) over
                // dark infill; every third fin stands proud and catches light.
                float f = fract(s / 0.9);
                float fin = smoothstep(0.0, 0.08, f) * smoothstep(0.42, 0.34, f);
                float proud = step(2.5, mod(floor(s / 0.9), 3.0));
                c = mix(vec3(0.03, 0.031, 0.034), vec3(0.11, 0.11, 0.115) * (1.0 + 0.5 * proud), fin);
                // A slow twist in the fins' angle reads as a gradient up the facade.
                c *= 0.85 + 0.3 * smoothstep(13.0, 33.0, y) * (0.5 + 0.5 * sin(s * 0.05));
                concreteRough = mix(0.7, 0.35, fin);
                concreteMetal = mix(0.0, 0.85, fin);
                // Night: warm uplight wash from the lintel, fading up the fins.
                concreteEmissive = warm * fin * uLights * 0.05 * (1.0 - smoothstep(13.0, 30.0, y));
              } else {
                // Crimson club band under the roof, with an LED line.
                c = vec3(0.22, 0.015, 0.022);
                float led = step(abs(y - 34.2), 0.08);
                concreteEmissive = vec3(1.0, 0.1, 0.12) * led * (0.3 + uLights * 3.0);
                concreteRough = 0.45;
              }
              // Weathering streaks below ledges.
              c *= 0.92 + 0.08 * fbm(vec2(s * 2.0, y * 0.05), 3);
            } else if (part > 9.5) {
              c *= 0.8;
            }
            // Horizontal pour joints.
            if (part < 4.5 || part > 5.5) c *= 1.0 - 0.18 * smoothstep(0.04, 0.0, abs(fract(vCWorld.y / 1.2) - 0.5) - 0.46);
            diffuseColor.rgb = c;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = concreteRough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = concreteMetal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += concreteEmissive;');
    },
    'concrete',
  );
}

export function createGlassMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x06080a, roughness: 0.12, metalness: 0.15, side: THREE.DoubleSide });
  mat.userData.noWeather = true;
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
  mat.userData.porosity = 0.05; // painted steel
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
  mat.userData.noWeather = true;
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
