// In-memory model for a `.guitartap` measurement. Mirrors the Swift
// TapToneMeasurement / SpectrumSnapshot / ResonantPeak structs and the Python
// dataclasses. The canonical on-disk format is documented in the Swift user manual
// Appendix B (Documentation/Manual/app-b-file-formats.md); decode/encode live in
// ./decode and ./encode. Field names here are the camelCase JSON keys.
//
// Numbers are plain JS numbers. The float32-vs-double distinction (App. B "Number
// precision") is applied only at encode time via floatJson.f32 — the model keeps full
// values. Dates/UUIDs are strings (ISO-8601 / RFC 4122), as on the wire.

import { MEASUREMENT_FULL_NAME, MEASUREMENT_SHORT_NAME, type AnnotationMode, type MeasurementType } from '../settings'
import { newId, type Uuid } from './newId'
import type { GuitarTypeName, ModeName } from '../dsp/guitarModes'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from '../dsp/classify'
import { MODE_DISPLAY_NAME, effectiveMode } from '../presentation/modeColors'
import { exportStem } from './exportFilename'
import { pair, seriesRole, type Role } from '../presentation/palette'
import type { ChartView } from '../presentation/chartTypes'

/** Guitar mode label overrides are stored per peak as the assigned label string. */
export type PeakModeOverrides = Record<Uuid, string>

/** Absolute data-space annotation label positions: uuid → [absFreqHz, absDB]. */
export type AnnotationOffsets = Record<Uuid, [number, number]>

// @parity dsp/find-peaks tests=test/peaks
/** A detected resonant peak — one type in memory and on file, guitar and material alike. Mirrors Swift
 *  `ResonantPeak` / Python `ResonantPeak`. Make one with {@link makeResonantPeak}. */
export interface ResonantPeak {
  /** Stable unique id (an uppercase UUID), kept through save and load. */
  id: Uuid
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
  id: Uuid
  label: string
  /** RGBA, each 0.0–1.0 (double precision). */
  colorComponents: number[]
  snapshot: SpectrumSnapshotModel
  peaks: ResonantPeak[]
  guitarType?: string
  sourceMeasurementID?: Uuid
  /** The DEFINITIVE Air/Top/Back for this overlaid spectrum, `{mode display name → peak id}` referencing
   *  this entry's own `peaks`, resolved override-aware from the SOURCE at build. Makes a saved comparison
   *  self-describing — a reader reproduces the table by id lookup, no `classifyAll`, no source overrides.
   *  Absent on pre-6b files → healed positionally on decode + re-saved. Mirrors Swift/Python
   *  `ComparisonEntry.modePeakIDs` (keyed by `GuitarMode.rawValue` = the mode's display name). */
  modePeakIDs?: Record<string, Uuid>
}

