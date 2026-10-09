// Bridge between the live analysis state and the persisted TapToneMeasurementModel. A peak keeps
// one id (a UUID, as Swift's `ResonantPeak.id`) live and on file, so the id-keyed selection,
// overrides and label offsets save and restore without remapping. Builds a measurement
// from the current frozen result and restores one back into the view.

import { type Spectrum } from '../dsp/guitarFFT'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from '../dsp/classify'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { exportStem } from './exportFilename'
import { normalizedMeasurementNotes } from './measurementName'
import { newId } from './newId'
import { MODE_DISPLAY_NAME, effectiveMode } from '../presentation/modeColors'
import { effectiveSelectedPeakIDs, isMaterialMeasurement, resolvedMeasurementType } from './types'
import { formatDisplayDateCompact } from '../format/date'
import type { ChartView } from '../presentation/chartTypes'
import { DEFAULT_SETTINGS, MEASUREMENT_FULL_NAME, MEASUREMENT_SHORT_NAME, STIFFNESS_RAW_NAME, type MeasurementType, type Settings } from '../settings'
import { materialInputsFromSnapshot, type MaterialMeasurementInputs } from './materialMeasurementInputs'
import { guitarTypeNameFromRaw, isoNow, TapEntry, type AnnotationOffsets, type ComparisonEntryModel, type ResonantPeak, type SpectrumSnapshotModel, type TapEntryModel, type TapToneMeasurementModel } from './types'
import { pair, seriesRole } from '../presentation/palette'

/** A measurement type's guitar-type raw name as a snapshot records it ("Generic" … "Flamenco"). */
export const GUITAR_TYPE_RAW: Record<string, string> = {
  generic: 'Generic',
  acoustic: 'Acoustic',
  classical: 'Classical',
  flamenco: 'Flamenco',
}

const uuid = newId

/** A fresh measurement id (uppercase UUID, matching Swift). Used on import so a
 *  re-imported file becomes a NEW library entry rather than overwriting by id —
 *  mirroring Swift `importMeasurements`, whose array store allows duplicate copies. */
export const newMeasurementId = uuid



