import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive the built app in a browser, as a user does. `npm run test:e2e` builds first, so the tests
// never run against a stale `dist/`.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  // One browser at a time: each test imports into the app's library, which lives in the browser profile.
  workers: 1,
  fullyParallel: false,

  // `vite preview` serves `dist/` the way the deployed site is served.
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 60_000,
  },

  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173',
        viewport: { width: 1280, height: 900 },
        // The service worker would serve a cached build; the tests must see the one just built.
        serviceWorkers: 'block',
        acceptDownloads: true,
      },
    },
  ],
})
