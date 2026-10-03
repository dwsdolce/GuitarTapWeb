// In-memory model for a `.guitartap` measurement. Mirrors the Swift
// TapToneMeasurement / SpectrumSnapshot / ResonantPeak structs and the Python
// dataclasses. The canonical on-disk format is documented in the Swift user manual
// Appendix B (Documentation/Manual/app-b-file-formats.md); decode/encode live in
// ./decode and ./encode. Field names here are the camelCase JSON keys.
//
// Numbers are plain JS numbers. The float32-vs-double distinction (App. B "Number
// precision") is applied only at encode time via floatJson.f32 — the model keeps full
// values. Dates/UUIDs are strings (ISO-8601 / RFC 4122), as on the wire.

import type { AnnotationMode } from '../settings'
import { newId } from './newId'
import type { GuitarTypeName, ModeName } from '../dsp/guitarModes'
import { resolvedModePeaks } from '../dsp/classify'

/** Guitar mode label overrides are stored per peak as the assigned label string. */
export type PeakModeOverrides = Record<string, string>

/** Absolute data-space annotation label positions: uuid → [absFreqHz, absDB]. */
export type AnnotationOffsets = Record<string, [number, number]>

/** A detected resonant peak — one type in memory and on file, guitar and material alike. Mirrors Swift
 *  `ResonantPeak` / Python `ResonantPeak`. Make one with {@link makeResonantPeak}. */
export interface ResonantPeak {
  /** Stable unique id (an uppercase UUID), kept through save and load. */
  id: string
  /** Interpolated peak frequency, in Hz. */
  frequency: number
  /** Interpolated peak magnitude, in dB. */
  magnitude: number
  /** Q factor: `frequency / bandwidth` (0 when bandwidth is 0). */
  quality: number
  /** −3 dB bandwidth, in Hz. */
  bandwidth: number
  /** When the peak was found (ISO-8601, no fractional seconds). */
  timestamp: string
  /** Nearest equal-temperament note, its cents offset and its exact frequency, when known. */
  pitchNote?: string
  pitchCents?: number
  pitchFrequency?: number
}

export interface SpectrumSnapshotModel {
  frequencies: number[]
  magnitudes: number[]
  minFreq: number
  maxFreq: number
  minDB: number
  maxDB: number
  /** Legacy field retained for .guitartap format compatibility; always false (the
   *  frequency axis is linear on all platforms — log-axis support was removed). */
  isLogarithmic: boolean
  showUnknownModes?: boolean
  guitarType?: string
  measurementType?: string
  // Plate
  plateLength?: number
  plateWidth?: number
  plateThickness?: number
  plateMass?: number
  guitarBodyLength?: number
  guitarBodyWidth?: number
  plateStiffnessPreset?: string
  customPlateStiffness?: number
  measureFlc?: boolean
  // Brace
  braceLength?: number
  braceWidth?: number
  braceThickness?: number
  braceMass?: number
}

export interface ComparisonEntryModel {
  id: string
  label: string
  /** RGBA, each 0.0–1.0 (double precision). */
  colorComponents: number[]
  snapshot: SpectrumSnapshotModel
  peaks: ResonantPeak[]
  guitarType?: string
  sourceMeasurementID?: string
  /** The DEFINITIVE Air/Top/Back for this overlaid spectrum, `{mode display name → peak id}` referencing
   *  this entry's own `peaks`, resolved override-aware from the SOURCE at build. Makes a saved comparison
   *  self-describing — a reader reproduces the table by id lookup, no `classifyAll`, no source overrides.
   *  Absent on pre-6b files → healed positionally on decode + re-saved. Mirrors Swift/Python
   *  `ComparisonEntry.modePeakIDs` (keyed by `GuitarMode.rawValue` = the mode's display name). */
  modePeakIDs?: Record<string, string>
}

