// `.guitartap` writer. Emits only the canonical, current field set documented in the
// Swift user manual App. B — never legacy keys (peakMinThreshold, never peakThreshold;
// no hysteresisMargin/maxPeaks; sampleRate only when known). The reader (./decode)
// owns backward compatibility; the writer stays minimal.
//
// Encoding rules (App. B "Number precision"): Float fields go through f32() (shortest
// float32 decimal, integers without a decimal point); Double fields (pitchCents,
// pitchFrequency, sampleRate, colorComponents, absFreqHz/absDB) are written raw.
// Optional fields are omitted entirely when unset (never null). Spectra are base64
// little-endian float32. UUID-keyed maps are flat alternating [uuid, value, …] arrays.
// Object key order is not significant; serializeGuitarTapFile sorts keys for diffable,
// Swift/Python-like output.

import { floatsToBase64 } from './base64'
import { f32 } from './floatJson'
import type {
  ComparisonEntryModel,
  ResonantPeakModel,
  SpectrumSnapshotModel,
  TapEntryModel,
  TapToneMeasurementModel,
} from './types'
import { classifyAll } from '../dsp/classify'
import type { Peak } from '../dsp/peaks'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { MODE_DISPLAY_NAME } from '../presentation/modeColors'

type JsonObj = Record<string, unknown>

/** Assign only when the value is set — mirrors Swift `encodeIfPresent` / App. B's
 *  "omitted, never null" rule. */
function put(d: JsonObj, key: string, value: unknown): void {
  if (value != null) d[key] = value
}

// ── mode labels (export-only convenience injected on top-level peaks) ─────────
const guitarTypeName = (raw?: string): GuitarTypeName =>
  raw === 'Classical' ? 'classical' : raw === 'Flamenco' ? 'flamenco' : raw === 'Acoustic' ? 'acoustic' : 'generic'

// Material measurement types are "Material (Plate)" / "Material (Brace)"; everything
// else (and an absent type) is treated as guitar, matching the Swift export path.
const isGuitarMeasurement = (mt?: string): boolean => mt == null || mt.endsWith('Guitar')

/** Resolve each top-level peak's `modeLabel` exactly as the Swift writer does:
 *  user override > carried-through label (preserves an imported file) > context-aware
 *  classification (guitar) or L/C/FLC role (plate/brace). */
function buildModeLabels(m: TapToneMeasurementModel): Map<string, string> {
  const out = new Map<string, string>()
  const mt = m.spectrumSnapshot?.measurementType ?? m.longitudinalSnapshot?.measurementType
  if (isGuitarMeasurement(mt)) {
    const gt = guitarTypeName(m.spectrumSnapshot?.guitarType ?? m.longitudinalSnapshot?.guitarType)
    const adapter: Peak[] = m.peaks.map((p, i) => ({
      id: i,
      frequency: p.frequency,
      magnitude: p.magnitude,
      quality: p.quality,
      bandwidth: p.bandwidth,
    }))
    const modeMap = classifyAll(adapter, gt)
    m.peaks.forEach((p, i) => {
      const override = m.peakModeOverrides?.[p.id]
      out.set(p.id, override ?? p.modeLabel ?? MODE_DISPLAY_NAME[modeMap.get(i) ?? 'unknown'])
    })
  } else {
    for (const p of m.peaks) {
      const label =
        p.id === m.selectedLongitudinalPeakID
          ? 'Longitudinal'
          : p.id === m.selectedCrossPeakID
            ? 'Cross-grain'
            : p.id === m.selectedFlcPeakID
              ? 'FLC'
              : 'Peak'
      out.set(p.id, label)
    }
  }
  return out
}

// ── nested types ─────────────────────────────────────────────────────────────
export function encodeSnapshot(s: SpectrumSnapshotModel): JsonObj {
  const d: JsonObj = {
    frequenciesData: floatsToBase64(s.frequencies),
    magnitudesData: floatsToBase64(s.magnitudes),
    minFreq: f32(s.minFreq),
    maxFreq: f32(s.maxFreq),
    minDB: f32(s.minDB),
    maxDB: f32(s.maxDB),
    isLogarithmic: s.isLogarithmic,
  }
  put(d, 'showUnknownModes', s.showUnknownModes)
  put(d, 'guitarType', s.guitarType)
  put(d, 'measurementType', s.measurementType)
  put(d, 'plateLength', f32(s.plateLength))
  put(d, 'plateWidth', f32(s.plateWidth))
  put(d, 'plateThickness', f32(s.plateThickness))
  put(d, 'plateMass', f32(s.plateMass))
  put(d, 'guitarBodyLength', f32(s.guitarBodyLength))
  put(d, 'guitarBodyWidth', f32(s.guitarBodyWidth))
  put(d, 'plateStiffnessPreset', s.plateStiffnessPreset)
  put(d, 'customPlateStiffness', f32(s.customPlateStiffness))
  put(d, 'measureFlc', s.measureFlc)
  put(d, 'braceLength', f32(s.braceLength))
  put(d, 'braceWidth', f32(s.braceWidth))
  put(d, 'braceThickness', f32(s.braceThickness))
  put(d, 'braceMass', f32(s.braceMass))
  return d
}

/** `includeModeLabel` is true only for the top-level `peaks` array; nested peaks
 *  (tapEntries / comparisonEntries) omit it, matching Swift's plain ResonantPeak. */
