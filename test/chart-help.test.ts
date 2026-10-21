// @parity test/chart-help
/**
 * The chart's help against the shared case file chart-help.json: the same lines, words and groups as Swift's and
 * Python's, and on each device the lines that work there.
 *
 * Mirrors: GuitarTapTests/ChartHelpTests.swift · tests/test_chart_help.py
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CHART_HELP_GROUPS, CHART_HELP_TITLE, shownHelp, type ChartHelpLine } from '../src/presentation/chartHelp'

interface Line { gesture: string; otherKeys?: string; effect: string; needs: string[] }
interface Device { id: string; pointer: boolean; keyboard: boolean; pinch: boolean; appleKeys: boolean; shows: string[][] }
const DATA = JSON.parse(readFileSync(new URL('./fixtures/chart-help.json', import.meta.url), 'utf8')) as {
  title: string
  groups: (Line & { id: string })[][]
  devices: Device[]
}

describe('chart help — the shared cases (chart-help.json)', () => {
  it('its lines, words and groups', () => {
    expect(CHART_HELP_TITLE).toBe(DATA.title)
    const expected = DATA.groups.map((g) =>
      g.map((c) => {
        const line: ChartHelpLine = { gesture: c.gesture, effect: c.effect, needs: c.needs as ChartHelpLine['needs'] }
        if (c.otherKeys) line.otherKeys = c.otherKeys
        return line
      }),
    )
    expect(CHART_HELP_GROUPS).toEqual(expected)
  })
  it.each(DATA.devices.map((d) => [d.id, d] as const))('%s: the lines shown', (_id, d) => {
    expect(shownHelp(d).map((g) => g.map(([gesture]) => gesture))).toEqual(d.shows)
  })
})
