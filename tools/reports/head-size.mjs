// M6.6 (Playtest 1: "player heads are too small on the models"): measure the
// built player (public/assets/characters/player.glb) at rest: stature,
// the helmet and facemask (the head as a fan sees it), the shoulder pads,
// for the base body and each body blend shape, and the head-to-height
// ratio a broadcast reads. A real player in pads and helmet measures about
// 1 : 7 to 1 : 7.5 (helmet crown to facemask chin, against helmet crown to
// the turf).
//
//   node tools/reports/head-size.mjs

import { readFileSync } from 'node:fs';

const buf = readFileSync(new URL('../../public/assets/characters/player.glb', import.meta.url));
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
const meta = JSON.parse(readFileSync(new URL('../../public/assets/characters/player.json', import.meta.url), 'utf8'));

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function get(dv, o, ct) {
  switch (ct) {
    case 5126: return dv.getFloat32(o, true);
    case 5123: return dv.getUint16(o, true);
    case 5122: return dv.getInt16(o, true);
    case 5121: return dv.getUint8(o);
    case 5120: return dv.getInt8(o);
    default: return dv.getUint32(o, true);
  }
}

function read(ai) {
  const a = gltf.accessors[ai];
  const [, size] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const out = new Float32Array(a.count * n);
  if (a.bufferView !== undefined) {
    const bv = gltf.bufferViews[a.bufferView];
    const stride = bv.byteStride || size * n;
    const dv = new DataView(bin.buffer, bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0));
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < n; k++) {
        let v = get(dv, i * stride + k * size, a.componentType);
        if (a.normalized) v /= NORM[a.componentType];
        out[i * n + k] = v;
      }
  }
  if (a.sparse) {
    const sp = a.sparse;
    const ibv = gltf.bufferViews[sp.indices.bufferView];
    const idv = new DataView(bin.buffer, bin.byteOffset + (ibv.byteOffset || 0) + (sp.indices.byteOffset || 0));
    const isz = COMP[sp.indices.componentType][1];
    const vbv = gltf.bufferViews[sp.values.bufferView];
    const vdv = new DataView(bin.buffer, bin.byteOffset + (vbv.byteOffset || 0) + (sp.values.byteOffset || 0));
    for (let j = 0; j < sp.count; j++) {
      const i = get(idv, j * isz, sp.indices.componentType);
      for (let k = 0; k < n; k++) {
        let v = get(vdv, (j * n + k) * size, a.componentType);
        if (a.normalized) v /= NORM[a.componentType];
        out[i * n + k] = v;
      }
    }
  }
  return { data: out, n, count: a.count };
}

const mesh = gltf.meshes.find((m) => m.name?.startsWith('player_lod0')) ?? gltf.meshes[0];
const prim = mesh.primitives[0];
const pos = read(prim.attributes.POSITION);
const uv = read(prim.attributes.TEXCOORD_0);
const targetNames = mesh.extras?.targetNames ?? meta.shapes;
const targets = (prim.targets ?? []).map((t) => read(t.POSITION));
const partOf = (i) => Math.floor(uv.data[i * 2] * meta.partScale + 0.001);
const P = meta.parts;

