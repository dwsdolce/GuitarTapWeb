// @parity test/tap-count-change
//
// Changing Taps (Swift numberOfTaps.didSet): while armed and waiting for the first tap the prompt follows
// the new count; otherwise it is left alone; and a change never completes a measurement or drops captured
// taps — there is no "lower the count mid-sequence → finalise with the taps in hand" rule. The Taps
// stepper is disabled from the first captured tap, so the count cannot change mid-sequence in the app;
// these pin that the model would not finalise if it did. The shared cases in tap-count-change.json
// (TC1–TC10), the same as Swift and Python, through the app's own paths.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type CountCase = { id: string; note: string; steps: AnalyzerStep[]; expect: Record<string, unknown> }
const DATA = JSON.parse(readFileSync('test/fixtures/tap-count-change.json', 'utf8')) as { cases: CountCase[] }

describe('tap-count-change — the shared cases (tap-count-change.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    let statusBeforeStep = a.statusMessage
    for (const step of c.steps) {
      statusBeforeStep = a.statusMessage
      expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    for (const [field, want] of Object.entries(c.expect)) {
      switch (field) {
        case 'statusMessage': expect(a.statusMessage, field).toBe(want); break
        case 'statusUnchangedByLastStep': expect(a.statusMessage === statusBeforeStep, `${field}: ${statusBeforeStep} → ${a.statusMessage}`).toBe(want); break
        case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
        case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
        case 'detecting': expect(a.isDetecting, field).toBe(want); break
        case 'capturedTaps': expect(a.capturedTaps.length, field).toBe(want); break
        case 'numberOfTaps': expect(a.numberOfTaps, field).toBe(want); break
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})