function encodePeak(p: ResonantPeakModel, modeLabel?: string): JsonObj {
  const d: JsonObj = {
    id: p.id,
    frequency: f32(p.frequency),
    magnitude: f32(p.magnitude),
    quality: f32(p.quality),
    bandwidth: f32(p.bandwidth),
    timestamp: p.timestamp,
  }
  put(d, 'pitchNote', p.pitchNote)
  put(d, 'pitchCents', p.pitchCents) // Double — raw
  put(d, 'pitchFrequency', p.pitchFrequency) // Double — raw
  put(d, 'modeLabel', modeLabel)
  return d
}

function encodeComparisonEntry(e: ComparisonEntryModel): JsonObj {
  const d: JsonObj = {
    id: e.id,
    label: e.label,
    colorComponents: e.colorComponents, // Double[] — raw
    snapshot: encodeSnapshot(e.snapshot),
    peaks: e.peaks.map((p) => encodePeak(p)),
  }
  put(d, 'guitarType', e.guitarType)
  put(d, 'sourceMeasurementID', e.sourceMeasurementID)
  return d
}

function encodeTapEntry(e: TapEntryModel): JsonObj {
  return {
    id: e.id,
    tapIndex: e.tapIndex,
    snapshot: encodeSnapshot(e.snapshot),
    peaks: e.peaks.map((p) => encodePeak(p)),
    selectedPeakIDs: e.selectedPeakIDs,
  }
}

// ── measurement ───────────────────────────────────────────────────────────────
export function encodeMeasurement(m: TapToneMeasurementModel): JsonObj {
  const d: JsonObj = { id: m.id, timestamp: m.timestamp }
  put(d, 'decayTime', f32(m.decayTime))
  put(d, 'measurementName', m.measurementName)
  put(d, 'notes', m.notes)
  if (m.spectrumSnapshot) d.spectrumSnapshot = encodeSnapshot(m.spectrumSnapshot)

  if (m.peakAnnotationOffsets) {
    const arr: unknown[] = []
    for (const [uuid, [absFreqHz, absDB]] of Object.entries(m.peakAnnotationOffsets)) {
      arr.push(uuid, { absFreqHz, absDB }) // Double — raw
    }
    d.peakAnnotationOffsets = arr
  }

  put(d, 'tapDetectionThreshold', f32(m.tapDetectionThreshold))
  put(d, 'numberOfTaps', m.numberOfTaps)
  put(d, 'peakMinThreshold', f32(m.peakMinThreshold))
  put(d, 'selectedLongitudinalPeakID', m.selectedLongitudinalPeakID)
  put(d, 'selectedCrossPeakID', m.selectedCrossPeakID)
  put(d, 'selectedFlcPeakID', m.selectedFlcPeakID)
  if (m.longitudinalSnapshot) d.longitudinalSnapshot = encodeSnapshot(m.longitudinalSnapshot)
  if (m.crossSnapshot) d.crossSnapshot = encodeSnapshot(m.crossSnapshot)
  if (m.flcSnapshot) d.flcSnapshot = encodeSnapshot(m.flcSnapshot)
  put(d, 'selectedPeakIDs', m.selectedPeakIDs)
  put(d, 'selectedPeakFrequencies', m.selectedPeakFrequencies?.map((v) => f32(v)))
  put(d, 'userModifiedSelection', m.userModifiedSelection)
  put(d, 'annotationVisibilityMode', m.annotationVisibilityMode)

  if (m.peakModeOverrides) {
    const arr: unknown[] = []
    for (const [uuid, label] of Object.entries(m.peakModeOverrides)) {
      arr.push(uuid, { type: 'assigned', label })
    }
    d.peakModeOverrides = arr
  }

  put(d, 'microphoneName', m.microphoneName)
  put(d, 'microphoneUID', m.microphoneUID)
  put(d, 'calibrationName', m.calibrationName)
  put(d, 'sampleRate', m.sampleRate) // Double — raw

  // Convenience copies for external consumers, resolved from the snapshot.
  const snap = m.spectrumSnapshot ?? m.longitudinalSnapshot
  put(d, 'measurementType', snap?.measurementType)
  put(d, 'guitarType', snap?.guitarType)

  const modeLabels = buildModeLabels(m)
  d.peaks = m.peaks.map((p) => encodePeak(p, modeLabels.get(p.id)))

  if (m.comparisonEntries) d.comparisonEntries = m.comparisonEntries.map(encodeComparisonEntry)
  if (m.tapEntries) d.tapEntries = m.tapEntries.map(encodeTapEntry)
  return d
}

/** Recursively sort object keys so output is byte-stable and diffable against the
 *  Swift (`.sortedKeys`) and Python (`sort_keys=True`) writers. Order is not
 *  semantically significant; this is purely cosmetic. */
function sortKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as JsonObj
    return Object.keys(v)
      .sort()
      .reduce<JsonObj>((acc, k) => {
        acc[k] = v[k]
        return acc
      }, {})
  }
  return value
}

/** Serialize measurements as a `.guitartap` document: a top-level JSON array,
 *  2-space indented, keys sorted. */
export function serializeGuitarTapFile(measurements: TapToneMeasurementModel[]): string {
  return JSON.stringify(measurements.map(encodeMeasurement), sortKeys, 2)
}