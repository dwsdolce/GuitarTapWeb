// @parity test/decay-tracking
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'

// Ring-out (decay) time: measureDecayTime on given histories (DK1–DK5, DK8–DK10, the shared cases in
// decay-tracking.json) and the tracker driven
// through production (DK6, DK7, DK11–DK13) — a fresh analyzer, startDecayTracking, startTapSequence and
// the per-chunk entry processAudioFrame. The same list, ids and values as Swift DecayTrackingTests and
// Python test_decay_tracking.py. Times are audio-clock seconds.

const DATA = JSON.parse(readFileSync('test/fixtures/decay-tracking.json', 'utf8')) as {
  defaultThreshold: number
  tolerance: number
  measureDecayTime: { id: string; note: string; magnitudes: number[]; interval: number; start: number; tapTime: number; threshold?: number; expect: number | null }[]
}

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
  for (const row of DATA.measureDecayTime) {
    it(`${row.id}: ${row.note}`, () => {
      const t = measure(history(row.magnitudes, row.interval, row.start), row.tapTime, row.threshold)
      if (row.expect === null) expect(t).toBeNull()
      else expect(Math.abs(t! - row.expect)).toBeLessThan(DATA.tolerance)
    })
  }

  it('the default threshold', () => {
    expect(new TapToneAnalyzer().decayThreshold).toBe(DATA.defaultThreshold)
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
