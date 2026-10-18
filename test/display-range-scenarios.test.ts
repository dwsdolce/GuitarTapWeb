// @parity test/display-range
//
// The analyzer's side of the chart's range: the range a load publishes for the chart (a measurement's
// snapshot range exactly, or the saved range when it has none) without moving the analysis range, and the
// announcements of the three material peaks the chart widens onto. The 'scenarios' of the shared
// display-range.json (DR1–DR7; DR7 — the web's sequence-start count — is the web's alone), the same as
// Swift and Python. The widening decision itself is display-range.test.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import type { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { parseGuitarTapFile } from '../src/measurement'
import { minFrequency, maxFrequency } from '../src/settings'
import { settingsStore } from '../src/settingsStore'
import { makeStepsAnalyzer, runAnalyzerStep, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type ScenarioStep = AnalyzerStep & { load?: string; listen?: boolean; check?: Fields }
type Scenario = { id: string; only?: string; note: string; steps: ScenarioStep[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/display-range.json', 'utf8')) as {
  files: Record<string, unknown>
  scenarios: Scenario[]
}
/** The scenarios for the web: all but those marked for the natives alone. */
const SCENARIOS = DATA.scenarios.filter((c) => c.only !== 'natives')

type Phase = 'L' | 'C' | 'FLC'
/** Each phase's peak frequency as announced: the analyzer notifies on every change, so an announcement of a
 *  phase is a notification at which its peak differs from the last one heard. */
function listen(a: TapToneAnalyzer): Record<Phase, (number | null)[]> {
  const heard: Record<Phase, (number | null)[]> = { L: [], C: [], FLC: [] }
  const current = () => ({
    L: a.selectedLongitudinalPeak?.frequency ?? null,
    C: a.selectedCrossPeak?.frequency ?? null,
    FLC: a.selectedFlcPeak?.frequency ?? null,
  })
  let last = current()
  a.subscribe(() => {
    const now = current()
    for (const phase of ['L', 'C', 'FLC'] as const) if (now[phase] !== last[phase]) heard[phase].push(now[phase])
    last = now
  })
  return heard
}

function check(fields: Fields, a: TapToneAnalyzer, heard: Record<Phase, (number | null)[]> | null): void {
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'loadedRange': {
        const r = a.loadedAxisRange
        const s = settingsStore.get()
        const wanted = want === 'saved'
          ? [minFrequency(s, s.measurementType), maxFrequency(s, s.measurementType), s.minDb, s.maxDb]
          : (want as number[])
        expect(r, field).not.toBeNull()
        ;[r!.minHz, r!.maxHz, r!.minDb, r!.maxDb].forEach((v, i) => expect(v, `${field}[${i}]`).toBeCloseTo(wanted[i]!, 4))
        break
      }
      case 'analysisRange': expect([a.minFrequency, a.maxFrequency], field).toEqual(want); break
      case 'lastAnnounced':
        for (const [phase, hz] of Object.entries(want as Record<Phase, number>)) {
          expect(heard?.[phase as Phase].at(-1), `${field} ${phase}`).toBeCloseTo(hz, 3)
        }
        break
      case 'announced':
        for (const [phase, list] of Object.entries(want as Record<Phase, (number | null)[]>)) {
          expect(heard?.[phase as Phase], `${field} ${phase}`).toEqual(list)
        }
        break
      case 'peaksFromLoad': expect(a.getSnapshot().materialPeaksFromLoad, field).toBe(want); break
      case 'sequenceStarts': expect(a.getSnapshot().sequenceStarts, field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

describe('display-range — the shared scenarios (display-range.json)', () => {
  it.each(SCENARIOS.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = makeStepsAnalyzer()
    let heard: Record<Phase, (number | null)[]> | null = null
    for (const step of c.steps) {
      if (step.load !== undefined) a.loadMeasurement(parseGuitarTapFile(JSON.stringify(DATA.files[step.load]))[0]!)
      else if (step.listen) heard = listen(a)
      else if (step.check) check(step.check, a, heard)
      else expect(runAnalyzerStep(step, a), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    check(c.expect, a, heard)
  })
})
