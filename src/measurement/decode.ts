// `.guitartap` reader. Accepts the canonical form the writer (./encode) produces and
// every older shape documented in the Swift user manual App. B "Legacy compatibility
// (reader-only)" table. The reader is deliberately permissive; the writer is minimal.
//
// Numbers are read at full JS precision (no float32 quantisation on the way in — that
// only matters when writing). Unknown fields are ignored.

import { base64ToFloats } from './base64'
import { classificationGuitarType, guitarTypeNameFromRaw, isMaterialMeasurement } from './types'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from '../dsp/classify'
import { MODE_DISPLAY_NAME, effectiveMode } from '../presentation/modeColors'
import type { AnnotationOffsets, ComparisonEntryModel, PeakModeOverrides, ResonantPeak, SpectrumSnapshotModel, TapEntryModel, TapToneMeasurementModel } from './types'
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

function decodePeak(d: Obj): ResonantPeak {
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
  }
}

const decodePeaks = (v: unknown): ResonantPeak[] =>
  Array.isArray(v) ? v.map((p) => decodePeak(obj(p) ?? {})) : []

/** A `{string: string}` map (e.g. `modePeakIDs`), or undefined when absent/empty. */
function decodeStrMap(raw: unknown): Record<string, string> | undefined {
  const o = obj(raw)
  if (!o) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string') out[k] = v
  return Object.keys(out).length ? out : undefined
}

