// `.guitartap` reader. Accepts the canonical form the writer (./encode) produces and
// every older shape documented in the Swift user manual App. B "Legacy compatibility
// (reader-only)" table. The reader is deliberately permissive; the writer is minimal.
//
// Numbers are read at full JS precision (no float32 quantisation on the way in — that
// only matters when writing). Unknown fields are ignored.

import { base64ToFloats } from './base64'
import type {
  AnnotationOffsets,
  ComparisonEntryModel,
  PeakModeOverrides,
  ResonantPeakModel,
  SpectrumSnapshotModel,
  TapEntryModel,
  TapToneMeasurementModel,
} from './types'
import type { AnnotationMode } from '../settings'

// ── primitive coercions (return undefined when absent/wrong-typed) ───────────
const numOpt = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const strOpt = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const boolOpt = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const strArrOpt = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
const numArrOpt = (v: unknown): number[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : undefined

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined

const ANNOTATION_MODES = new Set<AnnotationMode>(['all', 'selected', 'none'])
const annModeOpt = (v: unknown): AnnotationMode | undefined =>
  typeof v === 'string' && ANNOTATION_MODES.has(v as AnnotationMode) ? (v as AnnotationMode) : undefined

// ── UUID-keyed maps: flat alternating array (canonical) + legacy object forms ─
function decodeOffsets(raw: unknown): AnnotationOffsets | undefined {
  // Canonical: [uuid, {absFreqHz, absDB}, …]. Legacy delta offsets ({hzOffset,
  // dbOffset}) and any other object form are not convertible and are dropped.
  if (!Array.isArray(raw)) return undefined
  const out: AnnotationOffsets = {}
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const key = raw[i]
    const val = obj(raw[i + 1])
    if (typeof key === 'string' && val && typeof val.absFreqHz === 'number' && typeof val.absDB === 'number') {
      out[key] = [val.absFreqHz, val.absDB]
    }
  }
  return Object.keys(out).length ? out : {}
}

function decodeOverrides(raw: unknown): PeakModeOverrides | undefined {
  // Canonical: [uuid, {type:"assigned", label}, …]. Legacy (early Python 1.0.x):
  // a JSON object {uuid: {type,label}} or {uuid: "label"}.
  const take = (val: unknown): string | undefined => {
    if (typeof val === 'string') return val
    const o = obj(val)
    return o && o.type === 'assigned' && typeof o.label === 'string' ? o.label : undefined
  }
  if (Array.isArray(raw)) {
    const out: PeakModeOverrides = {}
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const key = raw[i]
      const label = take(raw[i + 1])
      if (typeof key === 'string' && label != null) out[key] = label
    }
    return out
  }
  const o = obj(raw)
  if (o) {
    const out: PeakModeOverrides = {}
    for (const [k, v] of Object.entries(o)) {
      const label = take(v)
      if (label != null) out[k] = label
    }
    return out
  }
  return undefined
}

// ── nested types ─────────────────────────────────────────────────────────────
export function decodeSnapshot(d: Obj): SpectrumSnapshotModel {
  let frequencies: number[]
  let magnitudes: number[]
  if (typeof d.frequenciesData === 'string' && typeof d.magnitudesData === 'string') {
    frequencies = base64ToFloats(d.frequenciesData)
    magnitudes = base64ToFloats(d.magnitudesData)
  } else {
    // Legacy plain-array format (pre-binary).
    frequencies = numArrOpt(d.frequencies) ?? []
    magnitudes = numArrOpt(d.magnitudes) ?? []
  }
  return {
    frequencies,
    magnitudes,
    minFreq: num(d.minFreq),
    maxFreq: num(d.maxFreq),
    minDB: num(d.minDB),
    maxDB: num(d.maxDB),
    isLogarithmic: boolOpt(d.isLogarithmic) ?? false,
    showUnknownModes: boolOpt(d.showUnknownModes),
    guitarType: strOpt(d.guitarType),
    measurementType: strOpt(d.measurementType),
    plateLength: numOpt(d.plateLength),
    plateWidth: numOpt(d.plateWidth),
    plateThickness: numOpt(d.plateThickness),
    plateMass: numOpt(d.plateMass),
    guitarBodyLength: numOpt(d.guitarBodyLength),
    guitarBodyWidth: numOpt(d.guitarBodyWidth),
    plateStiffnessPreset: strOpt(d.plateStiffnessPreset),
    customPlateStiffness: numOpt(d.customPlateStiffness),
    measureFlc: boolOpt(d.measureFlc),
    braceLength: numOpt(d.braceLength),
    braceWidth: numOpt(d.braceWidth),
    braceThickness: numOpt(d.braceThickness),
    braceMass: numOpt(d.braceMass),
  }
}

