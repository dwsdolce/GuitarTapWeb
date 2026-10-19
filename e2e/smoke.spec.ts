// @parity none — the web build's start-up check (the page loads, with its title); the natives' builds start
// in their export end-to-end tests.
import { expect, test } from '@playwright/test'

// The app starts in a browser with no microphone and shows its main window.
test('the app starts', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/^Guitar Tap /)
})
