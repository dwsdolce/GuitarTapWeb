// @parity test/button-enablement
//
// The Pause / New Tap / Cancel enablement rule — `buttonRule`, the production function App.tsx calls —
// against the shared case file `button-enablement.json` (B1–B16), the same cases the Swift and Python suites
// run; and the analyzer's Save / export rule, which drives a live analyzer. Names in the file are Swift's;
// the web spells the material phases short (reviewingL for reviewingLongitudinal).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer, type MaterialTapPhase } from '../src/state/tapToneAnalyzer'
import { buttonRule, type ButtonState } from '../src/state/buttonEnablement'

type Row = { id: string; name: string; state: Record<string, unknown>; expect: Record<string, boolean> }
const CASES = (JSON.parse(readFileSync('test/fixtures/button-enablement.json', 'utf8')) as { buttonRule: Row[] }).buttonRule

const PHASE: Record<string, MaterialTapPhase> = {
  notStarted: 'notStarted', capturingLongitudinal: 'capturingL', reviewingLongitudinal: 'reviewingL',
  capturingCross: 'capturingC', reviewingCross: 'reviewingC', waitingForFlcTap: 'waitingForFlcTap',
  capturingFlc: 'capturingFlc', reviewingFlc: 'reviewingFlc', complete: 'complete',
}

/** A case's state: the fields it sets, the rest left at ButtonState's defaults. */
function state(s: Record<string, unknown>): ButtonState {
  const out = { ...s } as unknown as ButtonState
  if (typeof s.materialTapPhase === 'string') out.materialTapPhase = PHASE[s.materialTapPhase]
  return out
}

describe('button-enablement — shared cases', () => {
  for (const row of CASES) {
    it(`${row.id} ${row.name}`, () => {
      const out = buttonRule(state(row.state)) as unknown as Record<string, boolean>
      for (const [key, expected] of Object.entries(row.expect)) expect(out[key], key).toBe(expected)
    })
  }

  // Save and the exports: enabled only when there is something to save or export — a complete
  // measurement or a comparison. One analyzer rule, read by the Save and export buttons.
  it('hasResultToSaveOrExport — only a complete measurement or a comparison', () => {
    const a = new TapToneAnalyzer()
    expect(a.hasResultToSaveOrExport, 'nothing to save or export while live').toBe(false)
    a.isMeasurementComplete = true
    expect(a.hasResultToSaveOrExport, 'a complete measurement').toBe(true)
    a.isMeasurementComplete = false
    a.displayMode = 'comparison'
    expect(a.hasResultToSaveOrExport, 'a comparison').toBe(true)
  })
})
