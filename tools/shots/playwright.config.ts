import { defineConfig } from '@playwright/test';
import { chromiumLaunch } from '../../playwright.config';

// Screenshot matrix: every front-end state × every lighting preset, into
// tools/shots/out/matrix. Look at them, compare to docs/reference, and write
// the critique in docs/PROGRESS.md.
export default defineConfig({
  testDir: '.',
  testMatch: 'matrix.spec.ts',
  timeout: 600_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1920, height: 1080 }, launchOptions: chromiumLaunch },
  webServer: { command: 'npx vite --port 5174 --strictPort', cwd: '../..', port: 5174, reuseExistingServer: true, timeout: 60_000 },
});
