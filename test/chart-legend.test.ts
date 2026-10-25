// @parity test/chart-legend
/**
 * The chart legend's lines against the shared case file chart-legend.json: the same entries on the same lines as
 * Swift's and Python's for the same widths.
 *
 * Mirrors: GuitarTapTests/ChartLegendTests.swift · tests/test_chart_legend.py
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { legendLines } from '../src/presentation/chartLegend'

type Row = [string, number[], number, number, number[][]]
const DATA = JSON.parse(readFileSync(new URL('./fixtures/chart-legend.json', import.meta.url), 'utf8')) as { lines: Row[] }

describe('chart legend — the shared cases (chart-legend.json)', () => {
  for (const [id, widths, width, spacing, expected] of DATA.lines) {
    it(`${id}: its lines`, () => {
      expect(legendLines(widths, width, spacing)).toEqual(expected)
    })
  }
})
