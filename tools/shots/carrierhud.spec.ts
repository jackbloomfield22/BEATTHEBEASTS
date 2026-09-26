import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The carrier's three move options (M6.5 #9) in the game: a scripted catch
// and run (src/game/clips.ts) in the Practice Field, a frame every 0.2 s
// while he has the ball, with the options he was offered, into
// tools/shots/out/hud. The run presses option 1 when a tackler closes, so
// one frame shows it lit.
//   BTB_HUD=1 BTB_PORT=5198 npx playwright test -c tools/shots/playwright.config.ts

type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown; phase: string; t: number; carrier: number; agents: { pos: { x: number; y: number }; down: boolean; mem: Record<string, unknown>; move: string | null; busy: number }[]; def: number[] } } | null; callClip(c: unknown): void; tickWith(f: unknown): void; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbClips(): Promise<{ id: string; script(s: unknown): Record<string, unknown> }[]>;
};

const W = 1280;
const H = 720;
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());
const CLIP = process.env.BTB_HUD_CLIP ?? 'completion-rac';

test.use({ viewport: { width: W, height: H } });
test(`carrier options · ${CLIP}`, async ({ page }) => {
  test.setTimeout(3_600_000);
  const dir = `tools/shots/out/hud/${CLIP}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=practice&nointro&quality=low&video=30&seed=1`);
  const pump = (pred: string) =>
    page.waitForFunction(
      (p) => {
        (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
        return new Function(`return (${p})`)() as boolean;
      },
      pred,
      { timeout: 300_000, polling: 250 },
    );
  await pump(`window.__btbPracticeUi?.getState().stage === 'call'`);
  await page.evaluate(async (id) => {
    const w = window as unknown as Win & { __hudScript?: (s: unknown) => unknown };
    const base = (await w.__btbClips()).find((x) => x.id === id)!;
    // The clip's run, but its move goes through option 1 (the likeliest) instead of the move's own key.
    const script = (s: Win['__btbPractice']['runner'] extends infer R ? (R extends { state: infer S } ? S : never) : never) => {
      const f = base.script(s);
      const pressed = !!(f.juke || f.stiffArm || f.spin);
      return { ...f, juke: false, stiffArm: false, spin: false, option: pressed ? 1 : 0 };
    };
    w.__hudScript = script as (s: unknown) => unknown;
    w.__btbPractice.callClip({ ...base, script });
  }, CLIP);
  await pump('window.__btbGameReady === true');
  await page.evaluate(() => void ((window as unknown as Win).__btbPractice.runner!.paused = true));
  const log: string[] = [];
  let n = 0;
  let caught = -1;
  for (let guard = 0; guard < 30 * 16; guard++) {
    const st = await page.evaluate(() => {
      const w = window as unknown as Win & { __hudScript: (s: unknown) => unknown };
      for (let k = 0; k < 2; k++) {
        const s = w.__btbPractice.runner!.state;
        if (s.result) w.__btbPractice.tick(1);
        else w.__btbPractice.tickWith(w.__hudScript(s));
      }
      const s = w.__btbPractice.runner!.state;
      const c = s.carrier >= 0 ? s.agents[s.carrier] : undefined;
      return { phase: s.phase, t: s.t, result: !!s.result, opts: (c?.mem.opts as string | undefined) ?? '', move: c && c.busy > 0 ? c.move : null };
    });
    if (st.phase === 'carrier' || guard % 10 === 0) await frame(page);
    if (st.phase === 'carrier' && caught < 0) caught = st.t;
    if (st.phase === 'carrier' && guard % 6 === 0) {
      const name = `${String(n++).padStart(3, '0')}.jpg`;
      await page.screenshot({ path: `${dir}/${name}`, type: 'jpeg', quality: 88 });
      log.push(`${name} t=${st.t.toFixed(2)} options=${st.opts} in=${st.move ?? '-'}`);
      writeFileSync(`${dir}/log.txt`, log.join('\n') + '\n');
    }
    if (st.result) break;
  }
});
