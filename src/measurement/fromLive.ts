// Bridge between the live analysis state (numeric-id peaks, frequency-keyed overrides)
// and the persisted TapToneMeasurementModel (UUID peaks, UUID-keyed maps). 4b uses this
// to build a measurement from the current frozen guitar result and to restore one back
// into the view. Guitar measurements only for now (material persistence is a follow-up).

import { type Spectrum } from '../dsp/guitarFFT'
import type { Peak } from '../dsp/peaks'
import type { TapEntry } from '../state/tapToneAnalyzer'
import type { MaterialPeak } from '../dsp/gatedCapture'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from '../dsp/classify'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { exportStem } from './exportFilename'
import { Pitch } from '../dsp/pitch'
import { MODE_DISPLAY_NAME } from '../presentation/modeColors'
import { formatDisplayDateCompact } from '../format/date'
import type { ChartView } from '../presentation/chartTypes'
import {
  DEFAULT_SETTINGS,
  MEASUREMENT_FULL_NAME,
  MEASUREMENT_SHORT_NAME,
  STIFFNESS_RAW_NAME,
  type MeasurementType,
  type Settings,
  type StiffnessPreset,
} from '../settings'
import type { AnnotationOffsets, ComparisonEntryModel, ResonantPeakModel, SpectrumSnapshotModel, TapEntryModel, TapToneMeasurementModel } from './types'

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

// Snapshot `plateStiffnessPreset` raw values (Swift `PlateStiffnessPreset.rawValue`) ↔ web preset.
// Reverse of the store's STIFFNESS_RAW_NAME (dedupes what used to be a local copy of both maps).
const STIFFNESS_FROM_RAW: Record<string, StiffnessPreset> = Object.fromEntries(
  Object.entries(STIFFNESS_RAW_NAME).map(([preset, raw]) => [raw, preset as StiffnessPreset]),
) as Record<string, StiffnessPreset>

const uuid = (): string => crypto.randomUUID().toUpperCase()

/** A fresh measurement id (uppercase UUID, matching Swift). Used on import so a
 *  re-imported file becomes a NEW library entry rather than overwriting by id —
 *  mirroring Swift `importMeasurements`, whose array store allows duplicate copies. */
export const newMeasurementId = uuid

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
  /** Per-tap entries (multi-tap capture) — spectrum + peaks — saved as the measurement's tapEntries. */
  tapEntries?: TapEntry[]
  sampleRate: number | null
  deviceLabel: string
  /** Active input deviceId + calibration name at capture time (provenance for the Details pane). */
  microphoneUID?: string
  calibrationName?: string
  /** Dragged annotation-label positions, keyed by `frequency.toFixed(1)` → [absFreqHz, absDB]. */
  annotationOffsetsByFreq?: Map<string, [number, number]>
  /** Measured ring-out time (s) from the engine, or null/undefined if not measured. */
  decayTime?: number | null
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
  const peakAnnotationOffsets: AnnotationOffsets = {}
  for (const p of a.peaks) {
    const override = a.overridesByFreq.get(key(p.frequency))
    if (override != null) peakModeOverrides[idForNumeric.get(p.id)!] = override
    const offset = a.annotationOffsetsByFreq?.get(key(p.frequency))
    if (offset != null) peakAnnotationOffsets[idForNumeric.get(p.id)!] = offset
  }

  // Per-tap entries for the multi-tap comparison view (mirrors Swift tapEntries):
  // each tap's spectrum snapshot + its peaks + the auto-selected per-mode peak IDs.
  const guitarTypeName = GUITAR_TYPE_NAME_FROM_RAW[guitarTypeRaw] ?? 'generic'
  const tapEntries: TapEntryModel[] | undefined =
    a.tapEntries && a.tapEntries.length > 1
      ? a.tapEntries.map((entry) => {
          // Peaks were already found on the entry by the analyzer (at the current Peak Min); save those
          // and resolve the auto-selected per-mode peaks — identical to the old per-spectrum recompute.
          const modes = resolvedModePeaks(entry.peaks, guitarTypeName)
          const idByNumeric = new Map<number, string>()
          const tapPeaks: ResonantPeakModel[] = entry.peaks.map((p) => {
            const id = uuid()
            idByNumeric.set(p.id, id)
            return { id, frequency: p.frequency, magnitude: p.magnitude, quality: p.quality, bandwidth: p.bandwidth, timestamp }
          })
          const selectedPeakIDs = (['air', 'top', 'back'] as const)
            .map((mode) => modes.get(mode))
            .filter((p): p is Peak => p != null)
            .map((p) => idByNumeric.get(p.id)!)
          return {
            id: uuid(),
            tapIndex: entry.tapIndex,
            snapshot: { ...snapshot, frequencies: entry.spectrum.frequencies, magnitudes: entry.spectrum.magnitudesDb },
            peaks: tapPeaks,
            selectedPeakIDs,
          }
        })
      : undefined

  return {
    id: uuid(),
    timestamp,
    peaks: peakModels,
    decayTime: a.decayTime ?? undefined,
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
    peakAnnotationOffsets: Object.keys(peakAnnotationOffsets).length ? peakAnnotationOffsets : undefined,
    tapEntries,
    microphoneName: a.deviceLabel || undefined,
    microphoneUID: a.microphoneUID || undefined,
    calibrationName: a.calibrationName || undefined,
    sampleRate: a.sampleRate ?? undefined,
  }
}

