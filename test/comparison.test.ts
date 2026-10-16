// @parity test/comparison
//
// Comparing saved measurements: the entries a comparison holds, their labels and range, the mode, detection
// standing down, the per-tap overlay giving way, each entry's Air/Top/Back taken from its source, and saving
// and loading a comparison. The shared cases in comparison.json (CM1–CM25), the same as Swift and Python.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile } from '../src/measurement'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { listMeasurements, clearMeasurements } from '../src/measurement/store'
import { saveComparison } from './saveFromAnalyzer'
import { makeStepsAnalyzer, runAnalyzerStep, PHASE_RAW, type AnalyzerStep } from './analyzerSteps'

type Fields = Record<string, unknown>
type ComparisonStep = AnalyzerStep & {
  compare?: string[]
  clearComparison?: boolean
  load?: string
  multiTap?: boolean
  saveComparison?: string
  loadSaved?: boolean
  check?: Fields
}
type ComparisonCase = { id: string; note: string; steps: ComparisonStep[]; expect: Fields }
const DATA = JSON.parse(readFileSync('test/fixtures/comparison.json', 'utf8')) as {
  files: Record<string, unknown>
  peakNames: Record<string, string>
  cases: ComparisonCase[]
}
const PEAK_NAMES = new Map(Object.entries(DATA.peakNames).map(([id, n]) => [id.toUpperCase(), n]))
const peakName = (id: string) => PEAK_NAMES.get(id.toUpperCase()) ?? id
const measurement = (name: string) => parseGuitarTapFile(JSON.stringify(DATA.files[name]))[0]!

async function check(fields: Fields, a: TapToneAnalyzer): Promise<void> {
  const entries = a.comparisonEntries
  for (const [field, want] of Object.entries(fields)) {
    switch (field) {
      case 'entries': expect(entries.length, field).toBe(want); break
      case 'labels': expect(entries.map((e) => e.label), field).toEqual(want); break
      case 'mode': expect(a.displayMode, field).toBe(want); break
      case 'loadedRange': {
        const r = a.loadedAxisRange
        expect(r ? [r.minHz, r.maxHz, r.minDb, r.maxDb] : null, field).toEqual(want)
        break
      }
      case 'detecting': expect(a.isDetecting, field).toBe(want); break
      case 'multiTap': expect(a.showingMultiTapComparison, field).toBe(want); break
      case 'tapEntries': expect(a.tapEntries.length, field).toBe(want); break
      case 'savedComparison': expect(a.isSavedMeasurementComparison, field).toBe(want); break
      case 'modeIds': {
        const ids = entries[0]?.modePeakIDs ?? {}
        expect(Object.fromEntries(Object.entries(ids).map(([m, id]) => [m, peakName(id)])), field).toEqual(want)
        break
      }
      case 'entryGuitarType': expect(entries[0]?.guitarType ?? null, field).toBe(want); break
      case 'entryPeaks':
        expect((entries[0]?.peaks ?? []).map((p) => peakName(p.id)).sort(), field).toEqual([...(want as string[])].sort())
        break
      case 'savedRecord': {
        const library = await listMeasurements()
        if (want === null) expect(library, `${field}: none added`).toHaveLength(0)
        else {
          const w = want as { name: string; entries: number }
          expect(library, `${field}: a record added`).toHaveLength(1)
          expect(library.at(-1)!.measurementName, `${field} name`).toBe(w.name)
          expect(library.at(-1)!.comparisonEntries?.length, `${field} entries`).toBe(w.entries)
        }
        break
      }
      case 'phase': expect(PHASE_RAW[a.materialTapPhase], field).toBe(want); break
      case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
      default: throw new Error(`unknown field ${field}`)
    }
  }
}

beforeEach(async () => {
  await clearMeasurements()
})

describe('comparison — the shared cases (comparison.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { a, store } = makeStepsAnalyzer()
    for (const step of c.steps) {
      if (step.compare) a.loadComparison(step.compare.map(measurement))
      else if (step.clearComparison) a.clearComparison()
      else if (step.load !== undefined) a.loadMeasurement(measurement(step.load))
      else if (step.multiTap !== undefined) a.applyMultiTapComparisonOverlays(step.multiTap)
      else if (step.saveComparison !== undefined) await a.saveComparison(step.saveComparison, '')
      else if (step.loadSaved) a.loadMeasurement((await listMeasurements()).at(-1)!)
      else if (step.check) await check(step.check, a)
      else expect(runAnalyzerStep(step, a, store), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    await check(c.expect, a)
  })
})
