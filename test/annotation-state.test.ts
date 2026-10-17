// @parity test/annotation-state
//
// The per-peak state the user edits and the views read: dragged label positions, selection, which peaks
// are annotated, mode labels (the user's own and the auto-detected), the one definitive Air/Top/Back and
// the tap-tone ratio, and what clears it all. The shared cases in annotation-state.json (AS1–AS41), the
// same as Swift and Python: each loads its peaks as the app loads a file and edits them as the views do.
//
// Below them, the web's own: the chart markers and the report are built by the web's presentation
// helpers (buildGuitarMarkers, reportPeaks) from the analyzer's visiblePeaks, which the natives' views
// read directly.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { annotatedBy, buildGuitarMarkers } from '../src/presentation/measurementImage'
import { reportPeaks } from '../src/presentation/spectrumExport'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { parseGuitarTapFile, MEASUREMENT_TYPE_FROM_RAW } from '../src/measurement'
import { DEFAULT_SETTINGS, type AnnotationMode } from '../src/settings'
import type { ResolvedMode } from '../src/dsp/classify'
import type { ResonantPeak } from '../src/measurement/types'
import type { SettingsStore } from '../src/settingsStore'
import { makeStepsAnalyzer, runAnalyzerStep, type AnalyzerStep } from './analyzerSteps'
import { testId } from './testIds'
import { parseUuid, type Uuid } from '../src/measurement/newId'

type Fields = Record<string, unknown>
type AnnotationStep = AnalyzerStep & {
  check?: Fields
  load?: string
  toggle?: string
  selectNone?: boolean
  resetToAuto?: boolean
  override?: [string, string]
  resetOverride?: string
  offset?: [string, number, number]
  resetOffset?: string
  resetAllOffsets?: boolean
  visibility?: AnnotationMode
  cycleVisibility?: boolean
  guitarTypeChange?: string
}
type AnnotationCase = {
  id: string
  note: string
  peakIds: Record<string, string>
  files: Record<string, unknown>
  steps: AnnotationStep[]
  expect: Fields
}
const DATA = JSON.parse(readFileSync('test/fixtures/annotation-state.json', 'utf8')) as { cases: AnnotationCase[] }

/** The modes by Swift's case names, as the case file names them. */
const MODES_BY_NAME: Record<string, ResolvedMode> = {
  air: 'air', top: 'top', back: 'back', dipole: 'dipole', ringMode: 'ring', upperModes: 'upper', unknown: 'unknown',
}
const MODE_NAME = Object.fromEntries(Object.entries(MODES_BY_NAME).map(([k, v]) => [v, k])) as Record<ResolvedMode, string>

/** One case's analyzer and the names it gives its peaks. Ids are compared ignoring case. */
class Case {
  readonly a: TapToneAnalyzer
  readonly store: SettingsStore
  readonly ids: Record<string, Uuid>
  readonly names: Map<string, string>

  constructor(readonly row: AnnotationCase) {
    ;({ a: this.a, store: this.store } = makeStepsAnalyzer())
    this.ids = Object.fromEntries(Object.entries(row.peakIds).map(([n, id]) => [n, parseUuid(id, 'peakIds')]))
    this.names = new Map(Object.entries(this.ids).map(([n, id]) => [id, n]))
  }

  /** The id the analyzer holds for that name. */
  id(name: string): Uuid {
    return this.ids[name]!
  }

  nameOf(id: string): string {
    return this.names.get(id.toUpperCase()) ?? id
  }

