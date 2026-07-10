// @parity test/state-invariants
// Mirrors GuitarTapTests/StateInvariantTests.swift and Python
// tests/test_state_invariants.py: the load-bearing state-machine invariants
// (I1–I6) that must hold after any sequence of operations.
import { describe, it, expect } from 'vitest'
import { TapSession, stateInvariantViolation, type CapturedTap } from '../src/state/tapSession'

function makeSUT(numberOfTaps = 1): TapSession {
  const s = new TapSession()
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
    s.isDetecting = false
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    s.processMultipleTaps()
    expect(stateInvariantViolation(s)).toBeNull()
  })

  // V4: mid multi-tap sequence holds invariants
  it('V4 — mid multi-tap sequence holds invariants', () => {
    const s = makeSUT(3)
    s.startTapSequence()
    s.capturedTaps = [fakeTap()]
    s.currentTapCount = 1
    s.isDetecting = true // re-armed for next tap
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
    s.isDetecting = true
    s.isMeasurementComplete = true
    expect(stateInvariantViolation(s)).not.toBeNull()
  })
})