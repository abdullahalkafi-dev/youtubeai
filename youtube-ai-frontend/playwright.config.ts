import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3017', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev --hostname 127.0.0.1 --port 3017', url: 'http://127.0.0.1:3017/login', reuseExistingServer: !process.env.CI, timeout: 120000 },
})
