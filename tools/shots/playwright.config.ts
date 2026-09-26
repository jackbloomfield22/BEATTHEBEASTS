import { defineConfig } from '@playwright/test';
import { chromiumLaunch } from '../../playwright.config';

// Screenshot matrix: every front-end state × every lighting preset, into
// tools/shots/out/matrix. Look at them, compare to docs/reference, and write
// the critique in docs/PROGRESS.md. BTB_CONTACT=1 runs the Animation Lab
// contact sheets (contact.spec.ts) instead; BTB_PRACTICE=1 the Practice
// Field play-through (practice.spec.ts); BTB_VIDEO=1 the feel videos
// (video.spec.ts: scripted plays recorded from the broadcast camera);
// BTB_LOCKER=1 the locker room (locker.spec.ts: empty, half, full, stalls, moods);
// BTB_CATCH=1 the catch clips in the Animation Lab (catch.spec.ts), BTB_CATCHGAME=1
// the catch call in a scripted play (catchgame.spec.ts); BTB_CARRIER=1 the carrier
// clips in the Lab (carrier.spec.ts), BTB_CARRIERGAME=1 scripted carries (carriergame.spec.ts). BTB_PORT
// moves the dev server off 5174 (another checkout's server can hold it).
const PORT = Number(process.env.BTB_PORT ?? 5174);
export default defineConfig({
  testDir: '.',
  testMatch: process.env.BTB_CARRIERGAME ? 'carriergame.spec.ts' : process.env.BTB_CARRIER ? 'carrier.spec.ts' : process.env.BTB_CATCHGAME ? 'catchgame.spec.ts' : process.env.BTB_CATCH ? 'catch.spec.ts' : process.env.BTB_GAME ? 'game.spec.ts' : process.env.BTB_M6VIDEO ? 'm6video.spec.ts' : process.env.BTB_LOCKER ? 'locker.spec.ts' : process.env.BTB_CONTACT ? 'contact.spec.ts' : process.env.BTB_PRACTICE ? 'practice.spec.ts' : process.env.BTB_VIDEO ? 'video.spec.ts' : 'matrix.spec.ts',
  timeout: process.env.BTB_VIDEO || process.env.BTB_M6VIDEO ? 7_200_000 : 600_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1920, height: 1080 }, launchOptions: chromiumLaunch },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, cwd: '../..', port: PORT, reuseExistingServer: true, timeout: 60_000 },
});