function measure(weights) {
  const at = (i) => {
    let x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2];
    targets.forEach((t, k) => {
      const w = weights[targetNames[k]] ?? 0;
      if (!w) return;
      x += t.data[i * 3] * w; y += t.data[i * 3 + 1] * w; z += t.data[i * 3 + 2] * w;
    });
    return [x, y, z];
  };
  const box = () => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity });
  const grow = (b, [x, y, z]) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); };
  const all = box(), helmet = box(), mask = box(), jersey = box();
  let jerseyShoulder = 0;
  // The jersey's half-width in 3 cm bands from 1.40 to 1.64 m (where the pads' caps are widest).
  const bands = new Array(8).fill(0);
  for (let i = 0; i < pos.count; i++) {
    const p = partOf(i);
    if (p === P.shirt || p === P.cap) continue; // the official's parts
    const v = at(i);
    grow(all, v);
    if (p === P.helmet) grow(helmet, v);
    if (p === P.mask_skill) grow(mask, v);
    if (p === P.jersey) {
      grow(jersey, v);
      // The pads across the shoulders: above the shoulder joint (1.505 m; below it the A-posed sleeves hang out at 45 degrees) and below the collar.
      if (v[1] > 1.5 && v[1] < 1.62) jerseyShoulder = Math.max(jerseyShoulder, Math.abs(v[0]));
      const k = Math.floor((v[1] - 1.4) / 0.03);
      if (k >= 0 && k < bands.length) bands[k] = Math.max(bands[k], Math.abs(v[0]));
    }
  }
  if (process.env.PROFILE) console.log('  pads width by height (1.40 m up, 3 cm bands):', bands.map((b) => (2 * b).toFixed(2)).join(' '));
  const stature = all.y1; // crown of the helmet above the turf
  const head = helmet.y1 - Math.min(helmet.y0, mask.y0); // crown to the facemask's chin
  return {
    stature: stature.toFixed(3),
    helmetW: (helmet.x1 - helmet.x0).toFixed(3),
    helmetD: (helmet.z1 - helmet.z0).toFixed(3),
    head: head.toFixed(3),
    heads: (stature / head).toFixed(2),
    padsW: (2 * jerseyShoulder).toFixed(3),
    padsOverHelmet: ((2 * jerseyShoulder) / (helmet.x1 - helmet.x0)).toFixed(2),
  };
}

const cases = {
  base: {},
  'skill (lean, slim pads)': { lean: 1, pads: -0.8, neck: 0.1 },
  'LB/TE (pads .45, neck .6)': { pads: 0.45, neck: 0.6 },
  'lineman (heavy, belly .6, pads 1, neck .9)': { heavy: 1, belly: 0.6, pads: 1, neck: 0.9 },
  'heavy only': { heavy: 1 },
  'pads 1 only': { pads: 1 },
  'lineman, pads .7': { heavy: 1, belly: 0.6, pads: 0.7, neck: 0.9 },
};
console.log('targets:', targetNames.join(', '));
for (const [k, w] of Object.entries(cases)) console.log(k.padEnd(44), JSON.stringify(measure(w)));

// At runtime (src/render/players/bodyShape.ts): the body scales with
// stature, the head bone by headScale(). Linear blend skinning: a vertex
// moves by its weight on the head bone; the helmet is all head.
const HEAD_BASE = 1.06;
const HEAD_STATURE_EXP = 0.5;
const joints = read(prim.attributes.JOINTS_0);
const wts = read(prim.attributes.WEIGHTS_0);
const HEAD_J = gltf.skins[0].joints.map((j) => gltf.nodes[j].name).indexOf('head');
const PIVOT_Y = 1.675; // skeleton.py J['head'] (Blender z up; glTF y up)
function runtime(heightM, headOn) {
  const s = heightM / 1.88;
  const hs = headOn ? HEAD_BASE * Math.pow(s, -HEAD_STATURE_EXP) : 1;
  let top = 0;
  let hTop = -Infinity;
  let hBot = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const p = partOf(i);
    if (p === P.shirt || p === P.cap) continue;
    let wh = 0;
    for (let k = 0; k < 4; k++) if (joints.data[i * 4 + k] === HEAD_J) wh += wts.data[i * 4 + k];
    const k = 1 + (hs - 1) * wh;
    const y = (PIVOT_Y + (pos.data[i * 3 + 1] - PIVOT_Y) * k) * s;
    top = Math.max(top, y);
    if (p === P.helmet) hTop = Math.max(hTop, y);
    if (p === P.helmet || p === P.mask_skill) hBot = Math.min(hBot, y);
  }
  const head = hTop - hBot;
  return `stature ${top.toFixed(3)} m, head ${head.toFixed(3)} m, ${(top / head).toFixed(2)} heads`;
}
console.log('\nOn the field (stature scale, and the head scale from bodyShape.ts headScale):');
for (const [label, h] of [["5'9\" corner", 1.753], ["6'2\" base", 1.88], ["6'5\" tackle", 1.956]]) {
  console.log(`  ${label.padEnd(14)} before: ${runtime(h, false)}   now: ${runtime(h, true)}`);
}
