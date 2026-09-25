import { test } from '@playwright/test';

// The Contenders' locker room (M6 gate): empty, half and full, stall close-ups
// and the pick panel, in both room moods. Into tools/shots/out/locker.
// BTB_ONLY=name1,name2 limits the states; BTB_MOODS=pregame,lightsdown the moods;
// BTB_Q adds query flags (e.g. cam=x,y,z,lx,ly,lz,fov to try a framing) and
// BTB_TAG suffixes the file names.

const STATES = [
  { name: 'empty', q: 'roomcam=home' },
  { name: 'half', q: 'fill=4&roomcam=home' },
  { name: 'full', q: 'fill=9&roomcam=home' },
  { name: 'full-pullback', q: 'fill=9&roomcam=pullback' },
  { name: 'stall-qb', q: 'fill=9&roomcam=QB' },
  { name: 'stall-wr', q: 'fill=9&roomcam=WR1' },
  { name: 'stall-ol', q: 'fill=9&roomcam=OL' },
  { name: 'stall-empty', q: 'fill=4&roomcam=TE' },
  { name: 'wall-beasts', q: 'roomcam=wall' },
  { name: 'door', q: 'fill=9&roomcam=door' },
  { name: 'pick-panel', q: 'fill=3&pickpanel' },
];
const MOODS = (process.env.BTB_MOODS ?? 'pregame,lightsdown').split(',');
const ONLY = process.env.BTB_ONLY?.split(',');
const EXTRA = process.env.BTB_Q ? `&${process.env.BTB_Q}` : '';
const TAG = process.env.BTB_TAG ? `-${process.env.BTB_TAG}` : '';

for (const mood of MOODS) {
  for (const s of STATES) {
    if (ONLY && !ONLY.includes(s.name)) continue;
    test(`${s.name} · ${mood}`, async ({ page }) => {
      await page.goto(`/?screen=draft&shot=menu&nointro&seed=7&room=${mood}&lighting=${mood === 'lightsdown' ? 'night' : 'golden'}&quality=${process.env.BTB_QUALITY ?? 'medium'}&${s.q}${EXTRA}`);
      await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 300_000 });
      await page.waitForFunction(() => {
        const d = (window as unknown as { __btbDraft?: { getState(): { phase: string } } }).__btbDraft;
        return !!d && d.getState().phase !== 'loading';
      }, null, { timeout: 120_000 });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `tools/shots/out/locker/${mood}-${s.name}${TAG}.png` });
    });
  }
}
