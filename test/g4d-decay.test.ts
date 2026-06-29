import { describe, it, expect } from 'vitest'
import { measureDecayTime, DecayTracker, DECAY_THRESHOLD_DB, type DecaySample } from '../src/dsp/decay'

// Ring-out (decay) time — pinned to the Swift DecayTrackingTests / Python test_decay_tracking
// reference vectors. Peak → first later sample below (peak − threshold) → elapsed seconds.

const history = (mags: number[], interval = 0.1, start = 0): DecaySample[] =>
  mags.map((db, i) => ({ t: start + i * interval, db }))

describe('measureDecayTime — Swift/Python reference vectors', () => {
  it('DK4: normal decay, 20 dB threshold → 0.5 s', () => {
    // peak −10 @ t=0; target −30; first below at index 5 (−31 @ t=0.5).
    const h = history([-10, -15, -20, -24, -28, -31, -35])
    expect(measureDecayTime(h, 0, 20)!).toBeCloseTo(0.5, 6)
  })

  it('DK5: immediate decay, 10 dB threshold → 0.1 s', () => {
    // peak −10 @ t=0; target −20; first below at index 1 (−21 @ t=0.1).
    const h = history([-10, -21, -30, -40])
    expect(measureDecayTime(h, 0, 10)!).toBeCloseTo(0.1, 6)
  })

  it('default threshold is 15 dB', () => {
    expect(DECAY_THRESHOLD_DB).toBe(15)
    // peak −10 @ t=0; target −25; first below at index 3 (−26 @ t=0.3).
    expect(measureDecayTime(history([-10, -12, -20, -26, -40]), 0)!).toBeCloseTo(0.3, 6)
  })

  it('returns null when the level never drops by the threshold', () => {
    expect(measureDecayTime(history([-10, -12, -14, -16]), 0)).toBeNull()
  })

  it('measures from the post-tap PEAK, not the tap instant (rising transient)', () => {
    // Level still rising after the tap: peak −8 @ t=0.1; target −23; crosses at −24 @ t=0.3.
    const h = history([-12, -8, -15, -24, -40])
    expect(measureDecayTime(h, 0)!).toBeCloseTo(0.2, 6) // 0.3 − 0.1 (from the peak, not the tap)
  })

  it('ignores samples before tapTime', () => {
    const h = history([-30, -10, -20, -26], 0.1, -0.1) // first sample at t=-0.1 (pre-tap)
    expect(measureDecayTime(h, 0)!).toBeCloseTo(0.2, 6) // peak −10 @ t=0 → −26 @ t=0.2
  })
})

describe('DecayTracker — streaming', () => {
  it('measures a fed decay once enough samples arrive', () => {
    const d = new DecayTracker()
    d.start(0, -10) // tap peak seed
    ;[-12, -14, -16, -18, -20, -22, -24, -26, -28, -30, -32, -34].forEach((db, i) => d.track((i + 1) * 0.05, db))
    // peak −10 @ t=0; target −25; first below is −26 @ t=0.4.
    expect(d.decayTime!).toBeCloseTo(0.4, 6)
  })

  it('no-ops before start and after reset', () => {
    const d = new DecayTracker()
    d.track(0.1, -50) // not started
    expect(d.decayTime).toBeNull()
    d.start(0, -10)
    ;[-20, -22, -24, -26, -28, -30, -32, -34, -36, -38, -40].forEach((db, i) => d.track((i + 1) * 0.05, db))
    expect(d.decayTime).not.toBeNull()
    d.reset()
    expect(d.decayTime).toBeNull()
  })

  it('stops tracking 3 s after the tap (no late crossing applied)', () => {
    const d = new DecayTracker()
    d.start(0, -10)
    // Stay loud for >3 s (never drops), then a late crossing at t=3.5 — must be ignored.
    for (let i = 1; i <= 40; i++) d.track(i * 0.1, -11) // t up to 4.0 s, never crosses
    d.track(3.5, -40)
    expect(d.decayTime).toBeNull()
  })
})