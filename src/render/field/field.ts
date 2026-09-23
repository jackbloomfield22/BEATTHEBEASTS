import * as THREE from 'three';
import { patchMaterial } from '../sky/atmosphere';
import { NOISE_GLSL } from '../sky/SkyDome';
import { YARD } from '../world/constants';

// The playing surface in one draw: grass albedo with color variation and wear,
// mowing stripes with a view-dependent sheen (why stripes read on TV),
// analytic anti-aliased yard lines / hashes / borders, and a painted-decal
// canvas for numbers, end zones and the midfield mark. No NFL marks.

const PAINT_W = 4096;
const PAINT_H = 2048;

/** Draw numbers, arrows, end-zone lettering and the midfield claw into a paint mask. */
export function createFieldPaint(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PAINT_W;
  canvas.height = PAINT_H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, PAINT_W, PAINT_H);
    ctx.save();
    // Canvas in yard units: x = along the field (z + 60), y = across (x + 26.667).
    ctx.scale(PAINT_W / 120, PAINT_H / (160 / 3));
    // Channels: R = white paint, G = crimson paint, B = dark end-zone paint.
    const white = 'rgb(255,0,0)';
    const crimson = 'rgb(0,255,0)';

    // End zones: dark paint over the whole zone (additive channel B).
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgb(0,0,255)';
    ctx.fillRect(0.12, 0, 9.88, 160 / 3);
    ctx.fillRect(110, 0, 9.88, 160 / 3);

    // World-vector text placement (see field notes in GDD §12.5): a,b = text-right in canvas; c,d = text-down.
    const place = (cx: number, cy: number, right: [number, number], up: [number, number], fn: () => void) => {
      ctx.save();
      // world (x, z) -> canvas (z, x)
      ctx.transform(right[1], right[0], -up[1], -up[0], cx, cy);
      fn();
      ctx.restore();
    };

    // Yard numbers: 2 yd tall, bottom 12 yd in from each sideline, read from that sideline.
    const font = (px: number) => `${px}px Bungee, "Arial Black", Impact, sans-serif`;
    for (const yl of [10, 20, 30, 40, 50, 40, 30, 20, 10].map((n, i) => ({ n, z: -40 + i * 10 }))) {
      for (const side of [-1, 1]) {
        const fxCenter = side * (26.667 - 13);
        const up: [number, number] = [-side, 0]; // toward the field center
        const right: [number, number] = side < 0 ? [0, 1] : [0, -1];
        place(yl.z + 60, fxCenter + 26.667, right, up, () => {
          ctx.font = font(2.75);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = white;
          const s = String(yl.n);
          ctx.fillText(s[0]!, -0.95, 0.1);
          ctx.fillText(s[1]!, 0.95, 0.1);
          // Direction arrow toward the nearer goal line.
          if (yl.n !== 50) {
            const toward = yl.z < 0 ? -1 : 1; // world z direction of the nearer goal
            const dirX = toward * right[1]; // text-space x sign
            ctx.beginPath();
            ctx.moveTo(dirX * 2.35, -0.55);
            ctx.lineTo(dirX * 2.35, -1.05);
            ctx.lineTo(dirX * 2.85, -0.8);
            ctx.closePath();
            ctx.fill();
          }
        });
      }
    }

    // End-zone lettering: BEASTS in both end zones, read from the field. The
    // stadium is the Beasts' home; Blackcliff is only the venue name on the
    // intro title card (owner's call, GDD §12.4).
    const endText = (label: string, zCenter: number, north: boolean) => {
      const up: [number, number] = north ? [0, -1] : [0, 1];
      const right: [number, number] = north ? [1, 0] : [-1, 0];
      place(zCenter + 60, 26.667, right, up, () => {
        ctx.font = font(6.2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 0.55;
        ctx.strokeStyle = white;
        ctx.strokeText(label, 0, 0.3);
        ctx.fillStyle = crimson;
        ctx.fillText(label, 0, 0.3);
      });
    };
    endText('BEASTS', -55, true);
    endText('BEASTS', 55, false);

    // Midfield claw: three raking slashes.
    ctx.save();
    ctx.translate(60, 26.667);
    for (let i = -1; i <= 1; i++) {
      ctx.save();
      ctx.translate(i * 2.2, i * 0.4);
      ctx.rotate(-0.35);
      const slash = new Path2D();
      slash.moveTo(0, -4.6);
      slash.bezierCurveTo(1.3, -1.5, 1.2, 1.8, 0.1, 4.6);
      slash.bezierCurveTo(-0.3, 1.8, -0.4, -1.5, 0, -4.6);
      ctx.lineWidth = 0.45;
      ctx.strokeStyle = white;
      ctx.stroke(slash);
      ctx.fillStyle = crimson;
      ctx.fill(slash);
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
    tex.needsUpdate = true;
  };

  draw();
  // Redraw once the display font has loaded.
  document.fonts?.load('100px Bungee').then(draw, () => undefined);
  return tex;
}