  run(step: AnnotationStep): boolean {
    const a = this.a
    if (step.load !== undefined) a.loadMeasurement(parseGuitarTapFile(JSON.stringify(this.row.files[step.load]))[0]!)
    else if (step.toggle !== undefined) a.togglePeakSelection(this.id(step.toggle))
    else if (step.selectNone) a.selectNoPeaks()
    else if (step.resetToAuto) a.resetToAutoSelection()
    else if (step.override) a.setModeOverride(this.id(step.override[0]), step.override[1])
    else if (step.resetOverride !== undefined) a.resetModeOverride(this.id(step.resetOverride))
    else if (step.offset) a.updateAnnotationOffset(this.id(step.offset[0]), [step.offset[1], step.offset[2]])
    else if (step.resetOffset !== undefined) a.resetAnnotationOffset(this.id(step.resetOffset))
    else if (step.resetAllOffsets) a.resetAllAnnotationOffsets()
    else if (step.visibility !== undefined) this.store.update({ annotationVisibilityMode: step.visibility })
    else if (step.cycleVisibility) a.cycleAnnotationVisibility()
    else if (step.guitarTypeChange !== undefined) {
      // As Settings applies a type change: the setting, then the model's change of type.
      const previous = this.store.get().measurementType
      const next = MEASUREMENT_TYPE_FROM_RAW[step.guitarTypeChange]!
      this.store.update({ measurementType: next })
      a.changeMeasurementType(previous, next)
    } else return runAnalyzerStep(step, a, this.store)
    return true
  }

  check(fields: Fields): void {
    const a = this.a
    for (const [field, want] of Object.entries(fields)) {
      switch (field) {
        case 'selected':
          expect([...a.selectedPeakIds].map((i) => this.nameOf(i)).sort(), field).toEqual([...(want as string[])].sort())
          break
        case 'userModified': expect(a.userModifiedSelection, field).toBe(want); break
        case 'visible': expect(a.visiblePeaks.map((p) => p.frequency).sort((x, y) => x - y), field).toEqual(want); break
        case 'visibility': expect(a.annotationVisibilityMode, field).toBe(want); break
        case 'label':
          for (const [name, label] of Object.entries(want as Record<string, string>)) {
            expect(a.effectiveModeLabel(this.id(name)), `${field} ${name}`).toBe(label)
          }
          break
        case 'mode':
          for (const [name, mode] of Object.entries(want as Record<string, string>)) {
            expect(MODE_NAME[a.effectiveMode(this.id(name))], `${field} ${name}`).toBe(mode)
          }
          break
        case 'autoMode':
          for (const [name, mode] of Object.entries(want as Record<string, string>)) {
            expect(MODE_NAME[a.autoDetectedMode(this.id(name))], `${field} ${name}`).toBe(mode)
          }
          break
        case 'manualOverride':
          for (const [name, flag] of Object.entries(want as Record<string, boolean>)) {
            expect(a.hasManualOverride(this.id(name)), `${field} ${name}`).toBe(flag)
          }
          break
        case 'overrides':
          expect(Object.fromEntries([...a.overrides].map(([i, l]) => [this.nameOf(i), l])), field).toEqual(want)
          break
        case 'offsets':
          expect(Object.fromEntries([...a.annotationOffsets].map(([i, xy]) => [this.nameOf(i), [...xy]])), field).toEqual(want)
          break
        case 'offsetCount': expect(a.annotationOffsets.size, field).toBe(want); break
        case 'getPeak':
          for (const [mode, name] of Object.entries(want as Record<string, string | null>)) {
            const peak = a.getPeak(MODES_BY_NAME[mode]!)
            expect(peak ? this.nameOf(peak.id) : null, `${field} ${mode}`).toBe(name)
          }
          break
        case 'hasRatio': expect(a.tapToneRatio() !== null, field).toBe(want); break
        case 'definitive': {
          const info = a.definitiveModeInfo()
          for (const [mode, entry] of Object.entries(want as Record<string, { hz: number; isOverride: boolean } | null>)) {
            const got = info[mode as 'air' | 'top' | 'back']
            if (entry === null) expect(got, `${field} ${mode}`).toBeNull()
            else {
              expect(got?.frequency, `${field} ${mode} hz`).toBeCloseTo(entry.hz, 4)
              expect(got?.isOverride, `${field} ${mode} isOverride`).toBe(entry.isOverride)
            }
          }
          break
        }
        case 'selectedIsAuto': {
          const auto = a.guitarModeSelectedPeakIds(a.peaks)
          const same = auto.size === a.selectedPeakIds.size && [...auto].every((i) => a.selectedPeakIds.has(i))
          expect(same, field).toBe(want)
          break
        }
        case 'materialPeakMode': {
          const fL = a.selectedLongitudinalPeak
          expect(fL, `${field}: a captured fL peak`).not.toBeNull()
          expect(MODE_NAME[a.effectiveMode(fL!.id)], field).toBe(want)
          break
        }
        default: throw new Error(`unknown field ${field}`)
      }
    }
  }
}

