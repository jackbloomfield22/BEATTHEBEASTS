import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// M6.6 stills (controls, prompts, kits, camera, heads) into
// tools/shots/out/m66, copied to docs/screenshots/m6.6 when kept:
//   pad: the play call, pre-snap, the pocket, the catch call and the carrier's
//        options at the catch with the prompts held on the gamepad (?pad);
//   run: the carrier's options at a designed run's handoff (keyboard);
//   breakaway: the camera easing out on a deep catch and run;
//   lineup: both kits on the field at field level, heads now and ?oldheads.
// Software GL renders a frame in seconds, so the captures are few.
//   BTB_M66=1 BTB_PORT=5198 npx playwright test -c tools/shots/playwright.config.ts
//   (BTB_M66_CASE=pad|run|breakaway|lineup for one)

type State = { result: unknown; phase: string; t: number; snapT: number; carrier: number; agents: { mem: Record<string, unknown> }[] };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: State } | null; callClip(c: unknown): void; tickWith(f: unknown): void; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbClips(): Promise<{ id: string; script(s: unknown): Record<string, unknown> }[]>;
  __m66Script?: (s: unknown) => unknown;
};

const W = 1280;
const H = 720;
const OUT = 'tools/shots/out/m66';
const only = process.env.BTB_M66_CASE;
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());

test.use({ viewport: { width: W, height: H } });

