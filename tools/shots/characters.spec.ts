import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// The character pass (docs/characters/CHARACTERS.md): the players at the
// distances a viewer sees them. The Animation Lab (studio light) close up
// and every body type front and back; the stadium lineup (?lineup) from the
// broadcast camera and at huddle distance in two lighting presets; and the
// draw calls and triangles of 22 players from the broadcast camera, read
// off the ?perf screen (no GPU here: counts, not frame times).
// Into tools/shots/out/characters/<BTB_CHARS_TAG>.
//   BTB_CHARS=1 BTB_CHARS_TAG=before BTB_PORT=5299 npx playwright test -c tools/shots/playwright.config.ts
// BTB_CHARS_ONLY=lab|stadium|perf runs one group; BTB_CHARS_GREP=<substring> one shot.

const TAG = process.env.BTB_CHARS_TAG ?? 'after';
const ONLY = process.env.BTB_CHARS_ONLY ?? '';
const GREP = process.env.BTB_CHARS_GREP ?? '';
const DIR = `tools/shots/out/characters/${TAG}`;
// Round two: JPEG (quality 90) by default, a tenth of the PNG's size; BTB_CHARS_PNG=1 for lossless.
const EXT = process.env.BTB_CHARS_PNG ? 'png' : 'jpg';
const SHOT = EXT === 'png' ? {} : { type: 'jpeg' as const, quality: 90 };