const MEASUREMENT_TYPE_FROM_RAW: Record<string, MeasurementType> = Object.fromEntries(
  Object.entries(MEASUREMENT_FULL_NAME).map(([k, v]) => [v, k as MeasurementType]),
)

/** A measurement's type as the single Settings-vocabulary word shown in the Details pane:
 *  Acoustic / Classical / Flamenco / Generic / Plate / Brace / Comparison. */
export function measurementTypeName(m: TapToneMeasurementModel): string {
  if (m.comparisonEntries != null) return 'Comparison'
  const raw = (m.spectrumSnapshot ?? m.longitudinalSnapshot)?.measurementType
  const t = raw != null ? MEASUREMENT_TYPE_FROM_RAW[raw] : undefined
  return t != null ? MEASUREMENT_SHORT_NAME[t] : (raw ?? '—')
}

/** The current capture setup, for the load-time provenance check. */
export interface CaptureSetup {
  microphoneName?: string
  sampleRate?: number | null
  calibrationName?: string
}

/** Tiered load-time warning, mirroring Swift `loadMeasurement` / Python `load_measurement`
 *  (the sample-rate epic): if the recorded microphone isn't the current input → name
 *  warning; if it's the same mic but the calibration and/or sample rate differ → a
 *  "recorded with a different …" warning; otherwise null. The web has no device picker or
 *  calibration yet, so "current mic" is the live `track.label` and calibration is absent. */
export function measurementWarning(m: TapToneMeasurementModel, current: CaptureSetup): string | null {
  const recorded = m.microphoneName
  if (!recorded) return null

  // `track.label` varies across browsers for the SAME physical device — e.g. Chrome
  // reports "MacBook Pro Microphone (Built-in)" where Safari reports "MacBook Pro
  // Microphone". Normalise (drop parenthetical suffixes, collapse whitespace, lowercase)
  // so those cosmetic differences don't read as a different mic. (Swift matches on the
  // stable CoreAudio UID; the web has only the label, so this is the closest equivalent.)
  const normMic = (s: string): string =>
    s.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const matched = current.microphoneName != null && normMic(recorded) === normMic(current.microphoneName)
  if (!matched) {
    const cur = current.microphoneName ? ` ('${current.microphoneName}')` : ''
    return `This measurement was recorded with '${recorded}', which isn't the current input${cur}. A newly captured tap may not match the saved result.`
  }

  const diffs: string[] = []
  if ((m.calibrationName ?? null) !== (current.calibrationName ?? null)) diffs.push('calibration')
  if (
    m.sampleRate != null &&
    current.sampleRate != null &&
    Math.round(m.sampleRate) !== Math.round(current.sampleRate)
  ) {
    diffs.push('sample rate')
  }
  return diffs.length
    ? `This measurement was recorded with a different ${diffs.join(' and ')}. A newly captured tap may not match the saved result.`
    : null
}

/** Filesystem-safe `.guitartap` base name, mirroring Swift `baseFilename`:
 *  `<measurement-name-slug>-<unix timestamp>`. */