function decodeComparisonEntry(d: Obj): ComparisonEntryModel {
  return {
    id: strOpt(d.id) ?? '',
    label: strOpt(d.label) ?? '',
    colorComponents: numArrOpt(d.colorComponents) ?? [0, 0, 1, 1],
    snapshot: decodeSnapshot(obj(d.snapshot) ?? {}),
    peaks: decodePeaks(d.peaks),
    guitarType: strOpt(d.guitarType),
    sourceMeasurementID: strOpt(d.sourceMeasurementID),
    modePeakIDs: decodeStrMap(d.modePeakIDs),
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
/** Peaks closer than this describe the same spectral feature (mirrors `PEAK_PROXIMITY_HZ`). */
const HEAL_PROXIMITY_HZ = 2

/**
 * Collapse peaks that describe the same spectral feature.
 *
 * Files written before the `findPeaks` duplicate fix contain one bit-identical twin per
 * capture (and one per tap entry in multi-tap files): the detector visited overlap bins once
 * per overlapping mode band and minted a peak each time. Loaded peaks are authoritative and
 * are never re-derived, so without this every existing file would show a phantom Analysis
 * Results row forever.
 *
 * Keeps, in order of preference: the peak in `selectedIds` (the claimed mode winner), then
 * the louder, then the first seen. `findPeaks` guarantees legitimately saved peaks are at
 * least `HEAL_PROXIMITY_HZ` apart, so any closer pair is corruption by definition.
 *
 * Mirrors Swift `TapToneMeasurement.healDuplicatePeaks` / Python `heal_duplicate_peaks`.
 */
function healDuplicatePeaks(
  peaks: ResonantPeak[],
  selectedIds: Set<string>,
): { peaks: ResonantPeak[]; removed: Set<string> } {
  const kept: ResonantPeak[] = []
  const removed = new Set<string>()

  for (const peak of peaks) {
    const idx = kept.findIndex((k) => Math.abs(k.frequency - peak.frequency) < HEAL_PROXIMITY_HZ)
    if (idx === -1) {
      kept.push(peak)
      continue
    }
    const incumbent = kept[idx]!
    const preferIncoming =
      selectedIds.has(peak.id) !== selectedIds.has(incumbent.id)
        ? selectedIds.has(peak.id)
        : peak.magnitude > incumbent.magnitude

    if (preferIncoming) {
      removed.add(incumbent.id)
      kept[idx] = peak
    } else {
      removed.add(peak.id)
    }
  }

  return { peaks: kept, removed }
}

export function decodeMeasurement(d: Obj): TapToneMeasurementModel {
  const m: TapToneMeasurementModel = {
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
    userModifiedSelection: typeof d.userModifiedSelection === 'boolean' ? d.userModifiedSelection : undefined,
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

  // Every read path reaches decodeMeasurement(): `.guitartap` import goes through it. The
  // IndexedDB store does NOT — it holds already-decoded objects — so it calls healMeasurement
  // directly on read (see store.ts). Both routes therefore repair pre-fix data.
  healMeasurement(m)
  return m
}

/**
 * Repairs a decoded measurement in place, collapsing duplicate peaks in the measurement and in
 * every tap entry, and dropping the removed ids from `selectedPeakIDs`, annotation offsets and
 * mode overrides.
 *
 * Sets a transient `wasHealed` marker when anything changed. That marker is deliberately NOT
 * part of the model's serialised shape: it describes what happened during one read, not a
 * property of the file. The saved-measurements store reads it to force a re-save so the library
 * repairs itself.
 *
 * @returns `true` when the measurement was modified.
 */
export function healMeasurement(m: TapToneMeasurementModel): boolean {
  let healed = false

  const { peaks, removed } = healDuplicatePeaks(m.peaks, new Set(m.selectedPeakIDs ?? []))
  if (removed.size > 0) {
    m.peaks = peaks
    // Drop dangling references so nothing points at a peak that no longer exists.
    if (m.selectedPeakIDs) m.selectedPeakIDs = m.selectedPeakIDs.filter((id) => !removed.has(id))
    if (m.peakAnnotationOffsets) {
      m.peakAnnotationOffsets = Object.fromEntries(
        Object.entries(m.peakAnnotationOffsets).filter(([id]) => !removed.has(id)),
      )
    }
    if (m.peakModeOverrides) {
      m.peakModeOverrides = Object.fromEntries(
        Object.entries(m.peakModeOverrides).filter(([id]) => !removed.has(id)),
      )
    }
    healed = true
  }

  // Multi-tap files carry a duplicate inside every tap entry as well; the Taps view and the
  // multi-tap PDF read those, so they need the same repair.
  for (const te of m.tapEntries ?? []) {
    const r = healDuplicatePeaks(te.peaks, new Set(te.selectedPeakIDs ?? []))
    if (r.removed.size === 0) continue
    te.peaks = r.peaks
    te.selectedPeakIDs = (te.selectedPeakIDs ?? []).filter((id) => !r.removed.has(id))
    healed = true
  }

  // Repair the selection to a valid DEFINITIVE set (after the duplicate heal cleaned dangling ids), so
  // a legacy file's on-screen state, saved-list ratio, and file all agree. Guitar-only, self-guarded.
  if (healSelection(m)) healed = true

  // Fill a legacy comparison's missing per-entry modePeakIDs so the file is self-describing.
  if (healComparisonModes(m)) healed = true

  if (healed) m.wasHealed = true
  return healed
}

/** Parse a `.guitartap` document. The top-level value is an array of measurements
 *  (the array wrapping is part of the format); a bare object is also accepted. */
export function parseGuitarTapFile(text: string): TapToneMeasurementModel[] {
  const root: unknown = JSON.parse(text)
  const list = Array.isArray(root) ? root : [root]
  return list.map((m) => decodeMeasurement(obj(m) ?? {}))
}

/** Heal a decoded GUITAR measurement's selection to a valid DEFINITIVE set, mirroring Swift's
 *  `TapToneMeasurement` decode heal. Legacy files predate the selection model two ways:
 *   • no saved selection (nil) — older code treated that as "all selected", i.e. every Air/Top/Back at
 *     once, exactly what the invariant forbids → set it to the strongest peak per EFFECTIVE mode;
 *   • a pre-uniqueness selection could hold two selected Tops → prune to at most the strongest selected
 *     peak per single-holder mode (cluster modes + unknown untouched).
 *  Guitar-only (material has no per-peak selection). Mutates `m.selectedPeakIDs`; returns true if changed. */
export function healSelection(m: TapToneMeasurementModel): boolean {
  if (isMaterialMeasurement(m)) return false
  const autoMap = classifyAll(m.peaks, classificationGuitarType(m))
  const effOf = (p: ResonantPeak): ResolvedMode => effectiveMode(m.peakModeOverrides?.[p.id], autoMap.get(p.id) ?? 'unknown')
  const singleHolder: ReadonlySet<ResolvedMode> = new Set(['air', 'top', 'back'])

  if (m.selectedPeakIDs == null) {
    // No saved selection → the auto definitive set: strongest peak per effective mode (skip unknown).
    const strongest = new Map<ResolvedMode, ResonantPeak>()
    m.peaks.forEach((peakModel) => {
      const mode = effOf(peakModel)
      if (mode === 'unknown') return
      const cur = strongest.get(mode)
      if (!cur || peakModel.magnitude > cur.magnitude) strongest.set(mode, peakModel)
    })
    m.selectedPeakIDs = [...strongest.values()].map((peakModel) => peakModel.id)
    return true
  }

  // Prune a pre-uniqueness selection to the strongest selected peak per single-holder mode.
  const selected = new Set(m.selectedPeakIDs)
  const winner = new Map<ResolvedMode, ResonantPeak>()
  const peakById = new Map(m.peaks.map((peakModel) => [peakModel.id, peakModel]))
  m.peaks.forEach((peakModel) => {
    if (!selected.has(peakModel.id)) return
    const mode = effOf(peakModel)
    if (!singleHolder.has(mode)) return
    const cur = winner.get(mode)
    if (!cur || peakModel.magnitude > cur.magnitude) winner.set(mode, peakModel)
  })
  const winnerIds = new Set([...winner.values()].map((peakModel) => peakModel.id))
  const pruned = m.selectedPeakIDs.filter((id) => {
    const peakModel = peakById.get(id)
    if (peakModel == null) return false
    const mode = effOf(peakModel)
    return !singleHolder.has(mode) || winnerIds.has(id)
  })
  if (pruned.length !== m.selectedPeakIDs.length) {
    m.selectedPeakIDs = pruned
    return true
  }
  return false
}

/** Heal a decoded COMPARISON measurement: fill each entry's `modePeakIDs` positionally when absent (a
 *  pre-6b file stored none). Override-BLIND by necessity — an old comparison never saved the sources'
 *  overrides, so this only freezes what the old app showed and makes the file self-describing from here
 *  on. Mutates entries; returns true if any changed. Mirrors Swift's decode comparison-heal. */
export function healComparisonModes(m: TapToneMeasurementModel): boolean {
  if (!m.comparisonEntries?.length) return false
  let changed = false
  for (const entry of m.comparisonEntries) {
    if (entry.modePeakIDs != null) continue
    const gt = guitarTypeNameFromRaw(entry.guitarType)
    const resolved = resolvedModePeaks(entry.peaks, gt)
    const map: Record<string, string> = {}
    for (const mode of ['air', 'top', 'back'] as const) {
      const id = resolved.get(mode)?.id
      if (id != null) map[MODE_DISPLAY_NAME[mode]] = id
    }
    entry.modePeakIDs = map
    changed = true
  }
  return changed
}
