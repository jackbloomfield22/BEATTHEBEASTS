// (Round 18 copy of a16_clipcmp.ts) Animation round 16 (docs/anim/FEET16.md): the clips a rebuild of the library left as they were. Compares every clip
// of two anims.glb files track by track (keys and values) and lists the clips that differ or are new.
//   node tools/run-ts.mjs tools/sim/a16_clipcmp.ts <old.glb> [new.glb]
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
type Anim = { name: string; tracks: { name: string; times: Float32Array; values: Float32Array }[] };
const load = async (f: string) => {
  const b = readFileSync(f);
  const g = await new Promise<{ animations: Anim[] }>((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', (x) => res(x as never), rej));
  return new Map(g.animations.map((a) => [a.name, a]));
};
const [oldF, newF = 'public/assets/characters/anims.glb'] = process.argv.slice(2);
const a = await load(oldF!);
const b = await load(newF);
let same = 0;
const changed: string[] = [];
for (const [n, ca] of a) {
  const cb = b.get(n);
  if (!cb) {
    changed.push(`${n} (gone)`);
    continue;
  }
  const key = (c: Anim) => c.tracks.map((t) => `${t.name}:${Array.from(t.times).join(',')}:${Array.from(t.values).join(',')}`).sort().join('|');
  if (key(ca) === key(cb)) same++;
  else changed.push(n);
}
console.log(`${same} of ${a.size} clips identical; changed: ${changed.join(' ') || 'none'}; new: ${[...b.keys()].filter((n) => !a.has(n)).join(' ')}`);
