import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The ball carrier's clips (M6.5 #11) in the Animation Lab (/#/dev/anim),
// into tools/shots/out/carrier. The gaits run through the runtime blend
// (the families, the ball tucked by the game's overlay) at 6 m/s: the
// receiver's run, the carrier in space, in traffic, in the burst's drive,
// pressing the hole, and the dip either side. The full-body moves play raw
// at their key frames.
//   BTB_CARRIER=1 BTB_PORT=5198 npx playwright test -c tools/shots/playwright.config.ts

const meta = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as {
  fps: number;
  clips: Record<string, { duration: number; events?: Record<string, number> }>;
};
const CAM = process.env.BTB_CARRIER_CAM ?? '-2.6,1.5,3.4,0,0.95,0';
const SIDE = '3.9,1.2,0.6,0,0.9,0';
const T = 1.37; // s into the blend: every weight has eased in

const blends: [string, string][] = [
  ['a_receiver', ''],
  ['b_space', '&carry=space'],
  ['c_traffic', '&carry=traffic'],
  ['d_drive', '&carry=drive'],
  ['e_press', '&carry=press'],
  ['f_dip_l', '&carry=traffic&dip=l'],
  ['g_dip_r', '&carry=traffic&dip=r'],
];
for (const [label, q] of blends) {
  for (const [view, cam] of [['front', CAM], ['side', SIDE]] as const) {
    test(`carrier blend · ${label} · ${view}`, async ({ page }) => {
      await page.goto(`/#/dev/anim?mode=single&clip=blend&speed=6${q}&t=${T}&lod=0&kit=royal&cam=${cam}`);
      await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 180_000 });
      await page.waitForTimeout(2500);
      await page.locator('.lab-view').screenshot({ path: `tools/shots/out/carrier/blend_${label}_${view}.png` });
    });
  }
}

const ev = (c: string, e: string) => (meta.clips[c]?.events?.[e] ?? 0) / meta.fps;
const moves: [string, string, number][] = [
  ['cut_plant_l', 'a_plant', ev('cut_plant_l', 'plant') + 0.06],
  ['cut_plant_l', 'b_push', ev('cut_plant_l', 'push')],
  ['cut_plant_sharp_r', 'a_plant', ev('cut_plant_sharp_r', 'plant') + 0.1],
  ['cut_plant_sharp_r', 'b_push', ev('cut_plant_sharp_r', 'push')],
  ['truck', 'a_gather', 0.14],
  ['truck', 'b_contact', ev('truck', 'contact') + 0.04],
  ['hurdle', 'a_takeoff', ev('hurdle', 'takeoff')],
  ['hurdle', 'b_over', ev('hurdle', 'over')],
  ['dive_reach', 'a_fly', 0.36],
  ['dive_reach', 'b_land', 0.55],
];
for (const [clip, label, t] of moves) {
  test(`carrier move · ${clip} · ${label}`, async ({ page }) => {
    await page.goto(`/#/dev/anim?mode=single&clip=${clip}&t=${t.toFixed(3)}&lod=0&kit=royal&cam=${clip.startsWith('cut') ? CAM : '4.2,1.4,-0.6,0,0.8,-0.6'}`);
    await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 180_000 });
    await page.waitForTimeout(2500);
    await page.locator('.lab-view').screenshot({ path: `tools/shots/out/carrier/move_${clip}_${label}.png` });
  });
}
