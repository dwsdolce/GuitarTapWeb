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
import { effectiveSelectedPeakIDs, isMaterialMeasurement } from './types'
import { formatDisplayDateCompact } from '../format/date'
import type { ChartView } from '../presentation/chartTypes'
import { DEFAULT_SETTINGS, MEASUREMENT_FULL_NAME, MEASUREMENT_SHORT_NAME, STIFFNESS_RAW_NAME, type MeasurementType, type Settings } from '../settings'
import { materialInputsFromSnapshot, type MaterialMeasurementInputs } from './materialMeasurementInputs'
import { guitarTypeNameFromRaw, isoNow, TapEntry, type AnnotationOffsets, type ComparisonEntryModel, type ResonantPeak, type SpectrumSnapshotModel, type TapEntryModel, type TapToneMeasurementModel } from './types'

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



export interface BuildMeasurementArgs {
  name: string
  notes: string
  spectrum: Spectrum
  peaks: ResonantPeak[]
  selectedIds: Set<string>
  /** Manual label overrides, keyed by peak `id` (the analyzer-owned live form). */
  overridesById: Map<string, string>
  view: ChartView
  settings: Settings
  numberOfTaps: number
  /** Per-tap entries (multi-tap capture), saved as they are as the measurement's tapEntries. */
  tapEntries?: TapEntry[]
  sampleRate: number | null
  deviceLabel: string
  /** Active input deviceId + calibration name at capture time (provenance for the Details pane). */
  microphoneUID?: string
  calibrationName?: string
  /** Dragged annotation-label positions, keyed by peak `id` → [absFreqHz, absDB] (the analyzer store). */
  annotationOffsetsById?: Map<string, [number, number]>
  /** Measured ring-out time (s) from the engine, or null/undefined if not measured. */
  decayTime?: number | null
  /** Whether the current selection is user-modified (vs automatic) — persisted so a reloaded
   *  measurement re-runs auto-selection on Peak Min change when automatic. Omitted defaults to
   *  automatic (a fresh build that never touched selection). */
  userModified?: boolean
}

/** Construct a guitar TapToneMeasurementModel from the current frozen result. */
export function buildGuitarMeasurement(a: BuildMeasurementArgs): TapToneMeasurementModel {
  const timestamp = isoNow()
  const guitarTypeRaw = GUITAR_TYPE_RAW[a.settings.measurementType] ?? 'Generic'
  const guitarTypeName = guitarTypeNameFromRaw(guitarTypeRaw)
  const measurementTypeRaw = MEASUREMENT_FULL_NAME[a.settings.measurementType]

  // Each peak is saved as it is — its own id, the time it was found and its pitch — as Swift saves
  // `allPeaks`. (The mode label the file carries is the writer's: encode.ts derives it afresh.)
  const peakModels: ResonantPeak[] = [...a.peaks]

  // Full-set save. `a.peaks` IS the full set — the analyzer detects
  // at the -100 dB floor and `peaksAbovePeakMin` is only its display projection — so what gets saved
  // is simply that set, built above. Mirrors Swift `guitarFullSavePeaks() { allPeaks }`.
  //
  // This block used to re-run findPeaks here and APPEND every peak below the current Peak Min, on
  // the pre-Phase-1 assumption that `a.peaks` held only the peaks above it. Once the analyzer's
  // durable set became the full -100 dB set, that appended a second copy of every sub-Peak-Min peak
  // under a second UUID: a real capture saved 111 peaks as 217, with 106 frequencies duplicated.
  // Swift deleted the same re-detect-and-append dance for the same reason. Do not reintroduce it.

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
    const override = a.overridesById.get(p.id)
    if (override != null) peakModeOverrides[p.id] = override
    const offset = a.annotationOffsetsById?.get(p.id)
    if (offset != null) peakAnnotationOffsets[p.id] = offset
  }

  // Per-tap entries for the multi-tap comparison view, saved as they are (mirrors Swift tapEntries).
  const tapEntries: TapEntryModel[] | undefined =
    a.tapEntries && a.tapEntries.length > 1
      ? a.tapEntries.map((entry) => ({
          id: entry.id,
          tapIndex: entry.tapIndex,
          snapshot: entry.snapshot,
          peaks: entry.peaks,
          selectedPeakIDs: entry.selectedPeakIDs,
        }))
      : undefined

  return {
    id: uuid(),
    timestamp,
    peaks: peakModels,
    decayTime: a.decayTime ?? undefined,
    measurementName: a.name.trim() || undefined,
    notes: normalizedMeasurementNotes(a.notes),
    spectrumSnapshot: snapshot,
    selectedPeakIDs: selected.map((p) => p.id),
    userModifiedSelection: a.userModified ?? false,
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
  // An UNRECOGNISED type is an em-dash, not the raw string. Swift's contract, stated on
  // TapToneMeasurement.measurementTypeShortName: "Acoustic / Classical / Flamenco / Generic /
  // Plate / Brace / Comparison — or '—' when no snapshot carries a type." Six names, Comparison,
  // or an em-dash; nothing else. Python raises out of MeasurementType(...) to the same place.
  // So a file whose snapshot carries a type none of the six match — a foreign writer, a corrupted
  // field, a future type opened by an older build — shows the same em-dash in all three editions.
  return t != null ? MEASUREMENT_SHORT_NAME[t] : '—'
}

