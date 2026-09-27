// @parity test/decay-tracking
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// Ring-out (decay) time: measureDecayTime on given histories (DK1–DK5, DK8–DK10) and the tracker driven
// through production (DK6, DK7, DK11–DK13) — a fresh analyzer, startDecayTracking, startTapSequence and
// the per-chunk entry processAudioFrame. The same list, ids and values as Swift DecayTrackingTests and
// Python test_decay_tracking.py. Times are audio-clock seconds.

const history = (mags: number[], interval = 0.1, start = 0) =>
  mags.map((magnitude, i) => ({ time: start + i * interval, magnitude }))

/** measureDecayTime on an analyzer holding `h`, with `threshold` if given. */
function measure(h: { time: number; magnitude: number }[], tapTime: number, threshold?: number): number | null {
  const a = new TapToneAnalyzer()
  if (threshold !== undefined) a.decayThreshold = threshold
  a.peakMagnitudeHistory = h
  return a.measureDecayTime(tapTime)
}

/** One chunk through the production per-chunk entry, at `levelDb`. */
const chunk = (a: TapToneAnalyzer, levelDb: number, audioTime: number) =>
  a.processAudioFrame(new Float32Array(1024), levelDb, audioTime)

describe('decay tracking', () => {
  it('DK1: an empty history measures nothing', () => {
    expect(measure([], 0)).toBeNull()
  })

  it('DK2: every entry before the tap — nothing to measure after it', () => {
    expect(measure(history([-20, -25, -30, -35, -40, -50], 0.1, -1), 0)).toBeNull()
  })

  it('DK3: the level never drops by the threshold (30 dB here; it falls 5 dB)', () => {
    expect(measure(history([-20, -22, -24, -25, -25, -25, -25]), 0, 30)).toBeNull()
  })

  it('DK4: normal decay is timed from the peak to the crossing → 0.5 s', () => {
    // peak −10 at 0 s; target −30 (20 dB); the first entry below it is −31 at 0.5 s.
    expect(measure(history([-10, -15, -20, -24, -28, -31, -35]), 0, 20)!).toBeCloseTo(0.5, 6)
  })

  it('DK5: an immediate decay is the next entry → 0.1 s', () => {
    // peak −10 at 0 s; target −20 (10 dB); the very next entry, −21 at 0.1 s, crosses.
    expect(measure(history([-10, -21, -30, -40]), 0, 10)!).toBeCloseTo(0.1, 6)
  })

  it('DK6: a fresh analyzer is not tracking — a chunk is not recorded', () => {
    const a = new TapToneAnalyzer()
    chunk(a, -50, 0.1)
    expect(a.peakMagnitudeHistory).toEqual([])
    expect(a.currentDecayTime).toBeNull()
  })

  it('DK7: a new sequence stops the ring-out of the previous tap', () => {
    // Within 3 s of the tap; the chunks are below the tap threshold, so no new tap is detected.
    const a = new TapToneAnalyzer()
    a.tapDetectionThreshold = -40
    a.tapPeakLevel = -10
    a.startDecayTracking(0)
    a.startTapSequence()
    for (let k = 1; k <= 12; k++) chunk(a, -50, 0.05 * k)
    expect(a.isTrackingDecay, 'a new sequence stops the ring-out tracking').toBe(false)
    expect(a.currentDecayTime, 'no ring-out is measured from the previous tap').toBeNull()
  })

  it('DK8: the threshold is 15 dB unless set → 0.3 s', () => {
    expect(new TapToneAnalyzer().decayThreshold).toBe(15)
    // peak −10 at 0 s; target −25; −26 at 0.3 s crosses.
    expect(measure(history([-10, -12, -20, -26, -40]), 0)!).toBeCloseTo(0.3, 6)
  })

  it('DK9: a rising transient is timed from the post-tap peak, not the tap → 0.2 s', () => {
    // the level rises to −8 at 0.1 s; target −23; −24 at 0.3 s crosses.
    expect(measure(history([-12, -8, -15, -24, -40]), 0)!).toBeCloseTo(0.2, 6)
  })

  it('DK10: an entry before the tap is ignored even when it is loudest → 0.2 s', () => {
    // −30 at −0.1 s is skipped; peak −10 at 0 s; −26 at 0.2 s crosses.
    expect(measure(history([-30, -10, -20, -26], 0.1, -0.1), 0)!).toBeCloseTo(0.2, 6)
  })

  it('DK11: a ring-out streamed through production is measured → 0.4 s', () => {
    // the tap seeds −10 at 0 s, then twelve chunks falling 2 dB each, 0.05 s apart; target −25; −26 at 0.4 s.
    const a = new TapToneAnalyzer()
    a.tapPeakLevel = -10
    a.startDecayTracking(0)
    for (let k = 1; k <= 12; k++) chunk(a, -10 - 2 * k, 0.05 * k)
    expect(a.currentDecayTime!).toBeCloseTo(0.4, 6)
  })

  it('DK12: tracking stops at the first chunk 3 s of audio after the tap, without recording it', () => {
    const a = new TapToneAnalyzer()
    a.tapPeakLevel = -10
    a.startDecayTracking(0)
    chunk(a, -40, 2.99)
    expect(a.isTrackingDecay && a.peakMagnitudeHistory.length === 2, 'a chunk before 3 s is recorded').toBe(true)
    chunk(a, -40, 3.0)
    expect(a.isTrackingDecay, 'tracking stops at 3 s').toBe(false)
    expect(a.peakMagnitudeHistory.length, 'the 3 s chunk is not recorded').toBe(2)
  })

  it('DK13: no ring-out is measured until the history holds more than 10 entries', () => {
    // the seed and nine chunks (10 entries) measure nothing; the tenth chunk (11) measures −10 → −50 at 0.05 s.
    const a = new TapToneAnalyzer()
    a.tapPeakLevel = -10
    a.startDecayTracking(0)
    for (let k = 1; k <= 9; k++) chunk(a, -50, 0.05 * k)
    expect(a.peakMagnitudeHistory.length).toBe(10)
    expect(a.currentDecayTime, '10 entries measure nothing').toBeNull()
    chunk(a, -50, 0.5)
    expect(a.currentDecayTime!, '11 entries measure the ring-out').toBeCloseTo(0.05, 6)
  })
})
