import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The catch call in the game (M6.5 #5): a scripted pass (src/game/clips.ts)
// replayed in the Practice Field with each call (RUN, SECURE, GO UP), frames
// from the broadcast camera around the catch into tools/shots/out/catchgame.
// In video mode (?video=30) every drawn frame is 1/30 s of game time, so the
// animation sees the same steps it would in play.
//   BTB_CATCHGAME=1 BTB_PORT=5197 npx playwright test -c tools/shots/playwright.config.ts

type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown; phase: string; t: number; ball: { mode: string; arrive: number } } } | null; callClip(c: unknown): void; tickWith(f: unknown): void; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbClips(): Promise<{ id: string; script(s: unknown): Record<string, unknown> }[]>;
};

const W = 960;
const H = 540;
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());

const CASES = [
  { clip: 'completion-rac', call: 'rac' },
  { clip: 'completion-rac', call: 'possession' },
  { clip: 'completion-rac', call: 'aggressive' },
  { clip: 'broken-tackle', call: 'rac' },
].filter((c) => !process.env.BTB_CATCH_CASE || process.env.BTB_CATCH_CASE === `${c.clip}-${c.call}`);

test.use({ viewport: { width: W, height: H } });
for (const c of CASES) {
  test(`catch in game · ${c.clip} · ${c.call}`, async ({ page }) => {
    // SwiftShader draws a frame in seconds here: allow an hour.
    test.setTimeout(3_600_000);
    const dir = `tools/shots/out/catchgame/${c.clip}-${c.call}`;
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
    await page.evaluate(
      async ({ id, call }) => {
        const w = window as unknown as Win & { __catchScript?: (s: unknown) => unknown };
        const base = (await w.__btbClips()).find((x) => x.id === id)!;
        // The same play with the other catch call.
        const script = (s: unknown) => {
          const f = base.script(s);
          return f.catchType ? { ...f, catchType: call } : f;
        };
        w.__catchScript = script;
        w.__btbPractice.callClip({ ...base, script });
      },
      { id: c.clip, call: c.call },
    );
    await pump('window.__btbGameReady === true');
    await page.evaluate(() => void ((window as unknown as Win).__btbPractice.runner!.paused = true));
    let n = 0;
    let caughtAt = -1;
    const log: string[] = [];
    for (let guard = 0; guard < 30 * 14; guard++) {
      const st = await page.evaluate(() => {
        const w = window as unknown as Win & { __catchScript: (s: unknown) => unknown };
        for (let k = 0; k < 2; k++) {
          const s = w.__btbPractice.runner!.state;
          if (s.result) w.__btbPractice.tick(1);
          else w.__btbPractice.tickWith(w.__catchScript(s));
        }
        const s = w.__btbPractice.runner!.state;
        return { phase: s.phase, t: s.t, left: s.ball.mode === 'air' ? s.ball.arrive - s.t : null, result: !!s.result };
      });
      // Draw every frame from the throw on (the catch is timed on them); before it, now and then.
      if (st.phase === 'air' || st.phase === 'carrier' || caughtAt >= 0 || guard % 8 === 0) await frame(page);
      if (st.phase === 'carrier' && caughtAt < 0) caughtAt = st.t;
      const near = (st.left !== null && st.left < 0.9) || (caughtAt >= 0 && st.t - caughtAt < 1.4);
      if (near && guard % 2 === 0) {
        const name = `${String(n++).padStart(3, '0')}.jpg`;
        await page.screenshot({ path: `${dir}/${name}`, type: 'jpeg', quality: 88 });
        log.push(`${name} t=${st.t.toFixed(2)} phase=${st.phase} left=${st.left?.toFixed(2) ?? '-'}`);
        writeFileSync(`${dir}/log.txt`, log.join('\n') + '\n');
      }
      if (caughtAt >= 0 && st.t - caughtAt >= 1.4) break;
      if (st.result && caughtAt < 0) break;
    }
    writeFileSync(`${dir}/log.txt`, log.join('\n') + '\n');
  });
}
