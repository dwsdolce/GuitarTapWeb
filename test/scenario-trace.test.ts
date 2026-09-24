// @parity test/scenario-trace
// Mirrors GuitarTapTests/ScenarioStateTraceTests.swift and Python
// tests/test_scenario_state_trace.py: pins the sequence of state tuples
// through end-to-end scenarios, not just the final outcome. The canonical
// trace for each scenario is identical across all three platforms.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'

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

/** Capture one tap through the REAL completion path (finishGuitarGatedCapture). */
function captureTap(s: TapToneAnalyzer): void {
  const n = GUITAR_FFT_SIZE
  const tap = new Float32Array(n)
  for (let i = 0; i < n; i++) tap[i] = 0.5 * Math.exp((-i / 48000) * 6) * Math.sin((2 * Math.PI * 100 * i) / 48000)
  s.finishGuitarGatedCapture(tap, 48000)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const afterCooldown = () => sleep(500 + 300) // tapCooldown (0.5 s) + margin
const afterCaptureWindow = () => sleep(200 + 300) // captureWindow (0.2 s) + margin

const row = (
  label: string,
  isDetecting: boolean,
  isDetectionPaused: boolean,
  isMeasurementComplete: boolean,
  currentTapCount: number,
  capturedTapsCount: number,
): StateSnapshot => ({ label, isDetecting, isDetectionPaused, isMeasurementComplete, currentTapCount, capturedTapsCount })

// Every tap goes through the real finishGuitarGatedCapture, and the waits are the real ones — the tap
// cooldown before re-arming, the capture window before averaging. The traces used to assign the "tap
// happened" state by hand, so their capture rows recorded what the TEST wrote; and S3/S4's postTap1 said
// detection was back on the instant a tap was captured, a path the app never takes (#17 F46). These
// traces are identical in Swift, Python and web.
describe('ScenarioStateTrace', () => {
  // S1: clean single-tap guitar measurement
  it('S1 — clean single tap (guitar)', async () => {
    const s = makeSUT(1)
    const trace: StateSnapshot[] = [snap('init', s)]
    s.startTapSequence()
    trace.push(snap('postStart', s))
    captureTap(s)
    trace.push(snap('postCapture', s))
    await afterCaptureWindow() // completion averages after the capture window
    trace.push(snap('postProcess', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', true, false, false, 0, 0),
      row('postCapture', false, false, false, 1, 1),
      row('postProcess', false, false, true, 1, 1),
    ])
  })

  // S2: spurious-tap-on-type-change — the stray DETECTION is simulated (it is the scenario); the
  // capture that follows is real. Same trace as S1.
  it('S2 — spurious tap on type change matches clean single tap', async () => {
    const s = makeSUT(1)
    const trace: StateSnapshot[] = [snap('init', s)]
    s.startTapSequence()
    s.detectionState = 'idle' // spurious tap fires before housekeeping
    trace.push(snap('postStart', s))
    captureTap(s)
    trace.push(snap('postCapture', s))
    await afterCaptureWindow()
    trace.push(snap('postProcess', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', false, false, false, 0, 0),
      row('postCapture', false, false, false, 1, 1),
      row('postProcess', false, false, true, 1, 1),
    ])
  })

  // S3: multi-tap with mid-sequence pause/resume
  it('S3 — multi-tap pause/resume', async () => {
    const s = makeSUT(3)
    const trace: StateSnapshot[] = [snap('init', s)]
    s.startTapSequence()
    trace.push(snap('postStart', s))
    captureTap(s) // tap 1: detection rests through the cooldown
    trace.push(snap('postTap1', s))
    await sleep(250) // halfway through the cooldown: still resting
    trace.push(snap('midCooldown', s))
    await sleep(250 + 300) // ...then re-arms
    trace.push(snap('postReArm', s))
    s.pauseTapDetection()
    trace.push(snap('postPause', s))
    s.resumeTapDetection()
    trace.push(snap('postResume', s))
    captureTap(s) // tap 2
    await afterCooldown()
    captureTap(s) // tap 3 — the last
    await afterCaptureWindow()
    trace.push(snap('postProcess', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', true, false, false, 0, 0),
      row('postTap1', false, false, false, 1, 1),
      row('midCooldown', false, false, false, 1, 1),
      row('postReArm', true, false, false, 1, 1),
      row('postPause', false, true, false, 1, 1),
      row('postResume', true, false, false, 1, 1),
      row('postProcess', false, false, true, 3, 3),
    ])
  })

  // S4: multi-tap cancelled mid-sequence — cancel is a restart, re-arming a fresh sequence
  // (≡ New Tap): isDetecting=true, isMeasurementComplete=false, counts reset to 0.
  it('S4 — multi-tap cancel', async () => {
    const s = makeSUT(3)
    const trace: StateSnapshot[] = [snap('init', s)]
    s.startTapSequence()
    trace.push(snap('postStart', s))
    captureTap(s)
    trace.push(snap('postTap1', s))
    await sleep(250) // halfway through the cooldown: still resting
    trace.push(snap('midCooldown', s))
    await sleep(250 + 300)
    trace.push(snap('postReArm', s))
    s.cancelTapSequence()
    trace.push(snap('postCancel', s))

    expect(trace).toEqual([
      row('init', false, false, false, 0, 0),
      row('postStart', true, false, false, 0, 0),
      row('postTap1', false, false, false, 1, 1),
      row('midCooldown', false, false, false, 1, 1),
      row('postReArm', true, false, false, 1, 1),
      row('postCancel', true, false, false, 0, 0),
    ])
  })
})
