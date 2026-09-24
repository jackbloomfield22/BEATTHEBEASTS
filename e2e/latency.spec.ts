import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// Input latency (M5.5 gate): every key, from the press to the first frame
// that shows the response, under 100 ms. The page runs on a fixed frame
// clock (?shot: each rendered frame is exactly one 60 Hz tick of game time),
// so a latency of N frames here is N × 16.7 ms on hardware that holds 60
// fps, however slowly this machine renders. The log (game/latency.ts) marks
// the press with the key event's timestamp and the response in the frame
// that shows it; the figures go to docs/screenshots/m5.5/latency.json.

type W = {
  __btbPractice: { runner: { state: { phase: string; carrier: number; agents: { busy: number; moveCooldown: number; down: boolean }[]; result: unknown } } | null };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbLatency: { samples: { kind: string; ms: number; frames: number }[]; summary(): { kind: string; n: number; f50: number; f95: number; p50: number; p95: number }[] };
};

const phase = (page: Page) => page.evaluate(() => (window as unknown as W).__btbPractice.runner?.state.phase ?? '');
const waitPhase = (page: Page, p: string[]) => page.waitForFunction((ps) => ps.includes((window as unknown as W).__btbPractice.runner?.state.phase ?? ''), p, { timeout: 600_000 });
/** Wait until the carrier can start a move (not committed, not cooling down), so a press is never a buffered one. */
const ready = (page: Page) =>
  page.waitForFunction(
    () => {
      const s = (window as unknown as W).__btbPractice.runner?.state;
      if (!s || s.result) return true;
      const c = s.agents[s.carrier];
      return !!c && c.busy === 0 && c.moveCooldown === 0;
    },
    null,
    { timeout: 300_000 },
  );
/** A press held for a few frames, then a pause for the response to show. */
async function press(page: Page, key: string, holdMs = 120) {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  await page.waitForTimeout(250);
}

// Small, so this machine's software renderer draws frames (each one a tick) quickly.
test.use({ viewport: { width: 640, height: 360 } });

test('every key shows its response within 100 ms at 60 fps', async ({ page }) => {
  test.setTimeout(2_400_000);
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto('/?screen=practice&nointro&seed=37&quality=low&shot=practice');
  await waitReady(page);
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi?.getState().stage === 'call', null, { timeout: 120_000 });
  await page.keyboard.press('ArrowDown'); // Four Verticals
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbGameReady === true, null, { timeout: 150_000 });

  // Snap, then move in the pocket both ways.
  await press(page, 'Space');
  await waitPhase(page, ['dropback', 'pocket']);
  await press(page, 'ArrowLeft', 300);
  await press(page, 'ArrowRight', 300);
  // Hold icon 4 (the ring comes up), release (the throw motion starts).
  await page.waitForTimeout(400);
  await press(page, 'Digit4', 60);
  await waitPhase(page, ['air', 'carrier', 'dead']);
  if ((await phase(page)) === 'air') await press(page, 'Digit3');
  await waitPhase(page, ['carrier', 'dead']);
  if ((await phase(page)) === 'carrier') {
    await page.keyboard.down('ArrowUp');
    await press(page, 'ShiftRight', 400);
    for (const k of ['KeyQ', 'KeyW', 'KeyE', 'KeyC']) {
      await ready(page);
      if ((await phase(page)) !== 'carrier') break;
      await press(page, k, k === 'KeyC' ? 300 : 80);
    }
    await page.keyboard.up('ArrowUp');
  }

  const out = await page.evaluate(() => ({ samples: (window as unknown as W).__btbLatency.samples, summary: (window as unknown as W).__btbLatency.summary() }));
  writeFileSync('docs/screenshots/m5.5/latency.json', JSON.stringify({ note: 'frames on a fixed 60 Hz frame clock; ms = frames × 16.7 on hardware that holds 60 fps', ...out }, null, 1) + '\n');
  console.log(out.summary.map((r) => `${r.kind.padEnd(13)} n=${r.n} frames p50 ${r.f50} p95 ${r.f95} → ${(r.f95 * 16.7).toFixed(0)} ms`).join('\n'));
  const kinds = out.summary.map((r) => r.kind);
  for (const k of ['snap', 'move', 'throwHold', 'throwRelease']) expect(kinds).toContain(k);
  for (const r of out.summary) expect(r.f95 * (1000 / 60), `${r.kind}: ${r.f95} frames`).toBeLessThan(100);
});