export interface TapEntryModel {
  id: Uuid
  tapIndex: number
  snapshot: SpectrumSnapshotModel
  peaks: ResonantPeak[]
  selectedPeakIDs: Uuid[]
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
    readonly id: Uuid,
    /** 1-based display index ("Tap 1", "Tap 2", …). */
    readonly tapIndex: number,
    /** Full spectrum snapshot for this tap, recording the guitar type it was captured under. */
    readonly snapshot: SpectrumSnapshotModel,
    /** Every peak found in this tap's spectrum, at the detection floor. */
    readonly peaks: ResonantPeak[],
    /** Ids of the auto-selected peaks — one per guitar mode where found. */
    readonly selectedPeakIDs: Uuid[],
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
  id: Uuid
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
  selectedPeakIDs?: Uuid[]
  /** Frequencies (Hz) of the selected peaks, parallel to `selectedPeakIDs`. Written for a program reading
   *  the file that wants the selected peaks' frequencies without resolving the IDs or repeating the
   *  selection; GuitarTap itself does not read it back. Mirrors Swift/Python selectedPeakFrequencies. */
  selectedPeakFrequencies?: number[]
  /** Whether the saved selection was hand-modified (vs the automatic mode-priority selection). Restored
   *  on load, so a loaded measurement offers Reset to automatic selection as it did when saved. Absent in
   *  older files — those default to manual. Mirrors Swift/Python userModifiedSelection. */
  userModifiedSelection?: boolean
  annotationVisibilityMode?: AnnotationMode
  tapDetectionThreshold?: number
  numberOfTaps?: number
  peakMinThreshold?: number
  selectedLongitudinalPeakID?: Uuid
  selectedCrossPeakID?: Uuid
  selectedFlcPeakID?: Uuid
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
 *  - Guitar: the saved selection (`selectedPeakIDs`) — empty for Select None — or all peaks when a
 *    legacy file saved none.
 *  - Material: **always all of `peaks`.** Plate/brace have no per-peak selection, and the saved
 *    aggregate can be corrupted by an intermittent phase-transition write (an iPad-only Swift
 *    glitch), so it is ignored on read — healing existing corrupt files at render time.
 *  Mirrors Swift/Python `effectiveSelectedPeakIDs`. */
export const effectiveSelectedPeakIDs = (m: TapToneMeasurementModel): Set<Uuid> => {
  if (isMaterialMeasurement(m)) return new Set(m.peaks.map((p) => p.id))
  return m.selectedPeakIDs != null ? new Set(m.selectedPeakIDs) : new Set(m.peaks.map((p) => p.id))
}

// ── The measurement's own logic — Swift `TapToneMeasurement` / Python `TapToneMeasurement` ─────────

/** The guitar type this measurement's peaks are classified with: the type its snapshot records,
 *  otherwise Generic — never the app's current setting, so a saved measurement's modes are the same
 *  whatever the app is set to. Swift `classificationGuitarType`. */
export const classificationGuitarType = (m: TapToneMeasurementModel): GuitarTypeName =>
  guitarTypeNameFromRaw(m.spectrumSnapshot?.guitarType ?? m.longitudinalSnapshot?.guitarType)

/** Each peak's automatic mode, classified among ALL of the measurement's peaks with
 *  {@link classificationGuitarType} — the rule the live analyzer applies (`reclassifyPeaks`). The Top
 *  and Back bands overlap and peaks compete for them, so classifying a subset (the selected peaks, the
 *  peaks on screen) can turn a Back into a Top. Empty for a material measurement. Swift `autoModes`. */
export function measurementAutoModes(m: TapToneMeasurementModel): Map<Uuid, ResolvedMode> {
  return isMaterialMeasurement(m) ? new Map() : classifyAll(m.peaks, classificationGuitarType(m))
}

/** The label each peak is shown and written with, by peak id: for a guitar, its override, otherwise
 *  its automatic mode ({@link measurementAutoModes}); for plate/brace, the role it fills. The one rule
 *  for the file's `modeLabel` and the Details pane, so the two cannot disagree. Never the peak's stored
 *  `modeLabel`: that is written for external readers and derived afresh on every write. Swift
 *  `peakModeLabels`. */
export function measurementPeakModeLabels(m: TapToneMeasurementModel): Map<Uuid, string> {
  const labels = new Map<Uuid, string>()
  if (isMaterialMeasurement(m)) {
    for (const p of m.peaks) {
      labels.set(
        p.id,
        p.id === m.selectedLongitudinalPeakID ? 'Longitudinal'
          : p.id === m.selectedCrossPeakID ? 'Cross-grain'
            : p.id === m.selectedFlcPeakID ? 'Diagonal'
              : 'Peak',
      )
    }
    return labels
  }
  const modes = measurementAutoModes(m)
  for (const p of m.peaks) labels.set(p.id, m.peakModeOverrides?.[p.id] ?? MODE_DISPLAY_NAME[modes.get(p.id) ?? 'unknown'])
  return labels
}

/** The DEFINITIVE peak of a mode — the SELECTED peak whose OVERRIDE-AWARE mode is that mode, strongest
 *  wins: the same rule the live analyzer applies, so the saved ratio and the on-screen ratio cannot
 *  disagree. Swift `definitivePeak(for:)`. */
export function measurementDefinitivePeak(m: TapToneMeasurementModel, mode: ResolvedMode): ResonantPeak | null {
  const autoMap = measurementAutoModes(m)
  const selected = effectiveSelectedPeakIDs(m)
  let best: ResonantPeak | null = null
  for (const p of m.peaks) {
    if (!selected.has(p.id)) continue
    const eff = effectiveMode(m.peakModeOverrides?.[p.id], autoMap.get(p.id) ?? 'unknown')
    if (eff === mode && (best === null || p.magnitude > best.magnitude)) best = p
  }
  return best
}

/** Top-to-Air frequency ratio for a saved guitar measurement, mirroring Swift `TapToneMeasurement.
 *  tapToneRatio`: the DEFINITIVE Top over the DEFINITIVE Air. Null when either is absent. */
export function measurementTapToneRatio(m: TapToneMeasurementModel): number | null {
  const air = measurementDefinitivePeak(m, 'air')
  const top = measurementDefinitivePeak(m, 'top')
  return air && top && air.frequency > 0 ? top.frequency / air.frequency : null
}

/** The definitive Air / Top / Back, each with whether it is the user's manual override — for the
 *  multi-tap Averaged row, on screen and in the PDF, where an overridden value must be marked so it is
 *  not read as the averaged spectrum's auto peak. Swift `definitiveModeInfo()`. */
export function measurementDefinitiveModeInfo(m: TapToneMeasurementModel): Map<'air' | 'top' | 'back', { frequency: number; isOverride: boolean }> {
  const out = new Map<'air' | 'top' | 'back', { frequency: number; isOverride: boolean }>()
  for (const mode of ['air', 'top', 'back'] as const) {
    const p = measurementDefinitivePeak(m, mode)
    if (p) out.set(mode, { frequency: p.frequency, isOverride: m.peakModeOverrides?.[p.id] != null })
  }
  return out
}

// @parity model/measurement-type tests=test/measurement-type-name
/** A measurement type's raw name on file ("Classical Guitar" …) → its Settings type. */
export const MEASUREMENT_TYPE_FROM_RAW: Record<string, MeasurementType> = Object.fromEntries(
  Object.entries(MEASUREMENT_FULL_NAME).map(([k, v]) => [v, k as MeasurementType]),
)

/** A measurement's type as the single Settings-vocabulary word shown in the Details pane:
 *  Acoustic / Classical / Flamenco / Generic / Plate / Brace / Comparison. */
export function measurementTypeName(m: TapToneMeasurementModel): string {
  if (m.comparisonEntries != null) return 'Comparison'
  const raw = resolvedMeasurementType(m)
  const t = raw != null ? MEASUREMENT_TYPE_FROM_RAW[raw] : undefined
  // An UNRECOGNISED type is an em-dash, not the raw string. Swift's contract, stated on
  // TapToneMeasurement.measurementTypeShortName: "Acoustic / Classical / Flamenco / Generic /
  // Plate / Brace / Comparison — or '—' when no snapshot carries a type." Six names, Comparison,
  // or an em-dash; nothing else. Python raises out of MeasurementType(...) to the same place.
  // So a file whose snapshot carries a type none of the six match — a foreign writer, a corrupted
  // field, a future type opened by an older build — shows the same em-dash in all three editions.
  return t != null ? MEASUREMENT_SHORT_NAME[t] : '—'
}

/** Filesystem-safe `.guitartap` base name, mirroring Swift `baseFilename`:
 *  `<measurement-name-slug>-<unix timestamp>`. */
export function guitarTapFilename(m: TapToneMeasurementModel): string {
  const ts = Math.floor((Date.parse(m.timestamp) || 0) / 1000)
  return `${exportStem(m.measurementName, ts, 'measurement')}.guitartap`
}

/** `{mode display name → peak id}` for Air/Top/Back from a source measurement's DEFINITIVE peaks
 *  (selected + override-aware). Keyed by `MODE_DISPLAY_NAME` = Swift `GuitarMode.rawValue`, so the saved
 *  map is cross-platform. The ids reference selected peaks, which the comparison entry keeps. Mirrors
 *  Swift `ComparisonEntry.modeIDMap`. */
export function comparisonModeIDMap(m: TapToneMeasurementModel): Record<string, Uuid> {
  const map: Record<string, Uuid> = {}
  for (const mode of ['air', 'top', 'back'] as const) {
    const p = measurementDefinitivePeak(m, mode)
    if (p) map[MODE_DISPLAY_NAME[mode]] = p.id
  }
  return map
}

/** The definitive Air/Top/Back frequencies for one comparison entry — drives the comparison table + PDF.
 *  Reads the stored self-describing `modePeakIDs` (id lookup into the entry's own peaks); falls back to
 *  positional `resolvedModePeaks` ONLY per-mode when the map lacks that mode (legacy / in-memory entries).
 *  The reader must NOT re-classify when the map is present, or an overridden Top would be lost. Mirrors
 *  Swift `ComparisonEntry.modeFrequency`. */
export function comparisonEntryModeFreqs(entry: ComparisonEntryModel): { air: number | null; top: number | null; back: number | null } {
  const gt = guitarTypeNameFromRaw(entry.guitarType)
  const positional = resolvedModePeaks(entry.peaks, gt)
  const freq = (mode: 'air' | 'top' | 'back'): number | null => {
    const id = entry.modePeakIDs?.[MODE_DISPLAY_NAME[mode]]
    if (id != null) return entry.peaks.find((p) => p.id === id)?.frequency ?? null
    return positional.get(mode)?.frequency ?? null
  }
  return { air: freq('air'), top: freq('top'), back: freq('back') }
}

/** A palette role as a comparison entry stores its colour: its light value as `[r, g, b, a]`, each 0–1.
 *  Swift `Palette.storedComponents`. */
export function storedComponents(role: Role): number[] {
  const h = pair(role).light.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1]
}

