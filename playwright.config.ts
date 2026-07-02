import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'pnpm --filter @petshop/api start',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      env: { PETSHOP_DB: 'data/e2e.db' },
    },
    {
      command: 'pnpm --filter @petshop/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