export function guitarTapFilename(m: TapToneMeasurementModel): string {
  const ts = Math.floor((Date.parse(m.timestamp) || 0) / 1000)
  return `${exportStem(m.measurementName, ts, 'measurement')}.guitartap`
}

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
  /** Dragged annotation-label positions to restore (keyed by `frequency.toFixed(1)`). */
  annotationOffsetsByFreq: Map<string, [number, number]>
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
  const annotationOffsetsByFreq = new Map<string, [number, number]>()
  const indexByUuid = new Map(m.peaks.map((p, i) => [p.id, i]))
  for (const [id, label] of Object.entries(m.peakModeOverrides ?? {})) {
    const i = indexByUuid.get(id)
    if (i != null) overridesByFreq.set(key(m.peaks[i]!.frequency), label)
  }
  for (const [id, pos] of Object.entries(m.peakAnnotationOffsets ?? {})) {
    const i = indexByUuid.get(id)
    if (i != null) annotationOffsetsByFreq.set(key(m.peaks[i]!.frequency), pos)
  }

  // Selection restores from the saved ids (1:1 with the injected peaks); if none were
  // saved, default to selecting all peaks (matches Swift loadMeasurement).
  const selectedIndices = new Set<number>(
    m.selectedPeakIDs
      ? m.selectedPeakIDs.map((id) => indexByUuid.get(id)).filter((i): i is number => i != null)
      : m.peaks.map((_, i) => i),
  )

  // The loaded axis range (freq AND dB) is carried in `view` and applied as a TRANSIENT
  // override by the caller (Swift loadedAxisRange) — it is NOT persisted to settings, so
  // no display range goes in the patch here.
  const settingsPatch: Partial<Settings> = {
    measurementType,
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
    annotationOffsetsByFreq,
  }
}