async function open(page: Page, pad: boolean) {
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=practice&nointro&quality=low&video=30&seed=1${pad ? '&pad' : ''}`);
  const pump = (pred: string) =>
    page.waitForFunction(
      (p) => {
        (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
        return new Function(`return (${p})`)() as boolean;
      },
      pred,
      { timeout: 600_000, polling: 250 },
    );
  await pump(`window.__btbPracticeUi?.getState().stage === 'call'`);
  return pump;
}

/** Load a scripted clip and wait for the bodies. */
async function clip(page: Page, pump: (p: string) => Promise<unknown>, id: string) {
  await page.evaluate(async (cid) => {
    const w = window as unknown as Win;
    const base = (await w.__btbClips()).find((x) => x.id === cid)!;
    w.__m66Script = base.script as (s: unknown) => unknown;
    w.__btbPractice.callClip(base);
  }, id);
  await pump('window.__btbGameReady === true');
  await page.evaluate(() => void ((window as unknown as Win).__btbPractice.runner!.paused = true));
}

/** Step the clip n ticks (drawing a frame every `draw` ticks so the camera and the bodies move as in play). */
async function step(page: Page, n: number, draw = 2): Promise<{ phase: string; t: number; since: number; opts: string; result: boolean }> {
  let st = { phase: '', t: 0, since: 0, opts: '', result: false };
  for (let k = 0; k < n; k += draw) {
    st = await page.evaluate((m) => {
      const w = window as unknown as Win;
      for (let j = 0; j < m; j++) {
        const s = w.__btbPractice.runner!.state;
        if (s.result) w.__btbPractice.tick(1);
        else w.__btbPractice.tickWith(w.__m66Script!(s));
      }
      const s = w.__btbPractice.runner!.state;
      const c = s.carrier >= 0 ? s.agents[s.carrier] : undefined;
      return { phase: s.phase, t: s.t, since: s.t - s.snapT, opts: (c?.mem.opts as string | undefined) ?? '(not set)', result: !!s.result };
    }, Math.min(draw, n - k));
    await frame(page);
  }
  return st;
}

async function until(page: Page, pred: (st: Awaited<ReturnType<typeof step>>) => boolean, max = 600) {
  for (let k = 0; k < max; k++) {
    const st = await step(page, 1, 1);
    if (pred(st)) return st;
  }
  throw new Error('never got there');
}

const shot = async (page: Page, name: string, log: string[], note = '') => {
  await frame(page);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 90 });
  log.push(`${name}.jpg ${note}`);
  writeFileSync(`${OUT}/log-${name.split('-')[0]}.txt`, log.join('\n') + '\n');
};

if (!only || only === 'pad')
  test('m66 · pad prompts: play call, pre-snap, pocket, catch call, carrier at the catch', async ({ page }) => {
    test.setTimeout(3_600_000 * 2);
    mkdirSync(OUT, { recursive: true });
    const log: string[] = [];
    const pump = await open(page, true);
    await shot(page, 'pad-call', log, 'play call, prompts on the pad');
    await clip(page, pump, 'completion-rac');
    await shot(page, 'pad-presnap', log, 'pre-snap: both kits, pad prompts');
    let st = await step(page, 40, 4);
    await shot(page, 'pad-pocket', log, `pocket t=${st.since.toFixed(2)}`);
    await until(page, (s) => s.phase === 'air');
    st = await step(page, 8, 4);
    await shot(page, 'pad-catchcall', log, `ball in the air t=${st.since.toFixed(2)}`);
    st = await until(page, (s) => s.phase === 'carrier');
    await shot(page, 'pad-carrier-catch', log, `the catch tick t=${st.since.toFixed(2)} options=${st.opts}`);
    st = await step(page, 12, 4);
    await shot(page, 'pad-carrier-0.2s', log, `t=${st.since.toFixed(2)} options=${st.opts}`);
  });

if (!only || only === 'run')
  test('m66 · carrier options at the handoff (keyboard)', async ({ page }) => {
    test.setTimeout(3_600_000 * 2);
    mkdirSync(OUT, { recursive: true });
    const log: string[] = [];
    const pump = await open(page, false);
    await clip(page, pump, 'cut-run');
    await until(page, (s) => s.phase === 'carrier');
    let st = await step(page, 2, 2);
    await shot(page, 'run-handoff', log, `handoff +2 ticks t=${st.since.toFixed(2)} sim options=${st.opts}`);
    st = await until(page, (s) => s.opts !== '(not set)');
    await shot(page, 'run-live', log, `options held by the sim t=${st.since.toFixed(2)} options=${st.opts}`);
  });

if (!only || only === 'breakaway')
  test('m66 · breakaway camera', async ({ page }) => {
    test.setTimeout(3_600_000 * 2);
    mkdirSync(OUT, { recursive: true });
    const log: string[] = [];
    const pump = await open(page, false);
    await clip(page, pump, process.env.BTB_M66_BREAK ?? 'go');
    let st = await until(page, (s) => s.phase === 'carrier', 900);
    await shot(page, 'breakaway-0', log, `catch t=${st.since.toFixed(2)}`);
    for (let k = 1; k <= 5 && !st.result; k++) {
      st = await step(page, 24, 3);
      await shot(page, `breakaway-${k}`, log, `+${(k * 0.4).toFixed(1)} s t=${st.since.toFixed(2)} ${st.phase}`);
    }
  });

if (!only || only === 'lab')
  for (const old of [false, true])
    test(`m66 · every body type, front on${old ? ' (old heads)' : ''}`, async ({ page }) => {
      test.setTimeout(1_800_000);
      mkdirSync(OUT, { recursive: true });
      await page.goto(`/${old ? '?oldheads' : ''}#/dev/anim?mode=lineup&speed=0&lod=0&kit=whiteLime&t=0.5&cam=0,1.3,13,0,1.15,0`);
      await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 600_000 });
      await page.waitForTimeout(6000);
      await page.locator('.lab-view').screenshot({ path: `${OUT}/lab-${old ? 'oldheads' : 'heads'}.jpg`, type: 'jpeg', quality: 90 });
    });

if (!only || only === 'lineup')
  for (const old of [false, true])
    test(`m66 · lineup at field level${old ? ' (old heads)' : ''}`, async ({ page }) => {
      test.setTimeout(1_800_000);
      mkdirSync(OUT, { recursive: true });
      await page.goto(`/?screen=main&shot=menu&t=0&lineup&noui&cam=-7,1.2,-13.7,0,0.6,-13.7,40&lighting=golden&quality=low${old ? '&oldheads' : ''}`);
      await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 600_000 });
      await page.addStyleTag({ content: '.ui-root{display:none!important}' });
      await page.waitForFunction(() => (window as unknown as { __btbLineupReady?: boolean }).__btbLineupReady === true, null, { timeout: 600_000 });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${OUT}/lineup-${old ? 'oldheads' : 'heads'}.jpg`, type: 'jpeg', quality: 90 });
    });
