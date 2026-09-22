import { defineConfig } from '@playwright/test';

// Browser tests drive the real app with keyboard input. No GPU here: Chromium
// renders WebGL through SwiftShader (correct pixels, slow frames).
export const chromiumLaunch = {
  executablePath: process.env.BTB_CHROMIUM ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 720 },
    launchOptions: chromiumLaunch,
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    port: 5174,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
