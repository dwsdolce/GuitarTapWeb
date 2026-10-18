// @parity test/tap-progress
//
// The values the status bar's progress bar shows:
//
//   totalPlateTaps = numberOfTaps × (brace 1, plate 2, plate with FLC 3)
//   tapProgress    = min(1, currentTapCount ÷ (guitar: numberOfTaps, else totalPlateTaps)), stored at each
//                    capture, so a later Taps change cannot rewrite a finished measurement's bar
//   currentTapCount (material) is CUMULATIVE across L → C → FLC, and rebases to the earlier phases' taps on
//                    Redo
//
// The cumulative count is the rule a phase boundary can break while the equations still hold, so the cases
// drive real captures across Accepts. The shared cases in tap-progress.json (TP1–TP15), the same as Swift
// and Python.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { parseGuitarTapFile } from '../src/measurement'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type ProgressStep = AnalyzerStep & { check?: Fields; load?: string }
type ProgressCase = { id: string; note: string; steps: ProgressStep[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/tap-progress.json', 'utf8')) as {
  files: Record<string, unknown>
  cases: ProgressCase[]
}

/** The measurement a load step names: an inline file of the case table, or a fixture. */
function measurement(name: string) {
  const inline = DATA.files[name]
  const text = inline !== undefined ? JSON.stringify(inline) : readFileSync(`test/fixtures/${name}`, 'utf8')
  return parseGuitarTapFile(text)[0]!
}

/** Assert the fields an expectation names. */
function check(fields: Fields, a: TapToneAnalyzer): void {
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'totalPlateTaps': expect(a.totalPlateTaps, field).toBe(want); break
      case 'tapProgress': expect(a.tapProgress, field).toBeCloseTo(want as number, 4); break
      case 'tapCount': expect(a.currentTapCount, field).toBe(want); break
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
      case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
      case 'detecting': expect(a.isDetecting, field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

describe('tap-progress — the shared cases (tap-progress.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    for (const step of c.steps) {
      if (step.check) check(step.check, a)
      else if (step.load !== undefined) a.loadMeasurement(measurement(step.load))
      else expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    check(c.expect, a)
  })
})
