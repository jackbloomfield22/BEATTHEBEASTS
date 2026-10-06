import { defineConfig } from '@playwright/test';

// Browser tests drive the real app with keyboard input. No GPU here: Chromium
// renders WebGL through SwiftShader (correct pixels, slow frames).
export const chromiumLaunch = {
  executablePath: process.env.BTB_CHROMIUM ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

// BTB_PORT moves the dev server off 5174 (another checkout's server can hold it, and
// reuseExistingServer would then test that checkout's code).
const PORT = Number(process.env.BTB_PORT ?? 5174);

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    launchOptions: chromiumLaunch,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
