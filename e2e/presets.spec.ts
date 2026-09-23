import { expect, test, type Page } from '@playwright/test';
import { expectStageAlive, trackErrors, waitFrames, waitReady } from './helpers';

// Owner's M3 report: switching the graphics preset to Medium in Settings left
// visual glitches (the shadow rig's materials kept the old rig's cascades).
// Every preset must apply cleanly at runtime, in both directions: the scene
// after a switch matches the scene loaded fresh at that preset.

type Q = 'low' | 'medium' | 'high' | 'ultra';
/** All 12 directed transitions between the four presets, as one walk. */
const WALK: Q[] = ['low', 'medium', 'high', 'ultra', 'low', 'high', 'medium', 'ultra', 'medium', 'low', 'ultra', 'high', 'low'];
const CASCADES: Record<Q, number> = { low: 2, medium: 2, high: 4, ultra: 4 };

interface SceneState {
  csmLights: number;
  sunVisible: boolean;
  csmMaterials: number;
  staleMaterials: number;
  thumb: number[];
}

/** Structural shadow state plus a 32×18 thumbnail of the frame. */
async function sceneState(page: Page): Promise<SceneState> {
  await waitFrames(page, 4);
  return page.evaluate(() => {
    type O = { isDirectionalLight?: boolean; castShadow: boolean; visible: boolean; name: string; material?: unknown; traverse(f: (o: O) => void): void };
    type M = { defines?: Record<string, unknown> };
    const w = window as unknown as { __btbScene: O; __btbGl: { domElement: HTMLCanvasElement } };
    let csmLights = 0;
    let sunVisible = false;
    const mats = new Set<M>();
    w.__btbScene.traverse((o) => {
      if (o.isDirectionalLight && o.name === 'sun') sunVisible = o.visible;
      else if (o.isDirectionalLight && o.castShadow && o.visible) csmLights++;
      const m = o.material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) mats.add(x as M);
    });
    const csm = [...mats].filter((m) => m.defines && 'USE_CSM' in m.defines);
    const cascades = csmLights;
    const stale = csm.filter((m) => Number(m.defines!.CSM_CASCADES) !== cascades).length;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 18;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(w.__btbGl.domElement, 0, 0, 32, 18);
    const d = ctx.getImageData(0, 0, 32, 18).data;
    const thumb: number[] = [];
    for (let i = 0; i < d.length; i += 4) thumb.push(d[i]!, d[i + 1]!, d[i + 2]!);
    return { csmLights, sunVisible, csmMaterials: csm.length, staleMaterials: stale, thumb };
  });
}

const meanDiff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;

function expectShadowRig(s: SceneState, q: Q) {
  expect(s.csmLights, `${q}: cascade lights`).toBe(CASCADES[q]);
  expect(s.sunVisible, `${q}: plain sun hidden while the rig is active`).toBe(false);
  expect(s.csmMaterials, `${q}: patched materials`).toBeGreaterThan(5);
  expect(s.staleMaterials, `${q}: materials with another rig's cascade count`).toBe(0);
}

// Fixed camera and clock (?shot, ?t) so fresh loads and switched scenes compare.
const URL = '/?screen=main&shot=menu&t=0&nointro';

test('every preset switch, both directions, matches a fresh load', async ({ browser }) => {
  test.setTimeout(1_500_000);
  // References: each preset loaded fresh.
  const ref = {} as Record<Q, SceneState>;
  for (const q of ['low', 'medium', 'high', 'ultra'] as Q[]) {
    const p = await browser.newPage();
    const errors = trackErrors(p);
    await p.goto(`${URL}&quality=${q}`);
    await waitReady(p);
    ref[q] = await sceneState(p);
    expectShadowRig(ref[q], q);
    expect(errors).toEqual([]);
    await p.close();
  }
  // Two fresh loads of one preset differ only by animation; switched scenes
  // must stay within a margin of that.
  const page = await browser.newPage();
  const errors = trackErrors(page);
  await page.goto(`${URL}&quality=low`);
  await waitReady(page);
  const noise = meanDiff((await sceneState(page)).thumb, ref.low.thumb);
  const tolerance = Math.max(3, noise * 2.5);
  console.log(`fresh-load noise ${noise.toFixed(2)}, tolerance ${tolerance.toFixed(2)}`);

  for (let i = 1; i < WALK.length; i++) {
    const [from, to] = [WALK[i - 1]!, WALK[i]!];
    await page.evaluate((q) => (window as unknown as { __btbSettings: { getState(): { applyPreset(q: string): void } } }).__btbSettings.getState().applyPreset(q), to);
    await expectStageAlive(page);
    const s = await sceneState(page);
    expectShadowRig(s, to);
    const d = meanDiff(s.thumb, ref[to].thumb);
    console.log(`${from} -> ${to}: diff ${d.toFixed(2)}`);
    expect(d, `${from} -> ${to} differs from a fresh ${to} load`).toBeLessThan(tolerance);
  }
  expect(errors).toEqual([]);
});

test('choosing Medium in Settings applies cleanly (the reported path)', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = trackErrors(page);
  await page.goto('/?screen=settings&quality=high&nointro');
  await waitReady(page);
  await page.keyboard.press('KeyE'); // Graphics tab
  await expect(page.locator('.tab.is-active')).toHaveText('Graphics');
  await expect(page.locator('.setting-row.is-focused .setting-label')).toHaveText('Quality preset');
  await page.keyboard.press('ArrowLeft'); // High -> Medium
  await expect(page.locator('.setting-row.is-focused')).toContainText('Medium');
  await expectStageAlive(page);
  expectShadowRig(await sceneState(page), 'medium');
  await page.keyboard.press('ArrowRight'); // and back to High
  await expect(page.locator('.setting-row.is-focused')).toContainText('High');
  await expectStageAlive(page);
  expectShadowRig(await sceneState(page), 'high');
  expect(errors).toEqual([]);
});
