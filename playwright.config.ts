import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser',
  outputDir: './.local/browser-results',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'https://hydrodb.test:18443',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'chromium-200-percent', use: { browserName: 'chromium' }, metadata: { zoom: 2 } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
})
