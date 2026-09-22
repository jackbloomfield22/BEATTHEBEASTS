// Quick capture: node --experimental-strip-types tools/shots/capture.ts <url-query> <out.png> [waitMs] [w] [h]
// Uses headless Chromium with SwiftShader (no GPU here): correct pixels, slow frames.
import { chromium } from '@playwright/test';

const [query = '', out = 'tools/shots/out/shot.png', waitMs = '6000', w = '1920', h = '1080'] = process.argv.slice(2);
const base = process.env.BTB_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch({
  executablePath: process.env.BTB_CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + query, { waitUntil: 'load' });
await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 180000 }).catch(() => console.log('ready flag timeout'));
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
