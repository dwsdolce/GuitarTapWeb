// @parity test/decay-tracking
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// Ring-out (decay) time — pinned to the Swift DecayTrackingTests / Python test_decay_tracking
// reference vectors. Peak → first later sample below (peak − threshold) → elapsed seconds.
// The ring-out lives on the analyzer, as in the natives.

const history = (mags: number[], interval = 0.1, start = 0) =>
  mags.map((magnitude, i) => ({ time: start + i * interval, magnitude }))

/** measureDecayTime on an analyzer holding `h`, with the given threshold. */
function measure(h: { time: number; magnitude: number }[], tapTime: number, threshold?: number): number | null {
  const a = new TapToneAnalyzer()
  if (threshold !== undefined) a.decayThreshold = threshold
  a.peakMagnitudeHistory = h
  return a.measureDecayTime(tapTime)
}

describe('measureDecayTime — Swift/Python reference vectors', () => {
  it('DK4: normal decay, 20 dB threshold → 0.5 s', () => {
    // peak −10 @ t=0; target −30; first below at index 5 (−31 @ t=0.5).
    expect(measure(history([-10, -15, -20, -24, -28, -31, -35]), 0, 20)!).toBeCloseTo(0.5, 6)
  })

  it('DK5: immediate decay, 10 dB threshold → 0.1 s', () => {
    // peak −10 @ t=0; target −20; first below at index 1 (−21 @ t=0.1).
    expect(measure(history([-10, -21, -30, -40]), 0, 10)!).toBeCloseTo(0.1, 6)
  })

  it('default threshold is 15 dB', () => {
    expect(new TapToneAnalyzer().decayThreshold).toBe(15)
    // peak −10 @ t=0; target −25; first below at index 3 (−26 @ t=0.3).
    expect(measure(history([-10, -12, -20, -26, -40]), 0)!).toBeCloseTo(0.3, 6)
  })

  it('returns null when the level never drops by the threshold', () => {
    expect(measure(history([-10, -12, -14, -16]), 0)).toBeNull()
  })

  it('measures from the post-tap PEAK, not the tap instant (rising transient)', () => {
    // Level still rising after the tap: peak −8 @ t=0.1; target −23; crosses at −24 @ t=0.3.
    expect(measure(history([-12, -8, -15, -24, -40]), 0)!).toBeCloseTo(0.2, 6) // 0.3 − 0.1
  })

  it('ignores samples before tapTime', () => {
    const h = history([-30, -10, -20, -26], 0.1, -0.1) // first sample at t=-0.1 (pre-tap)
    expect(measure(h, 0)!).toBeCloseTo(0.2, 6) // peak −10 @ t=0 → −26 @ t=0.2
  })
})

describe('trackDecayFast — streaming', () => {
  it('measures a fed decay once enough samples arrive', () => {
    const a = new TapToneAnalyzer()
    a.tapPeakLevel = -10 // the tap's peak-held level seeds the history
    a.startDecayTracking(0)
    ;[-12, -14, -16, -18, -20, -22, -24, -26, -28, -30, -32, -34].forEach((db, i) => a.trackDecayFast(db, (i + 1) * 0.05))
    // peak −10 @ t=0; target −25; first below is −26 @ t=0.4.
    expect(a.currentDecayTime!).toBeCloseTo(0.4, 6)
  })

  it('is a no-op before tracking starts', () => {
    const a = new TapToneAnalyzer()
    a.trackDecayFast(-50, 0.1)
    expect(a.peakMagnitudeHistory).toEqual([])
    expect(a.currentDecayTime).toBeNull()
  })
})