/** The current capture setup, for the load-time provenance check. */
export interface CaptureSetup {
  microphoneName?: string
  sampleRate?: number | null
  /** The CURRENTLY loaded calibration, or `undefined` when none is. **Required on purpose** —
   *  a required key whose value may be undefined, so a caller that forgets it is a COMPILE
   *  ERROR rather than a silent "no calibration now". It is compared against the recorded
   *  name, so omitting it made every calibrated measurement warn on load. A unit test cannot
   *  guard this: `measurementWarning` was always correct — only its callers were wrong. */
  calibrationName: string | undefined
}

/** Tiered load-time warning, mirroring Swift `loadMeasurement` / Python `load_measurement`
 *  (the sample-rate epic): if the recorded microphone isn't the current input → name
 *  warning; if it's the same mic but the calibration and/or sample rate differ → a
 *  "recorded with a different …" warning; otherwise null. "Current mic" is the live
 *  `track.label` (the web has no stable device UID — see normMic below).
 *
 *  CALLERS MUST PASS THE CURRENT `calibrationName`. It is compared against the recorded one,
 *  so omitting it reads as "no calibration now" and every calibrated measurement warns on
 *  load — which is exactly what happened while this doc-comment still claimed the web had no
 *  calibration (it gained one later; the load call sites were never updated). Pinned by
 *  test/measurement-warning.test.ts. */