export interface MaterialRestore {
  measurementType: MeasurementType
  /** Per-phase spectra for the chart overlay. */
  matSpectra: { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
  /** The selected L/C/FLC peaks, for the markers + Material Results panel. */
  matPeaks: { longitudinal: MaterialPeak | null; cross: MaterialPeak | null; flc: MaterialPeak | null }
  /** Type + dimensions to restore so Material Results recomputes correctly. */
  settingsPatch: Partial<Settings>
  /** The saved axis range — applied as a transient override (not persisted), like guitar. */
  view: ChartView
  /** Dragged L/C/FLC label positions (keyed by `frequency.toFixed(1)`), for the shared offset store. */
  annotationOffsetsByFreq: Map<string, [number, number]>
}

/** Decompose a saved plate/brace measurement for restore into the view. Mirrors Swift
 *  `loadMeasurement`'s material branch (per-phase spectra + selected peaks + dims). */
export function measurementToLiveMaterial(m: TapToneMeasurementModel): MaterialRestore {
  const snap = m.longitudinalSnapshot
  if (!snap) throw new Error('Not a material measurement (no longitudinal snapshot)')
  const measurementType = MEASUREMENT_TYPE_FROM_RAW[snap.measurementType ?? ''] ?? 'plate'

  const toSpectrum = (s: SpectrumSnapshotModel | undefined): Spectrum | null =>
    s ? { magnitudesDb: s.magnitudes, frequencies: s.frequencies } : null

  const byId = new Map(m.peaks.map((p) => [p.id, p]))
  const toMatPeak = (id: string | undefined): MaterialPeak | null => {
    const p = id != null ? byId.get(id) : undefined
    return p ? { frequency: p.frequency, magnitude: p.magnitude, quality: p.quality, bandwidth: p.bandwidth } : null
  }

  // Dragged label positions: re-key the saved {peakUUID → [Hz,dB]} offsets by frequency (the live
  // store's key), mirroring the guitar restore path. Stale UUIDs (no matching peak) are dropped.
  const annotationOffsetsByFreq = new Map<string, [number, number]>()
  for (const [id, pos] of Object.entries(m.peakAnnotationOffsets ?? {})) {
    const p = byId.get(id)
    if (p) annotationOffsetsByFreq.set(key(p.frequency), pos)
  }

  // Restore the dimensions so MaterialResults recomputes moduli/quality/Gore numbers.
  // The axis range is transient (see `view` below), so it is NOT in the patch.
  const patch: Partial<Settings> = { measurementType }
  if (snap.plateLength != null) patch.plateLength = snap.plateLength
  if (snap.plateWidth != null) patch.plateWidth = snap.plateWidth
  if (snap.plateThickness != null) patch.plateThickness = snap.plateThickness
  if (snap.plateMass != null) patch.plateMass = snap.plateMass
  if (snap.guitarBodyLength != null) patch.guitarBodyLength = snap.guitarBodyLength
  if (snap.guitarBodyWidth != null) patch.guitarBodyWidth = snap.guitarBodyWidth
  if (snap.plateStiffnessPreset != null) patch.plateStiffnessPreset = STIFFNESS_FROM_RAW[snap.plateStiffnessPreset] ?? 'custom'
  if (snap.customPlateStiffness != null) patch.customPlateStiffness = snap.customPlateStiffness
  if (snap.measureFlc != null) patch.measureFlc = snap.measureFlc
  if (snap.braceLength != null) patch.braceLength = snap.braceLength
  if (snap.braceWidth != null) patch.braceWidth = snap.braceWidth
  if (snap.braceThickness != null) patch.braceThickness = snap.braceThickness
  if (snap.braceMass != null) patch.braceMass = snap.braceMass

  return {
    measurementType,
    matSpectra: {
      longitudinal: toSpectrum(m.longitudinalSnapshot),
      cross: toSpectrum(m.crossSnapshot),
      flc: toSpectrum(m.flcSnapshot),
    },
    matPeaks: {
      longitudinal: toMatPeak(m.selectedLongitudinalPeakID),
      cross: toMatPeak(m.selectedCrossPeakID),
      flc: toMatPeak(m.selectedFlcPeakID),
    },
    settingsPatch: patch,
    view: { minHz: snap.minFreq, maxHz: snap.maxFreq, minDb: snap.minDB, maxDb: snap.maxDB },
    annotationOffsetsByFreq,
  }
}

export interface BuildMaterialArgs {
  name: string
  notes: string
  spectra: { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
  peaks: { longitudinal: MaterialPeak | null; cross: MaterialPeak | null; flc: MaterialPeak | null }
  view: ChartView
  settings: Settings
  sampleRate: number | null
  deviceLabel: string
  microphoneUID?: string
  calibrationName?: string
  /** Dragged L/C/FLC label positions, keyed by `frequency.toFixed(1)` (the shared offset store). */
  annotationOffsetsByFreq?: Map<string, [number, number]>
}

/** Construct a plate/brace TapToneMeasurementModel from the current completed material
 *  result. Mirrors Swift's per-phase snapshots: each snapshot carries the dimensions +
 *  measurementType; the selected L/C/FLC peaks are the measurement's `peaks`. */
export function buildMaterialMeasurement(a: BuildMaterialArgs): TapToneMeasurementModel {
  const timestamp = isoNow()
  const brace = a.settings.measurementType === 'brace'
  const measurementType = MEASUREMENT_FULL_NAME[a.settings.measurementType]
  // Swift/Python write the current guitar-body type on plate/brace snapshots too
  // (falls back to "Generic"); external consumers read it for the top-level guitarType.
  const guitarTypeRaw = GUITAR_TYPE_RAW[a.settings.measurementType] ?? 'Generic'

  // Dimensions written on every per-phase snapshot (matches Swift makePhaseSnapshot).
  const dims: Partial<SpectrumSnapshotModel> = brace
    ? {
        braceLength: a.settings.braceLength,
        braceWidth: a.settings.braceWidth,
        braceThickness: a.settings.braceThickness,
        braceMass: a.settings.braceMass,
      }
    : {
        plateLength: a.settings.plateLength,
        plateWidth: a.settings.plateWidth,
        plateThickness: a.settings.plateThickness,
        plateMass: a.settings.plateMass,
        guitarBodyLength: a.settings.guitarBodyLength,
        guitarBodyWidth: a.settings.guitarBodyWidth,
        plateStiffnessPreset: STIFFNESS_RAW_NAME[a.settings.plateStiffnessPreset],
        customPlateStiffness: a.settings.customPlateStiffness,
        measureFlc: a.settings.measureFlc,
      }

  const makeSnap = (sp: Spectrum): SpectrumSnapshotModel => ({
    frequencies: sp.frequencies,
    magnitudes: sp.magnitudesDb,
    minFreq: a.view.minHz,
    maxFreq: a.view.maxHz,
    minDB: a.view.minDb,
    maxDB: a.view.maxDb,
    isLogarithmic: false,
    showUnknownModes: a.settings.showUnknownModes,
    guitarType: guitarTypeRaw,
    measurementType,
    ...dims,
  })

  // The selected L/C/FLC peaks become the measurement's peaks (UUID each); any dragged label offset
  // is written into the shared peakAnnotationOffsets map keyed by that UUID (gold-standard format).
  const peaks: ResonantPeakModel[] = []
  const peakAnnotationOffsets: AnnotationOffsets = {}
  const addPeak = (mp: MaterialPeak | null): string | undefined => {
    if (!mp) return undefined
    const id = uuid()
    peaks.push({ id, frequency: mp.frequency, magnitude: mp.magnitude, quality: mp.quality, bandwidth: mp.bandwidth, timestamp })
    const offset = a.annotationOffsetsByFreq?.get(mp.frequency.toFixed(1))
    if (offset != null) peakAnnotationOffsets[id] = offset
    return id
  }
  const selL = addPeak(a.peaks.longitudinal)
  const selC = addPeak(a.peaks.cross)
  const selFlc = addPeak(a.peaks.flc)

  // selectedPeakIDs / selectedPeakFrequencies mirror Swift: every role-selected peak,
  // so a native consumer marks the same peaks "selected" (annotationVisibilityMode).
  const selectedPairs = [
    [selL, a.peaks.longitudinal],
    [selC, a.peaks.cross],
    [selFlc, a.peaks.flc],
  ] as const
  const selectedPeakIDs = selectedPairs.filter(([id]) => id != null).map(([id]) => id as string)
  const selectedPeakFrequencies = selectedPairs.filter(([, p]) => p != null).map(([, p]) => p!.frequency)

  return {
    id: uuid(),
    timestamp,
    peaks,
    measurementName: a.name.trim() || undefined,
    notes: a.notes.trim() || undefined,
    longitudinalSnapshot: a.spectra.longitudinal ? makeSnap(a.spectra.longitudinal) : undefined,
    crossSnapshot: a.spectra.cross ? makeSnap(a.spectra.cross) : undefined,
    flcSnapshot: a.spectra.flc ? makeSnap(a.spectra.flc) : undefined,
    selectedLongitudinalPeakID: selL,
    selectedCrossPeakID: selC,
    selectedFlcPeakID: selFlc,
    selectedPeakIDs,
    selectedPeakFrequencies,
    peakAnnotationOffsets: Object.keys(peakAnnotationOffsets).length ? peakAnnotationOffsets : undefined,
    annotationVisibilityMode: a.settings.annotationVisibilityMode,
    tapDetectionThreshold: a.settings.tapDetectionThreshold,
    numberOfTaps: 1,
    peakMinThreshold: a.settings.peakMinThreshold,
    microphoneName: a.deviceLabel || undefined,
    microphoneUID: a.microphoneUID || undefined,
    calibrationName: a.calibrationName || undefined,
    sampleRate: a.sampleRate ?? undefined,
  }
}

// ── Comparison measurements ─────────────────────────────────────────────────
// A comparison overlays several measurements' spectra. Same 5-color palette as the
// multi-tap view, cycled by index (Swift/Python comparison palette).
export const COMPARISON_PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#40c8e0']

/** ComparisonEntry.colorComponents ([r,g,b,a] 0–1) → a CSS color for the chart/table. */
export function colorComponentsToCss(c: number[]): string {
  const r = Math.round((c[0] ?? 0) * 255)
  const g = Math.round((c[1] ?? 0) * 255)
  const b = Math.round((c[2] ?? 0) * 255)
  const a = c[3] ?? 1
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function hexToComponents(hex: string): number[] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1]
}

const comparisonLabel = (m: TapToneMeasurementModel): string =>
  m.measurementName?.trim() || formatDisplayDateCompact(m.timestamp)

/** Build comparison entries from selected library measurements — mirrors Swift/Python
 *  loadComparison: filter to those with a spectrum, disambiguate duplicate labels with
 *  " (2)", assign palette colors by index, and keep each measurement's selected peaks. */
export function buildComparisonEntries(measurements: TapToneMeasurementModel[]): ComparisonEntryModel[] {
  const withSnap = measurements.filter((m) => m.spectrumSnapshot)
  const base = withSnap.map(comparisonLabel)
  const counts: Record<string, number> = {}
  for (const l of base) counts[l] = (counts[l] ?? 0) + 1
  const occ: Record<string, number> = {}
  const labels = base.map((l) => {
    if ((counts[l] ?? 0) <= 1) return l
    occ[l] = (occ[l] ?? 0) + 1
    return `${l} (${occ[l]})`
  })
  return withSnap.map((m, i) => {
    const snap = m.spectrumSnapshot!
    const selIds = m.selectedPeakIDs?.length ? new Set(m.selectedPeakIDs) : null
    const peaks = selIds ? m.peaks.filter((p) => selIds.has(p.id)) : m.peaks
    return {
      id: uuid(),
      label: labels[i]!,
      colorComponents: hexToComponents(COMPARISON_PALETTE[i % COMPARISON_PALETTE.length]!),
      snapshot: snap,
      peaks,
      guitarType: snap.guitarType,
      sourceMeasurementID: m.id,
    }
  })
}

// Averaged-spectrum highlight color for the multi-tap comparison — must match
// MultiTapComparisonResultsView.MULTITAP_AVG_COLOR (the per-tap colors reuse COMPARISON_PALETTE).
export const MULTITAP_AVG_COLOR = '#ffd900'

/** Convert a multi-tap guitar measurement's per-tap entries into comparison entries — one "Tap N"
 *  per tap (palette-cycled) plus a trailing "Averaged" entry built from the measurement's own
 *  spectrum + selected peaks. Mirrors Swift `exportMultiTapPDFReport`'s `cmpEntries`
 *  (TapToneAnalysisView+Export.swift): the averaged entry is appended last. Each entry keeps only
 *  its SELECTED peaks so the comparison table resolves the same Air/Top/Back the live view shows. */
export function multiTapComparisonEntries(m: TapToneMeasurementModel): ComparisonEntryModel[] {
  const selectedOf = (peaks: ResonantPeakModel[], ids?: string[]): ResonantPeakModel[] => {
    if (!ids?.length) return peaks
    const set = new Set(ids)
    return peaks.filter((p) => set.has(p.id))
  }
  const entries: ComparisonEntryModel[] = (m.tapEntries ?? []).map((e, i) => ({
    id: uuid(),
    label: `Tap ${e.tapIndex}`,
    colorComponents: hexToComponents(COMPARISON_PALETTE[i % COMPARISON_PALETTE.length]!),
    snapshot: e.snapshot,
    peaks: selectedOf(e.peaks, e.selectedPeakIDs),
    guitarType: e.snapshot.guitarType,
  }))
  if (m.spectrumSnapshot) {
    entries.push({
      id: uuid(),
      label: 'Averaged',
      colorComponents: hexToComponents(MULTITAP_AVG_COLOR),
      snapshot: m.spectrumSnapshot,
      peaks: selectedOf(m.peaks, m.selectedPeakIDs),
      guitarType: m.spectrumSnapshot.guitarType,
    })
  }
  return entries
}

/** Resolve the Air/Top/Back mode frequencies for one comparison entry (its selected peaks
 *  classified by its guitar type) — drives the ComparisonResultsView table. */
export function comparisonEntryModeFreqs(entry: ComparisonEntryModel): { air: number | null; top: number | null; back: number | null } {
  const gt = GUITAR_TYPE_NAME_FROM_RAW[entry.guitarType ?? 'Generic'] ?? 'generic'
  const peaks: Peak[] = entry.peaks.map((p, i) => ({ id: i, frequency: p.frequency, magnitude: p.magnitude, quality: p.quality, bandwidth: p.bandwidth }))
  const m = resolvedModePeaks(peaks, gt)
  return { air: m.get('air')?.frequency ?? null, top: m.get('top')?.frequency ?? null, back: m.get('back')?.frequency ?? null }
}

/** Union axis range across comparison entries' snapshots (Swift setLoadedAxisRange). */
export function comparisonAxisRange(entries: ComparisonEntryModel[]): ChartView | null {
  const snaps = entries.map((e) => e.snapshot)
  if (snaps.length === 0) return null
  return {
    minHz: Math.min(...snaps.map((s) => s.minFreq)),
    maxHz: Math.max(...snaps.map((s) => s.maxFreq)),
    minDb: Math.min(...snaps.map((s) => s.minDB)),
    maxDb: Math.max(...snaps.map((s) => s.maxDB)),
  }
}

/** Wrap live comparison entries into a saved comparison measurement (peaks: [] top-level,
 *  comparisonEntries populated) — mirrors Swift/Python save_comparison. */
export function buildComparisonMeasurement(a: { name: string; notes: string; entries: ComparisonEntryModel[] }): TapToneMeasurementModel {
  return {
    id: uuid(),
    timestamp: isoNow(),
    peaks: [],
    measurementName: a.name.trim() || undefined,
    notes: a.notes.trim() || undefined,
    comparisonEntries: a.entries,
  }
}