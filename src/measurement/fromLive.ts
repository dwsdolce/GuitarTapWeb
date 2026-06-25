// Bridge between the live analysis state (numeric-id peaks, frequency-keyed overrides)
// and the persisted TapToneMeasurementModel (UUID peaks, UUID-keyed maps). 4b uses this
// to build a measurement from the current frozen guitar result and to restore one back
// into the view. Guitar measurements only for now (material persistence is a follow-up).

import type { Spectrum } from '../dsp/guitarFFT'
import type { Peak } from '../dsp/peaks'
import { classifyAll, type ResolvedMode } from '../dsp/classify'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { Pitch } from '../dsp/pitch'
import { MODE_DISPLAY_NAME } from '../components/modeColors'
import type { ChartView } from '../components/SpectrumChart'
import {
  DEFAULT_SETTINGS,
  MEASUREMENT_FULL_NAME,
  type MeasurementType,
  type Settings,
} from '../settings'
import type { ResonantPeakModel, SpectrumSnapshotModel, TapToneMeasurementModel } from './types'

const GUITAR_TYPE_RAW: Record<string, string> = {
  generic: 'Generic',
  acoustic: 'Acoustic',
  classical: 'Classical',
  flamenco: 'Flamenco',
}

const GUITAR_TYPE_NAME_FROM_RAW: Record<string, GuitarTypeName> = {
  Generic: 'generic',
  Acoustic: 'acoustic',
  Classical: 'classical',
  Flamenco: 'flamenco',
}

const uuid = (): string => crypto.randomUUID().toUpperCase()

/** ISO-8601 without fractional seconds, matching Swift's `.iso8601` strategy. */
const isoNow = (): string => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

const key = (freqHz: number): string => freqHz.toFixed(1)

export interface BuildMeasurementArgs {
  name: string
  notes: string
  spectrum: Spectrum
  peaks: Peak[]
  modeByPeak: Map<number, ResolvedMode>
  selectedIds: Set<number>
  /** Per-frequency label overrides, keyed by `frequency.toFixed(1)` (the live form). */
  overridesByFreq: Map<string, string>
  view: ChartView
  settings: Settings
  numberOfTaps: number
  sampleRate: number | null
  deviceLabel: string
}

/** Construct a guitar TapToneMeasurementModel from the current frozen result. */
export function buildGuitarMeasurement(a: BuildMeasurementArgs): TapToneMeasurementModel {
  const pitch = new Pitch(440)
  const timestamp = isoNow()
  const guitarTypeRaw = GUITAR_TYPE_RAW[a.settings.measurementType] ?? 'Generic'
  const measurementTypeRaw = MEASUREMENT_FULL_NAME[a.settings.measurementType]

  // Assign a stable UUID per peak; remember each peak's frequency for the parallel maps.
  const peakModels: ResonantPeakModel[] = []
  const idForNumeric = new Map<number, string>()
  for (const p of a.peaks) {
    const id = uuid()
    idForNumeric.set(p.id, id)
    const mode = a.modeByPeak.get(p.id) ?? 'unknown'
    const override = a.overridesByFreq.get(key(p.frequency))
    const note = pitch.note(p.frequency)
    peakModels.push({
      id,
      frequency: p.frequency,
      magnitude: p.magnitude,
      quality: p.quality,
      bandwidth: p.bandwidth,
      timestamp,
      pitchNote: note,
      pitchCents: pitch.cents(p.frequency),
      pitchFrequency: pitch.freq0(p.frequency),
      modeLabel: override ?? MODE_DISPLAY_NAME[mode],
    })
  }

  const snapshot: SpectrumSnapshotModel = {
    frequencies: a.spectrum.frequencies,
    magnitudes: a.spectrum.magnitudesDb,
    minFreq: a.view.minHz,
    maxFreq: a.view.maxHz,
    minDB: a.view.minDb,
    maxDB: a.view.maxDb,
    isLogarithmic: false,
    showUnknownModes: a.settings.showUnknownModes,
    guitarType: guitarTypeRaw,
    measurementType: measurementTypeRaw,
  }

  const selected = a.peaks.filter((p) => a.selectedIds.has(p.id))
  const peakModeOverrides: Record<string, string> = {}
  for (const p of a.peaks) {
    const override = a.overridesByFreq.get(key(p.frequency))
    if (override != null) peakModeOverrides[idForNumeric.get(p.id)!] = override
  }

  return {
    id: uuid(),
    timestamp,
    peaks: peakModels,
    measurementName: a.name.trim() || undefined,
    notes: a.notes.trim() || undefined,
    spectrumSnapshot: snapshot,
    selectedPeakIDs: selected.map((p) => idForNumeric.get(p.id)!),
    selectedPeakFrequencies: selected.map((p) => p.frequency),
    annotationVisibilityMode: a.settings.annotationVisibilityMode,
    tapDetectionThreshold: a.settings.tapDetectionThreshold,
    numberOfTaps: a.numberOfTaps,
    peakMinThreshold: a.settings.peakMinThreshold,
    peakModeOverrides: Object.keys(peakModeOverrides).length ? peakModeOverrides : undefined,
    microphoneName: a.deviceLabel || undefined,
    sampleRate: a.sampleRate ?? undefined,
  }
}

