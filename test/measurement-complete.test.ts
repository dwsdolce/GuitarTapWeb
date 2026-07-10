// @parity test/measurement-complete
// Mirrors GuitarTapTests/MeasurementCompleteTransitionTests.swift and Python
// tests/test_measurement_complete_transitions.py: isMeasurementComplete must be
// set true by every completion path and cleared/handled by every reset path.
import { describe, it, expect } from 'vitest'
import { TapSession, type CapturedTap } from '../src/state/tapSession'

function makeSUT(numberOfTaps = 1): TapSession {
  const s = new TapSession()
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
    s.loadMeasurement({ magnitudes, frequencies })
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
})