export interface TapEntryModel {
  id: string
  tapIndex: number
  snapshot: SpectrumSnapshotModel
  peaks: ResonantPeak[]
  selectedPeakIDs: string[]
}

/** ISO-8601 without fractional seconds, matching Swift's `.iso8601` date strategy. */
export const isoNow = (): string => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

/** A new peak: a fresh id and the current time, as Swift's `ResonantPeak.init` gives them. */
export function makeResonantPeak(p: Omit<ResonantPeak, 'id' | 'timestamp'>): ResonantPeak {
  return { id: newId(), timestamp: isoNow(), ...p }
}

/** The classifier's guitar-type name for a snapshot's raw guitar type ("Classical" → 'classical');
 *  'generic' when absent or unknown. */
export function guitarTypeNameFromRaw(raw: string | undefined): GuitarTypeName {
  return raw === 'Acoustic' ? 'acoustic' : raw === 'Classical' ? 'classical' : raw === 'Flamenco' ? 'flamenco' : 'generic'
}

/**
 * One individual tap's spectrum and detected peaks within a multi-tap guitar sequence — the analyzer's
 * `tapEntries`, which drive the per-tap comparison view. Built by `processMultipleTaps` when more than one
 * tap was captured, and restored from the file's `tapEntries` on load. Mirrors Swift `TapEntry` /
 * Python `TapEntry`; {@link TapEntryModel} is its form on file.
 */
export class TapEntry {
  constructor(
    /** Stable unique identifier (an uppercase UUID). */
    readonly id: string,
    /** 1-based display index ("Tap 1", "Tap 2", …). */
    readonly tapIndex: number,
    /** Full spectrum snapshot for this tap, recording the guitar type it was captured under. */
    readonly snapshot: SpectrumSnapshotModel,
    /** Every peak found in this tap's spectrum, at the detection floor. */
    readonly peaks: ResonantPeak[],
    /** Ids of the auto-selected peaks — one per guitar mode where found. */
    readonly selectedPeakIDs: string[],
  ) {}

  /** The strongest peak per guitar mode among this tap's SELECTED peaks. Used by the multi-tap
   *  comparison table and the regression tests. Mirrors Swift `TapEntry.resolvedModePeaks(guitarType:)`.
   *  @param guitarType Guitar type to classify under; defaults to the snapshot's. */
  resolvedModePeaks(guitarType?: GuitarTypeName): Map<ModeName, ResonantPeak> {
    const selected = new Set(this.selectedPeakIDs)
    return resolvedModePeaks(
      this.peaks.filter((p) => selected.has(p.id)),
      guitarType ?? guitarTypeNameFromRaw(this.snapshot.guitarType),
    )
  }
}

