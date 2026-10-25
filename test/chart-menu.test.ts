// @parity test/chart-menu
/**
 * The chart's menu and a peak label's, against the shared case file chart-menu.json: the same items, words, order
 * and icons as Swift's and Python's. The Material Design icon is checked here; the SF Symbol in Swift.
 *
 * Mirrors: GuitarTapTests/ChartMenuTests.swift · tests/test_chart_menu.py
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CHART_MENU_GROUPS, COMPARISON_MENU_GROUPS, LABEL_MENU, type ChartMenuEntry } from '../src/presentation/chartMenu'

interface Case {
  action: string
  title: string
  mdi: string
}
const DATA = JSON.parse(readFileSync(new URL('./fixtures/chart-menu.json', import.meta.url), 'utf8')) as {
  groups: Case[][]
  comparisonGroups: Case[][]
  labelMenu: Case[]
}
const entries = (cases: Case[]) => cases.map((c) => ({ action: c.action, title: c.title, mdi: c.mdi }) as ChartMenuEntry)

describe('chart menu — the shared cases (chart-menu.json)', () => {
  it('the chart menu: its groups, items, words and icons', () => {
    expect(CHART_MENU_GROUPS).toEqual(DATA.groups.map(entries))
  })
  it("a comparison measurement's chart menu", () => {
    expect(COMPARISON_MENU_GROUPS).toEqual(DATA.comparisonGroups.map(entries))
  })
  it("a peak label's menu", () => {
    expect(LABEL_MENU).toEqual(entries(DATA.labelMenu))
  })
})
