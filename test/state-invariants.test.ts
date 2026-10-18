// @parity test/state-invariants
//
// State combinations the design forbids, checked after real sequences of steps. They are the rules Pause /
// New Tap / Cancel enablement and the audio-thread detection guards rest on, so a refactor that broke one
// would show up as a UI bug even where each function looks right on its own. The checker is below; the
// shared cases in state-invariants.json (V1–V13) run it after their steps and test it on each forbidden
// state, the same as Swift and Python.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { CapturedTap, MaterialTapPhase, TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type InvariantStep = AnalyzerStep & { check?: Fields; write?: Fields }
type InvariantCase = { id: string; note: string; steps: InvariantStep[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/state-invariants.json', 'utf8')) as { cases: InvariantCase[] }

const PHASE_FROM_RAW = Object.fromEntries(Object.entries(PHASE_RAW).map(([k, v]) => [v, k])) as Record<string, MaterialTapPhase>

/** The first rule `s` breaks, described, or null. The rules are listed in state-invariants.json; Swift's
 *  stateInvariantViolation and Python's state_invariant_violation check the same ones. */
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

/** A captured tap for a `write` step: 64 bins at 31.25 Hz, −80 dB but bin 16 at −30. */
function capturedTap(): CapturedTap {
  const magnitudes = new Array<number>(64).fill(-80)
  magnitudes[16] = -30
  return { magnitudes, frequencies: Array.from({ length: 64 }, (_, i) => i * 31.25), captureTime: 0 }
}

/** Set the fields a `write` step names directly — only to give the checker a forbidden state. */
function write(fields: Fields, a: TapToneAnalyzer): void {
  for (const [field, value] of Object.entries(fields)) {
    switch (field) {
      case 'detectionState': a.detectionState = value as 'idle' | 'listening' | 'paused'; break
      case 'complete': a.isMeasurementComplete = value as boolean; break
      case 'capturedTaps': a.capturedTaps = Array.from({ length: value as number }, capturedTap); break
      case 'tapCount': a.currentTapCount = value as number; break
      case 'tapProgress': a.tapProgress = value as number; break
      case 'phase': a.materialTapPhase = PHASE_FROM_RAW[value as string]!; break
      default: throw new Error(`unknown write field ${field}`)
    }
  }
}

/** Assert the fields an expectation names. */
function check(fields: Fields, a: TapToneAnalyzer): void {
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'violation': {
        const violation = stateInvariantViolation(a)
        expect(violation ? violation.slice(0, 2) : null, `${field}: ${violation}`).toBe(want)
        break
      }
      case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
      case 'detecting': expect(a.isDetecting, field).toBe(want); break
      case 'capturedTaps': expect(a.capturedTaps.length, field).toBe(want); break
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

describe('state-invariants — the shared cases (state-invariants.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    for (const step of c.steps) {
      if (step.check) check(step.check, a)
      else if (step.write) write(step.write, a)
      else expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    check(c.expect, a)
  })
})