const MEASUREMENT_TYPE_FROM_RAW: Record<string, MeasurementType> = Object.fromEntries(
  Object.entries(MEASUREMENT_FULL_NAME).map(([k, v]) => [v, k as MeasurementType]),
)

/** Top-to-Air frequency ratio for a saved guitar measurement, mirroring Swift/Python
 *  `tapToneRatio`: classify the selected peaks (all peaks if none recorded) and divide the
 *  first Top frequency by the first Air frequency. Null when either mode is absent. */
export function measurementTapToneRatio(m: TapToneMeasurementModel): number | null {
  const snap = m.spectrumSnapshot
  if (!snap) return null
  const gt = GUITAR_TYPE_NAME_FROM_RAW[snap.guitarType ?? ''] ?? 'generic'
  const selected = m.selectedPeakIDs?.length ? new Set(m.selectedPeakIDs) : null
  const src = selected ? m.peaks.filter((p) => selected.has(p.id)) : m.peaks
  if (!src.length) return null
  const adapter: Peak[] = src.map((p, i) => ({
    id: i,
    frequency: p.frequency,
    magnitude: p.magnitude,
    quality: p.quality,
    bandwidth: p.bandwidth,
  }))
  const modeMap = classifyAll(adapter, gt)
  let air: number | null = null
  let top: number | null = null
  src.forEach((p, i) => {
    const mode = modeMap.get(i)
    if (mode === 'air' && air == null) air = p.frequency
    if (mode === 'top' && top == null) top = p.frequency
  })
  return air != null && top != null && air > 0 ? top / air : null
}

export interface LiveRestore {
  measurementType: MeasurementType
  captured: Spectrum
  view: ChartView
  settingsPatch: Partial<Settings>
  /** The saved peaks, authoritative — never re-derived from the spectrum. Numeric ids
   *  are the array index; Peak Min only filters these by magnitude (matching Swift
   *  recalculateFrozenPeaksIfNeeded / Python recalculate_frozen_peaks_if_needed). */
  loadedPeaks: Peak[]
  /** Numeric ids (indices) of the selected peaks. */
  selectedIndices: Set<number>
  /** Per-frequency overrides to restore (keyed by `frequency.toFixed(1)`). */
  overridesByFreq: Map<string, string>
}

/** Decompose a saved guitar measurement into the pieces the App restores into the view.
 *  The saved peaks are injected verbatim (stable index ids); selection is restored by
 *  the saved ids 1:1 and overrides are keyed by frequency (the live override form). */
export function measurementToLive(m: TapToneMeasurementModel): LiveRestore {
  const snap = m.spectrumSnapshot
  if (!snap) throw new Error('Measurement has no guitar spectrum snapshot')

  const measurementType = MEASUREMENT_TYPE_FROM_RAW[snap.measurementType ?? ''] ?? 'generic'

  const loadedPeaks: Peak[] = m.peaks.map((p, i) => ({
    id: i,
    frequency: p.frequency,
    magnitude: p.magnitude,
    quality: p.quality,
    bandwidth: p.bandwidth,
  }))

  const overridesByFreq = new Map<string, string>()
  const indexByUuid = new Map(m.peaks.map((p, i) => [p.id, i]))
  for (const [id, label] of Object.entries(m.peakModeOverrides ?? {})) {
    const i = indexByUuid.get(id)
    if (i != null) overridesByFreq.set(key(m.peaks[i]!.frequency), label)
  }

  // Selection restores from the saved ids (1:1 with the injected peaks); if none were
  // saved, default to selecting all peaks (matches Swift loadMeasurement).
  const selectedIndices = new Set<number>(
    m.selectedPeakIDs
      ? m.selectedPeakIDs.map((id) => indexByUuid.get(id)).filter((i): i is number => i != null)
      : m.peaks.map((_, i) => i),
  )

  const settingsPatch: Partial<Settings> = {
    measurementType,
    displayMinHz: Math.round(snap.minFreq),
    displayMaxHz: Math.round(snap.maxFreq),
    minDb: Math.round(snap.minDB),
    maxDb: Math.round(snap.maxDB),
    showUnknownModes: snap.showUnknownModes ?? DEFAULT_SETTINGS.showUnknownModes,
    peakMinThreshold: m.peakMinThreshold ?? DEFAULT_SETTINGS.peakMinThreshold,
  }
  if (m.tapDetectionThreshold != null) settingsPatch.tapDetectionThreshold = m.tapDetectionThreshold
  if (m.annotationVisibilityMode != null) settingsPatch.annotationVisibilityMode = m.annotationVisibilityMode

  return {
    measurementType,
    captured: { magnitudesDb: snap.magnitudes, frequencies: snap.frequencies },
    view: { minHz: snap.minFreq, maxHz: snap.maxFreq, minDb: snap.minDB, maxDb: snap.maxDB },
    settingsPatch,
    loadedPeaks,
    selectedIndices,
    overridesByFreq,
  }
}