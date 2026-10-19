// @parity none — a test helper of the web's: Swift's and Python's tests set the analyzer and call its save directly.
// Saving a measurement the way the app does: set an analyzer's state, then build the record through its
// save (`buildMeasurement` / `buildComparisonMeasurement`), as Swift's tests set the analyzer and save.
// The recorded microphone and sample rate come from an attached engine, as live.
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import type { Spectrum } from '../src/dsp/guitarFFT'
import type { MaterialMeasurementInputs } from '../src/measurement/materialMeasurementInputs'
import type { ComparisonEntryModel, ResonantPeak, TapEntry, TapToneMeasurementModel } from '../src/measurement/types'
import type { ChartView } from '../src/presentation/chartTypes'
import type { Settings } from '../src/settings'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Uuid } from '../src/measurement/newId'
import { settingsStore } from '../src/settingsStore'

/** What the microphone side of a capture records. */
interface Provenance {
  sampleRate?: number | null
  deviceLabel?: string
}

/** A completed guitar result on an analyzer. */
export interface GuitarState extends Provenance {
  name: string
  notes: string
  spectrum: Spectrum
  peaks: ResonantPeak[]
  selectedIds: Set<Uuid>
  overridesById: Map<Uuid, string>
  annotationOffsetsById?: Map<Uuid, [number, number]>
  decayTime?: number | null
  view: ChartView
  settings: Settings
  numberOfTaps: number
  tapEntries?: TapEntry[]
  userModified?: boolean
}

/** A completed plate or brace result on an analyzer. */
export interface MaterialState extends Provenance {
  name: string
  notes: string
  spectra: { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
  peaks: { longitudinal: ResonantPeak | null; cross: ResonantPeak | null; flc: ResonantPeak | null }
  view: ChartView
  settings: Settings
  materialInputs: MaterialMeasurementInputs
  numberOfTaps: number
  annotationOffsetsById?: Map<string, [number, number]>
}

function analyzerWith(settings: Settings, p: Provenance): TapToneAnalyzer {
  settingsStore.update(settings)
  const analyzer = new TapToneAnalyzer()
  const engine = new RealtimeFFTAnalyzer()
  engine.sampleRate = p.sampleRate ?? 0
  engine.deviceLabel = p.deviceLabel ?? ''
  analyzer.setDevice(engine)
  return analyzer
}

/** The record a guitar save writes for `s`. */
export function saveGuitar(s: GuitarState): TapToneMeasurementModel {
  const a = analyzerWith(s.settings, s)
  a.frozenMagnitudes = s.spectrum.magnitudesDb
  a.frozenFrequencies = s.spectrum.frequencies
  a.peaks = s.peaks
  a.selectedPeakIds = s.selectedIds
  a.overrides = s.overridesById
  a.annotationOffsets = s.annotationOffsetsById ?? new Map()
  a.currentDecayTime = s.decayTime ?? null
  a.numberOfTaps = s.numberOfTaps
  a.tapEntries = s.tapEntries ?? []
  a.userModifiedSelection = s.userModified ?? false
  return a.buildMeasurement(s.name, s.notes, s.view)!
}

/** The record a plate or brace save writes for `s`. */
export function saveMaterial(s: MaterialState): TapToneMeasurementModel {
  const a = analyzerWith(s.settings, s)
  a.matSpectra = s.spectra
  a.selectedLongitudinalPeak = s.peaks.longitudinal
  a.selectedCrossPeak = s.peaks.cross
  a.selectedFlcPeak = s.peaks.flc
  a.materialInputs = s.materialInputs
  a.numberOfTaps = s.numberOfTaps
  a.annotationOffsets = s.annotationOffsetsById ?? new Map()
  return a.buildMeasurement(s.name, s.notes, s.view)!
}

/** The record a comparison save writes for `entries`. */
export function saveComparison(s: { name: string; notes: string; entries: ComparisonEntryModel[] }): TapToneMeasurementModel {
  const a = new TapToneAnalyzer()
  a.comparisonEntries = s.entries
  a.displayMode = 'comparison'
  return a.buildComparisonMeasurement(s.name, s.notes)!
}