/** A multi-tap measurement as a comparison: one entry per tap — "Tap N", the tap's own spectrum and its
 *  selected peaks — and last "Averaged", the measurement's own spectrum and selected peaks. Empty when
 *  the measurement has no taps. The one builder of these entries: the on-screen tap comparison, its
 *  chart and the report's comparison page read it, live and saved alike. Swift
 *  `multiTapComparisonEntries`. */
export function measurementMultiTapComparisonEntries(m: TapToneMeasurementModel): ComparisonEntryModel[] {
  if (!m.tapEntries?.length) return []
  const entries: ComparisonEntryModel[] = m.tapEntries.map((e, i) => {
    const selected = new Set(e.selectedPeakIDs)
    return {
      id: newId(),
      label: `Tap ${e.tapIndex}`,
      colorComponents: storedComponents(seriesRole(i)),
      snapshot: e.snapshot,
      peaks: e.peaks.filter((p) => selected.has(p.id)),
      guitarType: e.snapshot.guitarType,
    }
  })
  if (m.spectrumSnapshot) {
    const selected = effectiveSelectedPeakIDs(m)
    entries.push({
      id: newId(),
      label: 'Averaged',
      colorComponents: storedComponents('series.average'),
      snapshot: m.spectrumSnapshot,
      peaks: m.peaks.filter((p) => selected.has(p.id)),
      guitarType: m.spectrumSnapshot.guitarType,
    })
  }
  return entries
}

/** The union of comparison entries' axis ranges, or null for none. What Swift computes in
 *  `loadComparison` (`setLoadedAxisRange`) and its comparison chart renderers. */
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