const MEASUREMENT_TYPE_FROM_RAW: Record<string, MeasurementType> = Object.fromEntries(
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

/** The DEFINITIVE peak of a mode for a saved measurement — the SELECTED peak whose OVERRIDE-AWARE mode is
 *  that mode, strongest wins. Mirrors Swift `TapToneMeasurement.definitivePeak(for:)`: `classifyAll` over
 *  ALL peaks for the auto mode, the override from `peakModeOverrides`, resolved via
 *  `effectiveMode`; kept only if in `effectiveSelectedPeakIDs`. Deselecting or relabelling a peak drops it
 *  here exactly as on screen, so this ratio agrees with the live one. */
export function measurementDefinitivePeak(m: TapToneMeasurementModel, mode: ResolvedMode): ResonantPeak | null {
  const snap = m.spectrumSnapshot
  if (!snap) return null
  const gt = guitarTypeNameFromRaw(snap.guitarType)
  const autoMap = classifyAll(m.peaks, gt)
  const selected = effectiveSelectedPeakIDs(m)
  let best: ResonantPeak | null = null
  m.peaks.forEach((p) => {
    if (!selected.has(p.id)) return
    const eff = effectiveMode(m.peakModeOverrides?.[p.id], autoMap.get(p.id) ?? 'unknown')
    if (eff === mode && (best === null || p.magnitude > best.magnitude)) best = p
  })
  return best
}

/**
 * The mode label to DISPLAY for each guitar peak of a saved measurement, keyed by peak id.
 *
 * `override > classification`, which is the same two-rung rule the writer uses
 * (`encode.ts` buildModeLabels) and that Swift applies in both its writer and its
 * MeasurementDetailView. Display and file therefore cannot disagree.
 *
 * Deliberately does NOT consult the peak's stored `modeLabel`. That field is an export-only
 * convenience injected at serialisation time — Swift has no such property on `ResonantPeak` —
 * and reading it back made a loaded file's stale label outlive the reclassification that should
 * have replaced it. Same principle this codebase states for `measurementType` in
 * measurement/types.ts: derive, don't duplicate.
 *
 * Material measurements have no guitar modes; their peaks are labelled by selected role at the
 * call site, as Swift does.
 */
export function measurementPeakModeLabels(m: TapToneMeasurementModel): Map<string, string> {
  const out = new Map<string, string>()
  const snap = m.spectrumSnapshot
  if (!snap) return out
  const gt = guitarTypeNameFromRaw(snap.guitarType)
  const autoMap = classifyAll(m.peaks, gt)
  m.peaks.forEach((p) => {
    const eff = effectiveMode(m.peakModeOverrides?.[p.id], autoMap.get(p.id) ?? 'unknown')
    out.set(p.id, m.peakModeOverrides?.[p.id] ?? MODE_DISPLAY_NAME[eff])
  })
  return out
}

/** Top-to-Air frequency ratio for a saved guitar measurement, mirroring Swift `TapToneMeasurement.
 *  tapToneRatio`: the DEFINITIVE Top over the DEFINITIVE Air. Null when either is absent. */
export function measurementTapToneRatio(m: TapToneMeasurementModel): number | null {
  const air = measurementDefinitivePeak(m, 'air')
  const top = measurementDefinitivePeak(m, 'top')
  return air && top && air.frequency > 0 ? top.frequency / air.frequency : null
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
  const gt = guitarTypeNameFromRaw(m.spectrumSnapshot?.guitarType)
  const autoMap = classifyAll(m.peaks, gt)
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

export interface LiveRestore {
  measurementType: MeasurementType
  captured: Spectrum
  view: ChartView
  settingsPatch: Partial<Settings>
  /** The saved peaks, authoritative — never re-derived from the spectrum — each with its saved id. Peak
   *  Min only filters these by magnitude (matching Swift recalculateFrozenPeaksIfNeeded / Python
   *  recalculate_frozen_peaks_if_needed). */
  loadedPeaks: ResonantPeak[]
  /** Ids of the selected peaks. */
  selectedIds: Set<string>
  /** Whether the saved selection was hand-modified (default true for legacy files). */
  userModified: boolean
  /** Manual overrides to restore, keyed by peak `id`. */
  overridesById: Map<string, string>
  /** Dragged annotation-label positions to restore, keyed by peak `id`. */
  annotationOffsetsById: Map<string, [number, number]>
  /** The per-tap entries, restored as saved — each tap's peaks and auto-selection included. */
  tapEntries: TapEntry[]
}

/** Decompose a saved guitar measurement into the pieces the App restores into the view.
 *  The saved peaks are injected verbatim, ids included; selection, overrides and label offsets
 *  restore by those same ids, as Swift's do. */
export function measurementToLive(m: TapToneMeasurementModel): LiveRestore {
  const snap = m.spectrumSnapshot
  if (!snap) throw new Error('Measurement has no guitar spectrum snapshot')

  const measurementType = MEASUREMENT_TYPE_FROM_RAW[snap.measurementType ?? ''] ?? 'generic'

  const loadedPeaks: ResonantPeak[] = [...m.peaks]

  // Overrides, offsets and selection name peaks by id; an id with no matching peak is dropped.
  const peakIds = new Set(m.peaks.map((p) => p.id))
  const overridesById = new Map<string, string>()
  const annotationOffsetsById = new Map<string, [number, number]>()
  for (const [id, label] of Object.entries(m.peakModeOverrides ?? {})) {
    if (peakIds.has(id)) overridesById.set(id, label)
  }
  for (const [id, pos] of Object.entries(m.peakAnnotationOffsets ?? {})) {
    if (peakIds.has(id)) annotationOffsetsById.set(id, pos)
  }

  // Selection restores from the saved ids; if none were saved, default to selecting all peaks (matches
  // Swift loadMeasurement).
  const selectedIds = new Set<string>(
    m.selectedPeakIDs ? m.selectedPeakIDs.filter((id) => peakIds.has(id)) : peakIds,
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
    userModified: m.userModifiedSelection ?? true,
    captured: { magnitudesDb: snap.magnitudes, frequencies: snap.frequencies },
    view: { minHz: snap.minFreq, maxHz: snap.maxFreq, minDb: snap.minDB, maxDb: snap.maxDB },
    settingsPatch,
    loadedPeaks,
    selectedIds,
    overridesById,
    annotationOffsetsById,
    tapEntries: (m.tapEntries ?? []).map(
      (e) =>
        new TapEntry(
          e.id,
          e.tapIndex,
          e.snapshot,
          e.peaks,
          e.selectedPeakIDs,
        ),
    ),
  }
}

export interface MaterialRestore {
  measurementType: MeasurementType
  /** Per-phase spectra for the chart overlay. */
  matSpectra: { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
  /** The identified L/C/FLC peaks — the measurement's peaks (Swift selected…Peak, restored by id). */
  selectedLongitudinalPeak: ResonantPeak | null
  selectedCrossPeak: ResonantPeak | null
  selectedFlcPeak: ResonantPeak | null
  /** The measurement's OWN material dimensions (Store B) — restored here, NOT into Settings, so the
   *  calc/display/PDF read the measurement's values and loading never clobbers the Settings defaults. */
  materialInputs: MaterialMeasurementInputs
  /** Only the type (+ measureFlc, a capture setting) is restored into Settings; dims go to `materialInputs`. */
  settingsPatch: Partial<Settings>
  /** The saved axis range — applied as a transient override (not persisted), like guitar. */
  view: ChartView
  /** Dragged L/C/FLC label positions, keyed by the restored material peak `id` (the shared store). */
  annotationOffsetsById: Map<string, [number, number]>
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
  // Each restored material peak keeps its saved id, so the dragged offsets restore by that id into the
  // shared id-keyed store. Stale ids (no matching restored peak) are dropped.
  const toMatPeak = (id: string | undefined): ResonantPeak | null => {
    const p = id != null ? byId.get(id) : undefined
    return p ?? null
  }
  const selectedLongitudinalPeak = toMatPeak(m.selectedLongitudinalPeakID)
  const selectedCrossPeak = toMatPeak(m.selectedCrossPeakID)
  const selectedFlcPeak = toMatPeak(m.selectedFlcPeakID)
  const restoredIds = new Set(
    [selectedLongitudinalPeak, selectedCrossPeak, selectedFlcPeak].filter((p) => p != null).map((p) => p.id),
  )
  const annotationOffsetsById = new Map<string, [number, number]>()
  for (const [id, pos] of Object.entries(m.peakAnnotationOffsets ?? {})) {
    if (restoredIds.has(id)) annotationOffsetsById.set(id, pos)
  }

  // Store B ← the measurement's OWN dims from the snapshot (the calc/display/PDF read this). Loading no
  // longer writes the dims into Settings (Store A) — that was the clobber that silently overwrote the
  // user's next-measurement defaults. Only the type and measureFlc (a capture setting the process/slot
  // display reads) go into the Settings patch; the axis range is transient (see `view` below).
  const materialInputs = materialInputsFromSnapshot(measurementType === 'brace' ? 'brace' : 'plate', snap)
  const patch: Partial<Settings> = { measurementType }
  if (snap.measureFlc != null) patch.measureFlc = snap.measureFlc

  return {
    measurementType,
    materialInputs,
    matSpectra: {
      longitudinal: toSpectrum(m.longitudinalSnapshot),
      cross: toSpectrum(m.crossSnapshot),
      flc: toSpectrum(m.flcSnapshot),
    },
    selectedLongitudinalPeak,
    selectedCrossPeak,
    selectedFlcPeak,
    settingsPatch: patch,
    view: { minHz: snap.minFreq, maxHz: snap.maxFreq, minDb: snap.minDB, maxDb: snap.maxDB },
    annotationOffsetsById,
  }
}

// ── Comparison measurements ─────────────────────────────────────────────────
// A comparison overlays several measurements' spectra. Each entry's colour is its series slot's role,
// stored as the light value (Swift/Python comparison entries).

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

/** `{mode display name → peak id}` for Air/Top/Back from a source measurement's DEFINITIVE peaks
 *  (selected + override-aware). Keyed by `MODE_DISPLAY_NAME` = Swift `GuitarMode.rawValue`, so the saved
 *  map is cross-platform. The ids reference selected peaks, which the comparison entry keeps. Mirrors
 *  Swift `ComparisonEntry.modeIDMap`. */
function modeIDMap(m: TapToneMeasurementModel): Record<string, string> {
  const map: Record<string, string> = {}
  for (const mode of ['air', 'top', 'back'] as const) {
    const p = measurementDefinitivePeak(m, mode)
    if (p) map[MODE_DISPLAY_NAME[mode]] = p.id
  }
  return map
}

/** The Air/Top/Back modes whose definitive peak carries a manual override — the ones the multi-tap report's
 *  Averaged row marks. Swift `definitiveModeInfo()`'s `isOverride`. */
export function measurementOverriddenModes(m: TapToneMeasurementModel): ('air' | 'top' | 'back')[] {
  return (['air', 'top', 'back'] as const).filter((mode) => {
    const p = measurementDefinitivePeak(m, mode)
    return p != null && m.peakModeOverrides?.[p.id] != null
  })
}

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
      colorComponents: hexToComponents(pair(seriesRole(i)).light),
      snapshot: snap,
      peaks,
      guitarType: snap.guitarType,
      sourceMeasurementID: m.id,
      modePeakIDs: modeIDMap(m), // self-describing definitive Air/Top/Back, resolved from the source
    }
  })
}


