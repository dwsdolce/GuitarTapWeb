// @parity test/state-invariants
// Mirrors GuitarTapTests/StateInvariantTests.swift and Python tests/test_state_invariants.py: the
// load-bearing state-machine invariants (I1–I6) that must hold after any sequence of operations.
//
// The checker lives HERE, in the test, as it does in both natives. It used to be exported from
// src/state/tapToneAnalyzer.ts, where nothing but this file called it (#17 F45).
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer, type CapturedTap } from '../src/state/tapToneAnalyzer'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'
import { advanceAudio } from './audioClockFeed'

/** Returns a description of the first invariant `s` violates, or null when all hold. Keep in sync
 *  with Swift stateInvariantViolation / Python state_invariant_violation. */
function stateInvariantViolation(s: TapToneAnalyzer): string | null {
  const isGuitar = s.isGuitar
  // I1: guitar mode — isDetecting && isMeasurementComplete is illegal.
  if (isGuitar && s.isDetecting && s.isMeasurementComplete) {
    return 'I1: isDetecting && isMeasurementComplete is illegal in guitar mode'
  }
  // I2: cannot be paused once the measurement is complete.
  if (s.isDetectionPaused && s.isMeasurementComplete) {
    return 'I2: isDetectionPaused && isMeasurementComplete is illegal (cannot be paused once measurement is done)'
  }
  // I3: capturedTaps.count must never exceed numberOfTaps.
  if (s.capturedTaps.length > s.numberOfTaps) {
    return `I3: capturedTaps.count (${s.capturedTaps.length}) > numberOfTaps (${s.numberOfTaps})`
  }
  // I4: guitar mode — currentTapCount must match capturedTaps.count.
  if (isGuitar && s.currentTapCount !== s.capturedTaps.length) {
    return `I4: currentTapCount (${s.currentTapCount}) != capturedTaps.count (${s.capturedTaps.length}) in guitar mode`
  }
  // I5: tapProgress must be in [0, 1].
  if (s.tapProgress < 0 || s.tapProgress > 1) {
    return `I5: tapProgress (${s.tapProgress}) outside [0, 1]`
  }
  // I6: during a plate/brace review phase, isDetecting must be false.
  if (!isGuitar && (s.materialTapPhase === 'reviewingL' || s.materialTapPhase === 'reviewingC' || s.materialTapPhase === 'reviewingFlc')) {
    if (s.isDetecting) {
      return `I6: isDetecting must be false during a plate/brace review phase (phase=${s.materialTapPhase})`
    }
  }
  return null
}

function makeSUT(numberOfTaps = 1): TapToneAnalyzer {
  const s = new TapToneAnalyzer()
  s.numberOfTaps = numberOfTaps
  s.measurementType = 'classical' // guitar mode (Swift uses .generic)
  return s
}

function fakeTap(n = 64): CapturedTap {
  const magnitudes = new Array<number>(n).fill(-80)
  magnitudes[Math.floor(n / 4)] = -30
  const frequencies = Array.from({ length: n }, (_, i) => i * 31.25)
  return { magnitudes, frequencies, captureTime: 0 }
}

/** A decaying sinusoid — a synthetic tap with one resonance at `hz`. */
function tapSamples(hz: number, count: number, rate = 48000): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const t = i / rate
    out[i] = 0.5 * Math.exp(-t * 6) * Math.sin(2 * Math.PI * hz * t)
  }
  return out
}


describe('StateInvariants', () => {
  // V1: fresh analyzer is valid
  it('V1 — fresh analyzer holds invariants', () => {
    expect(stateInvariantViolation(makeSUT())).toBeNull()
  })

  // V2: after startTapSequence, invariants hold
  it('V2 — after startTapSequence holds invariants', () => {
    const s = makeSUT()
    s.startTapSequence()
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V3: single-tap completion holds invariants (iPad-bug end state)
  it('V3 — after single-tap complete holds invariants', () => {
    const s = makeSUT(1)
    s.startTapSequence()
    s.detectionState = 'idle'
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    s.processMultipleTaps()
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V4: mid multi-tap sequence holds invariants — reached through the REAL capture path
  // (finishGuitarGatedCapture), not by assigning the taps, count and state by hand (#17 F45).
  // Checked resting through the tap cooldown, and re-armed after it.
  it('V4 — mid multi-tap sequence holds invariants', async () => {
    const s = makeSUT(3)
    s.startTapSequence()
    s.finishGuitarGatedCapture(tapSamples(100, GUITAR_FFT_SIZE), 48000)
    expect(s.capturedTaps).toHaveLength(1)
    expect(s.isDetecting, 'detection rests through the tap cooldown').toBe(false)
    expect(stateInvariantViolation(s)).toBeNull()

    advanceAudio(s, s.tapCooldown) // the rest runs on the audio clock (#19)
    expect(s.isDetecting, 're-armed for the next tap once the cooldown has passed').toBe(true)
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V5: cancel mid-sequence holds invariants
  it('V5 — after cancel holds invariants', () => {
    const s = makeSUT(3)
    s.startTapSequence()
    s.cancelTapSequence()
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V6: paused state holds invariants
  it('V6 — after pause holds invariants', () => {
    const s = makeSUT(3)
    s.startTapSequence()
    s.pauseTapDetection()
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V7: the impossible (detecting && complete) state must be flagged
  it('V7 — impossible detecting+complete is flagged', () => {
    const s = makeSUT(1)
    s.detectionState = 'listening'
    s.isMeasurementComplete = true
    expect(stateInvariantViolation(s)).not.toBeNull()
  })

  // V8: a plate capture reaches its REVIEW phase through the real gated path, and invariants hold —
  // including I6, which no guitar case can reach (#17 F45).
  it('V8 — plate review phase holds invariants', () => {
    const s = makeSUT(1)
    s.measurementType = 'plate'
    s.tapDetectionThreshold = -90 // accept the synthetic tap
    s.startTapSequence()
    s.finishGatedFFTCapture(tapSamples(60, 24_000), 48000, 'capturingL')
    expect(s.materialTapPhase).toBe('reviewingL')
    expect(s.isDetecting).toBe(false)
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V9–V13: each invariant REPORTS its forbidden state. V7 did this for I1 alone (#17 F45).
  it('I2 — paused and complete is flagged', () => {
    const s = makeSUT()
    s.detectionState = 'paused'
    s.isMeasurementComplete = true
    expect(stateInvariantViolation(s)).toMatch(/^I2/)
  })

  it('I3 — more taps than requested is flagged', () => {
    const s = makeSUT(1)
    s.capturedTaps = [fakeTap(), fakeTap()]
    expect(stateInvariantViolation(s)).toMatch(/^I3/)
  })

  it('I4 — count out of step with the taps is flagged', () => {
    const s = makeSUT(3)
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 0
    expect(stateInvariantViolation(s)).toMatch(/^I4/)
  })

  it('I5 — progress out of range is flagged', () => {
    const s = makeSUT()
    s.tapProgress = 1.5
    expect(stateInvariantViolation(s)).toMatch(/^I5/)
  })

  it('I6 — detecting while reviewing is flagged', () => {
    const s = makeSUT()
    s.measurementType = 'plate'
    s.materialTapPhase = 'reviewingL'
    s.detectionState = 'listening'
    expect(stateInvariantViolation(s)).toMatch(/^I6/)
  })
})