/**
 * The field's albedo, roughness and paint coverage at a world point: grass,
 * mowing stripes, wear, analytic markings and painted decals. Shared by the
 * field surface and the grass shells (grass.ts) so blades carry the paint.
 * Needs NOISE_GLSL, uPaint and the atmosphere pars (for weatherSnowMask).
 */
export const FIELD_SAMPLE_GLSL = /* glsl */ `
struct FieldSample { vec3 col; float rough; float white; };
float aaBand(float d, float halfW) {
  float fw = max(fwidth(d), 1e-4);
  return 1.0 - smoothstep(halfW - fw, halfW + fw, d);
}
FieldSample fieldSample(vec3 w) {
            const float YD = ${YARD.toFixed(4)};
            vec2 f = vec2(w.x, w.z) / YD; // yards: x across, y along
            vec3 V = normalize(cameraPosition - w);

            // Grass base with multi-scale variation.
            float n1 = fbm(w.xz * 0.08, 4);
            float n2 = fbm(w.xz * 1.7, 3);
            vec3 grass = mix(vec3(0.045, 0.2, 0.03), vec3(0.085, 0.29, 0.04), n1);
            grass *= 0.88 + 0.24 * n2;

            // Mowing stripes (5-yard bands) with blade-lean sheen that flips with view direction.
            float band = mod(floor((f.y + 60.0) / 5.0), 2.0) * 2.0 - 1.0;
            float lean = dot(normalize(V.xz + vec2(0.0001)), vec2(0.0, 1.0));
            grass *= 1.0 + 0.16 * band * (0.35 + 0.65 * lean);

            // Wear: between the hashes and in front of the benches.
            float wear = smoothstep(4.0, 0.0, abs(f.x)) * smoothstep(52.0, 20.0, abs(f.y)) * 0.25 * smoothstep(0.4, 0.7, n2);
            grass = mix(grass, vec3(0.2, 0.2, 0.1), wear);

            // Analytic markings (yards).
            float inField = step(abs(f.x), 26.667) * step(abs(f.y), 60.0);
            float line = 0.0;
            // Yard lines every 5 yards between the goal lines (4 in = 0.111 yd; goal lines 8 in).
            float yl = abs(mod(f.y + 2.5, 5.0) - 2.5);
            line = max(line, aaBand(yl, 0.0556) * step(abs(f.y), 50.1) * step(abs(f.x), 26.667));
            line = max(line, aaBand(abs(abs(f.y) - 50.0), 0.111) * step(abs(f.x), 26.667));
            // Borders: 6 ft (2 yd) white border outside sidelines and end lines.
            float sideB = step(26.667, abs(f.x)) * step(abs(f.x), 28.667) * step(abs(f.y), 62.0);
            float endB = step(60.0, abs(f.y)) * step(abs(f.y), 62.0) * step(abs(f.x), 28.667);
            line = max(line, max(sideB, endB));
            // Hash marks every yard: inbound hashes (18'6" apart) and sideline marks.
            float yd = abs(fract(f.y + 0.5) - 0.5);
            float hashY = aaBand(yd, 0.0556) * step(abs(f.y), 49.6);
            float inHash = aaBand(abs(abs(f.x) - 3.25), 0.333);
            float sideHash = aaBand(abs(abs(f.x) - 26.0), 0.333);
            line = max(line, hashY * max(inHash, sideHash));
            // PAT marks at the 2 (well, the 2-yd line: 1 yd wide dash).
            line = max(line, aaBand(abs(abs(f.y) - 48.0), 0.0556) * aaBand(abs(f.x), 0.5));

            // Painted decals.
            vec2 puv = vec2((f.y + 60.0) / 120.0, (f.x + 26.667) / 53.333);
            vec3 paint = (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) ? texture2D(uPaint, puv).rgb : vec3(0.0);
            // Paint wear: chalk breaks up slightly.
            float chalk = 0.82 + 0.18 * smoothstep(0.25, 0.6, n2);
            vec3 col = grass;
            col = mix(col, grass * vec3(0.18, 0.12, 0.13), paint.b * 0.92); // dark end zones
            col = mix(col, vec3(0.42, 0.02, 0.035), paint.g * chalk);
            float whiteAmt = max(line, paint.r) * chalk;
            col = mix(col, vec3(0.86, 0.86, 0.83), whiteAmt);
            FieldSample o;
            o.col = col;
            o.rough = mix(0.92, 0.7, whiteAmt);
            o.white = whiteAmt;
            // Snow games: the crew sweeps the yard lines, goal lines and
            // borders clear (about a foot either side), so they read as
            // green-edged white lines through the snow; play scuffs the rest.
            float swept = aaBand(yl, 0.3) * step(abs(f.y), 50.3) * step(abs(f.x), 26.667);
            swept = max(swept, aaBand(abs(abs(f.y) - 50.0), 0.45) * step(abs(f.x), 26.667));
            swept = max(swept, max(sideB, endB));
            // Crews also keep the numbers and logos readable, and the turf
            // shows through where play has churned it.
            float painted = max(max(paint.r, paint.g), max(paint.b, line));
            weatherSnowMask = (1.0 - swept) * mix(0.42, 0.72, n1) * (1.0 - 0.55 * painted);
  return o;
}
`;