/** Convert a multi-tap guitar measurement's per-tap entries into comparison entries — one "Tap N"
 *  per tap (palette-cycled) plus a trailing "Averaged" entry built from the measurement's own
 *  spectrum + selected peaks. Mirrors Swift `exportMultiTapPDFReport`'s `cmpEntries`
 *  (TapToneAnalysisView+Export.swift): the averaged entry is appended last. Each entry keeps only
 *  its SELECTED peaks so the comparison table resolves the same Air/Top/Back the live view shows. */
export function multiTapComparisonEntries(m: TapToneMeasurementModel): ComparisonEntryModel[] {
  const selectedOf = (peaks: ResonantPeak[], ids?: string[]): ResonantPeak[] => {
    if (!ids?.length) return peaks
    const set = new Set(ids)
    return peaks.filter((p) => set.has(p.id))
  }
  const entries: ComparisonEntryModel[] = (m.tapEntries ?? []).map((e, i) => ({
    id: uuid(),
    label: `Tap ${e.tapIndex}`,
    colorComponents: hexToComponents(pair(seriesRole(i)).light),
    snapshot: e.snapshot,
    peaks: selectedOf(e.peaks, e.selectedPeakIDs),
    guitarType: e.snapshot.guitarType,
  }))
  if (m.spectrumSnapshot) {
    entries.push({
      id: uuid(),
      label: 'Averaged',
      colorComponents: hexToComponents(pair('series.average').light),
      snapshot: m.spectrumSnapshot,
      peaks: selectedOf(m.peaks, m.selectedPeakIDs),
      guitarType: m.spectrumSnapshot.guitarType,
      // Only the Averaged row is definitive/override-aware; per-tap rows stay positional (no map).
      modePeakIDs: modeIDMap(m),
    })
  }
  return entries
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
