// @parity none — each edition's zoom gesture is its own UI code: Swift's twin is
// SpectrumViewGestureTests (C3, C5 and the zoom-out cases), Python's test_chart_zoom_limits.py.
//
// A zoom step is refused when it would leave the chart's span narrower than 10 Hz / 10 dB (the chart's
// limits, the same as Settings'); a range at the minimum can still be zoomed out.
import { describe, it, expect } from 'vitest'
import { zoomedRange } from '../src/presentation/displayRange'
import {
  MIN_FREQUENCY_HZ,
  MAX_FREQUENCY_HZ,
  MIN_MAGNITUDE_DB,
  MAX_MAGNITUDE_DB,
  MIN_FREQUENCY_SPAN_HZ,
  MIN_MAGNITUDE_SPAN_DB,
} from '../src/presentation/chartLimits'

const freq = (lo: number, hi: number, anchor: number, scale: number) =>
  zoomedRange(lo, hi, anchor, scale, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ, MIN_FREQUENCY_SPAN_HZ)
const db = (lo: number, hi: number, anchor: number, scale: number) =>
  zoomedRange(lo, hi, anchor, scale, MIN_MAGNITUDE_DB, MAX_MAGNITUDE_DB, MIN_MAGNITUDE_SPAN_DB)

describe('chart zoom limits', () => {
  it('a frequency zoom leaving at least 10 Hz is allowed', () => {
    expect(freq(100, 400, 250, 2)).toEqual([175, 325])
    expect(freq(20, 40, 30, 2)).toEqual([25, 35])
  })
  it('a frequency zoom leaving less than 10 Hz is refused', () => {
    expect(freq(20, 30, 25, 1.15)).toBeNull()
  })
  it('zooming out from the minimum span is allowed', () => {
    expect(freq(20, 30, 25, 1 / 1.15)).not.toBeNull()
    expect(db(-55, -45, -50, 1 / 1.15)).not.toBeNull()
  })
  it('a magnitude zoom leaving less than 10 dB is refused', () => {
    expect(db(-55, -45, -50, 1.25)).toBeNull()
  })
  it('a zoom stays within the bounds', () => {
    expect(freq(1, 5000, 2500, 0.5)).toEqual([1, 5000])
  })
})
