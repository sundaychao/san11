import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  reporter: 'line',
  webServer: {
    command: 'npm.cmd run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
