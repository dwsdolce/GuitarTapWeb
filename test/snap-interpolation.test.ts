// @parity test/snap-interpolation
// The crosshair's snap to a curve against the shared case file snap-interpolation.json — the same cases the Swift
// and Python suites run: the point on a curve at the pointer's frequency, interpolated between the two bins either
// side, and which of several curves the crosshair follows.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lockedSeries, snapToWaveform } from '../src/presentation/snapInterpolation'

const DATA = JSON.parse(readFileSync('test/fixtures/snap-interpolation.json', 'utf8')) as {
  snapToWaveform: { id: string; targetHz: number; frequencies: number[]; magnitudes: number[]; expect: [number, number] | null }[]
  lockedSeries: { id: string; candidates: [number, number][]; locked: number; expect: number }[]
}

describe('snap-interpolation — snapToWaveform', () => {
  for (const c of DATA.snapToWaveform) {
    it(c.id, () => {
      const r = snapToWaveform(c.targetHz, c.magnitudes, c.frequencies)
      if (c.expect === null) {
        expect(r).toBeNull()
      } else {
        expect(r).not.toBeNull()
        expect(r!.frequency).toBeCloseTo(c.expect[0], 3)
        expect(r!.magnitude).toBeCloseTo(c.expect[1], 3)
      }
    })
  }
})

describe('snap-interpolation — lockedSeries', () => {
  for (const c of DATA.lockedSeries) {
    it(c.id, () => {
      const candidates = c.candidates.map(([index, dist]) => ({ index, dist }))
      expect(lockedSeries(candidates, c.locked)).toBe(c.expect)
    })
  }
})
