// @parity test/start-tap-race
// Mirrors GuitarTapTests/StartTapSequenceRaceTests.swift and Python
// tests/test_start_tap_sequence_race.py: startTapSequence must arm detection
// without any deferred path re-asserting isDetecting=true, so a completed
// measurement never strands the analyzer in the impossible (detecting &&
// complete) state. The web state machine is synchronous, so there is no
// deferred housekeeping to clobber — these pin the same end states.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer, type CapturedTap } from '../src/state/tapToneAnalyzer'

function makeSUT(numberOfTaps = 1): TapToneAnalyzer {
  const s = new TapToneAnalyzer()
  s.numberOfTaps = numberOfTaps
  s.measurementType = 'classical'
  return s
}

function fakeTap(): CapturedTap {
  const magnitudes = new Array<number>(64).fill(-80)
  magnitudes[16] = -30
  const frequencies = Array.from({ length: 64 }, (_, i) => i * 31.25)
  return { magnitudes, frequencies, captureTime: 0 }
}

describe('StartTapSequenceRace', () => {
  // R1: a handleTapDetection-style isDetecting=false survives after arming
  it('R1 — isDetecting=false survives after arming', () => {
    const s = makeSUT(1)
    s.startTapSequence()
    expect(s.isDetecting).toBe(true)
    s.isDetecting = false // handleTapDetection gates the capture window
    expect(s.isDetecting).toBe(false)
  })

  // R2: spurious tap on type change settles to complete, not detecting
  it('R2 — spurious tap settles to complete, not detecting', () => {
    const s = makeSUT(1)
    s.startTapSequence()
    s.isDetecting = false
    s.capturedTaps = [fakeTap()]
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.isDetecting).toBe(false)
    expect(s.isDetectionPaused).toBe(false)
  })

  // R3: multi-tap eventually completes cleanly
  it('R3 — multi-tap completes cleanly', () => {
    const s = makeSUT(3)
    s.startTapSequence()
    s.capturedTaps = [fakeTap(), fakeTap(), fakeTap()]
    s.currentTapCount = 3
    s.isDetecting = false
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.isDetecting).toBe(false)
    expect(s.isDetectionPaused).toBe(false)
  })

  // R4: per-tap record path — recordGuitarTap accumulates the device-delivered spectrum; the
  // idle transition (device state event) clears isDetecting, so processMultipleTaps completes
  // without stranding the analyzer in detecting && complete (6-TEST 3c-C2a).
  it('R4 — recordGuitarTap path settles complete, not detecting', () => {
    const s = makeSUT(1)
    s.startTapSequence()
    expect(s.isDetecting).toBe(true) // armed
    const t = fakeTap()
    s.recordGuitarTap({ magnitudesDb: t.magnitudes, frequencies: t.frequencies }) // device delivered a per-tap spectrum
    s.isDetecting = false // the device's idle transition clears detection
    s.processMultipleTaps()
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.isDetecting).toBe(false)
    expect(s.isDetectionPaused).toBe(false)
  })
})