// @parity test/measurement-complete
// Mirrors GuitarTapTests/MeasurementCompleteTransitionTests.swift and Python
// tests/test_measurement_complete_transitions.py: isMeasurementComplete must be
// set true by every completion path and cleared/handled by every reset path.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer, type CapturedTap } from '../src/state/tapToneAnalyzer'

function makeSUT(numberOfTaps = 1): TapToneAnalyzer {
  const s = new TapToneAnalyzer()
  s.numberOfTaps = numberOfTaps
  s.measurementType = 'classical'
  return s
}

function fakeTap(n = 64, peakDB = -30): CapturedTap {
  const magnitudes = new Array<number>(n).fill(-80)
  magnitudes[Math.floor(n / 4)] = peakDB
  const frequencies = Array.from({ length: n }, (_, i) => i * 31.25)
  return { magnitudes, frequencies, captureTime: 0 }
}

describe('MeasurementCompleteTransitions', () => {
  // MC1: processMultipleTaps sets isMeasurementComplete = true
  it('MC1 — processMultipleTaps sets isMeasurementComplete', () => {
    const s = makeSUT(1)
    s.capturedTaps = [fakeTap()]
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(true)
  })

  // MC2: processMultipleTaps populates the frozen spectrum
  it('MC2 — processMultipleTaps populates frozen spectrum', () => {
    const s = makeSUT(1)
    s.capturedTaps = [fakeTap()]
    s.processMultipleTaps()
    expect(s.frozenMagnitudes.length).toBeGreaterThan(0)
    expect(s.frozenFrequencies.length).toBeGreaterThan(0)
  })

  // MC3: two taps still set complete
  it('MC3 — processMultipleTaps multi-tap sets complete', () => {
    const s = makeSUT(2)
    s.capturedTaps = [fakeTap(64, -32), fakeTap(64, -28)]
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(true)
  })

  // MC4: startTapSequence clears complete
  it('MC4 — startTapSequence clears measurement complete', () => {
    const s = makeSUT(1)
    s.capturedTaps = [fakeTap()]
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(true)
    s.startTapSequence()
    expect(s.isMeasurementComplete).toBe(false)
  })

  // MC5: cancelTapSequence re-arms — clears frozen spectrum, resets complete, re-arms detection
  it('MC5 — cancelTapSequence re-arms and clears frozen', () => {
    const s = makeSUT(1)
    s.capturedTaps = [fakeTap()]
    s.processMultipleTaps()
    expect(s.frozenMagnitudes.length).toBeGreaterThan(0)
    expect(s.isMeasurementComplete).toBe(true)
    s.cancelTapSequence()
    expect(s.frozenMagnitudes.length).toBe(0)
    expect(s.frozenFrequencies.length).toBe(0)
    expect(s.isMeasurementComplete).toBe(false) // re-armed → not complete
    expect(s.isDetecting).toBe(true) // re-armed detection
  })

  // MC6: empty capturedTaps does not complete
  it('MC6 — processMultipleTaps with no taps does not complete', () => {
    const s = makeSUT(1)
    s.capturedTaps = []
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(false)
  })

  // MC7: loadMeasurement sets complete
  it('MC7 — loadMeasurement sets measurement complete', () => {
    const s = makeSUT()
    expect(s.isMeasurementComplete).toBe(false)
    const frequencies = Array.from({ length: 64 }, (_, i) => i * 31.25)
    const magnitudes = new Array<number>(64).fill(-80)
    magnitudes[16] = -30
    s.restoreSnapshot({ magnitudes, frequencies })
    expect(s.isMeasurementComplete).toBe(true)
  })

  // MC8: completing clears the loaded-settings warning (didSet)
  it('MC8 — measurement complete clears loaded-settings warning', () => {
    const s = makeSUT()
    s.showLoadedSettingsWarning = true
    s.capturedTaps = [fakeTap()]
    s.processMultipleTaps()
    expect(s.showLoadedSettingsWarning).toBe(false)
  })

  // MC9-MC11: the OTHER three rules that move this flag. Until #17 F40 the banner's real state was
  // an App.tsx useState and these were unreachable from a test — MC8 above passed against a field
  // the application never read, which is a test proving something about a dead copy.
  //
  // MC9: starting a new sequence clears it — the user's own Threshold/Taps now apply.
  it('MC9 — a new sequence clears the loaded-settings warning', () => {
    const s = makeSUT()
    s.showLoadedSettingsWarning = true
    s.startTapSequence({ arm: false })
    expect(s.showLoadedSettingsWarning).toBe(false)
  })

  // MC10: changing Taps clears it (Swift numberOfTaps.didSet / Python set_tap_num).
  it('MC10 — a tap-count change clears the loaded-settings warning', () => {
    const s = makeSUT()
    s.showLoadedSettingsWarning = true
    s.setNumberOfTaps(3)
    expect(s.showLoadedSettingsWarning).toBe(false)
  })

  // MC11: a load RAISES it, and does so after the completion assignment that would clear it —
  // the ordering dependency Swift carries between MeasMgmt:709 and :834.
  it('MC11 — loading a measurement raises it, surviving the completion clear', () => {
    const s = makeSUT()
    expect(s.showLoadedSettingsWarning).toBe(false)
    s.restoreSnapshot({ magnitudes: [-60, -60], frequencies: [100, 200] })
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.showLoadedSettingsWarning).toBe(true)
  })

  // MC12: a load that CARRIES a tap count must still raise the banner. Two clearing hooks fire
  // during a load — the completion setter and the tap-count hook — and the raise has to come after
  // BOTH. MC11 passes no tap count, so it never exercised the second one, and a version of this
  // code restored the tap count from App AFTER loadMeasurement returned: the banner was raised and
  // then wiped four lines later, and the banner never appeared at all. Swift cannot have that,
  // because loadMeasurement writes numberOfTaps itself, between the two (MeasMgmt:709/784/834).
  it('MC12 — a load carrying a tap count still raises the banner, and applies the count', () => {
    const s = makeSUT()
    s.restoreSnapshot({ magnitudes: [-60, -60], frequencies: [100, 200], numberOfTaps: 3 })
    expect(s.numberOfTaps).toBe(3)
    expect(s.showLoadedSettingsWarning).toBe(true)
  })
})