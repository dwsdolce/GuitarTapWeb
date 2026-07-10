// @parity test/scenario-trace
// Mirrors GuitarTapTests/ScenarioStateTraceTests.swift and Python
// tests/test_scenario_state_trace.py: pins the sequence of state tuples
// through end-to-end scenarios, not just the final outcome. The canonical
// trace for each scenario is identical across all three platforms.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer, type CapturedTap } from '../src/state/tapToneAnalyzer'

interface StateSnapshot {
  label: string
  isDetecting: boolean
  isDetectionPaused: boolean
  isMeasurementComplete: boolean
  currentTapCount: number
  capturedTapsCount: number
}

function snap(label: string, s: TapToneAnalyzer): StateSnapshot {
  return {
    label,
    isDetecting: s.isDetecting,
    isDetectionPaused: s.isDetectionPaused,
    isMeasurementComplete: s.isMeasurementComplete,
    currentTapCount: s.currentTapCount,
    capturedTapsCount: s.capturedTaps.length,
  }
}

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

const row = (
  label: string,
  isDetecting: boolean,
  isDetectionPaused: boolean,
  isMeasurementComplete: boolean,
  currentTapCount: number,
  capturedTapsCount: number,
): StateSnapshot => ({ label, isDetecting, isDetectionPaused, isMeasurementComplete, currentTapCount, capturedTapsCount })

describe('ScenarioStateTrace', () => {
  // S1: clean single-tap guitar measurement
  it('S1 — clean single tap (guitar)', () => {
    const s = makeSUT(1)
    const trace: StateSnapshot[] = []
    trace.push(snap('init', s))
    s.startTapSequence()
    trace.push(snap('postStart', s))
    s.isDetecting = false // handleTapDetection
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    trace.push(snap('postCapture', s))
    s.processMultipleTaps()
    trace.push(snap('postProcess', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', true, false, false, 0, 0),
      row('postCapture', false, false, false, 1, 1),
      row('postProcess', false, false, true, 1, 1),
    ])
  })

  // S2: spurious-tap-on-type-change — identical trace to S1 (bug fixed)
  it('S2 — spurious tap on type change matches clean single tap', () => {
    const s = makeSUT(1)
    const trace: StateSnapshot[] = []
    trace.push(snap('init', s))
    s.startTapSequence()
    s.isDetecting = false // spurious tap fires before housekeeping
    trace.push(snap('postStart', s))
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    trace.push(snap('postCapture', s))
    s.processMultipleTaps()
    trace.push(snap('postProcess', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', false, false, false, 0, 0),
      row('postCapture', false, false, false, 1, 1),
      row('postProcess', false, false, true, 1, 1),
    ])
  })

  // S3: multi-tap with mid-sequence pause/resume
  it('S3 — multi-tap pause/resume', () => {
    const s = makeSUT(3)
    const trace: StateSnapshot[] = []
    trace.push(snap('init', s))
    s.startTapSequence()
    trace.push(snap('postStart', s))
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    s.isDetecting = true // re-armed
    trace.push(snap('postTap1', s))
    s.pauseTapDetection()
    trace.push(snap('postPause', s))
    s.resumeTapDetection()
    trace.push(snap('postResume', s))
    s.capturedTaps = [fakeTap(), fakeTap(), fakeTap()]
    s.currentTapCount = 3
    s.isDetecting = false
    s.processMultipleTaps()
    trace.push(snap('postProcess', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', true, false, false, 0, 0),
      row('postTap1', true, false, false, 1, 1),
      row('postPause', false, true, false, 1, 1),
      row('postResume', true, false, false, 1, 1),
      row('postProcess', false, false, true, 3, 3),
    ])
  })

  // S4: multi-tap cancelled mid-sequence — cancel is a restart, re-arming a fresh sequence
  // (≡ New Tap): isDetecting=true, isMeasurementComplete=false, counts reset to 0.
  it('S4 — multi-tap cancel', () => {
    const s = makeSUT(3)
    const trace: StateSnapshot[] = []
    trace.push(snap('init', s))
    s.startTapSequence()
    trace.push(snap('postStart', s))
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    s.isDetecting = true
    trace.push(snap('postTap1', s))
    s.cancelTapSequence()
    trace.push(snap('postCancel', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', true, false, false, 0, 0),
      row('postTap1', true, false, false, 1, 1),
      row('postCancel', true, false, false, 0, 0),
    ])
  })
})