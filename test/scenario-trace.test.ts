// @parity test/scenario-trace
//
// End-to-end scenarios, pinned by the state they pass through — detecting, paused, complete, the tap count
// and the taps held — not only where they end: the app's behaviour on screen follows each intermediate
// state, so two editions reaching the same result by different paths would differ. Every tap is a real
// capture finish and every wait is audio fed through the analyzer's clock. The shared cases in
// scenario-trace.json (S1–S9), the same as Swift and Python.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { makeStepsAnalyzer, runAnalyzerStep, type AnalyzerStep } from './analyzerSteps'

type TraceStep = AnalyzerStep & { snap?: string }
type TraceCase = { id: string; note: string; steps: TraceStep[]; expect: { trace: Record<string, unknown>[] } }
const DATA = JSON.parse(readFileSync('test/fixtures/scenario-trace.json', 'utf8')) as { cases: TraceCase[] }

/** The state a `snap` step records, in the case file's form. */
function snapshot(label: string, a: TapToneAnalyzer): Record<string, unknown> {
  return {
    label, detecting: a.isDetecting, paused: a.isDetectionPaused, complete: a.isMeasurementComplete,
    tapCount: a.currentTapCount, capturedTaps: a.capturedTaps.length,
  }
}

describe('scenario-trace — the shared cases (scenario-trace.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    const trace: Record<string, unknown>[] = []
    for (const step of c.steps) {
      if (step.snap !== undefined) trace.push(snapshot(step.snap, a))
      else expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    expect(trace).toEqual(c.expect.trace)
  })
})
