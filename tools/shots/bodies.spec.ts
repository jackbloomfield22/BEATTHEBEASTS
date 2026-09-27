import { test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

// M6.5 #12, the bodies in the runtime: the Animation Lab (/#/dev/anim) at
// the skinning's worst frames (sprint, sharp cut, high point, dive; the
// High and Medium LODs, close on the shoulders), the run's lean into a turn
// seen from in front (where it pivots), and the defender's contest overlay
// over the run. Into tools/shots/out/bodies (BTB_BODIES_TAG names a run, e.g. "before").
//   BTB_BODIES=1 BTB_PORT=5197 npx playwright test -c tools/shots/playwright.config.ts

const meta = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as {
  fps: number;
  clips: Record<string, { events?: Record<string, number> }>;
};
const TAG = process.env.BTB_BODIES_TAG ?? 'after';
const DIR = `tools/shots/out/bodies/${TAG}`;
// The Lab plays a blend-mode overlay first at 0.6 s (AnimLab.tsx OVL_START).
const OVL_START = 0.6;
// Three-quarter front, close on the chest and shoulders (the Lab's player faces +Z).
const SHOULDER = '1.1,1.75,1.5,0,1.3,0';
const BODY = '2.6,1.6,3.4,0,0.95,0';
const FRONT = '0,1.1,5.5,0,0.95,0';

const shots: { name: string; q: string }[] = [];
for (const lod of [0, 1]) {
  for (const f of [0, 4, 11]) shots.push({ name: `sprint_f${f}_lod${lod}`, q: `mode=single&clip=loco_sprint&t=${(f / 30).toFixed(4)}&lod=${lod}&kit=royal&cam=${SHOULDER}` });
  shots.push({ name: `cut_sharp_f5_lod${lod}`, q: `mode=single&clip=cut_plant_sharp_l&t=${(5 / 30).toFixed(4)}&lod=${lod}&kit=royal&cam=${BODY}` });
  shots.push({ name: `high_point_f25_lod${lod}`, q: `mode=single&clip=catch_high_point&t=${(25 / 30).toFixed(4)}&lod=${lod}&kit=royal&cam=${BODY}` });
  shots.push({ name: `dive_f7_lod${lod}`, q: `mode=single&clip=dive&t=${(7 / 30).toFixed(4)}&lod=${lod}&kit=royal&cam=${BODY}` });
}
// The lean into a turn at speed, from in front: how far the chest leaves the spot he stands on.
shots.push({ name: 'lean_turn_8ms', q: `mode=single&clip=blend&speed=8&yaw=1.5&t=1.2&lod=0&kit=royal&cam=${FRONT}` });
shots.push({ name: 'lean_none_8ms', q: `mode=single&clip=blend&speed=8&yaw=0&t=1.2&lod=0&kit=royal&cam=${FRONT}` });
const contact = (meta.clips.def_contest_l?.events?.contact ?? 9) / meta.fps;
for (const [label, dt] of [['a_reach', -0.12], ['b_contact', 0], ['c_rake', 0.12]] as const) {
  shots.push({ name: `contest_l_${label}`, q: `mode=single&clip=blend&speed=6&ovl=def_contest_l&t=${(OVL_START + contact + dt).toFixed(3)}&lod=0&kit=royal&look=0&cam=${BODY}` });
}

for (const s of shots) {
  test(`bodies · ${TAG} · ${s.name}`, async ({ page }) => {
    mkdirSync(DIR, { recursive: true });
    await page.goto(`/#/dev/anim?${s.q}`);
    await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 180_000 });
    await page.waitForTimeout(2500);
    await page.locator('.lab-view').screenshot({ path: `${DIR}/${s.name}.png` });
  });
}
