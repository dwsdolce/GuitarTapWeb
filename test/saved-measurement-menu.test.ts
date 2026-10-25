// @parity test/saved-measurement-menu
/**
 * A saved measurement's menu, against the shared case file saved-measurement-menu.json: the same items, words,
 * order and icons as Swift's and Python's. The Material Design icon is checked here; the SF Symbol in Swift. The
 * item only Swift's Mac edition has (macOSOnly) is not in this edition.
 *
 * Mirrors: GuitarTapTests/SavedMeasurementMenuTests.swift · tests/test_saved_measurement_menu.py
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { SAVED_MEASUREMENT_MENU_GROUPS, type SavedMeasurementMenuEntry } from '../src/presentation/savedMeasurementMenu'

interface Case {
  action: SavedMeasurementMenuEntry['action']
  title: string
  mdi: string
  macOSOnly?: boolean
}
const DATA = JSON.parse(readFileSync(new URL('./fixtures/saved-measurement-menu.json', import.meta.url), 'utf8')) as {
  groups: Case[][]
}

describe('saved measurement menu — the shared cases (saved-measurement-menu.json)', () => {
  it("a saved measurement's menu: its groups, items, words and icons", () => {
    const expected = DATA.groups.map((g) => g.filter((c) => !c.macOSOnly).map(({ action, title, mdi }) => ({ action, title, mdi })))
    expect(SAVED_MEASUREMENT_MENU_GROUPS).toEqual(expected)
  })
})