export function measurementWarning(m: TapToneMeasurementModel, current: CaptureSetup): string | null {
  const recorded = m.microphoneName
  if (!recorded) return null

  // SAFE normalisation only — trim, collapse whitespace, lowercase. Deliberately NOT stripping
  // parentheticals: Windows Chrome names USB inputs "Microphone (Umik-1  Gain: 18dB)", so dropping
  // the parenthetical destroyed the device identity (everything collapsed to "microphone") and made
  // every cross-platform load warn. It could also collapse two genuinely DIFFERENT mics onto the
  // same token — suppressing a warning that should fire, which is the harmful direction.
  //
  // We no longer try to prove two labels are the same physical device: platform naming is outside
  // our control and unverifiable (Swift stores "Umik-1  Gain: 18dB", Windows reports
  // "Microphone (Umik-1  Gain: 18dB)" for the same mic). An exact match still correctly silences
  // the common same-platform reload; anything else is reported as UNKNOWN, not as a wrong mic.
  const normMic = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const matched = current.microphoneName != null && normMic(recorded) === normMic(current.microphoneName)
  if (!matched) {
    const cur = current.microphoneName ? `; currently using '${current.microphoneName}'` : ''
    // Report UNKNOWN, not "wrong mic": the same physical device is named differently per platform,
    // and we cannot verify identity from a display label. Impact is stated so the reader can judge —
    // peak FREQUENCIES (the primary output, and the derived values built on them) are essentially
    // mic-independent; levels, the tap trigger, peak SELECTION in marginal ranges, and faint peaks
    // are not. Mirrors the Swift/Python wording for the same situation.
    return `Recorded with '${recorded}'${cur}. Guitar Tap can't tell whether these are the same microphone. Peak frequencies should be comparable; input levels, the tap threshold, and faint peaks (such as FLC) may differ.`
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

export interface BuildMaterialArgs {
  name: string
  notes: string
  spectra: { longitudinal: Spectrum | null; cross: Spectrum | null; flc: Spectrum | null }
  peaks: { longitudinal: ResonantPeak | null; cross: ResonantPeak | null; flc: ResonantPeak | null }
  view: ChartView
  settings: Settings
  /** The measurement's OWN dims (Store B) — the sole source for the snapshot dims written on save. */
  materialInputs: MaterialMeasurementInputs
  /** Taps averaged per phase. Required (not optional) so the call site must supply the real
   *  count — a hardcoded 1 here shipped a wrong tap count in every saved material measurement. */
  numberOfTaps: number
  sampleRate: number | null
  deviceLabel: string
  microphoneUID?: string
  calibrationName?: string
  /** Dragged L/C/FLC label positions, keyed by material peak `id` (the shared analyzer store). */
  annotationOffsetsById?: Map<string, [number, number]>
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

  // Dimensions written on every per-phase snapshot come from Store B (the measurement's own values),
  // NOT the live Settings — mirrors Swift makePhaseSnapshot reading materialInputs. measureFlc is a
  // capture setting (not in Store B), so it still comes from settings.
  const mi = a.materialInputs
  const dims: Partial<SpectrumSnapshotModel> = brace
    ? {
        braceLength: mi.lengthMm,
        braceWidth: mi.widthMm,
        braceThickness: mi.thicknessMm,
        braceMass: mi.massG,
      }
    : {
        plateLength: mi.lengthMm,
        plateWidth: mi.widthMm,
        plateThickness: mi.thicknessMm,
        plateMass: mi.massG,
        guitarBodyLength: mi.bodyLengthMm,
        guitarBodyWidth: mi.bodyWidthMm,
        plateStiffnessPreset: STIFFNESS_RAW_NAME[mi.stiffnessPreset],
        customPlateStiffness: mi.customStiffness,
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

  // The selected L/C/FLC peaks become the measurement's peaks, each under its own id; any dragged label
  // offset is written into the shared peakAnnotationOffsets map keyed by that id (gold-standard format).
  const peaks: ResonantPeak[] = []
  const peakAnnotationOffsets: AnnotationOffsets = {}
  const addPeak = (mp: ResonantPeak | null): string | undefined => {
    if (!mp) return undefined
    const id = mp.id
    peaks.push(mp)
    const offset = a.annotationOffsetsById?.get(mp.id) // material offsets are id-keyed live
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
    notes: normalizedMeasurementNotes(a.notes),
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
    numberOfTaps: a.numberOfTaps,
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
      modePeakIDs: modeIDMap(m), // self-describing definitive Air/Top/Back, resolved from the source
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
  const selectedOf = (peaks: ResonantPeak[], ids?: string[]): ResonantPeak[] => {
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

/** Wrap live comparison entries into a saved comparison measurement (peaks: [] top-level,
 *  comparisonEntries populated) — mirrors Swift/Python save_comparison. */
export function buildComparisonMeasurement(a: { name: string; notes: string; entries: ComparisonEntryModel[] }): TapToneMeasurementModel {
  return {
    id: uuid(),
    timestamp: isoNow(),
    peaks: [],
    measurementName: a.name.trim() || undefined,
    notes: normalizedMeasurementNotes(a.notes),
    comparisonEntries: a.entries,
  }
}