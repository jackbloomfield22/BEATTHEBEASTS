import { expect, test, type Page } from '@playwright/test';
import { noAutoReplay, trackErrors } from './helpers';

// M7, Playtest 1 #4, cut down after M7 to the deciding play: a game is
// kicked off; the Beasts' first drive (a touchdown with this seed) stages
// its scoring play and plays it in the stadium on the broadcast camera, then
// the result graphic (the score bug bumps, the BEASTS DRIVE lower third),
// and hands on to your drive by itself. The next drive, a punt, is the punt
// itself through the kick view (their unit kicking), skipped with Esc. With
// the setting on "Meanwhile card", the card shows instead.

type W = {
  __btbDraft: { getState(): { phase: string; finishWalkout(go: (s: string) => void): void } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi: { getState(): { stage: string; match: { beastsDrives: unknown[]; score: { beasts: number }; round: number; ot: number; cfg: { seed: number } } | null; meanwhile: { points: number } | null } };
  __btbMontage: {
    busy: boolean;
    active: boolean;
    player: { tick: number; snapTick: number } | null;
    staged: { kind: string; label: string } | null;
    kick: { kind: string; label: string; hang: number } | null;
    prepare(d: object, teams: unknown, seed: number, round: number, ot: number, info: object, onDone: () => void, onNone: () => void): void;
    skip(): void;
  };
  __btbMontageUi: { getState(): { open: boolean; shot: string | null } };
  __btbKickView: { active: boolean; kind: string; team: string; t: number; path: unknown[] | null };
  __btbSettings: { getState(): { set(f: (d: { gameplay: { beastsDrives: string } }) => void): void } };
  __btbGame: Record<string, unknown> & { mTeams: unknown };
};

const read = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as W;
    const g = w.__btbGameUi.getState();
    const m = w.__btbMontageUi.getState();
    return { stage: g.stage, drives: g.match?.beastsDrives.length ?? 0, open: m.open, shot: m.shot, kind: w.__btbMontage.staged?.kind ?? w.__btbMontage.kick?.kind ?? null, tick: w.__btbMontage.player?.tick ?? -1, snap: w.__btbMontage.player?.snapTick ?? -1 };
  });

test("the Beasts' drive shows its deciding play, then the result, and hands on; a punt is the punt; Esc skips", async ({ page }) => {
  test.setTimeout(1_500_000);
  const errors = trackErrors(page);
  // A full draft (seed 5: the Beasts' opening drive is a touchdown), straight to the game (the walk-out has its own tests).
  await page.goto('/?screen=draft&nointro&quality=low&seed=5&fill=9');
  await page.waitForFunction(() => (window as unknown as W).__btbDraft?.getState().phase === 'complete', null, { timeout: 600_000 });
  await noAutoReplay(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__btbSettings.getState().set((d) => void (d.gameplay.beastsDrives = 'montage'));
    w.__btbDraft.getState().finishWalkout(w.__btbApp.getState().go);
  });
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game', null, { timeout: 300_000 });
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage === 'pregame', null, { timeout: 300_000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter'); // kick off: the Beasts have the ball
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage === 'meanwhile', null, { timeout: 60_000 });
  expect((await read(page)).open).toBe(true);
  // Staged (a few frames under the bumper), then straight to the play: no establishing shot.
  await page.waitForFunction(() => (window as unknown as W).__btbMontage.active, null, { timeout: 300_000 });
  const mid = await read(page);
  expect(mid.shot).toBe('play');
  expect(mid.kind).toBe('td');
  expect(mid.stage).toBe('meanwhile');
  expect(mid.drives).toBe(0); // not scored until it's over
  // It cuts in just before the snap (0.3 s), never a long look at the formation.
  expect(mid.tick).toBeGreaterThanOrEqual(mid.snap - 18);
  await expect(page.locator('.mt-bug')).toContainText('Beasts ball');
  await expect(page.locator('.mt-skip')).toContainText('Skip');
  // The result: the lower third and the score bug's bump, over the same camera; no reaction or board shot.
  await page.waitForFunction(() => (window as unknown as W).__btbMontageUi.getState().shot === 'result', null, { timeout: 600_000 });
  await expect(page.locator('.mt-lower')).toContainText('Touchdown');
  await expect(page.locator('.sb-team.bst .sb-pts')).not.toHaveText('0');
  await page.screenshot({ path: 'test-results/montage-result.png' });
  // Then on to your drive by itself, the drive scored.
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage !== 'meanwhile', null, { timeout: 600_000 });
  const after = await read(page);
  expect(after.open).toBe(false);
  expect(after.drives).toBe(1);

  // A punt (the resolver decides a real drive; here one is handed to the montage directly, for the test only): the punt itself.
  await page.evaluate(() => {
    const w = window as unknown as W;
    const m = w.__btbGameUi.getState().match!;
    const d = { result: 'Punt', points: 0, plays: 5, yards: 18, top: '2:40', nextStart: 18, start: 25 };
    const info = { drive: d, play: null, before: { user: 0, beasts: 7 }, after: { user: 0, beasts: 7 }, clock: 'Q1', ot: 0 };
    (window as unknown as { __puntDone: boolean }).__puntDone = false;
    w.__btbMontage.prepare(d, w.__btbGame.mTeams, m.cfg.seed, m.round + 1, m.ot, info, () => void ((window as unknown as { __puntDone: boolean }).__puntDone = true), () => undefined);
  });
  await page.waitForFunction(() => (window as unknown as W).__btbMontage.active, null, { timeout: 120_000 });
  const punt = await page.evaluate(() => {
    const w = window as unknown as W;
    return { kick: w.__btbMontage.kick, view: { active: w.__btbKickView.active, kind: w.__btbKickView.kind, team: w.__btbKickView.team, path: !!w.__btbKickView.path } };
  });
  expect(punt.kick?.kind).toBe('punt');
  expect(punt.view).toEqual({ active: true, kind: 'PUNT', team: 'bst', path: true });
  // The kick view runs on (the punter, the flight); Esc (Start) skips it at once and puts the kick view away (Enter is the play call's here: your drive is up).
  await page.waitForFunction(() => (window as unknown as W).__btbKickView.t > 1.6, null, { timeout: 300_000 });
  await page.screenshot({ path: 'test-results/montage-punt.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as unknown as { __puntDone: boolean }).__puntDone, null, { timeout: 60_000 });
  expect(await page.evaluate(() => [(window as unknown as W).__btbMontage.active, (window as unknown as W).__btbKickView.active, (window as unknown as W).__btbKickView.team])).toEqual([false, false, 'con']);

  // The setting's other choice: the Meanwhile card (the next Beasts possession is called up straight away here, for the test only).
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__btbSettings.getState().set((d) => void (d.gameplay.beastsDrives = 'card'));
    (w.__btbGame['nextBeasts'] as () => void).call(w.__btbGame);
  });
  await expect(page.locator('.meanwhile')).toBeVisible();
  expect((await read(page)).open).toBe(false);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage !== 'meanwhile', null, { timeout: 60_000 });
  expect((await read(page)).drives).toBe(2);
  expect(errors).toEqual([]);
});
