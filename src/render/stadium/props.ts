import * as THREE from 'three';
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
        .replace('#include <common>', '#include <common>\nvarying vec3 vPWorld;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 t = vPWorld.xz / vec2(1.8, 0.9);
            vec2 j = abs(fract(t) - 0.5);
            float joint = smoothstep(0.47, 0.5, max(j.x, j.y));
            float tone = fract(sin(dot(floor(t), vec2(12.9898, 78.233))) * 43758.5453);
            diffuseColor.rgb = mix(vec3(0.5, 0.47, 0.43), vec3(0.62, 0.59, 0.54), tone) * (1.0 - 0.35 * joint);
          }`,
        );
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
