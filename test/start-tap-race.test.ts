// @parity test/start-tap-race
// Mirrors GuitarTapTests/StartTapSequenceRaceTests.swift and Python
// tests/test_start_tap_sequence_race.py: startTapSequence must arm detection
// without any deferred path re-asserting isDetecting=true, so a completed
// measurement never strands the analyzer in the impossible (detecting &&
// complete) state.
//
// Captures go through the real finishGuitarGatedCapture and completion happens on its own after the
// capture window, as in the natives. R4 used to be a different test here (recordGuitarTap, then
// detection cleared BY HAND), R1 asserted with no wait, and R2/R3 populated capturedTaps and called
// processMultipleTaps by hand (#17 F48).
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'

function makeSUT(numberOfTaps = 1): TapToneAnalyzer {
  const s = new TapToneAnalyzer()
  s.numberOfTaps = numberOfTaps
  s.measurementType = 'classical'
  return s
}

/** Capture one tap through the REAL completion path (finishGuitarGatedCapture). */
function captureTap(s: TapToneAnalyzer): void {
  const tap = new Float32Array(GUITAR_FFT_SIZE)
  for (let i = 0; i < tap.length; i++) tap[i] = 0.5 * Math.exp((-i / 48000) * 6) * Math.sin((2 * Math.PI * 100 * i) / 48000)
  s.finishGuitarGatedCapture(tap, 48000)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TAP_COOLDOWN_MS = 500
const CAPTURE_WINDOW_MS = 200

describe('StartTapSequenceRace', () => {
  // R1: a handleTapDetection-style idle must survive any DEFERRED work startTapSequence leaves
  // behind — the natives wait for it (Swift Task.sleep, Python's event-loop drain), so this waits too.
  it('R1 — isDetecting=false survives deferred work after arming', async () => {
    const s = makeSUT(1)
    s.startTapSequence()
    expect(s.isDetecting).toBe(true)
    s.detectionState = 'idle' // handleTapDetection gates the capture window
    await sleep(50) // let any deferred work run
    expect(s.isDetecting).toBe(false)
  })

  // R2: spurious tap on type change — the capture completes through the real path and the
  // measurement completes on its own after the capture window.
  it('R2 — spurious tap settles to complete, not detecting', async () => {
    const s = makeSUT(1)
    s.startTapSequence()
    s.detectionState = 'idle' // handleTapDetection effect
    await sleep(50)
    captureTap(s)
    await sleep(CAPTURE_WINDOW_MS + 300)
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.isDetecting).toBe(false)
    expect(s.isDetectionPaused).toBe(false)
  })

  // R3: multi-tap — three real captures, the real cooldowns, the real completion.
  it('R3 — multi-tap completes cleanly', async () => {
    const s = makeSUT(3)
    s.startTapSequence()
    await sleep(50)
    for (let tap = 1; tap <= 3; tap++) {
      captureTap(s)
      if (tap < 3) await sleep(TAP_COOLDOWN_MS + 300)
    }
    await sleep(CAPTURE_WINDOW_MS + 300)
    expect(s.currentTapCount).toBe(3)
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.isDetecting).toBe(false)
    expect(s.isDetectionPaused).toBe(false)
  })

  // R4: the audio-queue gated-capture path — the actual iPad bug. The level-crossing handler starts
  // a capture without handleTapDetection, so detection stays armed through the capture window;
  // finishGuitarGatedCapture must clear it, or the measurement completes with the analyzer still
  // "detecting" (Pause enabled, New Tap disabled). No handleTapDetection here — that is the point.
  it('R4 — the audio-queue capture path clears isDetecting', async () => {
    const s = makeSUT(1)
    s.startTapSequence()
    expect(s.isDetecting, 'armed').toBe(true)
    s.finishGuitarGatedCapture(new Float32Array(GUITAR_FFT_SIZE), 48000)
    expect(s.isDetecting, 'REGRESSION: finishGuitarGatedCapture must clear isDetecting').toBe(false)
    await sleep(CAPTURE_WINDOW_MS + 300) // completion is scheduled by the capture itself
    expect(s.isMeasurementComplete).toBe(true)
    expect(s.isDetecting).toBe(false)
    expect(s.isDetectionPaused).toBe(false)
  })

  // R5: a restart from PAUSED must end listening, not paused. startTapSequence used to clear the
  // pause flag up front; with one detection state it simply moves to 'listening' at the arming
  // step, and nothing in between may leave 'paused' standing. Cancel is the reachable route: the
  // button rule DISABLES New Tap while paused (a paused sequence is still in flight, B6) and
  // ENABLES Cancel, which delegates to startTapSequence in all three editions.
  it('R5 — restart from paused ends listening', () => {
    const s = makeSUT(3)
    s.startTapSequence()
    s.currentTapCount = 1
    s.pauseTapDetection()
    expect(s.isDetectionPaused).toBe(true) // precondition

    s.cancelTapSequence()

    expect(s.detectionState).toBe('listening')
    expect(s.isDetectionPaused).toBe(false)
    expect(s.currentTapCount).toBe(0)
  })
})