describe('annotation-state — the shared cases (annotation-state.json)', () => {
  it.each(DATA.cases.map((c) => [c.id, c] as const))('%s', (_id, row) => {
    const c = new Case(row)
    for (const step of row.steps) {
      if (step.check) c.check(step.check)
      else expect(c.run(step), `unknown step ${JSON.stringify(step)}`).toBe(true)
    }
    c.check(row.expect)
  })
})

// The web's presentation helpers: three peaks, ids 1..3, with their modes.
const PEAKS: ResonantPeak[] = [
  { id: testId(1), frequency: 97.4, magnitude: -63.2, quality: 10, bandwidth: 9.74, timestamp: '2026-09-25T00:00:00Z' },
  { id: testId(2), frequency: 197.4, magnitude: -41.5, quality: 10, bandwidth: 19.74, timestamp: '2026-09-25T00:00:00Z' },
  { id: testId(3), frequency: 239.6, magnitude: -54.5, quality: 10, bandwidth: 23.96, timestamp: '2026-09-25T00:00:00Z' },
]
const MODES = new Map<Uuid, ResolvedMode>([
  [testId(1), 'air'],
  [testId(2), 'top'],
  [testId(3), 'back'],
])

/** A guitar analyzer holding `peaks` above Peak Min, with `selected` selected and `mode` set. */
const visibleAnalyzer = (mode: AnnotationMode, selected: Uuid[], peaks = PEAKS, modes = MODES, showUnknownModes = true) => {
  const a = new TapToneAnalyzer()
  a.setSettings({ ...DEFAULT_SETTINGS, measurementType: 'classical', annotationVisibilityMode: mode, showUnknownModes })
  a.measurementType = 'classical'
  a.peaksAbovePeakMin = peaks
  a.modeByPeak = modes
  a.selectedPeakIds = new Set(selected)
  return a
}

describe('annotation-state — the report is about the visible peaks (regression)', () => {
  it('reports the selected count, not the detected count', () => {
    // The shipped bug: header read "Detected Peaks: <all>" (47 vs Swift's 6).
    const markers = buildGuitarMarkers(PEAKS, MODES, annotatedBy('selected', new Set([testId(2)])), new Map())
    expect(markers).toHaveLength(3) // markers still carry every peak…
    expect(reportPeaks(markers)).toHaveLength(1) // …but the report is about the selected one
  })

  it('counts a visible peak OUTSIDE the chart\'s range', () => {
    // Swift's export counts and lists every visible peak (e.g. 409/623/1180 Hz under a 75–350 Hz view).
    // The report reads the analyzer's visiblePeaks, which has no range — not the chart's in-range markers.
    const wide: ResonantPeak[] = [...PEAKS, { id: testId(4), frequency: 994.5, magnitude: -68.6, quality: 10, bandwidth: 99.45, timestamp: '2026-09-25T00:00:00Z' }]
    const a = visibleAnalyzer('all', [], wide, new Map<Uuid, ResolvedMode>([...MODES, [testId(4), 'dipole']]))
    const report = reportPeaks(buildGuitarMarkers(a.visiblePeaks, a.modeByPeak, () => true, new Map()))
    expect(report.map((m) => m.frequency)).toEqual([97.4, 197.4, 239.6, 994.5])
  })

  it('marks exactly the selected peaks as annotated — badges + report follow this flag', () => {
    const markers = buildGuitarMarkers(PEAKS, MODES, annotatedBy('selected', new Set([testId(1), testId(3)])), new Map())
    expect(markers.map((m) => m.annotated)).toEqual([true, false, true])
  })
})
