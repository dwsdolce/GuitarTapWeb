// @parity test/effective-peak-id
//
// The id each material phase's peak is saved and exported under — effectiveLongitudinalPeakID,
// effectiveCrossPeakID, effectiveFlcPeakID: none until the phase's peak is chosen, then that peak's id.
// The shared cases in effective-peak-id.json (EP1–EP4), the same as Swift and Python, through real plate
// taps.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeStepsAnalyzer, runAnalyzerStep, type AnalyzerStep } from './analyzerSteps'

type PeakIdCase = { id: string; note: string; steps: AnalyzerStep[]; expect: Record<string, string | null> }
const DATA = JSON.parse(readFileSync('test/fixtures/effective-peak-id.json', 'utf8')) as { cases: PeakIdCase[] }

describe('effective-peak-id — the shared cases (effective-peak-id.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    for (const step of c.steps) expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    const phases = {
      L: [a.effectiveLongitudinalPeakID, a.selectedLongitudinalPeak],
      C: [a.effectiveCrossPeakID, a.selectedCrossPeak],
      FLC: [a.effectiveFlcPeakID, a.selectedFlcPeak],
    } as const
    for (const [phase, want] of Object.entries(c.expect)) {
      const [effective, selected] = phases[phase as keyof typeof phases]
      if (want === 'selected') {
        expect(effective, phase).not.toBeNull()
        expect(effective, phase).toBe(selected?.id)
      } else expect(effective, phase).toBeNull()
    }
  })
})
