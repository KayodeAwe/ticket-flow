import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

/**
 * End-to-end tests run against the real Compose stack — the React build behind nginx, the
 * Nest API, the dispatcher, Mailpit, and a MongoDB replica set. Not a mocked backend: the
 * point of these tests is what unit tests structurally cannot see, such as the dispatcher
 * actually delivering an email that the gate then accepts exactly once.
 *
 * Bring the stack up first:  docker compose up -d --build --wait
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
