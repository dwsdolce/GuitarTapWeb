// @parity test/axis-ticks
//
// The chart's axis ticks — its grid lines — against the shared case file `axis-ticks.json`: the frequency ticks and
// their labels (the same on screen and in the export), and the magnitude tick spacing. The same cases the Swift
// and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatTickLabels, generateTicks, magnitudeStride } from '../src/presentation/axisTicks'

const DATA = JSON.parse(readFileSync('test/fixtures/axis-ticks.json', 'utf8')) as {
  frequency: [[number, number], number[], string[]][]
  magnitude: [[number, number], number][]
}

describe('axis-ticks — shared cases', () => {
  for (const [[lo, hi], ticks, expected] of DATA.frequency) {
    it(`frequency ${lo}–${hi} Hz`, () => {
      const got = generateTicks(lo, hi, 8)
      expect(got.length).toBe(ticks.length)
      got.forEach((t, i) => expect(t).toBeCloseTo(ticks[i]!, 9))
      const visible = got.filter((t) => t >= lo && t <= hi)
      const labels = formatTickLabels(visible)
      expect(visible.map((t) => labels.get(t))).toEqual(expected)
    })
  }
  for (const [[lo, hi], stride] of DATA.magnitude) {
    it(`magnitude ${lo}–${hi} dB → every ${stride} dB`, () => expect(magnitudeStride(hi - lo)).toBe(stride))
  }
})
