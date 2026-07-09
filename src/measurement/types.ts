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

/** Guitar mode label overrides are stored per peak as the assigned label string. */
export type PeakModeOverrides = Record<string, string>

/** Absolute data-space annotation label positions: uuid → [absFreqHz, absDB]. */
export type AnnotationOffsets = Record<string, [number, number]>

export interface ResonantPeakModel {
  id: string
  frequency: number
  magnitude: number
  quality: number
  bandwidth: number
  timestamp: string
  pitchNote?: string
  pitchCents?: number
  pitchFrequency?: number
  /** Encode-only convenience the writer injects on top-level peaks; carried through
   *  on decode so a re-export preserves it. Ignored for nested peaks. */
  modeLabel?: string
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
  peaks: ResonantPeakModel[]
  guitarType?: string
  sourceMeasurementID?: string
}

export interface TapEntryModel {
  id: string
  tapIndex: number
  snapshot: SpectrumSnapshotModel
  peaks: ResonantPeakModel[]
  selectedPeakIDs: string[]
}

export interface TapToneMeasurementModel {
  id: string
  timestamp: string
  peaks: ResonantPeakModel[]
  decayTime?: number
  measurementName?: string
  notes?: string
  spectrumSnapshot?: SpectrumSnapshotModel
  peakAnnotationOffsets?: AnnotationOffsets
  selectedPeakIDs?: string[]
  selectedPeakFrequencies?: number[]
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
  comparisonEntries?: ComparisonEntryModel[]
  tapEntries?: TapEntryModel[]
}

/** True when this record is a saved comparison rather than a single tap measurement. */
export const isComparison = (m: TapToneMeasurementModel): boolean => m.comparisonEntries != null