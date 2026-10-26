// @parity test/export-e2e
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { catchDownload, exportPath, importMeasurement, openApp, openRowMenu } from './app'

// Each case is imported, then exported as the spectrum image and the PDF report from both places the app offers
// them: the main window, with the import loaded, and the row's menu in Saved Measurements.
// The fixtures are Swift's, since Swift's exports are the expected ones.
const cases = [
  { name: 'guitar', fixture: 'dws-2024-umik-1-swift-mac-1784225155.guitartap' },
  { name: 'multi-tap', fixture: 'dws-2024-umik-1-3-tap-swift-mac-1785359425.guitartap' },
  { name: 'plate', fixture: 'plate-umik-1-swift-mac-1785359486.guitartap' },
  { name: 'brace', fixture: 'brace-umik-1-swift-mac-1785359411.guitartap' },
  { name: 'comparison', fixture: '5-guitar-comparison-1776708138.guitartap' },
  { name: 'large-comparison', fixture: '18-compare-1792944381.guitartap' },
]

for (const c of cases) {
  test(`${c.name}: export from the main window`, async ({ page }) => {
    await openApp(page)
    await importMeasurement(page, c.fixture)
    const out = exportPath((name) => test.info().outputPath(name), c.name, 'main')

    const png = await catchDownload(page, out, () => page.getByRole('button', { name: 'Export Spectrum' }).click())
    const pdf = await catchDownload(page, out, () => page.getByRole('button', { name: 'Export PDF' }).click())
    expect(png).toMatch(/\.png$/)
    expect(pdf).toMatch(/\.pdf$/)
  })

  test(`${c.name}: export from Saved Measurements`, async ({ page }) => {
    await openApp(page)
    await importMeasurement(page, c.fixture)
    const out = exportPath((name) => test.info().outputPath(name), c.name, 'saved')

    await openRowMenu(page)
    const png = await catchDownload(page, out, () => page.getByRole('menuitem', { name: 'Export Spectrum' }).click())
    await openRowMenu(page)
    const pdf = await catchDownload(page, out, () => page.getByRole('menuitem', { name: 'Export PDF Report' }).click())
    expect(png).toMatch(/\.png$/)
    expect(pdf).toMatch(/\.pdf$/)
  })
}

// The main window exports the measurement on screen as Saved Measurements exports it: the same image from both places.
for (const c of cases) {
  test(`${c.name}: the main window's image is Saved Measurements'`, async ({ page }) => {
    await openApp(page)
    await importMeasurement(page, c.fixture)
    const main = await catchDownload(page, exportPath((name) => test.info().outputPath(name), c.name, 'main'),
      () => page.getByRole('button', { name: 'Export Spectrum' }).click())
    await openRowMenu(page)
    const saved = await catchDownload(page, exportPath((name) => test.info().outputPath(name), c.name, 'saved'),
      () => page.getByRole('menuitem', { name: 'Export Spectrum' }).click())
    expect(readFileSync(saved).equals(readFileSync(main))).toBe(true)
  })
}

// A multi-tap measurement's exports are of the measurement: its image is the averaged spectrum whether the Taps view
// is on or off.
test('multi-tap: the Taps view does not change the exports', async ({ page }) => {
  await openApp(page)
  await importMeasurement(page, 'dws-2024-umik-1-3-tap-swift-mac-1785359425.guitartap')
  const out = (tag: string) => (name: string) => test.info().outputPath(`${tag}-${name}`)
  const tapsOff = await catchDownload(page, out('taps-off'), () => page.getByRole('button', { name: 'Export Spectrum' }).click())
  await page.getByRole('button', { name: 'Taps', exact: true }).click()
  await expect(page.getByText(/Tap comparison/)).toBeVisible()
  // A second Export Spectrum within 700 ms is taken for a double-click and ignored (App.tsx).
  await page.waitForTimeout(800)
  const tapsOn = await catchDownload(page, out('taps-on'), () => page.getByRole('button', { name: 'Export Spectrum' }).click())
  expect(readFileSync(tapsOn).equals(readFileSync(tapsOff))).toBe(true)
})
