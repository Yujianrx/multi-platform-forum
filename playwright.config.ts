import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  globalTeardown: './tests/browser-teardown.ts',
  timeout: 60000,
  expect: { timeout: 15000 },
  webServer: {
    command: 'node tests/browser-server.mjs',
    url: 'http://127.0.0.1:3100/api/health',
    timeout: 60000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
        : {}),
    },
  },
  reporter: [['list'], ['html', { outputFolder: 'work/playwright-report', open: 'never' }]],
  outputDir: 'work/e2e-results',
});