export function createFieldMaterial(paint: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.userData.porosity = 0.85; // natural grass over sand root zone
  return patchMaterial(
    mat,
    (shader) => {
      shader.uniforms.uPaint = { value: paint };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvFWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vFWorld;
          uniform sampler2D uPaint;
          ${NOISE_GLSL}
          float fieldRough;`,
        )
        // After the atmosphere pars (patchMaterial puts them right after <common>).
        .replace('#include <color_pars_fragment>', `#include <color_pars_fragment>\n${FIELD_SAMPLE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            FieldSample fs = fieldSample(vFWorld);
            diffuseColor.rgb = fs.col;
            fieldRough = fs.rough;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fieldRough;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // Turf detail normal (fine blades) from derivative bump.
            float hgt = fbm(vFWorld.xz * 6.0, 3) * 0.6 + fbm(vFWorld.xz * 23.0, 2) * 0.4;
            vec3 dpx = dFdx(vViewPosition);
            vec3 dpy = dFdy(vViewPosition);
            float dhx = dFdx(hgt);
            float dhy = dFdy(hgt);
            vec3 r1 = cross(dpy, normal);
            vec3 r2 = cross(normal, dpx);
            float det = dot(dpx, r1);
            vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
            float fade = 1.0 - smoothstep(20.0, 90.0, length(vViewPosition));
            normal = normalize(abs(det) * normal - grad * 0.02 * fade);
          }`,
        );
    },
    'field',
  );
}