export interface TapToneMeasurementModel {
  // Measurement TYPE is deliberately NOT a field here. It is derived on read from the snapshot via
  // `resolvedMeasurementType` (below) — mirroring Swift's `TapToneMeasurement` (no stored
  // `measurementType`): "derive, don't duplicate", since a stored copy can fall out of sync with the
  // snapshot. Do NOT add a top-level `measurementType` and read it for logic (TypeScript already makes
  // such a read a compile error). The write-only top-level copy in the `.guitartap` FILE (encode.ts,
  // resolved from the snapshot at encode time) is a separate, fine thing — for external readers.
  /**
   * The measurement's DATASET identity, mirroring Swift `TapToneMeasurement.id`. It travels in
   * the `.guitartap` file, survives import unchanged, and is re-minted whenever the data changes
   * — including a name or notes edit, since those are part of the data. So two entries share an
   * `id` exactly when they hold identical content, which is the state a duplicate import
   * produces and which editing either one ends.
   *
   * It is deliberately NOT how the library addresses a row: duplicate imports share it. Rows are
   * addressed by `rowKey`, so import keeps this field as the file carries it.
   */
  id: string
  /**
   * Library-local row handle: unique per stored row, minted on insert, never written to a
   * `.guitartap` file. It is this edition's equivalent of the natives' array position — they can
   * address a row positionally because their library is an ordered array, where this one is a
   * keyed object store and needs an explicit handle.
   *
   * Absent on a measurement that has not been stored yet (one built from live capture or just
   * parsed from a file); `saveMeasurement` assigns it, exactly as it assigns `savedAt`.
   */
  rowKey?: string
  timestamp: string
  peaks: ResonantPeak[]
  decayTime?: number
  measurementName?: string
  notes?: string
  spectrumSnapshot?: SpectrumSnapshotModel
  peakAnnotationOffsets?: AnnotationOffsets
  selectedPeakIDs?: string[]
  selectedPeakFrequencies?: number[]
  /** Whether the saved selection was hand-modified (vs the automatic mode-priority selection).
   *  Restored on load so a loaded measurement behaves like a live one: an automatic selection
   *  re-runs auto-selection on Peak Min change; a manual one is parked. Absent in older files —
   *  those default to manual. Mirrors Swift/Python userModifiedSelection. */
  userModifiedSelection?: boolean
  annotationVisibilityMode?: AnnotationMode
  tapDetectionThreshold?: number
  numberOfTaps?: number
  peakMinThreshold?: number
  selectedLongitudinalPeakID?: string
  selectedCrossPeakID?: string
  selectedFlcPeakID?: string
  longitudinalSnapshot?: SpectrumSnapshotModel
  crossSnapshot?: SpectrumSnapshotModel
  flcSnapshot?: SpectrumSnapshotModel
  peakModeOverrides?: PeakModeOverrides
  microphoneName?: string
  microphoneUID?: string
  calibrationName?: string
  sampleRate?: number
  /** Transient: set when decoding repaired the measurement (healMeasurement). Never written to a file.
   *  Mirrors Swift/Python `wasHealed`. */
  wasHealed?: boolean
  comparisonEntries?: ComparisonEntryModel[]
  tapEntries?: TapEntryModel[]
}

/** True when this record is a saved comparison rather than a single tap measurement. */
export const isComparison = (m: TapToneMeasurementModel): boolean => m.comparisonEntries != null

/** Measurement type resolved from the stored snapshots; undefined for legacy files.
 *  Mirrors Swift `TapToneMeasurement.resolvedMeasurementType`. */
export const resolvedMeasurementType = (m: TapToneMeasurementModel): string | undefined =>
  m.spectrumSnapshot?.measurementType ?? m.longitudinalSnapshot?.measurementType

/** True for a plate/brace (material) measurement, which has **no per-peak selection** — the
 *  identified L/C/FLC in `peaks` are the peaks. Falls back to material-only fields for legacy
 *  files. Mirrors Swift `TapToneMeasurement.isMaterial`. */
export const isMaterialMeasurement = (m: TapToneMeasurementModel): boolean => {
  const mt = resolvedMeasurementType(m)
  if (mt != null) return !mt.endsWith('Guitar')
  return m.longitudinalSnapshot != null || m.selectedLongitudinalPeakID != null
}

// @parity model/material-selection tests=test/material-selection
/** The peak IDs to render, annotate, and export for this measurement.
 *  - Guitar: the saved selection (`selectedPeakIDs`), or all peaks when none saved.
 *  - Material: **always all of `peaks`.** Plate/brace have no per-peak selection, and the saved
 *    aggregate can be corrupted by an intermittent phase-transition write (an iPad-only Swift
 *    glitch), so it is ignored on read — healing existing corrupt files at render time.
 *  Mirrors Swift/Python `effectiveSelectedPeakIDs`. */
export const effectiveSelectedPeakIDs = (m: TapToneMeasurementModel): Set<string> => {
  if (isMaterialMeasurement(m)) return new Set(m.peaks.map((p) => p.id))
  return m.selectedPeakIDs?.length ? new Set(m.selectedPeakIDs) : new Set(m.peaks.map((p) => p.id))
}