// @parity test/export-menus
/**
 * Saved Measurements' library menu and Analysis Results' menu, against the shared case file export-menus.json: each
 * button's word and icon, and its items, words, order and icons — the same as Swift's and Python's. This edition's
 * items are those with a 'web' title, and a group left empty is not shown.
 *
 * Mirrors: GuitarTapTests/ExportMenusTests.swift · tests/test_export_menus.py
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { ANALYSIS_RESULTS_EXPORT_MENU, PANEL_EXPORT_MENU, type ExportMenu } from '../src/presentation/exportMenus'
import { expectedGroups, type MenuCase } from './menuCases'

interface MenuSpec {
  button: Record<string, string>
  mdi: string
  groups: MenuCase[][]
}
const DATA = JSON.parse(readFileSync(new URL('./fixtures/export-menus.json', import.meta.url), 'utf8')) as Record<
  'panel' | 'analysisResults',
  MenuSpec
>

describe('export menus — the shared cases (export-menus.json)', () => {
  it.each([
    ['panel', PANEL_EXPORT_MENU],
    ['analysisResults', ANALYSIS_RESULTS_EXPORT_MENU],
  ] as const)('%s', (key, menu: ExportMenu<string>) => {
    const spec = DATA[key]
    expect(menu.button).toBe(spec.button.web)
    expect(menu.mdi).toBe(spec.mdi)
    expect(menu.groups).toEqual(expectedGroups(spec.groups))
  })
})
