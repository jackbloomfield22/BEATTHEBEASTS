import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The ball carrier in the game (M6.5 #11): the scripted inside zone the
// player steers (src/game/clips.ts 'cut-run': pressing the hole, a hard
// planted cut across, a lighter one back up the field, the burst, a tackler
// closing), from the broadcast camera into tools/shots/out/carriergame.
// Frames are drawn every 3 ticks (1/20 s of game time, ?video=20) and saved
// every 6; log.txt says what the carrier is playing in each.
// 'hurdle' stages one: after the second cut a deep defender is laid on the
// turf in the carrier's path (capture only: the sim never blocks on a
// downed man, so this is how to see the render's hurdle).
//   BTB_CARRIERGAME=1 BTB_PORT=5198 npx playwright test -c tools/shots/playwright.config.ts

type Agent = { i: number; side: string; slot: string; pos: { x: number; y: number }; vel: { x: number; y: number }; down: boolean; burst: number };
type State = { result: unknown; phase: string; t: number; carrier: number; agents: Agent[]; def: number[]; events: { type: string; t: number; data?: Record<string, unknown> }[] };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: State } | null; callClip(c: unknown): void; tickWith(f: unknown): void; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbClips(): Promise<{ id: string; seed: number; script(s: unknown): Record<string, unknown> }[]>;
  __btbBodies?: { animator: { transition: { name: string; t: number } | null; overlayAction: { name: string } | null } }[];
  __carryScript?: (s: unknown) => unknown;
  __staged?: boolean;
};

const W = 960;
const H = 540;
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());

const CASES = [{ id: 'cut', stage: false }, { id: 'hurdle', stage: true }].filter((c) => !process.env.BTB_CARRY_CASE || process.env.BTB_CARRY_CASE === c.id);

