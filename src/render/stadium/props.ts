import * as THREE from 'three';
import { coastZ } from '../world/constants';
import { patchMaterial } from '../sky/atmosphere';
import { stadiumUniforms } from './materials';

// Video board, south light masts, the open-end terrace and the plaza.

export function createVideoBoardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 820;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const draw = () => {
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#0c0a14');
    g.addColorStop(1, '#030206');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    // LED pixel grid feel.
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let x = 0; x < c.width; x += 6) ctx.fillRect(x, 0, 1, c.height);
    for (let y = 0; y < c.height; y += 6) ctx.fillRect(0, y, c.width, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '96px Bungee, "Arial Black", sans-serif';
    ctx.fillStyle = '#c8102e';
    ctx.fillText('BLACKCLIFF', c.width / 2, 170);
    ctx.font = '230px Bungee, "Arial Black", sans-serif';
    ctx.fillStyle = '#aaff00';
    ctx.shadowColor = '#aaff00';
    ctx.shadowBlur = 30;
    ctx.fillText('BEAT THE BEASTS', c.width / 2, 430);
    ctx.shadowBlur = 0;
    ctx.font = '64px Bungee, "Arial Black", sans-serif';
    ctx.fillStyle = '#f4f0ff';
    ctx.fillText('THE CONTENDERS  ·  VS  ·  THE BEASTS', c.width / 2, 660);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load('100px Bungee').then(draw, () => undefined);
  return tex;
}

export function createScreenMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 2.2, roughness: 0.35 });
  mat.userData.noWeather = true;
  return patchMaterial(mat, undefined, 'screen');
}

export function createMetalMaterial(color = 0x2a2b2e): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.7 });
  mat.userData.porosity = 0.05;
  return patchMaterial(mat, undefined, 'metal');
}

/**
 * Plaza lamps on a 22 m grid around the bowl. The same rule runs in JS (to
 * place the posts) and in GLSL (to paint their light pools on the paving),
 * so pools always sit under lamps: inside the plaza, back from the cliff,
 * clear of the stands (rounded-rect distance > 58 m from the U, whose back
 * wall is 50.8 m out). None on the open-end terrace: posts there would stand
 * across the signature view of the sea.
 */
export const LAMP_GRID = 22;
const LAMP_RULE_GLSL = /* glsl */ `
float lampKeep(vec2 l) {
  vec2 p = l - vec2(0.0, -5.0);
  float r = p.y < 0.0 ? 30.0 : 0.0;
  vec2 q = abs(p) - (vec2(39.0, 65.0) - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float coast = 104.0 - 0.00085 * l.x * l.x;
  float plaza = step(abs(l.x), 118.0) * step(-130.0, l.y) * step(l.y, coast - 12.0);
  return plaza * step(58.0, d);
}`;

export function plazaLampPositions(): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = -6; i <= 6; i++) {
    for (let j = -6; j <= 6; j++) {
      const x = i * LAMP_GRID;
      const z = j * LAMP_GRID - 10;
      const px = x;
      const pz = z + 5;
      const r = pz < 0 ? 30 : 0;
      const qx = Math.abs(px) - (39 - r);
      const qz = Math.abs(pz) - (65 - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
      const plaza = Math.abs(x) <= 118 && z >= -130 && z <= coastZ(x) - 12;
      if (plaza && d >= 58) out.push(new THREE.Vector2(x, z));
    }
  }
  return out;
}

export function createPavingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
  mat.userData.porosity = 0.45; // sealed pavers
  return patchMaterial(
    mat,
    (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvPWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vPWorld;\nuniform float uLights;\nvec3 pavingPool;\n${LAMP_RULE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // Warm pool under the nearest plaza lamp (6 m head, ~5 m spread).
            vec2 l = vec2(floor(vPWorld.x / ${LAMP_GRID.toFixed(1)} + 0.5) * ${LAMP_GRID.toFixed(1)}, floor((vPWorld.z + 10.0) / ${LAMP_GRID.toFixed(1)} + 0.5) * ${LAMP_GRID.toFixed(1)} - 10.0);
            float dl = length(vPWorld.xz - l);
            pavingPool = vec3(1.0, 0.78, 0.52) * lampKeep(l) * exp(-dl * dl / (2.0 * 5.0 * 5.0)) * uLights * 0.35;
            vec2 t = vPWorld.xz / vec2(1.8, 0.9);
            vec2 j = abs(fract(t) - 0.5);
            float joint = smoothstep(0.47, 0.5, max(j.x, j.y));
            float tone = fract(sin(dot(floor(t), vec2(12.9898, 78.233))) * 43758.5453);
            diffuseColor.rgb = mix(vec3(0.5, 0.47, 0.43), vec3(0.62, 0.59, 0.54), tone) * (1.0 - 0.35 * joint);
          }`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * pavingPool;');
      Object.assign(shader.uniforms, stadiumUniforms);
    },
    'paving',
  );
}

export function createLightHeadMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.94, 0.84), emissiveIntensity: 6, roughness: 0.3 });
  mat.userData.noWeather = true;
  return patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, stadiumUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uLights;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uLights;');
    },
    'lighthead',
  );
}

/**
 * The plaza ring around the stadium: a 250 m square of paving, minus the
 * playing surface's footprint and everything within 8 m of the cliff edge (the square's southern corners
 * would otherwise hang out over the sea). Built as a grid and trimmed per
 * cell, with the cut edge snapped to the setback line.
 */
export function buildPlazaGeometry(): THREE.BufferGeometry {
  const half = 125;
  const cz = -10;
  const n = 100;
  const setback = (x: number) => coastZ(x) - 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const v = (x: number, z: number) => {
    pos.push(x, 0, Math.min(z, setback(x)));
    uv.push((x + half) / 250, (z - cz + half) / 250);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -half + (i / n) * 250;
      const x1 = -half + ((i + 1) / n) * 250;
      const z0 = cz - half + (j / n) * 250;
      const z1 = cz - half + ((j + 1) / n) * 250;
      if (z0 >= setback(x0) && z0 >= setback(x1)) continue;
      // No paving under the playing surface and apron (World: ±39 m, z −71..67).
      if (x0 >= -40 && x1 <= 40 && z0 >= -72 && z1 <= 66) continue;
      v(x0, z0); v(x0, z1); v(x1, z0);
      v(x1, z0); v(x0, z1); v(x1, z1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
