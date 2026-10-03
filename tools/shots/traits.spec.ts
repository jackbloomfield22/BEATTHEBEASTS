import { test, type Page } from '@playwright/test';

// The traits the play call and the line show (the trait catalog): the run
// tab with an H-Back's play in it and its art, a Pre-Snap Wizard's blitz
// tags at the line against the fire zone (two linebackers come), and a Field
// General's five audibles (Joe Montana is a Maestro: Surgeon and Field
// General). The practice roster's QB is given Pre-Snap Wizard in the page.
// BTB_TRAITS=1 npm run shots  ->  tools/shots/out/traits/

type P = {
  __btbPractice: { runner: { paused: boolean } | null; teams: { team: { QB: { traits?: string[] } } } | null };
  __btbPracticeUi: { getState(): { stage: string }; setState(s: Record<string, unknown>): void };
  __btbGameReady?: boolean;
  __btbReady?: boolean;
};
const OUT = 'tools/shots/out/traits';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test('traits at the play call and the line', async ({ page }) => {
  test.setTimeout(1_800_000);
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=practice&nointro&seed=1&quality=${process.env.BTB_QUALITY ?? 'medium'}&shot=practice`);
  await page.waitForFunction(() => (window as unknown as P).__btbReady === true, null, { timeout: 300_000 });
  await page.waitForFunction(() => (window as unknown as P).__btbPracticeUi?.getState().stage === 'call', null, { timeout: 120_000 });
  await page.evaluate(() => {
    const w = window as unknown as P;
    const qb = w.__btbPractice.teams!.team.QB;
    qb.traits = [...(qb.traits ?? []), 'pre-snap-wizard'];
    w.__btbPracticeUi.setState({ cover: 'firezone' });
  });
  // The run tab (five tabs over from the quick game), then the last play in it: H Iso.
  for (let k = 0; k < 5; k++) await page.keyboard.press('KeyE');
  await shot(page, '01-run-tab');
  await page.keyboard.press('ArrowUp');
  await shot(page, '02-run-tab-last');
  // Back round to the drop-backs (one tab on, wrapping, then one more) and call the first: Smash.
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyE');
  await shot(page, '03-dropback-tab');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as P).__btbGameReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => void ((window as unknown as P).__btbPractice.runner!.paused = true));
  await shot(page, '04-presnap-blitz-tags');
  await page.keyboard.press('KeyZ');
  await shot(page, '05-audibles');
});
