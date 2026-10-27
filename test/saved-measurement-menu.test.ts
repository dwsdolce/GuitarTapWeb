// @parity test/saved-measurement-menu
/**
 * A saved measurement's menu, against the shared case file saved-measurement-menu.json: the same items, words,
 * order and icons as Swift's and Python's. The Material Design icon is checked here; the SF Symbol in Swift. This
 * edition's items are those with a 'web' title (Swift's Share items have none), and a group left empty is not shown.
 *
 * Mirrors: GuitarTapTests/SavedMeasurementMenuTests.swift · tests/test_saved_measurement_menu.py
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { SAVED_MEASUREMENT_MENU_GROUPS } from '../src/presentation/savedMeasurementMenu'
import { expectedGroups, type MenuCase } from './menuCases'

const DATA = JSON.parse(readFileSync(new URL('./fixtures/saved-measurement-menu.json', import.meta.url), 'utf8')) as {
  groups: MenuCase[][]
}

describe('saved measurement menu — the shared cases (saved-measurement-menu.json)', () => {
  it("a saved measurement's menu: its groups, items, words and icons", () => {
    expect(SAVED_MEASUREMENT_MENU_GROUPS).toEqual(expectedGroups(DATA.groups))
  })
})
