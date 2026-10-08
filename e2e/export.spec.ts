import { expect, test } from '@playwright/test'
import { catchDownload, importMeasurement, openApp, openRowMenu } from './app'

// Each case is imported, then exported as the spectrum image and the PDF report from both places the app offers
// them: the main window, with the import loaded, and the row's menu in Saved Measurements.
// The fixtures are Swift's, since Swift's exports are the expected ones.
const cases = [
  { name: 'guitar', fixture: 'dws-2024-umik-1-swift-mac-1784225155.guitartap' },
  { name: 'multi-tap', fixture: 'dws-2024-umik-1-3-tap-swift-mac-1785359425.guitartap' },
  { name: 'plate', fixture: 'plate-umik-1-swift-mac-1785359486.guitartap' },
  { name: 'brace', fixture: 'brace-umik-1-swift-mac-1785359411.guitartap' },
  { name: 'comparison', fixture: '5-guitar-comparison-1776708138.guitartap' },
]

for (const c of cases) {
  test(`${c.name}: export from the main window`, async ({ page }) => {
    await openApp(page)
    await importMeasurement(page, c.fixture)
    const out = (name: string) => test.info().outputPath(`main-${name}`)

    const png = await catchDownload(page, out, () => page.getByRole('button', { name: 'Export Spectrum' }).click())
    const pdf = await catchDownload(page, out, () => page.getByRole('button', { name: 'Export PDF' }).click())
    expect(png).toMatch(/\.png$/)
    expect(pdf).toMatch(/\.pdf$/)
  })

  test(`${c.name}: export from Saved Measurements`, async ({ page }) => {
    await openApp(page)
    await importMeasurement(page, c.fixture)
    const out = (name: string) => test.info().outputPath(`saved-${name}`)

    await openRowMenu(page)
    const png = await catchDownload(page, out, () => page.getByRole('menuitem', { name: 'Export Spectrum' }).click())
    await openRowMenu(page)
    const pdf = await catchDownload(page, out, () => page.getByRole('menuitem', { name: 'Export PDF Report' }).click())
    expect(png).toMatch(/\.png$/)
    expect(pdf).toMatch(/\.pdf$/)
  })
}
