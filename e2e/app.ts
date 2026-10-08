import { expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/** A file in the unit tests' fixtures. */
export const fixture = (name: string) => fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url))

/** Open the app as the tests use it: no save picker, so a save is a download the test catches, and no microphone,
 *  so the audio engine's error is dismissed as a user would. */
export async function openApp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined })
  })
  await page.goto('/')
  const engineError = page.getByRole('alertdialog', { name: 'Audio Engine Error' })
  await engineError.getByRole('button', { name: 'OK' }).click()
  await expect(engineError).toBeHidden()
}

/** Import a `.guitartap` file through Saved Measurements and close the panel. */
export async function importMeasurement(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Measurements' }).click()
  const panel = page.getByRole('dialog', { name: 'Saved Measurements' })
  await panel.locator('input[type="file"]').setInputFiles(fixture(name))
  const imported = page.getByRole('alertdialog', { name: 'Import Successful' })
  await imported.getByRole('button', { name: 'OK' }).click()
  if (await panel.isVisible()) await panel.getByRole('button', { name: 'Done' }).click()
}

/** Click `trigger`, catch the file the app saves, and keep it in the test's output folder; returns its path. */
export async function catchDownload(page: Page, outputPath: (name: string) => string,
  trigger: () => Promise<void>): Promise<string> {
  const download = page.waitForEvent('download')
  await trigger()
  const file = await download
  const path = outputPath(file.suggestedFilename())
  await file.saveAs(path)
  return path
}

/** Open the only row's actions menu in Saved Measurements, opening the panel first when it is closed (it stays open
 *  after an export from the menu). */
export async function openRowMenu(page: Page): Promise<void> {
  const panel = page.getByRole('dialog', { name: 'Saved Measurements' })
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Measurements' }).click()
  await panel.getByRole('button', { name: 'Actions' }).click()
}