// Lab cameras (the Lab's player faces +Z, stands at the origin).
const lab: { name: string; q: string; pre?: string }[] = [
  { name: 'lab-lineup-front-white', q: 'mode=lineup&speed=0&lod=0&kit=whiteLime&t=0.5&cam=0,1.3,13,0,1.15,0' },
  { name: 'lab-lineup-back-white', q: 'mode=lineup&speed=0&lod=0&kit=whiteLime&t=0.5&cam=0,1.3,-13,0,1.15,0' },
  { name: 'lab-lineup-front-beasts', q: 'mode=lineup&speed=0&lod=0&kit=beasts&skin=4&t=0.5&cam=0,1.3,13,0,1.15,0' },
  { name: 'lab-lineup-front-royal-lod1', q: 'mode=lineup&speed=0&lod=1&kit=royal&skin=1&t=0.5&cam=0,1.3,13,0,1.15,0' },
  // Huddle distance: the head and pads, three-quarter front.
  { name: 'lab-head-34', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=0.75,1.82,1.05,0,1.68,0' },
  { name: 'lab-head-34-royal', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=royal&skin=3&cam=0.75,1.82,1.05,0,1.68,0' },
  { name: 'lab-torso-34', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=1.1,1.75,1.5,0,1.3,0' },
  { name: 'lab-back-34', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=royal&cam=-1.2,1.6,-1.9,0,1.25,0' },
  // The known weak spots: the sleeve hem as the arm swings forward, the
  // towel at the hip, the back of the knee at the sprint.
  { name: 'lab-sprint-f4-shoulder', q: 'mode=single&clip=loco_sprint&t=0.1333&lod=0&kit=royal&cam=1.1,1.75,1.5,0,1.3,0' },
  { name: 'lab-sprint-f0-lod1', q: 'mode=single&clip=loco_sprint&t=0&lod=1&kit=royal&cam=1.1,1.75,1.5,0,1.3,0' },
  { name: 'lab-sprint-f11-knee', q: 'mode=single&clip=loco_sprint&t=0.3667&lod=0&kit=whiteLime&cam=1.9,0.75,-0.6,0,0.6,0' },
  { name: 'lab-sprint-body', q: 'mode=single&clip=loco_sprint&t=0.1333&lod=0&kit=whiteLime&cam=2.6,1.6,3.4,0,0.95,0' },
  { name: 'lab-legs-feet', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=0.9,0.55,1.4,0,0.35,0' },
  { name: 'lab-gloves', q: 'mode=single&clip=stance_qb_gun&t=0.5&lod=0&kit=whiteLime&cam=0.9,1.3,1.3,0,1.0,0.1' },
  { name: 'lab-high-point-lod2', q: 'mode=single&clip=catch_high_point&t=0.8333&lod=2&kit=royal&cam=2.6,1.6,3.4,0,0.95,0' },
  { name: 'lab-sig-qb-lod0', q: 'mode=single&clip=sig_qb&t=1.0&lod=0&kit=royal&cam=2.6,1.6,3.4,0,1.1,0' },
  // Turf wear (?wear: every kit worn this much; the game raises it each trip to the ground).
  { name: 'lab-wear-white', pre: '?wear=0.75', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=1.5,1.3,2.2,0,0.95,0' },
  { name: 'lab-wear-royal-back', pre: '?wear=0.75', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=royal&cam=-1.5,1.3,-2.2,0,0.95,0' },
  // Round two (docs/characters/CHARACTERS2.md): the open items up close.
  // The pants hem at the calf, standing and at the sprint (the sawtooth).
  { name: 'lab-calf-hem-stance', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=0.75,0.55,0.75,0.1,0.42,0' },
  { name: 'lab-calf-hem-sprint', q: 'mode=single&clip=loco_sprint&t=0.1333&lod=0&kit=royal&cam=1.0,0.6,0.6,0.05,0.45,0' },
  { name: 'lab-calf-hem-lod1', q: 'mode=single&clip=stance_idle&t=0.5&lod=1&kit=whiteLime&cam=0.75,0.55,0.75,0.1,0.42,0' },
  // Behind the knee at the sprint's heel recovery, close.
  { name: 'lab-knee-back-sprint', q: 'mode=single&clip=loco_sprint&t=0.3667&lod=0&kit=whiteLime&cam=0.9,0.65,-0.9,0.05,0.55,0' },
  // The neck beside the collar, front and back three-quarter.
  { name: 'lab-neck-34', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=royal&skin=3&cam=0.55,1.66,0.55,0,1.58,0' },
  { name: 'lab-neck-back', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=royal&skin=3&cam=-0.5,1.72,-0.6,0,1.6,0' },
  // The cleats close (sole, studs).
  { name: 'lab-cleats-close', q: 'mode=single&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=0.55,0.18,0.6,0.1,0.06,0' },
  { name: 'lab-cleats-sprint', q: 'mode=single&clip=loco_sprint&t=0.3667&lod=1&kit=royal&cam=1.4,0.35,-0.4,0,0.2,0' },
  // Arms overhead (the high point's reference frame) at each LOD, closer.
  { name: 'lab-high-point-lod2-close', q: 'mode=single&clip=catch_high_point&t=0.8333&lod=2&kit=royal&cam=1.5,1.9,2.1,0,1.65,0' },
  { name: 'lab-high-point-lod1-close', q: 'mode=single&clip=catch_high_point&t=0.8333&lod=1&kit=royal&cam=1.5,1.9,2.1,0,1.65,0' },
  // The elbow at the sprint's arm swing.
  { name: 'lab-elbow-sprint', q: 'mode=single&clip=loco_sprint&t=0.1333&lod=1&kit=whiteLime&cam=1.2,1.3,0.2,0.3,1.15,0' },
  // A tackle's pads: profile and three-quarter back (the balloon and the hood).
  { name: 'lab-ot-profile', q: 'mode=single&body=5&num=75&name=Muñoz&clip=stance_idle&t=0.5&lod=0&kit=royal&cam=2.6,1.5,0,0,1.3,0' },
  { name: 'lab-ot-back-34', q: 'mode=single&body=5&num=75&name=Muñoz&clip=stance_idle&t=0.5&lod=0&kit=royal&cam=-1.6,1.7,-1.9,0,1.35,0' },
  { name: 'lab-ot-front-34', q: 'mode=single&body=5&num=75&name=Muñoz&clip=stance_idle&t=0.5&lod=0&kit=whiteLime&cam=1.6,1.6,2.1,0,1.3,0' },
  { name: 'lab-ot-stance', q: 'mode=single&body=5&num=75&name=Muñoz&clip=stance_ol_3pt&t=0.5&lod=0&kit=royal&cam=2.8,1.2,0.6,0,0.8,0' },
  // Every body type side on, and at broadcast size (a player ~60 px tall, the screen-size LOD).
  { name: 'lab-lineup-side-royal', q: 'mode=lineup&speed=0&lod=0&kit=royal&skin=1&t=0.5&cam=13,1.3,0,0,1.15,0' },
  { name: 'lab-lineup-far', q: 'mode=lineup&speed=0&lod=auto&kit=royal&skin=1&t=0.5&cam=0,9,58,0,1.0,0,18' },
];

// The stadium lineup (render/players/Lineup.tsx): ball on the north 35
// (z = -13.7 m), the offense facing -Z.
const BROADCAST = '-50,14,-13.7,0,0,-11.5,18';
const stadium: { name: string; q: string }[] = [];
const PRESETS = ['golden', 'night', 'overcast', 'rain', 'snow'];
for (const lighting of PRESETS) {
  if (lighting === 'golden' || lighting === 'night') continue;
  // Round two: every preset from the broadcast camera and at huddle distance (the white kits).
  stadium.push({ name: `stadium-broadcast-${lighting}`, q: `lineup&noui&cam=${BROADCAST}&lighting=${lighting}&quality=medium` });
  stadium.push({ name: `stadium-huddle-${lighting}`, q: `lineup&noui&cam=-2.6,1.75,-5.6,0.2,1.0,-10.5,42&lighting=${lighting}&quality=high` });
}
// A tighter broadcast lens on the offense's line (the white kits in the sun).
for (const lighting of PRESETS) stadium.push({ name: `stadium-tight-${lighting}`, q: `lineup&noui&cam=-30,9,-6,0,0.8,-11.5,14&lighting=${lighting}&quality=medium` });
for (const lighting of ['golden', 'night']) {
  stadium.push({ name: `stadium-broadcast-${lighting}`, q: `lineup&noui&cam=${BROADCAST}&lighting=${lighting}&quality=medium` });
  stadium.push({ name: `stadium-field-${lighting}`, q: `lineup&noui&cam=-7,1.2,-13.7,0,0.6,-13.7,40&lighting=${lighting}&quality=medium` });
  // Huddle distance behind the offense: the quarterback and the line's backs.
  stadium.push({ name: `stadium-huddle-${lighting}`, q: `lineup&noui&cam=-2.6,1.75,-5.6,0.2,1.0,-10.5,42&lighting=${lighting}&quality=high` });
  // In front of the defense, across the ball: the linemen in their stances.
  stadium.push({ name: `stadium-line-${lighting}`, q: `lineup&noui&cam=3.2,1.3,-19.5,0,0.6,-13.7,38&lighting=${lighting}&quality=high` });
}
stadium.push({ name: 'stadium-huddle-golden-wear', q: 'lineup&noui&wear=0.6&cam=-2.6,1.75,-5.6,0.2,1.0,-10.5,42&lighting=golden&quality=high' });

const want = (group: string, name: string) => (!ONLY || ONLY === group) && (!GREP || name.includes(GREP));

async function stadiumReady(page: Page, q: string): Promise<void> {
  await page.goto(`/?screen=main&shot=menu&t=0&${q}`);
  await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 600_000 });
  await page.waitForFunction(() => (window as unknown as { __btbLineupReady?: boolean }).__btbLineupReady === true, null, { timeout: 600_000 });
}

for (const s of lab) {
  if (!want('lab', s.name)) continue;
  test(`characters · ${TAG} · ${s.name}`, async ({ page }) => {
    test.setTimeout(900_000);
    mkdirSync(DIR, { recursive: true });
    await page.goto(`/${s.pre ?? ''}#/dev/anim?${s.q}`);
    await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 600_000 });
    await page.waitForTimeout(3000);
    await page.locator('.lab-view').screenshot({ path: `${DIR}/${s.name}.${EXT}`, ...SHOT });
  });
}

for (const s of stadium) {
  if (!want('stadium', s.name)) continue;
  test(`characters · ${TAG} · ${s.name}`, async ({ page }) => {
    test.setTimeout(1_800_000);
    mkdirSync(DIR, { recursive: true });
    await stadiumReady(page, s.q);
    await page.addStyleTag({ content: '.ui-root{display:none!important}' });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${DIR}/${s.name}.${EXT}`, ...SHOT });
  });
}

// Draw calls and triangles from the broadcast camera with 22 players, per
// quality tier, and with the players hidden (the difference is theirs).
for (const quality of ['medium', 'ultra']) {
  if (!want('perf', `perf-${quality}`)) continue;
  test(`characters · ${TAG} · perf-${quality}`, async ({ page }) => {
    test.setTimeout(1_800_000);
    mkdirSync(DIR, { recursive: true });
    await stadiumReady(page, `lineup&perf&cam=${BROADCAST}&lighting=golden&quality=${quality}`);
    await page.waitForTimeout(5000);
    const read = () =>
      page.evaluate(() => {
        const out: Record<string, string> = {};
        const dl = document.querySelector('.perf-rows');
        if (!dl) return out;
        const dts = dl.querySelectorAll('dt');
        const dds = dl.querySelectorAll('dd');
        dts.forEach((dt, i) => (out[dt.textContent ?? `row${i}`] = dds[i]?.textContent ?? ''));
        return out;
      });
    // Three successive frames: the far shadow cascades redraw every third
    // frame (lighting/shadows.ts), so one frame's counts depend on its phase.
    // A new frame shows as a new frame-time average on the perf screen.
    const samples: Record<string, string>[] = [];
    for (let i = 0; i < 3; i++) {
      const prev = samples[samples.length - 1]?.['Frame time avg'];
      const t0 = Date.now();
      let r = await read();
      while (prev !== undefined && r['Frame time avg'] === prev && Date.now() - t0 < 300_000) {
        await page.waitForTimeout(500);
        r = await read();
      }
      samples.push(r);
    }
    writeFileSync(`${DIR}/perf-${quality}.json`, JSON.stringify(samples, null, 2));
    await page.screenshot({ path: `${DIR}/perf-${quality}.png` });
  });
}