function decodePeak(d: Obj): ResonantPeakModel {
  return {
    id: strOpt(d.id) ?? '',
    frequency: num(d.frequency),
    magnitude: num(d.magnitude),
    quality: num(d.quality),
    bandwidth: num(d.bandwidth),
    timestamp: strOpt(d.timestamp) ?? '',
    pitchNote: strOpt(d.pitchNote),
    pitchCents: numOpt(d.pitchCents),
    pitchFrequency: numOpt(d.pitchFrequency),
    modeLabel: strOpt(d.modeLabel),
  }
}

const decodePeaks = (v: unknown): ResonantPeakModel[] =>
  Array.isArray(v) ? v.map((p) => decodePeak(obj(p) ?? {})) : []

function decodeComparisonEntry(d: Obj): ComparisonEntryModel {
  return {
    id: strOpt(d.id) ?? '',
    label: strOpt(d.label) ?? '',
    colorComponents: numArrOpt(d.colorComponents) ?? [0, 0, 1, 1],
    snapshot: decodeSnapshot(obj(d.snapshot) ?? {}),
    peaks: decodePeaks(d.peaks),
    guitarType: strOpt(d.guitarType),
    sourceMeasurementID: strOpt(d.sourceMeasurementID),
  }
}

function decodeTapEntry(d: Obj): TapEntryModel {
  return {
    id: strOpt(d.id) ?? '',
    tapIndex: num(d.tapIndex),
    snapshot: decodeSnapshot(obj(d.snapshot) ?? {}),
    peaks: decodePeaks(d.peaks),
    selectedPeakIDs: strArrOpt(d.selectedPeakIDs) ?? [],
  }
}

// ── measurement ───────────────────────────────────────────────────────────────
export function decodeMeasurement(d: Obj): TapToneMeasurementModel {
  return {
    id: strOpt(d.id) ?? '',
    timestamp: strOpt(d.timestamp) ?? '',
    peaks: decodePeaks(d.peaks),
    decayTime: numOpt(d.decayTime),
    // Legacy "tapLocation" predates the "measurementName" rename.
    measurementName: strOpt(d.measurementName) ?? strOpt(d.tapLocation),
    notes: strOpt(d.notes),
    spectrumSnapshot: obj(d.spectrumSnapshot) ? decodeSnapshot(obj(d.spectrumSnapshot)!) : undefined,
    peakAnnotationOffsets: decodeOffsets(d.peakAnnotationOffsets),
    selectedPeakIDs: strArrOpt(d.selectedPeakIDs),
    selectedPeakFrequencies: numArrOpt(d.selectedPeakFrequencies),
    annotationVisibilityMode: annModeOpt(d.annotationVisibilityMode),
    tapDetectionThreshold: numOpt(d.tapDetectionThreshold),
    numberOfTaps: numOpt(d.numberOfTaps),
    // Legacy "peakThreshold" predates the "peakMinThreshold" rename; prefer the new key.
    peakMinThreshold: numOpt(d.peakMinThreshold) ?? numOpt(d.peakThreshold),
    selectedLongitudinalPeakID: strOpt(d.selectedLongitudinalPeakID),
    selectedCrossPeakID: strOpt(d.selectedCrossPeakID),
    selectedFlcPeakID: strOpt(d.selectedFlcPeakID),
    longitudinalSnapshot: obj(d.longitudinalSnapshot) ? decodeSnapshot(obj(d.longitudinalSnapshot)!) : undefined,
    crossSnapshot: obj(d.crossSnapshot) ? decodeSnapshot(obj(d.crossSnapshot)!) : undefined,
    flcSnapshot: obj(d.flcSnapshot) ? decodeSnapshot(obj(d.flcSnapshot)!) : undefined,
    peakModeOverrides: decodeOverrides(d.peakModeOverrides),
    microphoneName: strOpt(d.microphoneName),
    microphoneUID: strOpt(d.microphoneUID),
    calibrationName: strOpt(d.calibrationName),
    sampleRate: numOpt(d.sampleRate),
    comparisonEntries: Array.isArray(d.comparisonEntries)
      ? d.comparisonEntries.map((e) => decodeComparisonEntry(obj(e) ?? {}))
      : undefined,
    tapEntries: Array.isArray(d.tapEntries) ? d.tapEntries.map((e) => decodeTapEntry(obj(e) ?? {})) : undefined,
  }
}

/** Parse a `.guitartap` document. The top-level value is an array of measurements
 *  (the array wrapping is part of the format); a bare object is also accepted. */
export function parseGuitarTapFile(text: string): TapToneMeasurementModel[] {
  const root: unknown = JSON.parse(text)
  const list = Array.isArray(root) ? root : [root]
  return list.map((m) => decodeMeasurement(obj(m) ?? {}))
}