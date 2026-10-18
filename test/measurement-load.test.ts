// @parity test/measurement-load
//
// Loading a saved measurement: the whole load is the model's — its own settings (written to the settings
// store, as the natives write TapDisplaySettings), its peaks shown under them, its spectra, label positions
// and microphone warning, and the detection state. The shared cases in measurement-load.json (LD1–LD11), the
// same as Swift and Python, run through an analyzer attached to its own settings store.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { parseGuitarTapFile } from '../src/measurement'
import { settingsStore } from '../src/settingsStore'
import { MEASUREMENT_FULL_NAME, isGuitarType } from '../src/settings'

type Step = { newTap?: boolean; peakMin?: number; load?: string; name?: string; compare?: string[]; highlightFirstPeak?: boolean }
type LoadCase = { id: string; note: string; steps: Step[]; expect: Record<string, unknown> }
const DATA = JSON.parse(readFileSync('test/fixtures/measurement-load.json', 'utf8')) as {
  files: Record<string, unknown>
  cases: LoadCase[]
}

/** The measurement a load step names: an inline file of the case table, or a fixture — with its name
 *  replaced when the step gives one (inline files only). */
function measurement(name: string, renamed?: string) {
  const inline = DATA.files[name] as Record<string, unknown>[] | undefined
  if (inline !== undefined && renamed !== undefined) {
    const copy = JSON.parse(JSON.stringify(inline)) as Record<string, unknown>[]
    copy[0]!.measurementName = renamed
    return parseGuitarTapFile(JSON.stringify(copy))[0]!
  }
  const text = inline !== undefined ? JSON.stringify(inline) : readFileSync(`test/fixtures/${name}`, 'utf8')
  return parseGuitarTapFile(text)[0]!
}

describe('measurement-load — the shared cases (measurement-load.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const a = new TapToneAnalyzer()
    for (const step of c.steps) {
      if (step.newTap) {
        a.startTapSequence()
        expect(a.isDetecting, 'precondition: a new tap sequence arms detection').toBe(true)
      }
      else if (step.peakMin !== undefined) a.peakMinThreshold = step.peakMin
      else if (step.load !== undefined) a.loadMeasurement(measurement(step.load, step.name))
      else if (step.compare !== undefined) a.loadComparison(step.compare.map((n) => measurement(n)))
      else if (step.highlightFirstPeak) {
        a.toggleHighlightedPeak(a.peaksAbovePeakMin[0]!.id)
        expect(a.highlightedPeakId, 'precondition: a peak is highlighted').not.toBeNull()
      }
    }
    const s = settingsStore.get()
    const guitar = isGuitarType(s.measurementType)
    for (const [field, want] of Object.entries(c.expect)) {
      switch (field) {
        case 'measurementType': expect(MEASUREMENT_FULL_NAME[s.measurementType], field).toBe(want); break
        case 'peakMinThreshold': expect(a.peakMinThreshold, field).toBe(want); break
        case 'tapDetectionThreshold': expect(a.tapDetectionThreshold, field).toBeCloseTo(want as number, 4); break
        case 'showUnknownModes': expect(s.showUnknownModes, field).toBe(want); break
        case 'shownPeaks':
          expect((guitar ? a.peaksAbovePeakMin : a.materialIdentifiedPeaks).length, field).toBe(want)
          break
        case 'frozenSpectrum': expect(a.frozenFrequencies.length > 0, field).toBe(want); break
        case 'phaseSpectra':
          expect([a.matSpectra.longitudinal, a.matSpectra.cross, a.matSpectra.flc].filter((x) => x != null).length, field).toBe(want)
          break
        case 'complete': expect(a.isMeasurementComplete, field).toBe(want); break
        case 'detecting': expect(a.isDetecting, field).toBe(want); break
        case 'comparison': expect(a.displayMode === 'comparison', field).toBe(want); break
        case 'microphoneWarning': expect(a.microphoneWarning != null, field).toBe(want); break
        case 'highlightedPeak': expect(a.highlightedPeakId != null, field).toBe(want); break
        case 'recordedMicrophone': expect(a.resultProvenance != null, field).toBe(want); break
        case 'loadedName': expect(a.loadedMeasurementName, field).toBe(want); break
        case 'labelPositions': expect(a.annotationOffsets.size, field).toBe(want); break
        default: throw new Error(`unknown field ${field}`)
      }
    }
  })
})