test.use({ viewport: { width: W, height: H } });
for (const c of CASES) {
  test(`carrier in game · ${c.id}`, async ({ page }) => {
    test.setTimeout(3_600_000 * 2);
    // BTB_CARRY_VIEW=field: the field-level camera behind the carrier (F3) instead of the broadcast one.
    const field = process.env.BTB_CARRY_VIEW === 'field';
    const dir = `tools/shots/out/carriergame/${c.id}${field ? '-field' : ''}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
    await page.goto(`/?screen=practice&nointro&quality=low&video=20&seed=1`);
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
    // The Practice Field plays with its own difficulty, fatigue and chemistry, so the
    // Node seed (tools/sim/findcarry.ts) can play out differently here: pick the seed in
    // the page, without drawing, where he gets through both cuts and runs on longest.
    const pick = await page.evaluate(async () => {
      const w = window as unknown as Win;
      const base = (await w.__btbClips()).find((x) => x.id === 'cut-run')!;
      w.__carryScript = base.script;
      // Every try starts fresh: a big hit on one play would carry fatigue into the next (practice.ts report).
      const fresh = () => void ((w.__btbPractice as unknown as { fatigue: object }).fatigue = {});
      let best = { seed: base.seed, score: -1, note: '' };
      for (let seed = 1; seed <= 40; seed++) {
        fresh();
        w.__btbPractice.callClip({ ...base, seed });
        w.__btbPractice.runner!.paused = true;
        for (let k = 0; k < 60 * 12; k++) {
          const s = w.__btbPractice.runner!.state;
          if (s.result) break;
          w.__btbPractice.tickWith(base.script(s));
        }
        const s = w.__btbPractice.runner!.state;
        const cuts = s.events.filter((e) => e.type === 'move' && e.data?.move === 'cut');
        if (cuts.length < 2) continue;
        const score = s.t - cuts[1]!.t;
        if (score > best.score) best = { seed, score, note: `${cuts.map((e) => String(e.data?.deg)).join('/')} deg, ${score.toFixed(1)} s after the second cut` };
      }
      fresh();
      w.__btbPractice.callClip({ ...base, seed: best.seed });
      // Paused at once: frames drawn while the scene loads mustn't tick the play on their own.
      w.__btbPractice.runner!.paused = true;
      return best;
    });
    writeFileSync(`${dir}/seed.txt`, `seed ${pick.seed}: ${pick.note}\n`);
    await pump('window.__btbGameReady === true');
    if (field) await page.keyboard.press('F3');
    await page.evaluate(() => void ((window as unknown as Win).__btbPractice.runner!.paused = true));
    let n = 0;
    let handT = -1;
    let after = 0;
    const log: string[] = [];
    for (let guard = 0; guard < 20 * 12; guard++) {
      const st = await page.evaluate((stage) => {
        const w = window as unknown as Win;
        const cutsOf = (s: State) => s.events.filter((e) => e.type === 'move' && e.data?.move === 'cut');
        for (let k = 0; k < 3; k++) {
          const s = w.__btbPractice.runner!.state;
          if (s.result) w.__btbPractice.tick(1);
          else {
            const f = w.__carryScript!(s) as Record<string, unknown>;
            // Staged: after the first cut he keeps running across (no second cut to interrupt the hurdle).
            w.__btbPractice.tickWith(stage && cutsOf(s).length >= 1 ? { ...f, move: { x: 0, y: 1 } } : f);
          }
        }
        const s = w.__btbPractice.runner!.state;
        const cuts = cutsOf(s);
        // The staged hurdle: out of the first cut and its burst, the deepest defender lies 0.55 s ahead of the carrier.
        if (stage && !w.__staged && cuts.length >= 1 && s.t - cuts[0]!.t > 0.45 && s.carrier >= 0) {
          const c = s.agents[s.carrier]!;
          const d = s.def.map((i) => s.agents[i]!).sort((a, b) => b.pos.x - a.pos.x)[0]!;
          d.pos = { x: c.pos.x + c.vel.x * 0.55, y: c.pos.y + c.vel.y * 0.55 };
          d.vel = { x: 0, y: 0 };
          d.down = true;
          w.__staged = true;
        }
        const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
        const b = c ? w.__btbBodies?.[c.i] : undefined;
        const tr = b?.animator.transition;
        return {
          phase: s.phase,
          t: s.t,
          result: !!s.result,
          sp: c ? Math.hypot(c.vel.x, c.vel.y) : 0,
          burst: c ? c.burst : 0,
          clip: tr ? `${tr.name}@${tr.t.toFixed(2)}` : '-',
          ovl: b?.animator.overlayAction?.name ?? '-',
          // Where the carrier's feet are on screen (his HUD rides under him), for crops.
          hud: (document.querySelector('.carrier-hud') as HTMLElement | null)?.style.transform.replace(/translate\(|px|\)/g, '').replace(/, /, ',') ?? '',
          ev: s.events.filter((e) => e.type === 'move' && s.t - e.t < 0.05).map((e) => `${String(e.data?.move)}${e.data?.deg ? ` ${String(e.data.deg)}°` : ''}`).join(','),
        };
      }, c.stage);
      await frame(page);
      if (st.phase === 'carrier' && handT < 0) handT = st.t;
      if (handT >= 0 && guard % 2 === 0) {
        const name = `${String(n++).padStart(3, '0')}.jpg`;
        await page.screenshot({ path: `${dir}/${name}`, type: 'jpeg', quality: 85 });
        log.push(`${name} t=${st.t.toFixed(2)} ${st.phase} v=${st.sp.toFixed(1)} burst=${st.burst} clip=${st.clip} ovl=${st.ovl} at=${st.hud} ${st.ev}`);
        writeFileSync(`${dir}/log.txt`, log.join('\n') + '\n');
      } else if (st.ev) log.push(`   t=${st.t.toFixed(2)} ${st.ev}`);
      if (st.result && handT >= 0 && ++after > 8) break;
    }
    writeFileSync(`${dir}/log.txt`, log.join('\n') + '\n');
  });
}
