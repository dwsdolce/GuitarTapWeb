// The web's tap/measurement lifecycle state machine — the equivalent of Swift
// `TapToneAnalyzer` and Python `TapToneAnalyzer` (the state layer, wrapping the
// audio layer just as they wrap RealtimeFFTAnalyzer / the mic). Extracted from
// the React hooks so the lifecycle is drivable and testable outside React,
// mirroring the canonical analyzers exactly.
//
// State fields mirror the analyzer's published vars; transitions mirror its
// methods. The React hooks own a TapToneAnalyzer and mirror its fields into
// render state, delegating every transition to it.
//
// @parity state/tap-tone-analyzer  tests=test/state-invariants,test/scenario-trace,test/measurement-complete,test/frozen-peak-recalc,test/audio-clock-timers
// @parity audio/tap-analyzer  tests=test/tap-decisions,test/effective-peak-id,test/tap-count-change
import type { Spectrum } from '../dsp/guitarFFT'
import { SampleBuffer } from '../audio/sampleBuffer'
import type { Calibration } from '../dsp/calibration'
import { classifyAll, type ResolvedMode } from '../dsp/classify'
// The one override-aware mode resolver (mirrors Swift GuitarMode.effectiveMode). A minor state→presentation
// import (precedent: MaterialPeaks from components) — the resolver lives with the mode↔label map it needs.
import { effectiveMode as resolveEffectiveMode, MODE_DISPLAY_NAME } from '../presentation/modeColors'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { comparisonModeIDMap, effectiveSelectedPeakIDs, MEASUREMENT_TYPE_FROM_RAW, measurementMultiTapComparisonEntries, storedComponents, guitarTypeNameFromRaw, isoNow, makeResonantPeak, TapEntry, type AnnotationOffsets, type ComparisonEntryModel, type ResonantPeak, type SpectrumSnapshotModel, type TapEntryModel, type TapToneMeasurementModel } from '../measurement/types'
import { normalizedMeasurementName, normalizedMeasurementNotes } from '../measurement/measurementName'
import { idEntries, InvalidIdError, newId, NoSpectrumError, type Uuid } from '../measurement/newId'
import { Pitch } from '../dsp/pitch'
import { formatDisplayDateCompact } from '../format/date'
import { seriesRole } from '../presentation/palette'
import { GUITAR_TYPE_RAW } from '../dsp/guitarModes'
import { clearMeasurements, deleteMeasurement as deleteStoredMeasurement, readLibrary, saveMeasurement as storeMeasurement, setAsideUnreadable, type ImportedMeasurements } from '../measurement/store'
import { amendMeasurement } from '../measurement/amend'
import type { ChartView } from '../presentation/chartTypes'
import { GUITAR_FFT_SIZE } from '../dsp/guitarFFT'
import { RealtimeFFTAnalyzer, failedOpenMessage, type MaterialSearch, type MaterialPhaseName, type EngineState } from '../audio/realtimeFFTAnalyzer'
// Single shared MeasurementType + guard (mirrors Swift's shared MeasurementType enum) — the settings
// store owns them; the analyzer no longer duplicates the type.
import { ANALYSIS_MAX_HZ, ANALYSIS_MIN_HZ, ANNOTATION_NEXT, guitarTypeSetting, isGuitarType, minFrequency, maxFrequency, MEASUREMENT_FULL_NAME, STIFFNESS_RAW_NAME, type AnnotationMode, type MeasurementType, type Settings } from '../settings'
import { settingsStore } from '../settingsStore'
import { materialInputsFromSettings, materialInputsFromSnapshot, type MaterialMeasurementInputs } from '../measurement/materialMeasurementInputs'
import { dumpCaptureProbe, dumpCaptureWav } from '../measurement/dumpWav'
import { FieldPrecision } from '../precision'
import { captureProbe } from './captureProbe'
import { SystemWallClock, type WallClock } from './wallClock'
import { spanningRange } from '../presentation/displayRange'
import { slackSetChunkPeriod, slackStart, slackTime } from '../diagnostics/slackProbe'

/** The tap detector's state. Mirrors Swift `DetectionState` (DetectionState.swift) and Python
 *  `DetectionState` (models/detection_state.py).
 *
 *      idle ──────▶ listening ──────▶ idle
 *                      │   ▲            (tap captured, sequence cancelled,
 *                      ▼   │             measurement loaded, stop)
 *                   paused ┘
 *             (pause/resume, mid-sequence)
 *
 *  One value rather than an `isDetecting` / `isDetectionPaused` boolean pair: two booleans can
 *  express "detecting AND paused", a state no code path intends, and one value makes it
 *  unrepresentable. Both booleans are available as derived reads. */
export type DetectionState = 'idle' | 'listening' | 'paused'

/** Material capture phase. Mirrors Swift `MaterialTapPhase` (web spelling). */
export type MaterialTapPhase =
  | 'notStarted'
  | 'capturingL'
  | 'reviewingL'
  | 'capturingC'
  | 'reviewingC'
  | 'waitingForFlcTap'
  | 'capturingFlc'
  | 'reviewingFlc'
  | 'complete'

/** Per-phase material result spectra (plate L/C/FLC, brace L). Mirrors Swift longitudinalSpectrum/
 *  crossSpectrum/flcSpectrum. */
export interface MatSpectra {
  longitudinal: Spectrum | null
  cross: Spectrum | null
  flc: Spectrum | null
}
export const EMPTY_MAT_SPECTRA: MatSpectra = { longitudinal: null, cross: null, flc: null }

/** The clipping-override warning (Swift `TapToneAnalyzer.clippingWarningStatus` / Python
 *  `_set_clipping`). Displayed while the input clips, then the real status is restored. */
const CLIPPING_WARNING = '⚠\uFE0E Input clipping — reduce mic gain'
/** Shown while the input delivers buffers that carry no signal. Outranks the clipping warning.
 *  Mirrors Swift `TapToneAnalyzer.deadInputStatus` / Python `DEAD_INPUT_STATUS`. */
const DEAD_INPUT_WARNING = '⚠\uFE0E No audio input — check the microphone connection'
/** Shown once the recovery has given up after restarts that failed. Outranks every other input warning.
 *  Mirrors Swift `TapToneAnalyzer.couldNotRestartStatus` / Python `COULD_NOT_RESTART_STATUS`. */
const COULD_NOT_RESTART_WARNING = '⚠\uFE0E The microphone could not be restarted — check its connection, or choose it again in Settings'
/** Shown while the microphone permission is refused. Outranks every other input warning. Mirrors Swift
 *  `TapToneAnalyzer.microphoneAccessStatus` / Python `MICROPHONE_ACCESS_STATUS`. */
export const MICROPHONE_ACCESS_WARNING = '⚠\uFE0E Microphone access required — enable it in Settings, then reload the page'
/** Shown while the input could not be started. Ranks just below the permission warning. Mirrors Swift
 *  `TapToneAnalyzer.couldNotStartStatus` / Python `COULD_NOT_START_STATUS`. */
const COULD_NOT_START_WARNING = '⚠\uFE0E The audio input could not be started — check it, or choose another input in Settings'

/** A material phase peak's frequency, 1 dp, or '?' when none — for the status-bar review/complete strings. */
const fHz = (p: { frequency: number } | null): string => (p ? FieldPrecision.string(p.frequency, FieldPrecision.peakFrequencyHz) : '?')
/**
 * What the main spectrum display is currently showing — the authoritative mode gate.
 *
 * Mirrors Swift `AnalysisDisplayMode` and Python `AnalysisDisplayMode`, including the rule that
 * the mode is DERIVED from whether there is overlay data: an empty comparison is `live`, not
 * `comparison` (Swift `comparisonSpectra.isEmpty ? .live : .comparison`).
 *
 * One value makes "frozen AND comparison" unrepresentable, which is the property both natives
 * rely on.
 */
/** The main spectrum is shown ('live' — live input, or the measurement's own frozen result once
 *  `isMeasurementComplete` is set), or saved measurements are overlaid ('comparison').
 *
 *  Those first two are NOT distinguished: whether a result is displayed is what
 *  `isMeasurementComplete` says, and a second field describing the same fact could disagree with
 *  it. */
export type DisplayMode = 'live' | 'comparison'

/** Loaded-measurement (frozen) status — curly quotes around New Tap match Swift/Python. */
const LOADED_STATUS = 'Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.'
/** Short phase label for the "L/C/FLC tap X/N captured" progress strings. */
const matPhaseLabel = (ph: MaterialPhaseName): string => (ph === 'cross' ? 'fC' : ph === 'flc' ? 'fLC' : 'fL')

// Gated-capture safety timeouts, on the WALL clock (Swift/Python: material 2.0 s; guitar the FFT
// window + 0.5 s). They exist for when the audio STOPS — the file ends, the user stops, the device
// drops — so an audio-clock timeout would never fire.
const MATERIAL_CAPTURE_SAFETY_MS = 2000
const GUITAR_CAPTURE_SAFETY_EXTRA_MS = 500

// Frequency tolerance (Hz) for carrying per-peak state across a peak RE-MINT, mirroring Swift's
// applyFrozenPeakState `tolerance` (5 Hz) / Python's remap tolerance. A re-detect (Re-analyze, guitar
// type or range change) can nudge a peak's interpolated frequency slightly; within this window it is
// the same peak. This is the robustness the old exact `frequency.toFixed(1)` view keying lacked.
const REMAP_TOLERANCE_HZ = 5

// The modes with at most one DEFINITIVE (selected) peak: Air/Top/Back are single physical resonances.
// Dipole/Ring/Upper are clusters and allow several selected peaks. Mirrors Swift `singleHolderModes`.
const SINGLE_HOLDER_MODES: ReadonlySet<ResolvedMode> = new Set(['air', 'top', 'back'])

/** One captured tap: its magnitude spectrum + capture time (ms). Mirrors Swift's captured-tap tuple. */
export interface CapturedTap {
  magnitudes: number[]
  frequencies: number[]
  captureTime: number
}

/** One definitive mode value for the multi-tap Averaged row: its frequency + whether it came from a user
 *  override (marked italic + " *"). Mirrors Swift `definitiveModeInfo`'s `(frequency, isOverride)`. */
export interface DefinitiveMode {
  frequency: number
  isOverride: boolean
}
/** Definitive Air / Top / Back for the Averaged row; `null` where there is no definitive peak. */
export interface DefinitiveModeInfo {
  air: DefinitiveMode | null
  top: DefinitiveMode | null
  back: DefinitiveMode | null
}



/** The load's warning when no connected input has the recorded name. Names both microphones — the
 *  recorded one and the one in use — and says why a measurement from another computer usually cannot
 *  find its microphone. Swift `TapToneAnalyzer.microphoneNotFoundMessage(recorded:current:)`. */
export function microphoneNotFoundMessage(recorded: string, current: string | null): string {
  return (
    `This measurement was recorded with a microphone named '${recorded}'. No connected microphone has exactly that name, so the input has not been changed — you are still using '${current ?? 'no microphone'}'.\n\n` +
    'Each computer names microphones its own way. A measurement made on another computer — especially one running a different operating system — will usually not find its microphone even when the same one is connected. If it is, choose it in Settings.\n\n' +
    'Peak frequencies are still comparable; input levels, the tap threshold, and faint peaks (such as FLC) may differ.'
  )
}

/** The load's warning when the recorded microphone is in use but the calibration and/or the sample
 *  rate differs — one line for each that differs, with both values. The web's rate is the browser's,
 *  which follows the output device, and the last sentence says so. Swift
 *  `TapToneAnalyzer.setupDiffersMessage(calibration:sampleRate:)`. */
export function setupDiffersMessage(
  calibration: [string | null, string | null] | null,
  sampleRate: [number, number] | null,
): string {
  const named = (n: string | null) => (n ? `'${n}'` : 'none')
  const lines = ['This measurement was made with a different setup from the current one:']
  if (calibration) lines.push(`• Calibration: recorded with ${named(calibration[0])}; the current microphone uses ${named(calibration[1])}.`)
  if (sampleRate) lines.push(`• Sample rate: recorded at ${sampleRate[0]} Hz; audio is now captured at ${sampleRate[1]} Hz.`)
  return (
    lines.join('\n') +
    '\n\nA tap captured now may not match the saved result. In a browser, the sample rate follows your output device: set the output and input to the same rate in Audio MIDI Setup (Mac) or Sound settings (Windows).'
  )
}

// ── Restoring a saved measurement ───────────────────────────────────────────────────────────
// The pieces `loadMeasurement` applies — Swift does this inside `loadMeasurement` itself. A peak keeps
// one id (a UUID, as Swift's `ResonantPeak.id`) live and on file, so the id-keyed selection, overrides
// and label offsets restore without remapping.

export interface LiveRestore {
  measurementType: MeasurementType
  captured: Spectrum
  view: ChartView
  settingsPatch: Partial<Settings>
  /** The saved peaks, authoritative — never re-derived from the spectrum — each with its saved id. */
  peaks: ResonantPeak[]
  /** Ids of the selected peaks. */
  selectedIds: Set<Uuid>
  /** Whether the saved selection was hand-modified (default true for legacy files). */
  userModified: boolean
  /** Manual overrides to restore, keyed by peak `id`. */
  overridesById: Map<Uuid, string>
  /** Dragged annotation-label positions to restore, keyed by peak `id`. */
  annotationOffsetsById: Map<Uuid, [number, number]>
  /** The per-tap entries, restored as saved — each tap's peaks and auto-selection included. */
  tapEntries: TapEntry[]
}

/** The settings a saved measurement carries, which a load makes the app's: its type, and — when the file has
 *  them — Show Unknown Modes, Peak Min, the tap threshold and the annotation mode. Mirrors Swift
 *  loadMeasurement, which applies each only if the file carries it. */
function loadedSettingsPatch(
  m: TapToneMeasurementModel,
  snap: SpectrumSnapshotModel,
  measurementType: MeasurementType,
): Partial<Settings> {
  const patch: Partial<Settings> = { measurementType }
  if (snap.showUnknownModes != null) patch.showUnknownModes = snap.showUnknownModes
  // The file's guitar type is stored apart from the measurement type, as Swift's load writes
  // TapDisplaySettings.guitarType — a plate or brace saved later records it.
  if (snap.guitarType != null) patch.guitarType = guitarTypeNameFromRaw(snap.guitarType)
  if (m.peakMinThreshold != null) patch.peakMinThreshold = m.peakMinThreshold
  if (m.tapDetectionThreshold != null) patch.tapDetectionThreshold = m.tapDetectionThreshold
  if (m.annotationVisibilityMode != null) patch.annotationVisibilityMode = m.annotationVisibilityMode
  return patch
}

/** Decompose a saved guitar measurement into the pieces the App restores into the view.
 *  The saved peaks are injected verbatim, ids included; selection, overrides and label offsets
 *  restore by those same ids, as Swift's do. */
export function measurementToLive(m: TapToneMeasurementModel, settings: Settings): LiveRestore {
  // Every readable guitar measurement carries its spectrum (checkMeasurement).
  const snap = m.spectrumSnapshot!
  const measurementType = MEASUREMENT_TYPE_FROM_RAW[snap.measurementType ?? ''] ?? 'generic'

  const peaks: ResonantPeak[] = [...m.peaks]

  // Overrides, offsets and selection name peaks by id; an id with no matching peak is dropped.
  const peakIds = new Set(m.peaks.map((p) => p.id))
  const overridesById = new Map<Uuid, string>()
  const annotationOffsetsById = new Map<Uuid, [number, number]>()
  for (const [id, label] of idEntries(m.peakModeOverrides)) {
    if (peakIds.has(id)) overridesById.set(id, label)
  }
  for (const [id, pos] of idEntries(m.peakAnnotationOffsets)) {
    if (peakIds.has(id)) annotationOffsetsById.set(id, pos)
  }

  // Selection restores from the saved ids; if none were saved, default to selecting all peaks (matches
  // Swift loadMeasurement).
  const selectedIds = new Set<Uuid>(
    m.selectedPeakIDs ? m.selectedPeakIDs.filter((id) => peakIds.has(id)) : peakIds,
  )

  // The loaded axis range (freq AND dB) is carried in `view` and applied as a TRANSIENT
  // override by the caller (Swift loadedAxisRange) — it is NOT persisted to settings, so
  // no display range goes in the patch here.
  const settingsPatch = loadedSettingsPatch(m, snap, measurementType)

  return {
    measurementType,
    userModified: m.userModifiedSelection ?? true,
    captured: { magnitudesDb: snap.magnitudes, frequencies: snap.frequencies },
    view: { minHz: snap.minFreq, maxHz: snap.maxFreq, minDb: snap.minDB, maxDb: snap.maxDB },
    settingsPatch,
    peaks,
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
  annotationOffsetsById: Map<Uuid, [number, number]>
}

/** Decompose a saved plate/brace measurement for restore into the view. Mirrors Swift
 *  `loadMeasurement`'s material branch (per-phase spectra + selected peaks + dims); `settings` fills
 *  what the file lacks. */
export function measurementToLiveMaterial(m: TapToneMeasurementModel, settings: Settings): MaterialRestore {
  const snap = m.longitudinalSnapshot
  if (!snap) throw new Error('Not a material measurement (no longitudinal snapshot)')
  const measurementType = MEASUREMENT_TYPE_FROM_RAW[snap.measurementType ?? ''] ?? 'plate'

  const toSpectrum = (s: SpectrumSnapshotModel | undefined): Spectrum | null =>
    s ? { magnitudesDb: s.magnitudes, frequencies: s.frequencies } : null

  const byId = new Map(m.peaks.map((p) => [p.id, p]))
  // Each restored material peak keeps its saved id, so the dragged offsets restore by that id into the
  // shared id-keyed store. Stale ids (no matching restored peak) are dropped.
  const toMatPeak = (id: Uuid | undefined): ResonantPeak | null => {
    const p = id != null ? byId.get(id) : undefined
    return p ?? null
  }
  const selectedLongitudinalPeak = toMatPeak(m.selectedLongitudinalPeakID)
  const selectedCrossPeak = toMatPeak(m.selectedCrossPeakID)
  const selectedFlcPeak = toMatPeak(m.selectedFlcPeakID)
  const restoredIds = new Set(
    [selectedLongitudinalPeak, selectedCrossPeak, selectedFlcPeak].filter((p) => p != null).map((p) => p.id),
  )
  const annotationOffsetsById = new Map<Uuid, [number, number]>()
  for (const [id, pos] of idEntries(m.peakAnnotationOffsets)) {
    if (restoredIds.has(id)) annotationOffsetsById.set(id, pos)
  }

  // Store B ← the measurement's OWN dims from the snapshot (the calc/display/PDF read this). Loading
  // never writes the dims into Settings (Store A) — that would overwrite the user's next-measurement
  // defaults. The settings a measurement carries go into the patch as for a guitar, plus measureFlc (a
  // capture setting the process/slot display reads); the axis range is transient (see `view` below).
  const materialInputs = materialInputsFromSnapshot(measurementType === 'brace' ? 'brace' : 'plate', snap, settings)
  const patch = loadedSettingsPatch(m, snap, measurementType)
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

// ── The saved record ────────────────────────────────────────────────────────────────────────
// The record builders behind `buildMeasurement` / `buildComparisonMeasurement`: the analyzer's save is the
// only caller, as Swift builds the record inside `saveMeasurement` / `saveComparison`.

interface BuildMeasurementArgs {
  name: string
  notes: string
  spectrum: Spectrum
  peaks: ResonantPeak[]
  selectedIds: Set<Uuid>
  /** Manual label overrides, keyed by peak `id` (the analyzer-owned live form). */
  overridesById: Map<Uuid, string>
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
  annotationOffsetsById?: Map<Uuid, [number, number]>
  /** Measured ring-out time (s) from the engine, or null/undefined if not measured. */
  decayTime?: number | null
  /** Whether the current selection is user-modified (vs automatic) — persisted so a reloaded
   *  measurement offers Reset to automatic selection as it did when saved. Omitted defaults to
   *  automatic (a fresh build that never touched selection). */
  userModified?: boolean
}

/** Construct a guitar TapToneMeasurementModel from the current frozen result. */
function makeGuitarMeasurement(a: BuildMeasurementArgs): TapToneMeasurementModel {
  const timestamp = isoNow()
  const guitarTypeRaw = GUITAR_TYPE_RAW[guitarTypeSetting(a.settings)]!
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

  // Per-tap entries for the multi-tap comparison view, saved as they are whenever there are any (a capture
  // builds them only for more than one tap). As Swift: `!tapEntries.isEmpty ? tapEntries : nil`.
  const tapEntries: TapEntryModel[] | undefined =
    a.tapEntries && a.tapEntries.length > 0
      ? a.tapEntries.map((entry) => ({
          id: entry.id,
          tapIndex: entry.tapIndex,
          snapshot: entry.snapshot,
          peaks: entry.peaks,
          selectedPeakIDs: entry.selectedPeakIDs,
        }))
      : undefined

  return {
    id: newId(),
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


interface BuildMaterialArgs {
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
  annotationOffsetsById?: Map<Uuid, [number, number]>
}

/** Construct a plate/brace TapToneMeasurementModel from the current completed material
 *  result. Mirrors Swift's per-phase snapshots: each snapshot carries the dimensions +
 *  measurementType; the selected L/C/FLC peaks are the measurement's `peaks`. */
function makeMaterialMeasurement(a: BuildMaterialArgs): TapToneMeasurementModel {
  const timestamp = isoNow()
  const brace = a.settings.measurementType === 'brace'
  const measurementType = MEASUREMENT_FULL_NAME[a.settings.measurementType]
  // Swift/Python write the current guitar-body type on plate/brace snapshots too
  // (falls back to "Generic"); external consumers read it for the top-level guitarType.
  const guitarTypeRaw = GUITAR_TYPE_RAW[guitarTypeSetting(a.settings)]!

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
  const addPeak = (mp: ResonantPeak | null): Uuid | undefined => {
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
  const selectedPeakIDs = selectedPairs.filter(([id]) => id != null).map(([id]) => id!)
  const selectedPeakFrequencies = selectedPairs.filter(([, p]) => p != null).map(([, p]) => p!.frequency)

  return {
    id: newId(),
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


/** Wrap live comparison entries into a saved comparison measurement (peaks: [] top-level,
 *  comparisonEntries populated) — mirrors Swift/Python save_comparison. */
function makeComparisonMeasurement(a: { name: string; notes: string; entries: ComparisonEntryModel[]; range: ChartView }): TapToneMeasurementModel {
  return {
    id: newId(),
    timestamp: isoNow(),
    peaks: [],
    measurementName: a.name.trim() || undefined,
    notes: normalizedMeasurementNotes(a.notes),
    comparisonEntries: a.entries,
    comparisonRange: a.range,
  }
}

/** A magnitude or frequency array the peak analysis reads. */
type SpectrumValues = number[] | Float32Array | Float64Array

export class TapToneAnalyzer {
  // ── Published-equivalent state (settable; the audio layer / tests mutate these directly) ──
  /** Whether the detector is listening, paused mid-sequence, or neither. One value rather than
   *  the `isDetecting` / `isDetectionPaused` pair it replaced; both derive from it below. */
  detectionState: DetectionState = 'idle'
  /** `true` when tap detection is actively listening for taps. Mirrors Swift `isDetecting`. */
  get isDetecting(): boolean { return this.detectionState === 'listening' }
  /** `true` when the sequence is paused (spectrum stays live, detection is off). Distinct from
   *  `'idle'`, which discards the in-progress sequence. Mirrors Swift `isDetectionPaused`. */
  get isDetectionPaused(): boolean { return this.detectionState === 'paused' }
  isReadyForDetection = true
  /** True while a device change settles and the chart should show nothing, rather than the new
   *  device's not-yet-valid audio, as in Swift and Python. */
  isSettling = false
  /** Taps captured so far. Guitar: 0…numberOfTaps. Material: CUMULATIVE across phases. Swift
   *  `currentTapCount`. `tapProgress` is written beside it at each site, as Swift and Python write it. */
  currentTapCount = 0
  numberOfTaps = 1
  capturedTaps: CapturedTap[] = []
  frozenMagnitudes: number[] = []
  frozenFrequencies: number[] = []

  // ── Display mode ────────────────────────────────────────────────────────────────────────────
  // The mode and the overlay data live together, as they do in Swift (displayMode +
  // comparisonSpectra) and Python (_display_mode + _comparison_data): the mode is derived from
  // whether the data is empty, so splitting them would let the two disagree.
  displayMode: DisplayMode = 'live'
  /** Saved measurements currently overlaid. Empty unless displayMode is 'comparison'. */
  comparisonEntries: ComparisonEntryModel[] = []
  /** True while the per-tap overlay of the CURRENT measurement is shown, which is also
   *  `displayMode === 'comparison'` — `isSavedMeasurementComparison` separates the two. */
  showingMultiTapComparison = false
  // Per-tap entries for the multi-tap comparison view (snapshot + peaks + auto-selection). Mirrors Swift
  // `tapEntries`. Built from capturedTaps at completion (>1 tap), restored on load, cleared on reset —
  // distinct from the raw `capturedTaps` (which are NOT restored on load), exactly like Swift's
  // tapEntries vs capturedTaps split. Nothing re-derives an entry's peaks once it is built.
  tapEntries: TapEntry[] = []
  // Main peaks detected on the frozen spectrum (or filtered from a loaded measurement's authoritative
  // peaks) + their mode classification. Owned by the analyzer, mirroring Swift `currentPeaks` /
  // `identifiedModes`, set at Swift's events (a live frame, completion, a load, Re-analyze, a type change).
  peaks: ResonantPeak[] = []
  // The Peak-Min DISPLAY projection of `peaks` — the same peak objects, filtered to the slider.
  // Mirrors Swift `peaksAbovePeakMin` / Python `peaks_above_peak_min`. Assigning `peaks` or
  // `peakMinThreshold` is the ONLY way this changes; nothing else may write it.
  //
  // This lives on the analyzer, not in the view. "Peak Min is guitar-only, material is never
  // filtered" is a rule about the MEASUREMENT, and it had been implemented in App.tsx as a useMemo
  // — so every other consumer (the save path, the PDF, the multi-tap table, the unit tests) had to
  // re-derive it and could disagree. One rule, one home.
  peaksAbovePeakMin: ResonantPeak[] = []
  // True for the duration of `loadMeasurement`, which applies the whole restore — spectrum, per-tap
  // entries, peaks, overrides, offsets, selection — as ONE step, so completing a measurement there is
  // told apart from a capture completing. Mirrors Swift `isLoadingMeasurement` / Python
  // `is_loading_measurement`.
  isLoadingMeasurement = false
  modeByPeak: Map<Uuid, ResolvedMode> = new Map()
  // Minimum magnitude (dBFS) for a peak to be DISPLAYED. A display control and nothing more:
  // assigning it re-projects `peaksAbovePeakMin` from the durable set — no detection, no
  // classification, no per-peak state touched — so selection, overrides and dragged labels all
  // survive a slider sweep, and a peak hidden then revealed comes back as the SAME object.
  // Mirrors Swift `@Published var peakMinThreshold { didSet { refreshDisplayedPeaks() } }` and
  // Python's `peak_min_threshold` setter: set from the settings store at construction, and saved to
  // it on every change, as Swift's didSet saves it to TapDisplaySettings.
  private _peakMinThreshold = settingsStore.get().peakMinThreshold
  get peakMinThreshold(): number {
    return this._peakMinThreshold
  }
  set peakMinThreshold(v: number) {
    this._peakMinThreshold = v
    settingsStore.update({ peakMinThreshold: v })
    this.refreshDisplayedPeaks()
  }
  // Per-peak manual mode-label overrides, keyed by peak `id`. The value is the display label string
  // (a predefined mode name or a freeform label); the id key keeps the state with the peaks it
  // describes. Carried across a peak re-mint by
  // `applyFrozenPeakState` (±REMAP_TOLERANCE_HZ) and cleared on a blank-slate reset (`clearResult`).
  // Mirrors Swift `peakModeOverrides` / Python `_peak_mode_overrides` (both id/UUID-keyed).
  overrides: Map<Uuid, string> = new Map()
  // Dragged annotation-label positions, keyed by peak `id` → [absFreqHz, absDB]. ONE store for guitar
  // AND material, matching Swift's
  // single `peakAnnotationOffsets: [UUID: CGPoint]` and Python's `peak_annotation_offsets` — whose
  // material peaks are id-bearing too. Guitar entries are carried across a re-mint by
  // `applyFrozenPeakState`; material entries never re-mint. Guitar and material never coexist (cleared
  // between by clearResult / resetMaterial), so their ids share one map without collision.
  annotationOffsets: Map<Uuid, [number, number]> = new Map()
  // Selection — which peak is the DEFINITIVE Air/Top/Back.
  // CONCRETE state (full-Swift paradigm, not a derived set): auto-selected afresh on a peak re-mint by
  // applyFrozenPeakState. Mirrors Swift `selectedPeakIDs`.
  selectedPeakIds: Set<Uuid> = new Set()
  // The selected peaks' frequencies, kept with the selection and saved with the measurement; nothing
  // reads it back. Mirrors Swift `selectedPeakFrequencies`.
  selectedPeakFrequencies: number[] = []
  // Whether the user has hand-modified the selection since the last auto-select: Reset to automatic
  // selection is offered only then, and it is saved with the measurement. Swift
  // `userHasModifiedPeakSelection`.
  userModifiedSelection = false
  // The highlighted peak — transient VIEW state for the chart-dot ↔ results-row cross-highlight; NOT
  // selection and NOT measurement state (lives here like Swift/Python `highlightedPeakID`, but is never
  // persisted). Toggled by clicking a peak dot or its results row (desktop only); cleared on a fresh sequence.
  highlightedPeakId: Uuid | null = null
  materialTapPhase: MaterialTapPhase = 'notStarted'
  // Material (plate/brace) result data — the per-phase averaged spectra. Owned by the analyzer, mirroring
  // Swift longitudinalSpectrum/crossSpectrum/flcSpectrum.
  matSpectra: MatSpectra = EMPTY_MAT_SPECTRA
  // The identified peak of each material phase — the dominant peak of its averaged spectrum, stored when
  // the phase completes. These ARE a material measurement's peaks: there is no per-peak selection and no
  // other material peak state (`peaks` / `selectedPeakIds` are guitar-only). Mirrors Swift/Python
  // selectedLongitudinalPeak / selectedCrossPeak / selectedFlcPeak.
  selectedLongitudinalPeak: ResonantPeak | null = null
  selectedCrossPeak: ResonantPeak | null = null
  selectedFlcPeak: ResonantPeak | null = null

  /** The id of the fL peak, or null before the phase finalises. Swift `effectiveLongitudinalPeakID`. */
  get effectiveLongitudinalPeakID(): string | null {
    return this.selectedLongitudinalPeak?.id ?? null
  }
  /** The id of the fC peak, or null before the phase finalises. Swift `effectiveCrossPeakID`. */
  get effectiveCrossPeakID(): string | null {
    return this.selectedCrossPeak?.id ?? null
  }
  /** The id of the FLC peak, or null before the phase finalises. Swift `effectiveFlcPeakID`. */
  get effectiveFlcPeakID(): string | null {
    return this.selectedFlcPeak?.id ?? null
  }
  /** A measurement was just loaded and its Threshold/Taps are in force — the banner's state.
   *  MODEL state, as in Swift (`@Published var showLoadedSettingsWarning`) and Python. */
  showLoadedSettingsWarning = false

  // ── What a loaded measurement leaves on the model ─────────────────────────────────────────────
  // Swift's `loaded*` published properties: the model records what was loaded and the view reacts,
  // rather than the view sequencing a load and remembering the pieces itself. Cleared together by
  // startTapSequence (Swift Control.swift:135) — a new sequence is no longer "the loaded one".
  /** The loaded measurement's name / notes (Swift `loadedMeasurementName` / `loadedNotes`). */
  loadedMeasurementName: string | null = null
  loadedNotes: string | null = null
  /** When the result on screen was measured (ISO), if it is a saved one — loaded, or just saved: its exports show
   *  this date and are named by it; null for an unsaved result, whose exports use the time of export. Swift
   *  `sourceMeasurementTimestamp`. */
  sourceMeasurementTimestamp: string | null = null
  /** The loaded measurement's saved axis range — a TRANSIENT override of the persisted display
   *  range, which is left untouched (Swift `loadedAxisRange`). */
  loadedAxisRange: ChartView | null = null
  /** The loaded measurement's microphone is not connected, or its calibration / sample rate differs
   *  (Swift `@Published var microphoneWarning`). An IMPORT never sets this — only a load, which is
   *  what puts the user in front of the data. The view shows it and clears it on acknowledgement. */
  microphoneWarning: string | null = null
  /** The title of the alert that shows `microphoneWarning`; set with it. Swift `microphoneWarningTitle`. */
  microphoneWarningTitle = 'Microphone Not Found'
  /** Ring-out (decay) time in seconds of what is on screen: the file's when a measurement is loaded,
   *  the last captured guitar tap's otherwise (`finishGuitarGatedCapture` writes it). ONE value, as
   *  Swift `currentDecayTime` and Python `current_decay_time` — the view used to hold two and choose
   *  between them. Cleared by startTapSequence, as in Swift. */
  currentDecayTime: number | null = null

  /** Pitch at concert A (440 Hz) for the peaks the analyzer makes. Swift `pitchCalculator`. */
  readonly pitchCalculator = new Pitch(440)
  /** The analysis range for peak detection, in Hz. Swift `minFrequency` / `maxFrequency`. */
  minFrequency = ANALYSIS_MIN_HZ
  maxFrequency = ANALYSIS_MAX_HZ
  // Store B — the current material measurement's OWN dimensions. `null` for guitar and before a
  // material measurement completes. Seeded from Settings at the completion transition (the setter
  // below), restored from the file's snapshot by loadMeasurement, and edited through
  // setMaterialInputs. The sole source for MaterialResults' calc and for Save; never the live
  // Settings. Mirrors Swift `analyzer.materialInputs` / Python `analyzer.material_inputs`.
  materialInputs: MaterialMeasurementInputs | null = null

  // ── Status-bar message (imperative field — mirrors Swift @Published `statusMessage` / Python
  // `status_message`, set at every transition). `latestRealStatus` stashes the last
  // analyzer-set string so the clipping override can restore it (Swift `latestRealStatus` / Python
  // `_latest_real_status`). Written only through `setStatusMessage` / `setClipping`.
  // @parity state/status-message  tests=test/status-message
  statusMessage = 'Tap the guitar to begin'
  private latestRealStatus = 'Tap the guitar to begin'
  private isClipping = false
  /** Input delivering chunks that carry no signal — outranks clipping in the status override. */
  private inputAppearsDead = false
  private inputCouldNotRestart = false
  private microphonePermissionDenied = false
  private inputCouldNotStart = false
  /** The file name of the last capture audio handed to the browser as a download; null when none
   *  is shown. */
  private captureAudioSaved: string | null = null
  /** Whether the plate / brace peaks were restored by a load rather than identified by a capture. A load
   *  shows the range it was saved with, so its peaks do not widen the chart. Set by a load before it
   *  writes the peaks; cleared when a sequence starts. Mirrors Swift `materialPeaksFromLoad`. */
  private materialPeaksFromLoad = false
  /** How many sequences have started — each New Tap, Play File, Cancel or re-arm. The chart reacts to
   *  each start (Swift's view hears each `isMeasurementComplete = false` from startTapSequence; a
   *  snapshot can only show a change, so the web counts them). */
  private sequenceStarts = 0
  // The device owns the guitar detection loop, so the guitar status strings derive from these transitions
  // (the web equivalent of Swift's TapToneAnalyzer+TapDetection setting statusMessage in the loop).

  // isMeasurementComplete carries Swift's didSet, which does exactly two things and nothing else:
  // clear the loaded-settings warning on completion, and seed Store B from Settings at a material
  // CAPTURE completion. The reset work that accompanies leaving the complete state is not here —
  // Swift does it in startTapSequence, and so do clearResult/resetMaterial below.
  private _isMeasurementComplete = false
  get isMeasurementComplete(): boolean {
    return this._isMeasurementComplete
  }
  set isMeasurementComplete(v: boolean) {
    const oldValue = this._isMeasurementComplete
    this._isMeasurementComplete = v
    if (!v) return
    this.showLoadedSettingsWarning = false
    // Seed Store B from the Settings defaults — the one and only seed hook (nothing on New Tap,
    // type-change or Cancel). Guarded on the TRANSITION, not on Store B being null: once the
    // transition is spent, anything that clears Store B while still complete must NOT re-seed, which
    // is what Swift and Python do. Material types only, and never during a load — loadMeasurement
    // sets Store B from the file's own snapshot instead. Mirrors Swift didSet:
    // !oldValue && !isGuitar && !isLoadingMeasurement.
    if (oldValue || this.isGuitar || this.isLoadingMeasurement) return
    this.materialInputs = materialInputsFromSettings(
      settingsStore.get().measurementType === 'brace' ? 'brace' : 'plate',
      settingsStore.get(),
    )
  }

  get isGuitar(): boolean {
    return isGuitarType(settingsStore.get().measurementType)
  }

  /** Total individual taps expected across ALL phases of the current material sequence.
   *  Brace: `numberOfTaps` (longitudinal only). Plate: `numberOfTaps × 2` (L+C), or `× 3` with FLC.
   *  Mirrors Swift `totalPlateTaps` (TapDetection:360) / Python `total_plate_taps`. */
  get totalPlateTaps(): number {
    if (settingsStore.get().measurementType === 'brace') return this.numberOfTaps
    return this.numberOfTaps * (settingsStore.get().measureFlc ? 3 : 2)
  }

  /** Fraction of the sequence captured, 0…1 — the value the status-bar progress bar renders.
   *  Guitar divides by `numberOfTaps`; material divides by `totalPlateTaps`, because the material
   *  `currentTapCount` is CUMULATIVE across phases — so the bar fills once across L→C→FLC rather than
   *  refilling each phase. Written where Swift writes it: a new sequence, each guitar and material tap, Redo's
   *  rebase and a load — the last tap leaves it at 1. Mirrors Swift `tapProgress`. */
  tapProgress = 0
  /** The status from before a device-change settle began, restored when the settle has nothing of
   *  its own to say. Captured by the change that begins a settle; `null` when no settle is in flight.
   *  Swift `statusBeforeSettle`. */
  private statusBeforeSettle: string | null = null
  /** Whether the settle in flight puts detection back to listening when it ends — captured by the
   *  change that begins it, since a later change inside the settle finds the detector already stood
   *  down. `null` when no settle is in flight. Swift `detectingBeforeSettle`. */
  private detectingBeforeSettle: boolean | null = null
  /** Counts device changes: a settle's restore runs only if no later change superseded it, so the
   *  settle always ends 3 s of audio after the LAST change. Swift `routeChangeGeneration`. */
  private routeChangeGeneration = 0
  /** Counts abandoned captures (`abandonCapture`). What a capture schedules — its processing, the next tap's
   *  re-arm — runs only if no abandon has come since. Swift `captureGeneration`. */
  private captureGeneration = 0
  /** Actions waiting for the next FFT frame — see `afterNextFrame`. Swift `pendingFrameActions`. */
  private pendingFrameActions: ((peakMagnitude: number) => void)[] = []

  /** Cumulative taps completed in the phases BEFORE `phase` — the base the material `currentTapCount`
   *  counts on from at each tap, and rebases to on Redo. Guarded on the prior phases actually having been
   *  captured, mirroring Swift's redo rebasing (`lCount` / `lcCount`, Control:465-487). */
  private materialPhaseBase(phase: MaterialTapPhase): number {
    const n = this.numberOfTaps
    const haveL = this.matSpectra.longitudinal != null
    const haveC = this.matSpectra.cross != null
    if (phase === 'capturingC') return haveL ? n : 0
    if (phase === 'capturingFlc' || phase === 'waitingForFlcTap') return haveL && haveC ? n * 2 : 0
    return 0 // capturingL — no phase precedes it
  }

  // ── Transitions (mirror TapToneAnalyzer) ──────────────────────────────────

  /** The canonical fresh sequence, for GUITAR AND MATERIAL alike: clear everything (result data +
   *  all per-peak state + any comparison overlay), set up the type's starting state, and arm.
   *
   *  This is the web's `startTapSequence(skipWarmup:)` / `start_tap_sequence(skip_warmup)`. As in both
   *  natives, EVERY New Tap — guitar or material — goes through this one method, so no type's path can
   *  skip clearing the comparison and returning to live.
   *
   *  `detectionState` is owned here, as it is in Swift and Python: the arming below sets it. */
  startTapSequence(opts: { skipWarmup?: boolean } = {}): void {
    const { skipWarmup = false } = opts
    this.sequenceStarts += 1
    // The shared reset — result data, per-peak state, completion flag, and the return to live.
    this.clearResult()
    this.currentTapCount = 0
    this.tapProgress = 0
    // Clear the previous peaks so the chart shows a clean slate while waiting — not the last
    // measurement's dots until the first live frame replaces them. Mirrors Swift startTapSequence
    // (allPeaks = [], identifiedModes = []) / Python start_tap_sequence.
    this.peaks = []
    this.modeByPeak = new Map()
    this.refreshDisplayedPeaks()
    // The user is explicitly starting a new sequence, so the loaded measurement's Threshold/Taps are
    // now theirs. Mirrors Swift startTapSequence (Control.swift:149) and Python start_tap_sequence;
    // covers the measurement-type change, file playback and New Tap/Cancel paths.
    this.showLoadedSettingsWarning = false
    // …and with it everything else the loaded measurement left behind: this sequence is no longer
    // "the loaded one". Mirrors Swift startTapSequence (Control.swift:135-136, :163).
    this.loadedMeasurementName = null
    this.loadedNotes = null
    this.sourceMeasurementTimestamp = null
    this.loadedAxisRange = null
    this.currentDecayTime = null
    this.showingMultiTapComparison = false
    this.captureAudioSaved = null
    this.materialPeaksFromLoad = false
    // A new sequence listens to the input until playFile says otherwise, and no longer names a file.
    this.resultProvenance = null
    if (this.attachedDevice) this.attachedDevice.playingFileName = null
    // No pause-clear here: the arming below moves straight to 'listening', which leaves 'paused'
    // on its own. Mirrors Swift/Python startTapSequence.

    // A new sequence starts its tap confirmation from zero: a chunk counted before it cannot help confirm
    // its first tap. Swift's and Python's startTapSequence do the same.
    this.consecutive = 0
    // Cancel any in-flight capture from a previous sequence and reset the pre-roll before arming, as
    // Swift's startTapSequence.
    this.abandonCapture()

    if (this.isGuitar) {
      // skipWarmup mirrors Swift startTapSequence(skipWarmup:) — guitar file playback skips it,
      // because an externally recorded file may put the tap inside the first 0.5 s and guitar
      // detects against the absolute threshold, so it never reads the noise floor.
      this.armWarmup(skipWarmup)
      this.detectionState = 'listening'
      this.startSessionRecording() // begin the continuous session WAV
      // Guitar resting prompt (canonical post-warm-up steady state).
      this.setStatusMessage(this.tapPrompt())
    } else {
      this.clearMaterialPeaks()
      this.matSpectra = EMPTY_MAT_SPECTRA
      this.materialBuffer = []
      this.materialTapPhase = 'capturingL'
      // startSessionRecording seeds checkpoint [0] (the L-phase truncation anchor), so no explicit
      // checkpoint is needed here.
      this.startSessionRecording()
      this.armWarmup(false)
      this.detectionState = 'listening'
      // capturingL arm prompt = "Ready for L tap" (mirrors Swift startTapSequence; the silent
      // warm-up on Swift/Python now shows this too — was "Tap the guitar…", a divergence).
      this.setStatusMessage(this.materialArmPrompt())
    }
    this.notify()
  }

  /** Record one captured guitar tap's spectrum (computed + delivered raw by the device) and advance
   *  the count. processMultipleTaps() later power-averages the accumulated taps into the frozen
   *  spectrum, mirroring the canonical analyzer accumulating spectra (Swift capturedTaps /
   *  process_multiple_taps). Called by finishGuitarGatedCapture, which computes the spectrum. */
  recordGuitarTap(spectrum: Spectrum): void {
    this.capturedTaps.push({ magnitudes: spectrum.magnitudesDb, frequencies: spectrum.frequencies, captureTime: 0 })
    this.currentTapCount = this.capturedTaps.length
  }

  /** Complete the measurement: power-average the captured taps into the frozen spectrum, build the
   *  per-tap entries (>1 tap only, mirroring Swift processMultipleTaps building tapEntries),
   *  and set isMeasurementComplete. No-op when no taps were captured. */
  processMultipleTaps(): void {
    if (this.capturedTaps.length === 0) return // guard: nothing to freeze (MC6)
    const spectra: Spectrum[] = this.capturedTaps.map((t) => ({
      magnitudesDb: t.magnitudes,
      frequencies: t.frequencies,
    }))
    const avg = this.averageSpectra(spectra)
    this.frozenMagnitudes = avg.magnitudesDb
    this.frozenFrequencies = avg.frequencies
    this.isMeasurementComplete = true
    // Find peaks in the AVERAGED spectrum so they align with what's displayed. Store the FULL set
    // (detected to the floor) as the durable result, and auto-select one best peak per guitar mode over
    // that full set — a quiet Air below Peak Min is selected even though it is not displayed. A new
    // capture is one of the two things that legitimately resets per-peak selection state.
    const peaksFromAveragedSpectrum = this.findPeaks(avg.magnitudesDb, avg.frequencies, { peakMinOverride: TapToneAnalyzer.peakDetectionFloor })
    this.peaks = peaksFromAveragedSpectrum
    this.selectedPeakIds = this.guitarModeSelectedPeakIds(peaksFromAveragedSpectrum)
    this.userModifiedSelection = false
    this.selectedPeakFrequencies = [] // reset the frequency cache for the new live session
    this.modeByPeak = classifyAll(peaksFromAveragedSpectrum, this.guitarType)
    this.refreshDisplayedPeaks()
    this.setStatusMessage(
      `Analysis complete! ${peaksFromAveragedSpectrum.length} peaks identified (from ${this.capturedTaps.length} averaged taps).`,
    )
    // Build per-tap entries for the multi-tap comparison view. Only meaningful when more than one tap
    // was captured; single-tap sessions have nothing to compare. Each entry's peaks are found once, at
    // the detection floor, with the auto-selected peak per mode, and a snapshot recording the display
    // settings and guitar type at capture — as Swift's processMultipleTaps builds them.
    if (this.capturedTaps.length > 1) {
      const s = settingsStore.get()
      const range = { minHz: minFrequency(s, settingsStore.get().measurementType), maxHz: maxFrequency(s, settingsStore.get().measurementType) }
      this.tapEntries = spectra.map((sp, i) => {
        const tapPeaks = this.findPeaks(sp.magnitudesDb, sp.frequencies, { peakMinOverride: TapToneAnalyzer.peakDetectionFloor })
        const modeSelected = this.guitarModeSelectedPeakIds(tapPeaks)
        const snap: SpectrumSnapshotModel = {
          frequencies: sp.frequencies,
          magnitudes: sp.magnitudesDb,
          minFreq: range.minHz,
          maxFreq: range.maxHz,
          minDB: s.minDb,
          maxDB: 0,
          isLogarithmic: false,
          showUnknownModes: s.showUnknownModes,
          guitarType: GUITAR_TYPE_RAW[guitarTypeSetting(settingsStore.get())]!,
          measurementType: MEASUREMENT_FULL_NAME[settingsStore.get().measurementType],
        }
        return new TapEntry(newId(), i + 1, snap, tapPeaks, [...modeSelected])
      })
    } else {
      this.tapEntries = []
    }
    this.notify()
  }

  /** Cancel the sequence by restarting it: re-arm a fresh sequence (≡ New Tap), NOT
   *  complete the measurement. Mirrors Swift cancelTapSequence. Cancel is offered while a multi-step
   *  sequence is active, and throughout a file playback. During a playback it stops the file first,
   *  so the fresh sequence listens to the microphone and the partial result is discarded. */
  cancelTapSequence(): void {
    this.attachedDevice?.stopFilePlayback()
    this.startTapSequence()
  }

  /**
   * Frequency-domain power averaging of tap spectra: each bin's dB to linear power, the mean, back to dB.
   * Mirrors Swift `averageSpectra(from:)`.
   * @param taps One spectrum per tap.
   * @returns The averaged spectrum: empty for no taps; a single tap unchanged; the first tap when the bin
   *   counts differ.
   */
  // @parity dsp/spectrum-average
  averageSpectra(taps: Spectrum[]): Spectrum {
    if (taps.length === 0) return { magnitudesDb: [], frequencies: [] }
    if (taps.length === 1) return taps[0]!
    const first = taps[0]!
    const spectrumLength = first.magnitudesDb.length
    if (!taps.every((t) => t.magnitudesDb.length === spectrumLength)) return first
    const magnitudesDb = new Array<number>(spectrumLength)
    for (let bin = 0; bin < spectrumLength; bin++) {
      let linearSum = 0
      for (const tap of taps) linearSum += 10 ** (tap.magnitudesDb[bin]! / 10)
      magnitudesDb[bin] = 10 * Math.log10(linearSum / taps.length)
    }
    return { magnitudesDb, frequencies: first.frequencies }
  }

  /** The guitar peak set to save: the full set found down to the −100 dB floor, not just those above the
   *  current Peak Min, so a reloaded measurement reveals peaks below its capture-time Peak Min as the live
   *  one does. The durable set is that set. Mirrors Swift `guitarFullSavePeaks()`. */
  guitarFullSavePeaks(): ResonantPeak[] {
    return this.peaks
  }

  /** Build the current measurement from the analyzer's state — guitar or material — or null when there is
   *  no result to save. Everything but the view's own state is read here: the peaks and selection, the
   *  identified material peaks, overrides, annotation offsets, the ring-out, the spectra, the material
   *  inputs, and the capture's provenance. The view passes the name, the notes and the displayed range.
   *  The save and the live PDF export both use it. Mirrors Swift `saveMeasurement` (which builds and
   *  stores in one step). */
  buildMeasurement(name: string, notes: string, view: ChartView): TapToneMeasurementModel | null {
    const provenance = {
      sampleRate: this.captureSampleRate,
      deviceLabel: this.captureMicrophoneName ?? '',
      microphoneUID: this.captureMicrophoneUID,
      calibrationName: this.captureCalibrationName,
    }
    const settings = settingsStore.get()
    const type = settings.measurementType
    if (!isGuitarType(type)) {
      if (!this.matSpectra.longitudinal) return null
      return makeMaterialMeasurement({
        name,
        notes,
        spectra: this.matSpectra,
        peaks: { longitudinal: this.selectedLongitudinalPeak, cross: this.selectedCrossPeak, flc: this.selectedFlcPeak },
        view,
        settings,
        numberOfTaps: this.numberOfTaps,
        // The measurement's own dimensions; the Settings template until completion has seeded them.
        materialInputs: this.materialInputs ?? materialInputsFromSettings(type, settings),
        annotationOffsetsById: this.annotationOffsets,
        ...provenance,
      })
    }
    const spectrum = this.frozenSpectrum()
    if (!spectrum) return null
    return makeGuitarMeasurement({
      name,
      notes,
      spectrum,
      peaks: this.guitarFullSavePeaks(),
      selectedIds: this.selectedPeakIds,
      overridesById: this.overrides,
      annotationOffsetsById: this.annotationOffsets,
      decayTime: this.currentDecayTime,
      view,
      settings,
      numberOfTaps: this.numberOfTaps,
      tapEntries: this.tapEntries,
      userModified: this.userModifiedSelection,
      ...provenance,
    })
  }

  // @parity model/measurement-management tests=test/measurement-load,test/import-persistence,test/comparison
  /** Save the current measurement to the measurement store. Mirrors Swift `saveMeasurement`. */
  async saveMeasurement(name: string, notes: string, view: ChartView): Promise<void> {
    const m = this.buildMeasurement(name, notes, view)
    if (!m) return
    await storeMeasurement(m)
    // The result on screen is now this saved measurement: its exports show its date and are named by it.
    this.sourceMeasurementTimestamp = m.timestamp
    await this.refreshSavedMeasurements()
  }

  /** The current comparison as a saved record — its entries as they are, no peaks of its own — or null
   *  when no comparison is showing. The comparison save and the comparison PDF both use it. */
  buildComparisonMeasurement(name: string, notes: string, view?: ChartView): TapToneMeasurementModel | null {
    if (this.displayMode !== 'comparison' || this.comparisonEntries.length === 0) return null
    return makeComparisonMeasurement({
      name, notes, entries: this.comparisonEntries,
      range: view ?? spanningRange(this.comparisonEntries.map((e) => e.snapshot))!,
    })
  }

  /** Save the current comparison to the measurement store, with the chart's range `view` (none: the range a
   *  new comparison shows), which loading it shows. Mirrors Swift
   *  `saveComparison(measurementName:notes:minFreq:maxFreq:minDB:maxDB:)`. */
  async saveComparison(name: string, notes: string, view?: ChartView): Promise<void> {
    const m = this.buildComparisonMeasurement(name, notes, view)
    if (!m) return
    await storeMeasurement(m)
    // The comparison on screen is now this saved one: its exports show its date and are named by it.
    this.sourceMeasurementTimestamp = m.timestamp
    await this.refreshSavedMeasurements()
  }

  /** Load a saved measurement — guitar, material or comparison record. THE load entry point.
   *
   *  Mirrors Swift `loadMeasurement(_:)` and Python `load_measurement()`: hand it the saved
   *  measurement and the model works out what kind it is, converts it, restores itself, and records
   *  what it loaded (name, notes, axis range, settings, microphone warning, ring-out) for the view
   *  to react to. Because the whole load lives here, any caller — the view, an import, a test —
   *  performs the same load.
   *
   *  The measurement's own settings are applied here and saved (the settings store, as Swift writes
   *  TapDisplaySettings). The view only displays the result, and applies `loadedAxisRange` to the chart's
   *  range, as Swift's view does with its `.onReceive(tap.$loadedAxisRange)`. */
  loadMeasurement(m: TapToneMeasurementModel): void {
    // Comparison records: restore the overlay spectra directly from the saved entries and return early —
    // no peak/spectrum restoration needed for the regular path.
    if (m.comparisonEntries) {
      const entries = m.comparisonEntries
      this.comparisonEntries = entries
      // A saved comparison shows the range it was saved with, as a measurement does; one saved before
      // comparisons kept their range spans its entries' ranges, as a new comparison does.
      const savedRange = m.comparisonRange ?? spanningRange(entries.map((e) => e.snapshot))
      if (savedRange) this.loadedAxisRange = savedRange
      this.loadedMeasurementName = normalizedMeasurementName(m.measurementName ?? '') ?? null
      this.loadedNotes = normalizedMeasurementNotes(m.notes ?? '') ?? null
      // The saved comparison's own date, which its exports show and are named by.
      this.sourceMeasurementTimestamp = m.timestamp || null
      // Clear any per-tap entries from a previously loaded multi-tap measurement.
      this.tapEntries = []
      this.showingMultiTapComparison = false
      this.displayMode = 'comparison'
      this.resultProvenance = null // a comparison has no microphone of its own
      this.highlightedPeakId = null
      this.detectionState = 'idle'
      this.abandonCapture()
      this.cancelSessionRecording()
      this.notify()
      return
    }

    // One load, in Swift loadMeasurement's order.
    this.isLoadingMeasurement = true
    try {
      // Loading a measurement ends any comparison, and its spectrum goes at once.
      this.clearComparison()
      this.frozenMagnitudes = []
      this.frozenFrequencies = []
      this.sourceMeasurementTimestamp = m.timestamp || null
      this.loadedMeasurementName = normalizedMeasurementName(m.measurementName ?? '') ?? null
      this.loadedNotes = normalizedMeasurementNotes(m.notes ?? '') ?? null

      // The file read as the analyzer's values: a plate's or brace's per-phase snapshots, or a guitar's.
      const material = m.longitudinalSnapshot ? measurementToLiveMaterial(m, settingsStore.get()) : null
      const guitar = material ? null : measurementToLive(m, settingsStore.get())
      const read = (material ?? guitar)!
      const { peakMinThreshold, tapDetectionThreshold, annotationVisibilityMode, ...settings } = read.settingsPatch

      // The measurement's settings: the chart range it was saved with, Show Unknown Modes, the guitar and
      // measurement type — saved, as Swift's load writes TapDisplaySettings — and a plate's or brace's own
      // dimensions.
      this.loadedAxisRange = read.view
      settingsStore.update(settings)
      if (material) this.materialInputs = material.materialInputs
      if (peakMinThreshold !== undefined) this.peakMinThreshold = peakMinThreshold

      // The saved peaks — a guitar's (authoritative, never re-derived); a plate or brace keeps none.
      this.peaks = guitar ? guitar.peaks : []
      this.currentDecayTime = m.decayTime ?? null
      this.matSpectra = material ? material.matSpectra : EMPTY_MAT_SPECTRA
      if (guitar) {
        this.frozenMagnitudes = guitar.captured.magnitudesDb
        this.frozenFrequencies = guitar.captured.frequencies
      }
      this.materialTapPhase = 'complete'
      this.materialPeaksFromLoad = true
      this.selectedLongitudinalPeak = material?.selectedLongitudinalPeak ?? null
      this.selectedCrossPeak = material?.selectedCrossPeak ?? null
      this.selectedFlcPeak = material?.selectedFlcPeak ?? null
      this.capturedTaps = [] // a loaded measurement has no raw taps

      // Frozen: detection stops, a capture under way is dropped with all it scheduled (it would otherwise
      // land on the loaded measurement), any session recording goes, and the measurement is complete.
      this.detectionState = 'idle'
      this.abandonCapture()
      this.cancelSessionRecording()
      this.isMeasurementComplete = true
      this.currentTapCount = 0
      this.tapProgress = 0
      this.setStatusMessage(LOADED_STATUS)

      this.annotationOffsets = new Map(read.annotationOffsetsById)
      this.highlightedPeakId = null
      // The selection — a plate or brace has none (its peaks are its identified L/C/FLC).
      this.selectedPeakIds = guitar ? new Set(guitar.selectedIds) : new Set()
      this.userModifiedSelection = guitar ? guitar.userModified : false
      this.selectedPeakFrequencies = guitar ? guitar.peaks.filter((p) => guitar.selectedIds.has(p.id)).map((p) => p.frequency) : []
      // The file's annotation mode — "all" when it has none — and saved, as Swift's.
      this.annotationVisibilityMode = annotationVisibilityMode ?? 'all'
      settingsStore.update({ annotationVisibilityMode: this.annotationVisibilityMode })
      this.overrides = guitar ? new Map(guitar.overridesById) : new Map()
      this.reclassifyPeaks()
      this.refreshDisplayedPeaks()

      // The threshold and tap count it carries are the loaded ones, and the analyzer's — when the file has them.
      if (tapDetectionThreshold !== undefined) {
        this.loadedTapDetectionThreshold = tapDetectionThreshold
        this.tapDetectionThreshold = tapDetectionThreshold
      }
      if (m.numberOfTaps != null) {
        this.loadedNumberOfTaps = m.numberOfTaps
        this.setNumberOfTaps(m.numberOfTaps)
      }

      // Select the recorded microphone if it is connected; warn if it is not. The id is tried first
      // (a measurement made in this browser); then the name, so a measurement from another edition —
      // a CoreAudio UID, or Python's "Name:SampleRate" fingerprint — still resolves. Swift
      // `loadMeasurement(_:)`.
      const device = this.attachedDevice
      if (m.microphoneUID) {
        const name = m.microphoneName ?? m.microphoneUID
        const available = device?.availableInputDevices ?? []
        const match =
          available.find((d) => d.deviceId === m.microphoneUID) ??
          available.find((d) => d.label === m.microphoneName)
        console.info(
          `[analyzer] 🎤 Load: recorded microphone '${name}' (uid ${m.microphoneUID}) — ` +
            (match
              ? `matched '${match.label}' by ${match.deviceId === m.microphoneUID ? 'id' : 'name'}; the input is ${device?.inputDeviceId === match.deviceId ? 'already it' : `'${device?.inputDeviceId}' — switching`}`
              : `no connected input matches (${available.map((d) => `'${d.label}'`).join(', ') || 'none listed'})`) +
            `; recorded rate ${m.sampleRate ?? 'none'} Hz, current rate ${device?.sampleRate ?? 'none'} Hz` +
            ` (the browser's audio rate — it follows the output device), track rate ${device?.audioSettings?.sampleRate ?? 'unknown'} Hz`,
        )
        if (match && device) {
          // Connected — switch to it for this session; its calibration is selected with it, before
          // the check below reads it. The stream follows.
          if (device.inputDeviceId !== match.deviceId) {
            device.setInputDevice(match.deviceId).catch(() => {
              // It could not be opened: setInputDevice kept the previous input, and the load says so.
              this.microphoneWarningTitle = 'Microphone Unavailable'
              this.microphoneWarning = failedOpenMessage(match.label)
              this.notify()
            })
          }
          // Same microphone — but flag a calibration or sample-rate difference, since a newly
          // captured tap would then not match this saved measurement.
          const currentCalibration = device.activeCalibration?.name ?? null
          const calibrationDiffers = (m.calibrationName ?? null) !== currentCalibration
          const rateDiffers = m.sampleRate != null && Math.round(m.sampleRate) !== Math.round(device.sampleRate)
          this.microphoneWarningTitle = 'Recording Setup Differs'
          this.microphoneWarning =
            calibrationDiffers || rateDiffers
              ? setupDiffersMessage(
                  calibrationDiffers ? [m.calibrationName ?? null, currentCalibration] : null,
                  rateDiffers ? [Math.round(m.sampleRate!), Math.round(device.sampleRate)] : null,
                )
              : null
        } else {
          // UNKNOWN, not "unplugged": a no-match can equally mean the device is attached under a
          // different name on this platform; the message says both.
          this.microphoneWarningTitle = 'Microphone Not Found'
          this.microphoneWarning = microphoneNotFoundMessage(name, device ? device.deviceLabel || null : null)
        }
      } else {
        this.microphoneWarning = null // no microphone recorded: no warning from an earlier load stays (Swift)
      }

      // After the completion and the tap count, both of whose hooks clear it.
      this.showLoadedSettingsWarning = true
      // The loaded result's provenance is what the file recorded; no microphone means unknown.
      this.resultProvenance = {
        microphoneName: m.microphoneName ?? null,
        microphoneUID: m.microphoneUID ?? null,
        calibrationName: m.calibrationName ?? null,
        sampleRate: m.sampleRate ?? null,
      }
      this.tapEntries = guitar?.tapEntries ?? [] // restored as saved — peaks and selection included
      this.showingMultiTapComparison = false
    } finally {
      this.isLoadingMeasurement = false
    }
    this.notify()
  }

  /** Change a saved measurement's name and notes. The amended measurement is a different dataset, so
   *  it gets a new id; it keeps its row (`rowKey`), so it stays in its place in the library. Mirrors
   *  Swift `updateMeasurement(at:measurementName:notes:)`, which addresses the entry by position. */
  async updateMeasurement(m: TapToneMeasurementModel, measurementName: string | undefined, notes: string | undefined): Promise<void> {
    await storeMeasurement(amendMeasurement(m, measurementName, notes))
    await this.refreshSavedMeasurements()
  }

  /** Remove a saved measurement from the library. Mirrors Swift `deleteMeasurement(at:)`, which
   *  addresses the entry by position; here its row key names it. */
  async deleteMeasurement(m: TapToneMeasurementModel): Promise<void> {
    await deleteStoredMeasurement(m.rowKey as string)
    await this.refreshSavedMeasurements()
  }

  /** Remove every saved measurement. Mirrors Python `delete_all_measurements`. */
  async deleteAllMeasurements(): Promise<void> {
    await clearMeasurements()
    await this.refreshSavedMeasurements()
  }

  /** The message an import that failed shows, the same in every edition: the file is not a valid
   *  measurement (naming the id when that is why), or what went wrong. Mirrors Swift
   *  `importErrorMessage(for:fileName:)` (a browser has no file-permission failure to report). */
  static importErrorMessage(err: unknown, fileName: string): string {
    const reason = TapToneAnalyzer.unreadableReason(err)
    if (reason !== null) {
      return `Could not import "${fileName}": the file is not a valid GuitarTap measurement (${reason}).`
    }
    if (err instanceof SyntaxError || err instanceof TypeError) {
      return `Could not import "${fileName}": the file is not a valid GuitarTap measurement.`
    }
    return `Could not import "${fileName}": ${err instanceof Error ? err.message : String(err)}`
  }

  /** Why one entry of a file could not be read, in the words an import's message uses: the id that is not a
   *  UUID, or "no spectrum"; null for any other reason. Mirrors Swift `unreadableReason(_:)`. */
  static unreadableReason(err: unknown): string | null {
    if (err instanceof InvalidIdError || err instanceof NoSpectrumError) return err.message
    return null
  }

  /** What an import's message says about the entries it skipped — null when none were: how many, and why
   *  when there was one. Mirrors Swift `skippedEntriesMessage(_:)`. */
  static skippedEntriesMessage(unreadable: unknown[]): string | null {
    if (unreadable.length === 0) return null
    if (unreadable.length > 1) return `${unreadable.length} measurements in the file could not be read and were not imported.`
    const reason = TapToneAnalyzer.unreadableReason(unreadable[0])
    return `1 measurement in the file could not be read and was not imported${reason !== null ? ` (${reason})` : ''}.`
  }

  /** Import a `.guitartap` file and return the one message the user sees for it.
   *
   *  Mirrors Swift `importAndLoadMeasurements(from:)` and Python `import_and_load_measurements`.
   *  A single measurement is also loaded — so, and only then, the message carries the LOAD's
   *  microphone warning, folded in so one dialog appears rather than two, and consumed. A library
   *  import (Export All) only adds to the library and says nothing about microphones: nothing is on
   *  screen yet, so there is nothing for a microphone difference to affect.
   *
   *  The warning is cleared first, so the message can only ever describe THIS import.
   *
   *  Entries that could not be read and were skipped are named in the message.
   *
   *  @param save Persists each decoded measurement and returns what was stored and what was skipped (the
   *              store's `importMeasurements`), injected so the model does not reach into storage itself. */
  async importAndLoadMeasurements(
    text: string,
    save: (text: string) => Promise<ImportedMeasurements>,
  ): Promise<string> {
    this.microphoneWarning = null
    const { imported, unreadable } = await save(text)
    await this.refreshSavedMeasurements()
    let message: string
    if (imported.length === 1) {
      this.loadMeasurement(imported[0]!)
      message = 'Successfully imported and loaded 1 measurement'
    } else {
      message = `Successfully imported ${imported.length} measurements`
    }
    const skipped = TapToneAnalyzer.skippedEntriesMessage(unreadable)
    if (skipped) message += '\n\n' + skipped
    if (imported.length === 1 && this.microphoneWarning) {
      message += '\n\n⚠\uFE0E ' + this.microphoneWarning
      this.microphoneWarning = null
      this.notify()
    }
    return message
  }


  /** Clear the frozen result (New Tap / measurement-type switch / play-file / comparison / load-reset):
   *  drop the frozen spectrum, the per-tap entries, the raw tap accumulation, and completion.
   *  Mirrors Swift startTapSequence's result reset (frozen + tapEntries + capturedTaps + complete). */
  clearResult(): void {
    this.frozenMagnitudes = []
    this.frozenFrequencies = []
    this.tapEntries = []
    this.capturedTaps = []
    // A blank-slate reset (New Tap / type-switch / play-file / cancel) drops per-peak state, mirroring
    // the view's old fresh-capture reset. The remap in applyFrozenPeakState then carries an empty map,
    // so a freshly-captured measurement starts with no overrides. Load restores AFTER (restoreOverrides),
    // so it is unaffected. Selection resets too (empty, auto): the next recalc auto-selects.
    this.overrides = new Map()
    this.annotationOffsets = new Map()
    this.selectedPeakIds = new Set()
    this.selectedPeakFrequencies = []
    this.userModifiedSelection = false
    this.highlightedPeakId = null
    this.isMeasurementComplete = false // setter also clears the loaded-settings warning
    // New Tap / type-switch / play-file / cancel all return to live input, and drop any overlay
    // with the result they are clearing — through clearComparison, as Swift's and Python's.
    this.clearComparison()
    this.showingMultiTapComparison = false
    this.notify()
  }

  /** Whether the Re-analyze button is offered: ANY complete guitar measurement with a frozen
   *  spectrum, and never a plate/brace one.
   *
   *  Re-analyze is a RESET, not a dirty-flag indicator. It is offered whenever it COULD do
   *  something, not only when we can prove it WILL — deliberately. What can leave the displayed
   *  analysis differing from a clean re-derivation is open-ended: the peaks came from a file; the
   *  guitar type or the analysis range moved; selections or mode names were hand-edited. Proving "it will definitely change something" means
   *  enumerating all of those correctly, forever, with nothing to tell us when we got it wrong. The
   *  two failure modes are not symmetric: a wrongly-DISABLED button is a dead end (the user cannot
   *  force the recomputation they want), while a wrongly-ENABLED one costs a click that recomputes
   *  the same answer.
   *
   *  (The previous rule, "a measurement is loaded", was a proxy for "the peaks are stale" and was wrong
   *  in both directions: it disabled itself after a single press, and never lit up for a live
   *  capture whose mode assignments had drifted.)
   *
   *  Never for plate/brace: material peaks come from the per-phase captures, and running findPeaks
   *  over them would destroy the saved L/C/FLC peaks.
   *
   *  Mirrors Swift `canReanalyze` / Python `can_reanalyze`. */
  get canReanalyze(): boolean {
    return (
      this.isGuitar &&
      this.isMeasurementComplete &&
      this.frozenMagnitudes.length > 0 &&
      this.frozenFrequencies.length > 0
    )
  }

  /** The guitar type the analyzer classifies under — Swift `TapDisplaySettings.guitarType`. */
  private get guitarType(): GuitarTypeName {
    return guitarTypeSetting(settingsStore.get())
  }

  /** FFT-frame entry point: the device hands each live spectrum here. Mirrors Swift `onFftFrame`. */
  onFftFrame(magnitudes: number[], frequencies: number[]): void {
    this.runNextFrameActions(magnitudes.length > 0 ? Math.max(...magnitudes) : -100)
    this.analyzeMagnitudes(magnitudes, frequencies)
  }

  /** Run `action` on the next FFT frame, with that frame's peak magnitude — the device-change settle's
   *  end, which re-anchors detection on the first frame the user sees. Swift `afterNextFrame`. */
  afterNextFrame(action: (peakMagnitude: number) => void): void {
    this.pendingFrameActions.push(action)
  }

  /** Run, in scheduling order, every action waiting for this frame. Swift `runNextFrameActions`. */
  private runNextFrameActions(peakMagnitude: number): void {
    const due = this.pendingFrameActions
    this.pendingFrameActions = []
    for (const action of due) action(peakMagnitude)
  }

  /** Live peaks from one FFT frame, while a sequence is running (detecting, paused, or a capture window
   *  filling) and not complete: found at the Peak Min threshold, all selected, classified. A complete
   *  measurement's peaks are never overwritten here. Mirrors Swift `analyzeMagnitudes`, guitar path; the
   *  web shows no live material peaks (Swift finds them against an adaptive median threshold). */
  analyzeMagnitudes(magnitudes: number[], frequencies: number[]): void {
    // Nothing to analyze unless the engine is running. Mirrors Swift's guard fftAnalyzer.isRunning.
    if (!this.attachedDevice?.running) return
    if (!(this.isDetecting || this.isDetectionPaused || this.gatedCaptureActive) || this.isMeasurementComplete) return
    if (!this.isGuitar) {
      // Material: no live peaks on the web (its result is matPeaks), so the set is empty.
      if (this.peaks.length > 0) {
        this.peaks = []
        this.modeByPeak = new Map()
        this.refreshDisplayedPeaks()
        this.notify()
      }
      return
    }
    const peaks = this.findPeaks(magnitudes, frequencies)
    this.peaks = peaks
    // Auto-select every newly detected peak so visibility mode "selected" shows everything by default.
    this.selectedPeakIds = new Set(peaks.map((p) => p.id))
    this.modeByPeak = classifyAll(peaks, this.guitarType)
    this.refreshDisplayedPeaks()
    this.notify()
  }

  /** Re-run the frozen-spectrum peak analysis — reached only through Re-analyze ({@link reanalyzePeaks}),
   *  which checks first that the measurement is complete and its spectrum frozen: the FULL set is re-detected at the floor,
   *  classified afresh and auto-selected, and each peak's label position and custom name carried across
   *  by frequency. Mirrors Swift `recalculateFrozenPeaksIfNeeded`. */
  recalculateFrozenPeaksIfNeeded(): void {
    const oldPeaks = this.peaks
    // Detect the FULL set (floor -100) on the frozen spectrum; Peak Min only projects it.
    const peaks = this.findPeaks(this.frozenMagnitudes, this.frozenFrequencies, {
      peakMinOverride: TapToneAnalyzer.peakDetectionFloor,
    })
    this.peaks = peaks
    this.refreshDisplayedPeaks()
    // Nothing detected at all: no modes, and the per-peak state is left alone, so the selection survives
    // (Swift returns before applyFrozenPeakState; Python likewise).
    if (peaks.length === 0) this.modeByPeak = new Map()
    else this.applyFrozenPeakState(oldPeaks, peaks)
    // Per-tap entries are deliberately NOT recomputed here: each is detected once, at capture, and is
    // durable (Swift removed `recalculateTapEntryPeaks` for the same reason).
    this.notify()
  }

  /** Re-analyze: drop any manual selection and re-detect the frozen spectrum's peaks, which replace the
   *  saved ones. The stored ring-out is untouched. Mirrors Swift `reanalyzePeaks()` / Python
   *  `reanalyze_peaks()`. No-op without a frozen spectrum. */
  reanalyzePeaks(): void {
    if (!this.isMeasurementComplete || this.frozenFrequencies.length === 0 || this.frozenMagnitudes.length === 0) return
    this.userModifiedSelection = false
    this.selectedPeakFrequencies = []
    this.modeByPeak = new Map()
    this.recalculateFrozenPeaksIfNeeded()
  }

  /** Re-classify the durable peaks under the current guitar type (no detection). Mirrors Swift
   *  `reclassifyPeaks`. */
  reclassifyPeaks(): void {
    this.modeByPeak = classifyAll(this.peaks, this.guitarType)
  }

  // ── Per-peak mode overrides (id-keyed) ───────────────────────────────────────────────────────────
  // @parity state/mode-overrides tests=test/frozen-peak-recalc,test/annotation-state

  /** Assign a manual mode-label override to a peak (mirrors Swift `setModeOverride`). The label is the
   *  display string (a predefined mode name or a freeform label). Overriding an already-SELECTED peak into
   *  a single-holder mode displaces the previous definitive holder (see enforceDefinitiveModeUniqueness). */
  setModeOverride(id: Uuid, label: string): void {
    // Reassign a fresh Map (never mutate in place): the snapshot exposes this reference, and App memos
    // keyed on `overrides` identity (overriddenPeakIds → displayPeaks → chart layers) must see the change.
    this.overrides = new Map(this.overrides).set(id, label)
    // Changing the mode of an already-selected peak can create two definitive holders of the new mode —
    // the only way an override touches selection (Swift setModeOverride). No-op if this peak isn't selected.
    this.enforceDefinitiveModeUniqueness(id)
    this.notify()
  }

  /** Clear a peak's override, reverting it to its auto-classified mode (Swift `resetModeOverride`). */
  resetModeOverride(id: Uuid): void {
    if (!this.overrides.has(id)) return
    const next = new Map(this.overrides)
    next.delete(id)
    this.overrides = next
    this.notify()
  }

  /** Replace the whole override map from a loaded measurement (id-keyed to the loaded peaks). The load
   *  path calls this AFTER `loadMeasurement`; the loaded peaks keep stable ids, so no remap follows. */
  restoreOverrides(map: Map<Uuid, string>): void {
    this.overrides = new Map(map)
    this.notify()
  }

  // ── Dragged annotation offsets (one id-keyed store for guitar + material, mirrors Swift/Python) ──────
  // @parity state/annotation-management tests=test/annotation-state,test/frozen-peak-recalc

  /** Set a peak's dragged annotation-label position (absolute [Hz, dB]). Fresh Map for memo identity.
   *  Mirrors Swift `updateAnnotationOffset` / Python `update_annotation_offset`. */
  updateAnnotationOffset(id: Uuid, pos: [number, number]): void {
    this.annotationOffsets = new Map(this.annotationOffsets).set(id, pos)
    this.notify()
  }

  /** Clear one peak's dragged offset (Swift `resetAnnotationOffset`). */
  resetAnnotationOffset(id: Uuid): void {
    if (!this.annotationOffsets.has(id)) return
    const next = new Map(this.annotationOffsets)
    next.delete(id)
    this.annotationOffsets = next
    this.notify()
  }

  /** Clear every dragged offset — "Reset Labels" (Swift `resetAllAnnotationOffsets`). */
  resetAllAnnotationOffsets(): void {
    if (this.annotationOffsets.size === 0) return
    this.annotationOffsets = new Map()
    this.notify()
  }


  /** Carry per-peak state across a peak RE-MINT (findPeaks assigns fresh ids), the web equivalent of
   *  Swift `applyFrozenPeakState`. Snapshots the old state BY FREQUENCY from the DURABLE old set (never
   *  a display projection), then re-attaches the overrides and offsets to the new peaks by
   *  ±REMAP_TOLERANCE_HZ proximity; the new peaks are classified afresh and auto-selected. Notify is left
   *  to the caller. */
  private applyFrozenPeakState(oldPeaks: ResonantPeak[], newPeaks: ResonantPeak[]): void {
    this.modeByPeak = classifyAll(newPeaks, this.guitarType)
    if (this.overrides.size > 0) {
      // Snapshot {frequency → label} from the OLD durable peaks, then remap onto the new ids.
      const byFreq: Array<{ frequency: number; label: string }> = []
      for (const [id, label] of this.overrides) {
        const old = oldPeaks.find((q) => q.id === id)
        if (old) byFreq.push({ frequency: old.frequency, label })
      }
      const remapped = new Map<Uuid, string>()
      for (const np of newPeaks) {
        const match = byFreq.find((o) => Math.abs(o.frequency - np.frequency) <= REMAP_TOLERANCE_HZ)
        if (match) remapped.set(np.id, match.label)
      }
      this.overrides = remapped
    }
    if (this.annotationOffsets.size > 0) {
      // Same ±5 Hz carry for dragged label positions. Guitar-only here — the findPeaks branch runs in
      // guitar mode, where no material offsets are present.
      const byFreq: Array<{ frequency: number; pos: [number, number] }> = []
      for (const [id, pos] of this.annotationOffsets) {
        const old = oldPeaks.find((q) => q.id === id)
        if (old) byFreq.push({ frequency: old.frequency, pos })
      }
      const remapped = new Map<Uuid, [number, number]>()
      for (const np of newPeaks) {
        const match = byFreq.find((o) => Math.abs(o.frequency - np.frequency) <= REMAP_TOLERANCE_HZ)
        if (match) remapped.set(np.id, match.pos)
      }
      this.annotationOffsets = remapped
    }
    const autoIds = this.guitarModeSelectedPeakIds(newPeaks)
    this.selectedPeakIds = autoIds
    this.selectedPeakFrequencies = newPeaks.filter((np) => autoIds.has(np.id)).map((np) => np.frequency)
  }

  /** Recompute `peaksAbovePeakMin` from the durable set — a cheap filter, no detection. Hands back
   *  the SAME peak objects, so projecting can never disturb identity. Peak Min is a GUITAR control:
   *  a material measurement's identified L/C/FLC peaks ARE the result and are never filtered out
   *  from under it. Mirrors Swift `refreshDisplayedPeaks()` / Python `refresh_displayed_peaks()`. */
  refreshDisplayedPeaks(): void {
    this.peaksAbovePeakMin = this.isGuitar
      ? this.peaks.filter((p) => p.magnitude >= this._peakMinThreshold)
      : this.peaks
  }

  /** The identified per-phase peaks (L, then C, then FLC) found so far in a material measurement, in phase
   *  order — a material measurement's peaks. The chart, annotations, results, save and PDF read them through
   *  here. Empty for guitar. Mirrors Swift `materialIdentifiedPeaks` / Python `material_identified_peaks`. */
  get materialIdentifiedPeaks(): ResonantPeak[] {
    if (this.isGuitar) return []
    return [this.selectedLongitudinalPeak, this.selectedCrossPeak, this.selectedFlcPeak].filter(
      (p): p is ResonantPeak => p != null,
    )
  }

  // @parity state/visible-peaks tests=test/annotation-state,test/comparison
  /** Which peaks are annotated: all, the selected ones, or none. Set from the settings store at
   *  construction; cycled by `cycleAnnotationVisibility`. Swift / Python `annotationVisibilityMode`. */
  annotationVisibilityMode: AnnotationMode = settingsStore.get().annotationVisibilityMode

  /** Advance the annotation mode — all → selected → none → all, on every measurement type — and save it
   *  to the settings, as Swift's writes TapDisplaySettings. Swift / Python `cycleAnnotationVisibility()`. */
  cycleAnnotationVisibility(): void {
    this.annotationVisibilityMode = ANNOTATION_NEXT[this.annotationVisibilityMode]
    settingsStore.update({ annotationVisibilityMode: this.annotationVisibilityMode })
    this.notify()
  }

  /** A guitar peak whose mode is unknown and that the user has not named. Swift / Python `isUnknown`. */
  isUnknown(peak: ResonantPeak): boolean {
    return (this.modeByPeak.get(peak.id) ?? 'unknown') === 'unknown' && !this.overrides.has(peak.id)
  }

  /** The peaks to annotate for the current `annotationVisibilityMode` — what the chart's annotation
   *  cards show (those in its range) and what an exported report counts and summarises (all of them).
   *  Material: the identified L / C / FLC, which have no per-peak selection, so all and selected are the
   *  same. Guitar: every peak above Peak Min, or only the selected ones; unknown peaks dropped when Show
   *  Unknown Modes is off. Swift `visiblePeaks` / Python `visible_peaks`. */
  /** The peaks the chart marks: a guitar's above Peak Min, a plate's or brace's identified ones — none (null)
   *  while a comparison is shown, which draws its entries' own. Swift `chartPeaks` / Python `chart_peaks`. */
  get chartPeaks(): ResonantPeak[] | null {
    if (this.displayMode === 'comparison') return null
    return this.isGuitar ? this.peaksAbovePeakMin : this.materialIdentifiedPeaks
  }

  /** The peaks the chart labels: `visiblePeaks` — none (null) while a comparison is shown. Swift
   *  `chartAnnotationPeaks` / Python `chart_annotation_peaks`. */
  get chartAnnotationPeaks(): ResonantPeak[] | null {
    return this.displayMode === 'comparison' ? null : this.visiblePeaks
  }

  /** Whether the chart draws the guitar mode lines: not for a comparison of saved measurements, whose
   *  entries need not be of one guitar type. A multi-tap guitar's per-tap overlay keeps them. Swift
   *  `showsModeBoundaries` / Python `shows_mode_boundaries`. */
  get showsModeBoundaries(): boolean {
    return !this.isSavedMeasurementComparison
  }

  get visiblePeaks(): ResonantPeak[] {
    if (!this.isGuitar) return this.annotationVisibilityMode === 'none' ? [] : this.materialIdentifiedPeaks
    let candidates: ResonantPeak[]
    switch (this.annotationVisibilityMode) {
      case 'all':
        candidates = this.peaksAbovePeakMin
        break
      case 'selected':
        candidates = this.peaksAbovePeakMin.filter((p) => this.selectedPeakIds.has(p.id))
        break
      case 'none':
        return []
    }
    if (settingsStore.get().showUnknownModes) return candidates
    return candidates.filter((p) => !this.isUnknown(p))
  }

  /** Drop the three identified material peaks (a new sequence, a reset). */
  private clearMaterialPeaks(): void {
    this.selectedLongitudinalPeak = null
    this.selectedCrossPeak = null
    this.selectedFlcPeak = null
  }

  /** Set the Peak Min display threshold from its control (it saves itself to the settings) and publish
   *  the new projection. */
  setPeakMinThreshold(v: number): void {
    this.peakMinThreshold = v
    this.notify()
  }

  /** Set the tap threshold from its control, and tell the view. */
  setTapDetectionThreshold(v: number): void {
    this.tapDetectionThreshold = v
    this.notify()
  }

  // ── Peak selection (concrete state, full-Swift paradigm) ─────────────────────────────────────────

  /** The selected peaks over the DURABLE set (Swift `selectedPeaks`). */
  get selectedPeaks(): ResonantPeak[] {
    return this.peaks.filter((p) => this.selectedPeakIds.has(p.id))
  }

  /**
   * The peaks auto-selected by guitar mode: for each named mode, the strongest peak `classifyAll` assigns
   * to it (the first on a tie). Unknown peaks are never auto-selected. Mirrors Swift
   * `guitarModeSelectedPeakIDs(from:)`.
   * @param peaks The candidates; default the DURABLE set — auto-selection is a fact about the measurement,
   *   so it never runs over the Peak Min projection. Classified under the analyzer's guitar type.
   * @returns At most one peak id per named mode.
   */
  guitarModeSelectedPeakIds(peaks: ResonantPeak[] = this.peaks): Set<Uuid> {
    const modeMap = classifyAll(peaks, this.guitarType)
    const claimedModes = new Set<ResolvedMode>(['air', 'top', 'back', 'dipole', 'ring', 'upper'])
    const bestPerMode = new Map<ResolvedMode, ResonantPeak>()
    for (const peak of peaks) {
      const mode = modeMap.get(peak.id)
      if (mode === undefined || !claimedModes.has(mode)) continue
      const best = bestPerMode.get(mode)
      if (best === undefined || peak.magnitude > best.magnitude) bestPerMode.set(mode, peak)
    }
    return new Set([...bestPerMode.values()].map((p) => p.id))
  }

  /** The override-aware mode of a peak (mirrors Swift `peakMode(for:)` → `GuitarMode.effectiveMode`): a
   *  present override resolves to its mode — a FREEFORM label to `'unknown'`, NOT the auto mode — otherwise
   *  the auto classification. The selection invariant resolves modes through this, never the override-blind
   *  `modeByPeak`. */
  effectiveMode(id: Uuid): ResolvedMode {
    return resolveEffectiveMode(this.overrides.get(id), this.modeByPeak.get(id) ?? 'unknown')
  }

  /** The label a peak shows: its manual label, else its mode's name. Mirrors Swift `effectiveModeLabel(for:)`. */
  effectiveModeLabel(id: Uuid): string {
    return this.overrides.get(id) ?? MODE_DISPLAY_NAME[this.effectiveMode(id)]
  }

  /** The mode a peak carries with no override — what "Reset to Auto" restores it to. Override-blind on
   *  purpose; a peak with no classification is `'unknown'`. Mirrors Swift `autoDetectedMode(for:)`. */
  autoDetectedMode(id: Uuid): ResolvedMode {
    return this.modeByPeak.get(id) ?? 'unknown'
  }

  /** Whether the user has given this peak a label of their own. Mirrors Swift `hasManualOverride(for:)`. */
  hasManualOverride(id: Uuid): boolean {
    return this.overrides.has(id)
  }

  // @parity state/mode-lookup tests=test/measurement-codable,test/frozen-peak-recalc
  /** The DEFINITIVE peak for a mode — the *selected* peak whose *effective* (override-aware) mode is that
   *  mode, strongest wins. Deselecting or relabelling a peak removes it here exactly as on screen. Mirrors
   *  Swift analyzer `getPeak(for:)`. (Definitive-mode uniqueness means normally ≤1 candidate; `max`
   *  guards a transient double-selection.) */
  getPeak(mode: ResolvedMode): ResonantPeak | undefined {
    let best: ResonantPeak | undefined
    for (const p of this.selectedPeaks) {
      if (this.effectiveMode(p.id) === mode && (!best || p.magnitude > best.magnitude)) best = p
    }
    return best
  }

  /** Tap-tone ratio f_Top / f_Air over the DEFINITIVE Air/Top peaks — null if either is absent (a
   *  renamed/deselected Top drops the ratio, matching every other surface). Mirrors Swift
   *  `calculateTapToneRatio`. */
  tapToneRatio(): number | null {
    const air = this.getPeak('air')
    const top = this.getPeak('top')
    return air && top && air.frequency > 0 ? top.frequency / air.frequency : null
  }

  /** The definitive Air / Top / Back for the multi-tap Averaged row, each with an override flag so an
   *  overridden value can be marked (italic + " *"). Mirrors Swift `definitiveModeInfo` — `getPeak`
   *  per mode + `hasManualOverride` (= the peak carries any override). */
  definitiveModeInfo(): DefinitiveModeInfo {
    const of = (mode: ResolvedMode): DefinitiveMode | null => {
      const p = this.getPeak(mode)
      return p ? { frequency: p.frequency, isOverride: this.overrides.has(p.id) } : null
    }
    return { air: of('air'), top: of('top'), back: of('back') }
  }

  /** Keep the selection invariant: at most one SELECTED peak per Air/Top/Back. The preferred peak stays;
   *  every OTHER selected peak with the same override-aware mode is deselected. Only ever REMOVES from the
   *  selection — never reclassifies, never promotes. Guitar-only; a no-op unless `id` is selected and its
   *  effective mode is single-holder. Notify is left to the caller. Mirrors Swift
   *  `enforceDefinitiveModeUniqueness(preferring:)`. */
  enforceDefinitiveModeUniqueness(id: Uuid): void {
    if (!this.isGuitar || !this.selectedPeakIds.has(id)) return
    if (!this.peaks.some((p) => p.id === id)) return
    const mode = this.effectiveMode(id)
    if (!SINGLE_HOLDER_MODES.has(mode)) return
    const next = new Set(this.selectedPeakIds)
    let changed = false
    for (const p of this.peaks) {
      if (p.id !== id && next.has(p.id) && this.effectiveMode(p.id) === mode) {
        next.delete(p.id)
        changed = true
      }
    }
    if (changed) this.selectedPeakIds = next
  }

  /** Toggle one peak's selection (Swift `togglePeakSelection`). On SELECT, enforce the
   *  one-definitive-per-Air/Top/Back invariant (only the select branch can break it). User-modifies. */
  togglePeakSelection(id: Uuid): void {
    const next = new Set(this.selectedPeakIds)
    const wasSelected = next.has(id)
    if (wasSelected) next.delete(id)
    else next.add(id)
    this.selectedPeakIds = next
    if (!wasSelected) this.enforceDefinitiveModeUniqueness(id)
    this.userModifiedSelection = true
    this.notify()
  }

  /** Clear the selection — a legitimate state (Swift `selectNoPeaks`). */
  selectNoPeaks(): void {
    this.selectedPeakIds = new Set()
    this.userModifiedSelection = true
    this.notify()
  }

  /** The wand: drop manual edits and re-run auto-selection over the durable set, under the analyzer's guitar
   *  type (Swift `resetToAutoSelection`). */
  resetToAutoSelection(): void {
    this.userModifiedSelection = false
    this.selectedPeakFrequencies = []
    this.selectedPeakIds = this.guitarModeSelectedPeakIds()
    this.notify()
  }

  /** A guitar-subtype change (e.g. Classical → Flamenco) as a CLEAN SLATE for the new type: the type
   *  changes what each mode BAND means, so manual labels — made against the OLD bands — are dropped and
   *  selection reverts to auto for the new type. Dragged offsets are kept (peaks are unchanged; position
   *  is orthogonal to mode); `modeByPeak` is reclassified for the new type — no re-detection. Mirrors Swift
   *  `reclassifyForGuitarTypeChange` (peakModeOverrides=[:] → reclassifyPeaks → resetToAutoSelection) /
   *  Python `reclassify_for_guitar_type_change`. Deliberately NOT the wand (`resetToAutoSelection`
   *  alone), which keeps labels. */
  reclassifyForGuitarTypeChange(): void {
    this.overrides = new Map()
    this.reclassifyPeaks()
    this.resetToAutoSelection()
  }

  /** Restore selection from a loaded measurement (ids keyed to the loaded peaks, + their frequencies
   *  and the manual/auto flag). Loaded peaks keep stable ids, so no remap follows. */
  restoreSelection(ids: Set<Uuid>, freqs: number[], userModified: boolean): void {
    this.selectedPeakIds = new Set(ids)
    this.selectedPeakFrequencies = [...freqs]
    this.userModifiedSelection = userModified
    this.notify()
  }

  /** Toggle the highlighted peak (clicking its chart dot or its results row): same id → clear, else set.
   *  Mirrors Swift's macOS dot `.onTapGesture` toggle and the results-row tap (both toggle). Transient
   *  view state — not selection, not persisted. */
  toggleHighlightedPeak(id: Uuid): void {
    this.highlightedPeakId = this.highlightedPeakId === id ? null : id
    this.notify()
  }

  // ── Material (plate/brace) phase machine (mirrors Swift TapToneAnalyzer+SpectrumCapture) ──────────
  // The engine the analyzer owns for its life, as Swift's TapToneAnalyzer owns `fftAnalyzer`: given at
  // construction (or, in tests, by `setDevice`), started and stopped through `start` / `stop`, and
  // subscribed to — each chunk, each frame, a dead input and an input change reach the analyzer here,
  // as Swift's sinks on the engine's publishers do.
  private attachedDevice: RealtimeFFTAnalyzer | null = null

  /** An analyzer and the engine it owns for its life — Swift `init(fftAnalyzer:)`. Tests make one
   *  without and attach a headless engine with `setDevice`. */
  /** The wall clock the capture's safety timeout reads and schedules on — the system's in the app. */
  readonly wallClock: WallClock

  constructor(device: RealtimeFFTAnalyzer | null = null, wallClock: WallClock = new SystemWallClock()) {
    this.wallClock = wallClock
    if (device) this.setDevice(device)
    // The library, as Swift's init loads it — where there is storage to load it from.
    this.libraryLoaded = typeof indexedDB !== 'undefined' ? this.loadPersistedMeasurements() : Promise.resolve()
  }

  /** The launch's load of the library, done when it settles. Swift's init loads it before returning; here
   *  storage is asynchronous, so whoever needs the loaded library waits on this. */
  readonly libraryLoaded: Promise<void>

  /** The saved measurements, in the order they were saved. Swift `savedMeasurements`. */
  savedMeasurements: TapToneMeasurementModel[] = []
  /** Set when saved measurements could not be read at launch and were kept aside. The view shows it once in
   *  an alert and clears it. Mirrors Swift `libraryLoadFailure`. */
  libraryLoadFailure: string | null = null

  /** Read the library into `savedMeasurements`, as at launch. Records that cannot be read are left out: they
   *  are kept aside ({@link setAsideUnreadable}) and the user is told once. Mirrors Swift
   *  `loadPersistedMeasurements()`. */
  async loadPersistedMeasurements(): Promise<void> {
    const library = await readLibrary()
    this.savedMeasurements = library.measurements
    const n = library.unreadable.length
    if (n > 0) {
      const count = n === 1 ? '1 saved measurement' : `${n} saved measurements`
      const was = n === 1 ? 'was' : 'were'
      this.libraryLoadFailure = (await setAsideUnreadable(library.unreadable))
        ? `${count} could not be read and ${was} removed from the list.`
        : `${count} could not be read and ${was} left out of the list.`
    }
    this.notify()
  }

  /** Read the library into `savedMeasurements` again after a change to it — each record is stored on its own,
   *  so the list is read back rather than kept. Says nothing about records that cannot be read: the launch
   *  load has. */
  private async refreshSavedMeasurements(): Promise<void> {
    this.savedMeasurements = (await readLibrary()).measurements
    this.notify()
  }

  /** The user has read the alert. */
  clearLibraryLoadFailure(): void {
    this.libraryLoadFailure = null
    this.notify()
  }

  /** The analyzer's engine, for the view to show what it reports (its level, devices and spectrum). */
  get device(): RealtimeFFTAnalyzer | null {
    return this.attachedDevice
  }
  // Raw gated taps accumulated for the CURRENT material phase; the analyzer averages them +
  // findDominantPeak at phase completion.
  private materialBuffer: Spectrum[] = []

  /** Set the audio device this analyzer drives (useAudioEngine calls this on creation). As Swift's
   *  analyzer sets `fftAnalyzer.preMicRestartHandler`, it asks the engine to flush its gated capture
   *  when a played file ends. */
  setDevice(device: RealtimeFFTAnalyzer | null): void {
    if (this.attachedDevice === device) return
    if (this.attachedDevice) this.attachedDevice.preMicRestartHandler = null
    for (const unsubscribe of this.deviceSubscriptions) unsubscribe()
    this.deviceSubscriptions = []
    this.attachedDevice = device
    if (device) {
      device.preMicRestartHandler = () => this.flushGatedCaptureOnFileEnd()
      this.deviceSubscriptions = [
        // The device is the microphone, the FFT and the watchdogs — it hands every chunk up and the
        // analyzer does the rest: pre-roll, detection, gated capture, the tap count, the status
        // strings and the L→C→FLC phase machine. That is Swift's split.
        device.onAudioFrame((samples, levelDb, audioTime) => {
          slackStart()
          slackSetChunkPeriod(samples.length, this.mpmSampleRate)
          slackTime('main/chunk', () => this.processAudioFrame(samples, levelDb, audioTime))
        }),
        // Each live frame: the live peaks while a sequence runs (Swift's sink on fftAnalyzer.frame →
        // onFftFrame → analyzeMagnitudes).
        device.frame.onFrame(() => {
          const spectrum = device.frame.spectrum
          if (spectrum) slackTime('frame', () => this.onFftFrame(spectrum.magnitudesDb, spectrum.frequencies))
        }),
        // Input clipping → the status override (Swift `fftAnalyzer.level.$isClipping` sink /
        // Python `level.clippingChanged` → `_set_clipping`).
        device.level.onClipping((c) => this.setClipping(c)),
        // The dead-input watchdog's verdict → the "no audio input" status (Swift `$inputAppearsDead`
        // sink / Python `inputAppearsDeadChanged` → `_set_input_appears_dead`).
        device.onInputAppearsDead((dead) => this.setInputAppearsDead(dead)),
        device.onInputCouldNotRestart((failed) => this.setInputCouldNotRestart(failed)),
        device.onMicrophonePermissionDenied((denied) => this.setMicrophonePermissionDenied(denied)),
        device.onInputCouldNotStart((failed) => this.setInputCouldNotStart(failed)),
        // The hardware changed the input → the route-change settle.
        device.onInputChanged(() => this.handleRouteChangeRestart()),
      ]
    }
  }
  private deviceSubscriptions: (() => void)[] = []

  /** Start the engine, anchor the warm-up and, one pass later, make the guarded auto-start. Throws
   *  what the engine's start throws (permission denied, no input), for the view to report. Mirrors
   *  Swift `start()` / Python `start()`. */
  async start(): Promise<void> {
    const device = this.attachedDevice
    if (!device) return
    await device.start()
    if (!device.running) return // stopped while starting
    this.warmupStartAudioTime = device.audioTime // begin the warm-up period for the new session
    // Evaluate the auto-start guard after pending state changes have settled.
    setTimeout(() => this.autoStartTapSequence(), 0)
  }

  /** Stop the engine (the view going away). */
  async stop(): Promise<void> {
    await this.attachedDevice?.stop()
  }

  /** Play a decoded audio file through the live pipeline — the Play File action. Plays with the
   *  calibration given for the file, or with none: the microphone the file was recorded with is unknown,
   *  so the live input's calibration never applies to it. Arms a fresh tap sequence, then plays the file;
   *  the calibration in effect before is restored when playback ends (the returned promise resolves then).
   *  App calls this; so do the file-playback regressions, which therefore run the path users take.
   *  Mirrors Swift `TapToneAnalyzer.playFile(url:calibrationURL:completion:)`.
   *
   *  The warm-up is decided by the MEASUREMENT TYPE, not by "is this a file". Guitar skips it: an
   *  externally recorded file may put the tap inside the first 0.5 s, and guitar uses the absolute
   *  threshold, never the noise floor. Material (plate/brace) runs it: it is the only mode on the
   *  relative noise-floor detector, and the warm-up is what establishes that floor. A saved session WAV
   *  always contains its warm-up.
   *
   *  `startTapSequence` runs BEFORE the file starts, as in Swift, so the analyzer is fully reset before
   *  any file audio flows. */
  async playFile(
    samples: Float32Array,
    sampleRate: number,
    calibration: Calibration | null,
    fileName: string | null = null,
  ): Promise<void> {
    const device = this.attachedDevice
    if (!device) return
    const previousCalibration = device.activeCalibration
    device.setCalibration(calibration)
    this.startTapSequence({ skipWarmup: this.isGuitar })
    try {
      const playing = device.playFile(samples, sampleRate, { fileName })
      // The result comes from the file: its calibration, its sample rate, an unknown microphone.
      this.resultProvenance = { microphoneName: null, microphoneUID: null, calibrationName: calibration?.name ?? null, sampleRate }
      this.notify() // the playback has started — the view's buttons read isPlayingFile
      await playing
    } finally {
      device.setCalibration(previousCalibration)
      this.notify()
    }
  }

  /** There is something to save or export: a complete measurement (captured, loaded, multi-tap, or a
   *  finished plate/brace) or a comparison. Save, Export Spectrum and Export PDF are enabled only then.
   *  Mirrors Swift `hasResultToSaveOrExport`. */
  get hasResultToSaveOrExport(): boolean {
    return this.isMeasurementComplete || this.displayMode === 'comparison'
  }

  /** A file is playing through the device. Mirrors Swift `fftAnalyzer.isPlayingFile`. */
  get isPlayingFile(): boolean {
    return this.attachedDevice?.playingFile ?? false
  }

  /** Where the current result came from when it is not the live input — a played file or a loaded
   *  measurement — or null while the sequence listens to the input. A played file has no microphone (the
   *  one that recorded a file is not known), the calibration it was played with (or none) and its sample
   *  rate; a loaded measurement has what the file recorded. Set by `playFile` and `loadMeasurement`; a
   *  new sequence clears it. Mirrors Swift `resultProvenance`. */
  resultProvenance: {
    microphoneName: string | null
    microphoneUID: string | null
    calibrationName: string | null
    sampleRate: number | null
  } | null = null

  /** The microphone the current result was captured with, as shown, saved and reported: the input device
   *  for a live result; the recorded one for a played file or a loaded measurement, undefined (unknown)
   *  when there is none. Mirrors Swift `captureMicrophoneName`. */
  get captureMicrophoneName(): string | undefined {
    if (this.resultProvenance) return this.resultProvenance.microphoneName ?? undefined
    return this.attachedDevice?.deviceLabel || undefined
  }

  /** The id of `captureMicrophoneName`'s device. Mirrors Swift `captureMicrophoneUID`. */
  get captureMicrophoneUID(): string | undefined {
    if (this.resultProvenance) return this.resultProvenance.microphoneUID ?? undefined
    return this.attachedDevice?.inputDeviceId ?? undefined
  }

  /** The calibration the current result was captured with: the input's for a live result, the recorded
   *  one otherwise (none for a file played uncalibrated). Mirrors Swift `captureCalibrationName`. */
  get captureCalibrationName(): string | undefined {
    if (this.resultProvenance) return this.resultProvenance.calibrationName ?? undefined
    return this.attachedDevice?.activeCalibration?.name
  }

  /** The sample rate the current result was captured at: the input's for a live result (null when there is
   *  no rate yet), the recorded one otherwise. Mirrors Swift `captureSampleRate`. */
  get captureSampleRate(): number | null {
    if (this.resultProvenance) return this.resultProvenance.sampleRate
    return this.attachedDevice?.sampleRate || null
  }

  /** User-initiated arming (New Tap, a measurement-type change). A file that is playing is stopped
   *  first: a new sequence — for a changed measurement type, say — must not be fed the rest of the
   *  file. Mirrors Swift `requestStartTapSequence` (the web has no dump-folder guard to check). */
  requestStartTapSequence(): void {
    this.attachedDevice?.stopFilePlayback()
    this.startTapSequence()
  }

  /** What the engine coming up does: start a tap sequence — only when nothing is under way or on screen
   *  (not detecting, not complete, not paused, no taps taken), so an engine start never replaces a
   *  measurement. Mirrors Swift `autoStartTapSequence()` / Python `auto_start_tap_sequence()`. */
  autoStartTapSequence(): void {
    if (this.isDetecting || this.isMeasurementComplete || this.isDetectionPaused || this.currentTapCount > 0) return
    this.requestStartTapSequence()
  }

  // ── The settings store (the web's TapDisplaySettings) ────────────────────────────────────────────

  /** A load makes the measurement's own settings the app's, and saves them — through the store when
   *  there is one (the view then shows them), directly otherwise. Mirrors Swift loadMeasurement writing
   *  TapDisplaySettings. */
  private applyLoadedSettings(patch: Partial<Settings>): void {
    const { peakMinThreshold, tapDetectionThreshold, annotationVisibilityMode, ...rest } = patch
    settingsStore.update(rest)
    // Analyzer state, which saves itself to the settings — as Swift's load sets these properties.
    if (tapDetectionThreshold !== undefined) this.tapDetectionThreshold = tapDetectionThreshold
    if (annotationVisibilityMode !== undefined) {
      this.annotationVisibilityMode = annotationVisibilityMode
      settingsStore.update({ annotationVisibilityMode })
    }
    if (peakMinThreshold !== undefined) this.peakMinThreshold = peakMinThreshold
  }


  /** Build the gated search for a material phase: its frequency range and peak-selection rule. The
   *  calibration is not part of it — the gated transform applies the active calibration itself, at
   *  the moment of the capture, as Swift and Python do. */
  private matSearch(phase: MaterialPhaseName): MaterialSearch {
    // Swift `finishGatedFFTCapture`'s per-phase search window, by measurement type and phase.
    if (settingsStore.get().measurementType === 'brace') {
      // Brace bars resonate 100–1000 Hz; exclude sub-100 Hz table/impact thud. Strongest peak: there is
      // one resonance of interest and it should dominate.
      return { minHz: 100, maxHz: 1200, preferLowestSignificant: false }
    }
    switch (phase) {
      case 'cross':
        // fC, the cross-grain bending mode: ~57–194 Hz across tonewoods (Gore & Gilet Vol.1 §4.5). The
        // strongest peak — preferring the lowest would risk re-selecting fL.
        return { minHz: 40, maxHz: 220, preferLowestSignificant: false }
      case 'flc':
        // fLC, the torsional mode: ~25–76 Hz. The tap placement (a corner) selects the mode, so the
        // lowest significant peak.
        return { minHz: 15, maxHz: 100, preferLowestSignificant: true }
      default:
        // fL, the longitudinal bending mode: ~43–77 Hz. The lowest significant peak, as for fLC.
        return { minHz: 20, maxHz: 100, preferLowestSignificant: true }
    }
  }

  /** Continuous session WAV label for a completed material measurement (Swift Plate_LC / Plate_LCF / Brace). */
  private finishMaterialSession(): void {
    const label = settingsStore.get().measurementType === 'brace' ? 'Brace' : settingsStore.get().measureFlc ? 'Plate_LCF' : 'Plate_LC'
    this.finishSessionRecording(label)
  }

  /** Review → advance to the next phase (Accept). */
  acceptCurrentPhase(): void {
    const phase = this.materialTapPhase
    if (phase === 'reviewingL') {
      this.materialTapPhase = 'capturingC'
      this.materialBuffer = []
      this.checkpointSession() // C phase start (so a redo can drop it)
      this.isAboveThreshold = this.lastChunkLevelDb > this.tapDetectionThreshold - this.hysteresisMargin
      this.warmupStartAudioTime = this.attachedDevice?.audioTime ?? 0
      this.detectionState = 'listening'
      this.setStatusMessage(this.materialArmPrompt()) // phase is capturingC — one source
      this.notify()
    } else if (phase === 'reviewingC') {
      if (settingsStore.get().measureFlc) {
        // Mirror Swift acceptCurrentPhase: show the FLC reposition prompt during a tapCooldown with
        // detection DISARMED (waitingForFlcTap) so the plate-repositioning bump isn't taken as the FLC
        // tap; then arm the FLC capture.
        this.materialTapPhase = 'waitingForFlcTap'
        this.materialBuffer = []
        this.checkpointSession() // FLC phase start (so a redo can drop it)
        this.setStatusMessage(this.materialArmPrompt()) // phase is waitingForFlcTap
        this.notify()
        // The hold: `tapCooldown` of AUDIO. It cannot be cancelled, like Swift's — cancelled or
        // restarted meanwhile (Cancel / New Tap / type change), the phase has moved on and it does nothing.
        this.afterAudio(this.tapCooldown, () => {
          if (this.materialTapPhase !== 'waitingForFlcTap') return
          this.materialTapPhase = 'capturingFlc'
          // Anchored on the chunk that made the hold due — its level and its audio time.
          this.isAboveThreshold = this.lastChunkLevelDb > this.tapDetectionThreshold - this.hysteresisMargin
          this.warmupStartAudioTime = this.lastAudioTime
          this.detectionState = 'listening'
          this.setStatusMessage(this.materialArmPrompt()) // phase is capturingFlc
          this.notify()
        })
      } else {
        this.materialTapPhase = 'complete'
        this.isMeasurementComplete = true // material completion flips the shared flag (Swift finalisePlate*)
        this.finishMaterialSession()
        this.setStatusMessage(this.materialCompleteString())
        this.notify()
      }
    } else if (phase === 'reviewingFlc') {
      this.materialTapPhase = 'complete'
      this.isMeasurementComplete = true
      this.finishMaterialSession()
      this.setStatusMessage(this.materialCompleteString())
      this.notify()
    }
  }

  /** Review → re-capture the current phase (Redo). */
  redoCurrentPhase(): void {
    const phase = this.materialTapPhase
    this.redoSession() // drop the rejected phase's audio from the session WAV
    this.materialBuffer = []
    // Clear the redone phase's spectrum and identified peak, as Swift's redoCurrentPhase does.
    if (phase === 'reviewingL') {
      this.matSpectra = { ...this.matSpectra, longitudinal: null }
      this.selectedLongitudinalPeak = null
      this.materialTapPhase = 'capturingL'
      this.isAboveThreshold = this.lastChunkLevelDb > this.tapDetectionThreshold - this.hysteresisMargin
      this.warmupStartAudioTime = this.attachedDevice?.audioTime ?? 0
      this.detectionState = 'listening'
      this.setStatusMessage('Ready for fL tap — tap again')
    } else if (phase === 'reviewingC') {
      this.matSpectra = { ...this.matSpectra, cross: null }
      this.selectedCrossPeak = null
      this.materialTapPhase = 'capturingC'
      this.isAboveThreshold = this.lastChunkLevelDb > this.tapDetectionThreshold - this.hysteresisMargin
      this.warmupStartAudioTime = this.attachedDevice?.audioTime ?? 0
      this.detectionState = 'listening'
      this.setStatusMessage('Ready for fC tap — tap again')
    } else if (phase === 'reviewingFlc') {
      this.matSpectra = { ...this.matSpectra, flc: null }
      this.selectedFlcPeak = null
      this.materialTapPhase = 'capturingFlc'
      this.isAboveThreshold = this.lastChunkLevelDb > this.tapDetectionThreshold - this.hysteresisMargin
      this.warmupStartAudioTime = this.attachedDevice?.audioTime ?? 0
      this.detectionState = 'listening'
      this.setStatusMessage('Ready for fLC tap — tap again')
    }
    // Rebase the cumulative count to the taps completed in the PRIOR phases — redoing C keeps L's taps
    // counted, redoing FLC keeps L+C's (Swift redo: `currentTapCount = lCount` / `= lcCount`).
    this.currentTapCount = this.materialPhaseBase(this.materialTapPhase)
    this.tapProgress = this.currentTapCount / this.totalPlateTaps
    this.notify()
  }

  /** One gated tap's spectrum for the current phase. The analyzer owns the per-tap validity gate +
   *  count + re-arm + phase advance, mirroring Swift `finishGatedFFTCapture` +
   *  `handle{L,C,Flc}GatedProgress`.
   *  Runs the per-tap `findDominantPeak` validity check: a tap with no in-band resonance is rejected
   *  ("No resonance detected — tap again", re-arm the same phase, no count). A valid tap is buffered
   *  and counted; when the phase's tap count is reached, its taps are averaged + the peak found on the
   *  average, then the phase advances (review when live; auto-advance to the next phase when playing). */
  recordMaterialTap(spectrum: Spectrum): void {
    const ph: MaterialPhaseName =
      this.materialTapPhase === 'capturingC' ? 'cross' : this.materialTapPhase === 'capturingFlc' ? 'flc' : 'longitudinal'
    const search = this.matSearch(ph)
    const peak = this.findDominantPeak(
      spectrum.magnitudesDb,
      spectrum.frequencies,
      search.minHz,
      search.maxHz,
      search.preferLowestSignificant,
    )
    // No detectable resonance in the phase band → reject the tap and re-arm the SAME phase (no
    // count, no buffer). Mirrors Swift/Python `finishGatedFFTCapture`'s `dominantPeak == nil` branch.
    if (peak == null) {
      this.setStatusMessage('No resonance detected — tap again')
      this.reEnableDetectionForNextPlateTap()
      this.notify()
      return
    }
    this.materialBuffer.push(spectrum)
    // Cumulative across phases (Swift): prior phases' taps + this phase's buffered taps. The phase
    // machinery below keys on `materialBuffer.length` (the WITHIN-phase count), never on currentTapCount.
    this.currentTapCount = this.materialPhaseBase(this.materialTapPhase) + this.materialBuffer.length
    this.tapProgress = Math.min(1, this.currentTapCount / this.totalPlateTaps)
    const total = this.numberOfTaps
    if (this.materialBuffer.length < total) {
      // More taps for this phase — re-arm the same phase (Swift reEnableDetectionForNextPlateTap).
      this.setStatusMessage(`${matPhaseLabel(ph)} tap ${this.materialBuffer.length}/${total} captured. Tap again...`)
      this.reEnableDetectionForNextPlateTap()
      this.notify()
      return
    }
    // Phase complete: average the phase's taps + read the dominant peak off the AVERAGED spectrum (the
    // stored result value, pinned by REG-B1/P1/P2).
    const avg = this.averageSpectra(this.materialBuffer)
    const avgPeak = this.findDominantPeak(
      avg.magnitudesDb,
      avg.frequencies,
      search.minHz,
      search.maxHz,
      search.preferLowestSignificant,
    )
    this.materialBuffer = []
    this.advanceAfterPhase(ph, avg, avgPeak)
    this.notify()
  }

  /** Store a completed phase's averaged spectrum + peak, then advance: to review when live (the user
   *  Accepts/Redos), or auto-advance to the next phase when playing a file (arming it — the analyzer owns
   *  the L→C→FLC auto-advance, Swift `isPlayingFile`). Sets the phase's status string. */
  private advanceAfterPhase(ph: MaterialPhaseName, avg: Spectrum, avgPeak: ResonantPeak | null): void {
    const playing = this.attachedDevice?.playingFile ?? false
    const stored = avgPeak // a fresh peak (its own id) per phase, as Swift's findDominantPeak returns
    if (ph === 'longitudinal') {
      this.matSpectra = { ...this.matSpectra, longitudinal: avg }
      this.selectedLongitudinalPeak = stored
      if (settingsStore.get().measurementType === 'brace') {
        this.materialTapPhase = 'complete'
        this.isMeasurementComplete = true // Swift brace complete sets isMeasurementComplete (SpectrumCapture:1217)
        this.finishMaterialSession() // brace = single phase → session done
        this.setStatusMessage(this.materialCompleteString())
      } else if (playing) {
        this.materialTapPhase = 'capturingC'
        this.setStatusMessage('File: fL complete, capturing fC...')
        // The latch starts ABOVE, so the last tap's ring-out must fall before anything counts.
        this.isAboveThreshold = true
        this.detectionState = 'listening'
      } else {
        this.materialTapPhase = 'reviewingL'
        this.setStatusMessage(`fL: ${fHz(avgPeak)} Hz — Accept to continue or Redo to re-tap`)
      }
    } else if (ph === 'cross') {
      this.matSpectra = { ...this.matSpectra, cross: avg }
      this.selectedCrossPeak = stored
      if (playing) {
        if (settingsStore.get().measureFlc) {
          this.materialTapPhase = 'capturingFlc'
          this.setStatusMessage('File: fC complete, capturing fLC...')
          // The latch starts ABOVE, so the last tap's ring-out must fall before anything counts.
          this.isAboveThreshold = true
          this.detectionState = 'listening'
        } else {
          this.materialTapPhase = 'complete'
          this.isMeasurementComplete = true
          this.setStatusMessage(this.materialCompleteString())
        }
      } else {
        this.materialTapPhase = 'reviewingC'
        this.setStatusMessage(`fC: ${fHz(avgPeak)} Hz — Accept to continue or Redo to re-tap`)
      }
    } else {
      this.matSpectra = { ...this.matSpectra, flc: avg }
      this.selectedFlcPeak = stored
      if (playing) {
        this.materialTapPhase = 'complete'
        this.isMeasurementComplete = true
        this.setStatusMessage(this.materialCompleteString())
      } else {
        this.materialTapPhase = 'reviewingFlc'
        this.setStatusMessage(`fLC: ${fHz(avgPeak)} Hz — Accept to complete or Redo to re-tap`)
      }
    }
  }

  /** Back to notStarted + cleared (measurement-type change, cancel). */
  resetMaterial(): void {
    this.materialTapPhase = 'notStarted'
    this.clearMaterialPeaks()
    this.matSpectra = EMPTY_MAT_SPECTRA
    this.materialBuffer = []
    this.annotationOffsets = new Map() // drop dragged material labels
    this.isMeasurementComplete = false // clearing the material measurement clears its completion flag
    this.cancelSessionRecording() // abandon any partial session WAV
    this.notify()
  }

  /** Replace Store B — the Results-panel dimension editor. Mirrors Swift's
   *  `set: { analyzer.materialInputs = $0 }` binding in TapAnalysisResultsView. */
  setMaterialInputs(v: MaterialMeasurementInputs | null): void {
    this.materialInputs = v
    this.notify()
  }

  // ── Tap detection + gated capture ───────────────────────────────────────────────────────────
  // @parity state/tap-detection  tests=test/tap-decisions,test/status-message,test/audio-clock-timers
  // Swift keeps all of this on the analyzer: TapToneAnalyzer+TapDetection (the detector) and
  // +SpectrumCapture (the pre-roll ring, the capture window, the completion paths). The engine is
  // the microphone, the FFT primitive and the watchdogs — nothing more. The web draws the same line:
  // arming, detection state and the status strings all live here, on the analyzer.

  /** Hysteresis below the rising threshold; the latch only clears here. Swift `hysteresisMargin`. */
  readonly hysteresisMargin = 3.0
  /** Noise-floor EMA coefficient, material only. Swift `noiseFloorAlpha`. */
  readonly noiseFloorAlpha = 0.05
  /** Detection warm-up, in seconds of AUDIO. Swift `warmupPeriod`. */
  readonly warmupPeriod = 0.5
  /** The rest after a capture before detection re-arms, and the hold before the FLC phase arms, in
   *  seconds of AUDIO. Swift `tapCooldown`. */
  readonly tapCooldown = 0.5
  /** After the LAST guitar tap, "All taps captured. Processing..." shows for this much AUDIO before
   *  the taps are averaged. Swift `captureWindow`. */
  readonly captureWindow = 0.2
  /** Consecutive above-threshold chunks required to confirm a tap. */
  readonly confirmChunks = 2
  private readonly noiseFloorMinHeadroomDb = 10
  private readonly noiseFloorMinFallingHeadroomDb = 4

  /** The tap-detection threshold in dBFS, set from the settings store at construction and saved to it
   *  on every change, as Swift's `tapDetectionThreshold` and its didSet. Read by `detectTap` — absolute
   *  for guitar, the base of the relative rule for material. A change away from the loaded
   *  measurement's threshold ends the loaded-settings warning, as Swift's didSet. */
  private _tapDetectionThreshold = settingsStore.get().tapDetectionThreshold
  get tapDetectionThreshold(): number {
    return this._tapDetectionThreshold
  }
  set tapDetectionThreshold(v: number) {
    this._tapDetectionThreshold = v
    settingsStore.update({ tapDetectionThreshold: v })
    if (v !== this.loadedTapDetectionThreshold) this.showLoadedSettingsWarning = false
  }

  /** The threshold and tap count the loaded measurement carried — each set only when the file has it,
   *  as Swift's `loadedTapDetectionThreshold` / `loadedNumberOfTaps`. A change away from them ends
   *  the loaded-settings warning. */
  loadedTapDetectionThreshold: number | null = null
  loadedNumberOfTaps: number | null = null

  /** A gated capture window is filling. Swift `gatedCaptureActive`. */
  gatedCaptureActive = false

  // ── Hysteresis — mirrors Swift/Python `isAboveThreshold` ────────────────────────────────────────
  // A LATCH, and the gate on counting: it goes true when a tap is CONFIRMED and clears only at the
  // lower FALLING threshold, so the ring-out decay envelope cannot re-trigger a tap on its way down.
  // While it is up nothing counts, which is what makes the hysteresis real rather than advisory.
  //
  // One flag does both jobs, as in Swift and Python: with a separate edge flag clearing at RISING
  // while the latch clears at FALLING, a ring-out in the 3 dB between them would re-arm the detector.
  // The margin is `hysteresisMargin` (3.0 dB), the same in all three editions.

  // ── Noise-floor EMA — mirrors Swift/Python `noiseFloorEstimate` ─────────────────────────────────
  // Material (plate/brace) detects RELATIVE to the tracked ambient floor, not against a fixed dBFS
  // level. The rule reduces to `rising = max(threshold, noiseFloor + 10 dB)` — i.e. it is the absolute
  // threshold with a FLOOR under it, so it only differs once the room gets loud. That is what keeps
  // detection working when ambient noise is elevated; a fixed threshold simply saturates (the level
  // never drops below it, so no rising edge can ever be confirmed) and the app goes deaf.
  // Guitar stays absolute.

  // ── Detection warm-up — mirrors Swift/Python `warmupStartAudioTime` ─────────────────────────────
  // Value of the AUDIO clock when the sequence armed; detection is suppressed for WARMUP_SECONDS of
  // AUDIO after it. SILENT — it never writes a status message. Its real job is to
  // let the noise-floor EMA converge before the first tap is judged, and to re-anchor the floor to
  // real audio at exit. Measured on the audio clock, never the wall clock: the warm-up must cover the
  // first 0.5 s of AUDIO however long setup took. `null` = not armed / warm-up skipped.

  // Detector state (Swift TapToneAnalyzer+TapDetection).
  private isAboveThreshold = false
  /** The latest chunk's input level — Swift `fftAnalyzer.level.inputLevelDB`; seeds the latch at Accept/Redo. */
  private inputLevelDb = -100
  /** The audio clock as the analyzer has seen it: the audio time of the latest chunk to reach
   *  detection, recorded on every chunk before any guard. The tap-lifecycle timers run on THIS clock,
   *  not the wall clock: file playback advances audio at "real time + processing time", so a
   *  wall-clock delay would cover a different stretch of audio on a slower run and move late captures
   *  in a sequence. Swift `lastAudioTime`. */
  lastAudioTime = 0
  /** The level of that chunk — a re-arm that falls due re-anchors the latch from it. Swift
   *  `lastChunkLevelDB`. */
  private lastChunkLevelDb = -100
  /** Tap-lifecycle actions waiting on the audio clock — see `afterAudio`. Swift `pendingAudioActions`. */
  private pendingAudioActions: { due: number; releasedAtFileEnd: boolean; action: () => void }[] = []
  /** The WALL time (`wallClock`, seconds) at which the latest chunk reached `processAudioFrame` — what the
   *  capture safety timeout measures its silence from. Swift `lastChunkWallTime`. */
  private lastChunkWallTime = 0
  /** Identity of the current gated capture, so a stale safety timeout does nothing. Swift `gatedCaptureID`. */
  private gatedCaptureId = 0
  private consecutive = 0
  /** dB drop that defines "rung out". Swift `decayThreshold` (15). */
  decayThreshold = 15
  /** The EMA-tracked input noise floor (dBFS) the relative detector rises from. Swift/Python
   *  `noiseFloorEstimate` — readable, as there (the noisy-plate regression checks it converged). */
  noiseFloorEstimate = -60
  private justExitedWarmup = false
  private warmupStartAudioTime: number | null = null

  /** The most recent `preRollSamples` of audio, kept so a capture starts just before its trigger.
   *  Swift `preRollBuffer`. */
  private preRollBuffer: number[] = []
  /** The capture under way: seeded with the pre-roll when it opens, then each chunk appended until it
   *  holds `gatedCaptureSamples`. Swift `gatedAccumBuffer`. */
  private gatedAccumBuffer: number[] = []
  /** How many samples the capture under way takes: `gatedCaptureDuration` of audio for a plate or brace
   *  phase, one FFT window for a guitar. Swift `gatedCaptureSamples`. */
  private gatedCaptureSamples = 0
  /** The plate/brace phase the capture under way is for; null for a guitar's. Swift
   *  `gatedCapturePhase`. */
  private gatedCapturePhase: MaterialTapPhase | null = null
  private guitarTapCount = 0
  /** The rate of the audio feeding the gated capture. Mirrors Swift `mpmSampleRate`. */
  private mpmSampleRate = 48000

  // ── Continuous session recording (Swift TapToneAnalyzer+SpectrumCapture) ────────────────────
  // @parity dsp/session-recording tests=test/session-pre-roll
  // Swift keeps the whole session WAV on the analyzer: the buffer, the bounded pre-roll, the phase
  // checkpoints and the write. Web had it on the engine, which is why the first tap had to be
  // signalled across the seam; both live here now, so the latch freezes where the capture starts.

  private sessionSamples = new SampleBuffer()
  private sessionCheckpoints: number[] = []
  private sessionRecording = false
  private sessionActive = false
  private sessionRate = 48000
  private sessionPreRollActive = false

  /** Seconds of audio retained before the first tap (>= the 0.5 s warm-up, with margin).
   *  Swift `sessionPreRollDuration`. */
  static readonly SESSION_PRE_ROLL_SECONDS = 2.0

  /** SESSION_PRE_ROLL_SECONDS in samples at the current session rate (Swift sessionPreRollSamples). */
  private get sessionPreRollSamples(): number {
    return Math.round(this.sessionRate * TapToneAnalyzer.SESSION_PRE_ROLL_SECONDS)
  }

  // ── Continuous session recording (Swift TapToneAnalyzer session WAV) ────────
  /** Begin accumulating every pipeline chunk for the session WAV. Whether it is saved (`sessionActive`)
   *  is read from Dump Capture Audio here and again when the setting changes before the first tap; with
   *  it off only the bounded pre-roll is kept, and it is dropped at the first tap unless the setting has
   *  been turned on by then (Swift/Python). Guitar calls this from `arm()`; live material drives it from
   *  useMaterialSession. */
  startSessionRecording(): void {
    this.sessionSamples = new SampleBuffer()
    this.sessionCheckpoints = [0] // first-phase truncation anchor (Swift/Python seed [0] at start)
    this.sessionRate = this.attachedDevice?.sampleRate ?? 48000
    this.sessionActive = settingsStore.get().dumpCaptureAudio
    this.sessionRecording = true
    this.sessionPreRollActive = true // bound the pre-first-tap audio to ~2 s
    captureProbe.beginLiveSession(settingsStore.get().dumpCaptureAudio) // diagnostic
  }

  /** Mark a phase boundary (SAMPLE count) so a later redo can truncate the rejected phase's audio
   *  (Swift/Python sessionCheckpoints). */
  checkpointSession(): void {
    if (this.sessionActive) this.sessionCheckpoints.push(this.sessionSamples.length)
  }

  /** Redo the current phase: drop everything recorded since the last checkpoint (Swift redo truncation). */
  redoSession(): void {
    if (!this.sessionActive) return
    const cp = this.sessionCheckpoints[this.sessionCheckpoints.length - 1] ?? 0
    if (cp < this.sessionSamples.length) {
      this.sessionSamples.truncate(cp)
      // Redoing the FIRST phase empties the buffer back to the pre-first-tap state, so re-arm the
      // bounded pre-roll. Later phases keep the latch frozen. Mirrors Swift redoCurrentPhase.
      if (cp === 0) this.sessionPreRollActive = true
    }
  }

  /** Append one chunk to the session WAV buffer and maintain the bounded pre-roll.
   *
   *  Before the first tap (sessionPreRollActive): keep only the last ~2 s — the tap is always in
   *  the tail, so trimming the head never eats it; this just discards accumulated idle. The first
   *  capture freezes the latch; a sequence that is not being saved (Dump Capture Audio off) stops
   *  recording there and drops what it kept. Everything after — subsequent taps, plate
   *  phases, and the gaps between them — is completely live. Mirrors Swift maintainSessionRecording. */
  private maintainSessionRecording(s: Float32Array): void {
    if (!this.sessionRecording) return
    this.sessionSamples.append(s)
    if (!this.sessionPreRollActive) return // frozen after the first tap → fully live
    if (this.gatedCaptureActive) {
      // The first tap has started — freeze the pre-roll. The latch is owned HERE, as in Swift and
      // Python (`if gatedCaptureActive { sessionPreRollActive = false }`), so one rule has one owner.
      this.sessionPreRollActive = false
      if (!this.sessionActive) {
        this.sessionRecording = false
        this.sessionSamples = new SampleBuffer()
      }
    } else {
      const excess = this.sessionSamples.length - this.sessionPreRollSamples
      if (excess > 0) this.sessionSamples.dropFirst(excess)
    }
  }

  /** Finish the session: if the dump setting is on, download the accumulated audio (if any) as one WAV
   *  and name it in `captureAudioSaved`; then clear. Swift's analyzer calls its own dumpCaptureWAV
   *  helper here, gated on the dump setting. */
  finishSessionRecording(label: string): void {
    const wasActive = this.sessionActive
    this.sessionRecording = false
    this.sessionActive = false
    this.sessionPreRollActive = false
    const samples = this.sessionSamples
    const rate = this.sessionRate
    this.sessionSamples = new SampleBuffer()
    this.sessionCheckpoints = []
    if (!wasActive || samples.length === 0 || !settingsStore.get().dumpCaptureAudio) return
    this.captureAudioSaved = dumpCaptureWav(samples.toFloat32Array(), rate, `session_${label}`)
    const probeFile = captureProbe.liveRecordsFile(this.captureAudioSaved) // diagnostic; null in a released build
    if (probeFile) dumpCaptureProbe(probeFile)
    this.notify()
  }

  /** The user dismissed the "Capture audio saved" notice. */
  dismissCaptureAudioSaved(): void {
    if (this.captureAudioSaved === null) return
    this.captureAudioSaved = null
    this.notify()
  }

  /** Abandon the session without writing — cancel, a measurement-type change, or a loaded measurement or
   *  comparison that has replaced the sequence, which can no longer finish. Swift cancelSessionRecording. */
  cancelSessionRecording(): void {
    this.sessionRecording = false
    this.sessionActive = false
    this.sessionPreRollActive = false
    this.sessionSamples = new SampleBuffer()
    this.sessionCheckpoints = []
  }

  /** Apply a change of Dump Capture Audio to the sequence in progress. Called whenever the setting is
   *  changed (Swift applyDumpCaptureAudioSetting).
   *
   *  Turned on before the first tap: this sequence is saved. Only the pre-roll exists so far, and it has
   *  been kept, so the recording is the same as if the setting had been on when the sequence started.
   *  Turned on after the first tap: nothing changes; it takes effect when the next sequence starts (New
   *  Tap, Cancel, or anything else that starts one). Turned off: this sequence is not saved. After the
   *  first tap the recording stops and what it held is dropped; before it, the pre-roll is still kept in
   *  case it is turned on again. */
  applyDumpCaptureAudioSetting(): void {
    if (settingsStore.get().dumpCaptureAudio) {
      if (this.sessionPreRollActive && !this.sessionActive) {
        this.sessionActive = true
        captureProbe.beginLiveSession(true) // diagnostic
      }
    } else {
      this.sessionActive = false
      captureProbe.beginLiveSession(false) // diagnostic
      if (!this.sessionPreRollActive) {
        this.sessionRecording = false
        this.sessionSamples = new SampleBuffer()
      }
    }
  }

  /** Exclude a paused segment from the session WAV (Swift clears its flag in pauseTapDetection). */
  suspendSessionRecording(): void {
    this.sessionRecording = false
  }

  /** Resume accumulating into the session WAV after a pause — the saved recording, or the pre-roll
   *  before the first tap. */
  resumeSessionRecording(): void {
    if (this.sessionActive || this.sessionPreRollActive) this.sessionRecording = true
  }

  /** The audio pipeline hands every chunk here: the analyzer keeps the pre-roll, judges the level
   *  and fills the capture window. Swift's analyzer does the same from its FFT subscriber and the
   *  audio-queue level-crossing handler. */
  processAudioFrame(samples: Float32Array, levelDb: number, audioTime: number): void {
    this.inputLevelDb = levelDb
    slackTime('accumulate', () => this.accumulateGatedSamples(samples, this.attachedDevice?.sampleRate ?? this.mpmSampleRate))
    // The chunk reaches detection AFTER its samples fed the capture — as in Swift, where a filled
    // capture's finish is queued on the main thread ahead of the same chunk's level. So a finish sees
    // the audio clock at the end of the previous chunk, in every edition.
    //
    // Advance the analyzer's audio clock and run any lifecycle action this chunk makes due — before
    // the guards, since a re-arm is what turns detection back on. A chunk that made an action
    // due is not also detected on: a re-arm has just re-anchored the latch from it. Swift
    // `onRmsLevelChanged`.
    this.lastAudioTime = audioTime
    this.lastChunkLevelDb = levelDb
    this.lastChunkWallTime = this.wallClock.now()
    if (!this.runDueAudioActions()) {
      // Detection is off through a capture: a detected tap turns it off first, as Swift's and Python's
      // `handleTapDetection` does, and the capture's finish and the rest keep it off until the re-arm.
      if (this.isDetecting && !this.isDetectionPaused && !this.isMeasurementComplete) this.detectTap(levelDb, audioTime)
    }
  }

  // ── Audio-clock lifecycle timers — Swift afterAudio / runDueAudioActions ─────────────────────────

  /** Schedule `action` once the audio clock has advanced `delay` seconds past `lastAudioTime`. The tap
   *  lifecycle's delays — the rest before re-arming, the FLC hold, the capture window — run on this
   *  clock, never the wall clock. The action runs from `processAudioFrame`, on the first chunk
   *  whose audio time reaches the due time. Like Swift's, it cannot be cancelled; each action guards
   *  itself. `releasedAtFileEnd`: run it at once when file playback ends, if still pending — with no
   *  more audio the clock stops, and the capture window's processing would otherwise never run. A
   *  re-arm is not released: with no audio there is nothing to detect. */
  afterAudio(delay: number, action: () => void, releasedAtFileEnd = false): void {
    this.pendingAudioActions.push({ due: this.lastAudioTime + delay, releasedAtFileEnd, action })
  }

  /** Run, in scheduling order, every pending action whose due time `lastAudioTime` has reached.
   *  Returns true if any ran on this chunk. */
  private runDueAudioActions(): boolean {
    const due = this.pendingAudioActions.filter((a) => a.due <= this.lastAudioTime)
    if (due.length === 0) return false
    this.pendingAudioActions = this.pendingAudioActions.filter((a) => a.due > this.lastAudioTime)
    for (const a of due) a.action()
    return true
  }

  /** File playback has ended: run every pending action marked `releasedAtFileEnd` now, because the
   *  audio clock will not advance again to make it due. Called from the file-end flush. */
  private releaseAudioActionsAtFileEnd(): void {
    const released = this.pendingAudioActions.filter((a) => a.releasedAtFileEnd)
    this.pendingAudioActions = this.pendingAudioActions.filter((a) => !a.releasedAtFileEnd)
    for (const a of released) a.action()
  }

  /** Re-arm detection from the chunk that made a rest due: re-anchor the hysteresis latch from THAT
   *  chunk's level, then listen. Shared by the guitar and plate/brace rests. Swift
   *  `reArmFromCurrentChunk`. */
  private reArmFromCurrentChunk(): void {
    const falling = this.tapDetectionThreshold - this.hysteresisMargin
    this.isAboveThreshold = this.lastChunkLevelDb > falling
    this.detectionState = 'listening'
  }

  /** File playback has ended: finish any capture the file stopped filling — zero-padded to the window,
   *  as guitar OR material — then release what the ended audio clock can no longer make due (the
   *  capture window's processing). Called by the engine at file end (its `preMicRestartHandler`),
   *  as Swift's and Python's are, so a partial capture of either kind is kept. Swift
   *  `flushGatedCaptureOnFileEnd`. */
  flushGatedCaptureOnFileEnd(): void {
    try {
      if (!this.gatedCaptureActive) return
      this.gatedCaptureActive = false
      const partial = this.gatedAccumBuffer
      const phase = this.gatedCapturePhase
      this.gatedAccumBuffer = []
      if (partial.length === 0) return
      const samples = new Float32Array(Math.max(this.gatedCaptureSamples, partial.length))
      samples.set(partial)
      if (phase !== null) this.finishGatedFFTCapture(samples, this.mpmSampleRate, phase)
      else this.finishGuitarGatedCapture(samples, this.mpmSampleRate)
    } finally {
      this.releaseAudioActionsAtFileEnd()
    }
  }

  // @parity dsp/gated-capture tests=test/file-playback,test/tap-decisions,test/guitar-capture-window,test/self-regression
  /** The newest audio a capture's pre-roll keeps, in samples. Swift `preRollSamples`. */
  private get preRollSamples(): number {
    return Math.trunc(this.mpmSampleRate * TapToneAnalyzer.preRollDuration)
  }

  /** Every chunk of audio: the pre-roll keeps its newest `preRollSamples`, the session recording takes
   *  it, and a capture under way takes it — and, once it holds `gatedCaptureSamples`, is handed to the
   *  finisher for its phase. Swift `accumulateGatedSamples(_:sampleRate:)` (its audio-thread fast start
   *  and deferred pre-roll are the natives': their audio arrives on another thread than the capture
   *  start, where the web's audio and analyzer share one). */
  private accumulateGatedSamples(samples: Float32Array, sampleRate: number): void {
    this.mpmSampleRate = sampleRate
    for (let i = 0; i < samples.length; i++) this.preRollBuffer.push(samples[i]!)
    const excess = this.preRollBuffer.length - this.preRollSamples
    if (excess > 0) this.preRollBuffer.splice(0, excess)
    this.maintainSessionRecording(samples)
    if (!this.gatedCaptureActive) return
    for (let i = 0; i < samples.length; i++) this.gatedAccumBuffer.push(samples[i]!)
    if (this.gatedAccumBuffer.length < this.gatedCaptureSamples) return
    this.gatedCaptureActive = false
    const captured = Float32Array.from(this.gatedAccumBuffer.slice(0, this.gatedCaptureSamples))
    const phase = this.gatedCapturePhase
    this.gatedAccumBuffer = []
    if (phase !== null) this.finishGatedFFTCapture(captured, sampleRate, phase)
    else this.finishGuitarGatedCapture(captured, sampleRate)
  }

  /** Between taps of one plate/brace phase, and after a rejected tap: rest `tapCooldown` of AUDIO,
   *  then re-arm from the chunk that made the rest due. The warm-up and the noise floor are NOT
   *  restarted. Swift `reEnableDetectionForNextPlateTap`. */
  private reEnableDetectionForNextPlateTap(): void {
    const generation = this.captureGeneration
    this.afterAudio(this.tapCooldown, () => {
      if (generation !== this.captureGeneration) return
      this.reArmFromCurrentChunk()
      this.notify()
    })
  }

  /** Ends any capture in progress and drops what the sequence has gathered: the gate closes, the window's
   *  samples and the pre-roll go, the captured taps (guitar and material) go, the capture id resets — so a
   *  pending timeout finds its capture gone — and what a capture scheduled (its processing, the next tap's
   *  re-arm) does nothing when it comes due. New Tap and a load call it, so a capture under way when either
   *  happens cannot land after it. Swift `abandonCapture`. */
  abandonCapture(): void {
    this.captureGeneration += 1
    this.gatedCaptureActive = false
    this.gatedAccumBuffer = []
    this.preRollBuffer = []
    this.gatedCaptureId = 0
    this.capturedTaps = []
    this.materialBuffer = []
    this.guitarTapCount = 0
  }

  /** Pause detection while the live spectrum keeps flowing. Swift `pauseTapDetection()`. */
  pauseTapDetection(): void {
    if (this.detectionState !== 'listening') return
    this.detectionState = 'paused'
    this.suspendSessionRecording()
    this.setStatusMessage(TapToneAnalyzer.pausedStatus)
    this.notify()
  }

  /** Resume after a pause, continuing from the current tap count. Swift `resumeTapDetection()`. */
  resumeTapDetection(): void {
    if (this.detectionState !== 'paused') return
    // Swift `resumeTapDetection`: the warm-up restarts from now and the latch goes down; the noise floor
    // and the sync flag are left as they were. The tap counter restarts too, so a chunk counted before
    // the pause cannot help confirm a tap after it, as in Swift and Python.
    this.warmupStartAudioTime = this.attachedDevice?.audioTime ?? 0
    this.isAboveThreshold = false
    this.consecutive = 0
    this.detectionState = 'listening'
    this.resumeSessionRecording()
    this.setStatusMessage(this.armedPrompt())
    this.notify()
  }

  /** Apply the engine's per-bin calibration corrections — Swift reads
   *  `fftAnalyzer.calibrationCorrections` and applies them in finishGuitarGatedCapture. */
  private applyCalibration(spec: Spectrum): Spectrum {
    const corr = this.attachedDevice?.calibrationCorrections ?? null
    if (!corr || corr.length !== spec.magnitudesDb.length) return spec
    return { ...spec, magnitudesDb: spec.magnitudesDb.map((m: number, i: number) => m + corr[i]!) }
  }

  private detectTap(levelDb: number, audioTime: number): void {
    // Plate and brace detect relative to the noise floor — decided by the measurement type, as Swift's
    // `detectTap` does.
    const useRelative = settingsStore.get().measurementType === 'plate' || settingsStore.get().measurementType === 'brace'
    const threshold = this.tapDetectionThreshold

    // 1. Noise-floor EMA — only while below threshold, so a tap cannot inflate the floor.
    if (useRelative && !this.isAboveThreshold) {
      this.noiseFloorEstimate =
        this.noiseFloorAlpha * levelDb + (1 - this.noiseFloorAlpha) * this.noiseFloorEstimate
    }

    // 2. Effective thresholds.
    //    Guitar   — absolute (unchanged behaviour), now WITH a falling threshold it never had.
    //    Material — relative to the tracked floor. Note this reduces to
    //                   rising = max(threshold, noiseFloor + 10)
    //               so it IS the absolute rule until the room gets loud enough to lift the floor.
    let rising: number
    let falling: number
    if (useRelative) {
      const headroom = Math.max(threshold - this.noiseFloorEstimate, this.noiseFloorMinHeadroomDb)
      rising = this.noiseFloorEstimate + headroom
      falling =
        this.noiseFloorEstimate +
        Math.max(headroom - this.hysteresisMargin, this.noiseFloorMinFallingHeadroomDb)
    } else {
      rising = threshold
      falling = threshold - this.hysteresisMargin
    }

    // 3a. Warm-up — SILENT (it never writes a status message). Suppresses detection
    //     while the EMA converges, measured on the AUDIO clock against this chunk's timestamp.
    if (this.warmupStartAudioTime !== null && audioTime - this.warmupStartAudioTime < this.warmupPeriod) {
      this.justExitedWarmup = true // the NEXT frame is the first after warm-up
      return
    }

    // 3b. First frame after the warm-up: re-anchor the floor to real audio. The EMA may have been
    //     seeded before any audio arrived, and without this it can latch at a garbage value and the
    //     relative rule silently degrades to the absolute one.
    if (this.justExitedWarmup) {
      this.justExitedWarmup = false
      if (useRelative) {
        this.noiseFloorEstimate = levelDb
        const h = Math.max(threshold - this.noiseFloorEstimate, this.noiseFloorMinHeadroomDb)
        this.isAboveThreshold = levelDb > this.noiseFloorEstimate + h
      } else {
        this.isAboveThreshold = levelDb > rising
      }
      return // sync state only; do not detect on this frame
    }

    // 3c. Hysteresis + confirmation. `isAboveThreshold` latches at `rising` and only clears at the
    //     lower `falling`, so the ring-out decay cannot re-trigger. A tap additionally requires
    //     this.confirmChunks consecutive above-rising chunks, which rejects brief noise bumps.
    // `isAboveThreshold` is BOTH the hysteresis latch and the gate on counting, exactly as in Swift
    // and Python: while it is up, nothing counts and nothing can fire, so the signal must fall below
    // `falling` before another tap is possible. So between taps of a multi-tap sequence — capture
    // finished, signal not yet settled — a ring-out that decays past `rising` but never reaches
    // `falling` cannot re-arm the detector and have its next swing up taken as the following tap.
    if (this.isAboveThreshold) {
      if (levelDb <= falling) {
        this.isAboveThreshold = false
        this.consecutive = 0
      }
    } else if (levelDb > rising) {
      this.consecutive++
      if (this.consecutive >= this.confirmChunks) {
        this.isAboveThreshold = true
        this.consecutive = 0
        this.handleTapDetection()
      }
    } else {
      this.consecutive = 0
    }
  }

  // ── Ring-out ──────────────────────────────────────────────────────────────────────────────────
  // @parity dsp/decay tests=test/decay-tracking,test/guitar-capture-window
  // Swift TapToneAnalyzer+DecayTracking / Python tap_tone_analyzer_decay_tracking. The ring-out of a
  // guitar tap, from the samples of its FFT window. The level is the mean square over a window of
  // `ringOutWindowSamples` samples, taken at every sample from the tap's onset; the ring-out is the
  // time from the window where that level is highest to the first window after it whose level is
  // `decayThreshold` dB lower, interpolated between samples.
  //
  // The guitar window starts a fixed distance before the onset and its audio ends a fixed distance
  // after it, whichever chunk the trigger fired on — so, measured on it, the ring-out depends on the
  // tap alone, not on where the audio's chunk boundaries fell. Measured once per chunk, it could only
  // come out in whole chunks, and the same tap read a chunk apart. The window's audio lasts about
  // 1.16 s after the onset; a ring-out longer than that is not measured.

  /** The number of samples the ring-out level is measured over. Swift `ringOutWindowSamples`. */
  static readonly ringOutWindowSamples = 1024

  /** The ring-out time of the audio in `samples[start, end)`, in seconds — or null if there is too
   *  little audio, it is silent, or its level does not fall by `threshold` dB before `end`.
   *
   *  The energy of every `ringOutWindowSamples`-sample window from `start`, from a running sum of the
   *  squares (in order, from `start`); the peak is the first window with the most energy; the crossing
   *  is the first window after it with less than the peak's energy `threshold` dB lower, interpolated
   *  in dB from the window before it. Swift `ringOutTime(_:from:to:sampleRate:threshold:)`. */
  static ringOutTime(samples: ArrayLike<number>, start: number, end: number, sampleRate: number,
                     threshold: number): number | null {
    const window = TapToneAnalyzer.ringOutWindowSamples
    end = Math.min(end, samples.length)
    if (start < 0 || sampleRate <= 0 || end - start <= window) return null

    const sums = new Float64Array(end - start + 1)
    let total = 0
    for (let k = start; k < end; k++) {
      const x = samples[k]!
      total += x * x
      sums[k - start + 1] = total
    }
    const windows = end - start - window + 1
    const energy = (i: number): number => sums[i + window]! - sums[i]!

    let peak = 0
    for (let i = 1; i < windows; i++) if (energy(i) > energy(peak)) peak = i
    const peakEnergy = energy(peak)
    if (!(peakEnergy > 0)) return null

    const target = peakEnergy * Math.pow(10, -threshold / 10)
    let crossing = -1
    for (let i = peak + 1; i < windows; i++) {
      if (energy(i) < target) { crossing = i; break }
    }
    if (crossing < 0) return null

    const before = energy(crossing - 1), after = energy(crossing)
    const fraction = after > 0
      ? (Math.log10(before) - Math.log10(target)) / (Math.log10(before) - Math.log10(after))
      : 0
    return (crossing - 1 - peak + fraction) / sampleRate
  }

  private armWarmup(skip: boolean): void {
    this.warmupStartAudioTime = skip ? (this.attachedDevice?.audioTime ?? 0) - (this.warmupPeriod + 0.1) : (this.attachedDevice?.audioTime ?? 0)
    this.justExitedWarmup = false
    // Mirrors Swift startTapSequence's `isAboveThreshold = skipWarmup`. With the warm-up running,
    // the post-warm-up sync frame sets the latch from the first real level; when it is SKIPPED there
    // is no such frame, so the detector starts latched and a tap needs a genuine fall first.
    this.isAboveThreshold = skip
    // Seed the floor from the current input level, as Swift's startTapSequence does; the warm-up's EMA
    // converges it and the warm-up's exit re-anchors it. -100 when the warm-up is skipped (guitar file
    // playback), where the floor is never read.
    this.noiseFloorEstimate = skip ? -100 : this.inputLevelDb
  }

  /** A confirmed tap: detection goes off first — it stays off through the capture and the rest — then
   *  the tap is routed by capture kind. Swift `handleTapDetection(magnitudes:frequencies:time:)`:
   *  a guitar tap shows "capturing" and opens the guitar capture, whose window gives both its spectrum
   *  and its ring-out; a plate/brace tap goes to `handlePlateTapDetection`. */
  private handleTapDetection(): void {
    this.detectionState = 'idle'
    if (!this.isGuitar) {
      this.handlePlateTapDetection()
      return
    }
    this.setStatusMessage(this.guitarLoopStatus(true))
    this.startGuitarGatedCapture()
  }

  /** Route a plate/brace tap to its phase's gated capture. Swift `handlePlateTapDetection`: a tap in a
   *  capturing phase opens the capture; one in any other phase (not started, reviewing, complete) is
   *  ignored with a warning. Detection is already off — `handleTapDetection` turned it off. */
  private handlePlateTapDetection(): void {
    const phase = this.materialTapPhase
    switch (phase) {
      case 'capturingL':
      case 'capturingC':
      case 'capturingFlc':
      case 'waitingForFlcTap':
        this.startGatedCapture(phase)
        return
      default:
        console.warn(`⚠️ Unexpected tap in plate phase: ${phase}`)
    }
  }

  // @parity dsp/gated-capture tests=test/file-playback,test/tap-decisions,test/guitar-capture-window,test/self-regression
  /** Open a plate/brace gated capture — `gatedCaptureDuration` of audio, seeded with the pre-roll — for
   *  `phase`. Swift `startGatedCapture(phase:)`, with its safety timeout: once NO audio has arrived for
   *  2 s, finish whatever arrived, or with nothing, say so and rest before re-arming (T6). On the WALL
   *  clock, since it exists for when the audio STOPS, and measured from the LAST chunk, so it never fires
   *  while audio is merely slow. */
  private startGatedCapture(phase: MaterialTapPhase): void {
    // A capture already filling absorbs the tap — Swift guards the same re-entry, comparing capture ids
    // because its window can start on the audio queue and finish before the main thread runs.
    if (this.gatedCaptureActive) return
    this.gatedCaptureId += 1
    const myCaptureId = this.gatedCaptureId
    this.gatedAccumBuffer = this.preRollBuffer.slice()
    this.gatedCapturePhase = phase
    this.gatedCaptureSamples = Math.trunc(this.mpmSampleRate * TapToneAnalyzer.gatedCaptureDuration)
    this.gatedCaptureActive = true // (the session WAV's pre-roll freezes on the next chunk — maintainSessionRecording)
    this.afterAudioStall(MATERIAL_CAPTURE_SAFETY_MS / 1000, () => myCaptureId === this.gatedCaptureId && this.gatedCaptureActive, () => {
      this.gatedCaptureActive = false
      const partial = Float32Array.from(this.gatedAccumBuffer)
      this.gatedAccumBuffer = []
      if (partial.length > 0) {
        this.finishGatedFFTCapture(partial, this.mpmSampleRate, phase)
      } else {
        this.setStatusMessage('No signal detected — tap again')
        this.reEnableDetectionForNextPlateTap()
        this.notify()
      }
    })
  }

  /** Open a guitar gated capture — one FFT window of audio, seeded with the pre-roll. Swift
   *  `startGuitarGatedCapture()`, with its safety timeout: once NO audio has arrived for the window plus
   *  0.5 s, finish whatever arrived, or with nothing, say so and rest before re-arming (T6, as above). */
  private startGuitarGatedCapture(): void {
    if (this.gatedCaptureActive) return
    const fftSize = this.attachedDevice?.fftSize ?? GUITAR_FFT_SIZE
    this.gatedCaptureId += 1
    const myCaptureId = this.gatedCaptureId
    this.gatedAccumBuffer = this.preRollBuffer.slice()
    this.gatedCapturePhase = null // null = the guitar marker, as Swift's nil
    this.gatedCaptureSamples = fftSize
    this.gatedCaptureActive = true
    const timeoutMs = (fftSize / Math.max(this.mpmSampleRate, 1)) * 1000 + GUITAR_CAPTURE_SAFETY_EXTRA_MS
    this.afterAudioStall(timeoutMs / 1000, () => myCaptureId === this.gatedCaptureId && this.gatedCaptureActive && this.gatedCapturePhase === null, () => {
      this.gatedCaptureActive = false
      const partial = Float32Array.from(this.gatedAccumBuffer)
      this.gatedAccumBuffer = []
      if (partial.length > 0) {
        this.finishGuitarGatedCapture(partial, this.mpmSampleRate)
      } else {
        this.setStatusMessage('No signal detected — tap again')
        this.scheduleGuitarReEnable()
        this.notify()
      }
    })
  }

  /** Run `action` once NO audio has arrived for `interval` seconds of WALL time; stops checking once
   *  `relevant()` is false. Swift `afterAudioStall`. */
  private afterAudioStall(interval: number, relevant: () => boolean, action: () => void): void {
    this.wallClock.after(interval, () => {
      if (!relevant()) return
      const quiet = this.wallClock.now() - this.lastChunkWallTime
      if (quiet >= interval) action()
      else this.afterAudioStall(interval - quiet, relevant, action)
    })
  }

  // ── The gated capture's alignment and peak selection ──────────────────────────────────────────
  // @parity dsp/gated-capture tests=test/file-playback,test/tap-decisions,test/guitar-capture-window,test/self-regression
  // @parity dsp/gated-fft tests=test/gated-fft
  // Swift keeps these on the analyzer (TapToneAnalyzer statics and +SpectrumCapture), as does Python,
  // and so does the web. The gated TRANSFORM is the engine's `computeGatedFFT`, as Swift's is its FFT
  // analyzer's.

  /** The material capture window, in seconds — longer than `gatedFFTWindowDuration` so the aligner has
   *  room to find the onset. Swift `gatedCaptureDuration`. */
  static readonly gatedCaptureDuration = 0.5
  /** The gated FFT window, in seconds. Swift `gatedFFTWindowDuration`. */
  static readonly gatedFFTWindowDuration = 0.4
  /** Silence kept before the onset, in seconds. Swift `preOnsetDuration`. */
  static readonly preOnsetDuration = 0.1
  /** Audio kept before the trigger, in seconds — the pre-roll ring's length. Swift `preRollDuration`. */
  static readonly preRollDuration = 0.2

  /**
   * How many samples of a guitar tap's FFT window are audio; the rest of the window, to fftSize, is
   * always zeros.
   *
   * A guitar capture is fftSize samples beginning the pre-roll before the trigger, and
   * `alignCaptureToOnset` starts the window `preOnsetDuration` before the onset — so the window
   * starts up to (pre-roll − pre-onset) into the capture, depending on how long after the onset the
   * trigger's chunk boundary fell, and that many samples short of its end the capture runs out.
   * Ending the audio that margin before the window's end, always, makes the window the same samples
   * wherever the boundary fell: the same tap gives the same spectrum on every run and in every
   * edition. What is left out is the last tenth of a second of a 1.4-second window.
   *
   * Mirrors Swift `guitarWindowAudioSamples(sampleRate:)`.
   *
   * @param sampleRate The capture's sample rate in Hz.
   * @returns The number of leading samples of the window that are audio.
   */
  guitarWindowAudioSamples(sampleRate: number): number {
    const margin =
      Math.round(sampleRate * TapToneAnalyzer.preRollDuration) - Math.round(sampleRate * TapToneAnalyzer.preOnsetDuration)
    return (this.attachedDevice?.fftSize ?? GUITAR_FFT_SIZE) - Math.max(0, margin)
  }
  /** Samples at the start of a capture used to estimate its noise. Swift `onsetNoiseEstimateSamples`. */
  static readonly onsetNoiseEstimateSamples = 2048
  /** The onset is the first sample above this multiple of the noise RMS. Swift `onsetThresholdMultiplier`. */
  static readonly onsetThresholdMultiplier = 10.0
  /** The onset threshold's floor, for digital silence. Swift `onsetMinThreshold`. */
  static readonly onsetMinThreshold = 0.001
  /** Samples the onset is moved back, to keep the attack. Swift `onsetBackupSamples`. */
  static readonly onsetBackupSamples = 32
  /** Samples left between the noise re-measured before the tap and the tap's first sample above the
   *  threshold, so the measured stretch holds none of the tap's own rise. Swift `onsetNoiseGuardSamples`. */
  static readonly onsetNoiseGuardSamples = 256
  /** How many times the onset may be found again from the noise just before it. It settles in one or
   *  two. Swift `onsetRefinementPasses`. */
  static readonly onsetRefinementPasses = 4

  /**
   * Re-anchor a captured buffer so the tap onset sits at a fixed index, making the FFT input independent
   * of level-crossing chunk boundaries. Swift `alignCaptureToOnset(_:windowSize:preOnsetSamples:)`:
   * estimate the noise from the first `onsetNoiseEstimateSamples`, set the onset threshold at
   * `onsetThresholdMultiplier` × that RMS (floored at `onsetMinThreshold`), scan for the first sample
   * above it; measure the noise again just before that sample and scan again, until the sample stops
   * moving; back up `onsetBackupSamples`, then extract `windowSize` samples with the onset at
   * `preOnsetSamples` — zero-padding either edge if it does not fit.
   * @param samples Raw captured buffer (pre-roll + post-crossing).
   * @param windowSize Output length (e.g. 19200 = 400 ms at 48 kHz).
   * @param preOnsetSamples Silence samples to keep before the onset (100 ms).
   * @returns A `windowSize` buffer anchored at the onset (the buffer's start, zero-padded, if it is too
   *   short or no onset is found).
   */
  alignCaptureToOnset(samples: Float32Array | Float64Array | number[], windowSize: number, preOnsetSamples: number): Float64Array {
    const T = TapToneAnalyzer
    const n = samples.length
    const out = new Float64Array(windowSize)
    const copyInto = (srcStart: number, dstStart: number, count: number) => {
      for (let k = 0; k < count; k++) out[dstStart + k] = samples[srcStart + k] as number
    }
    if (n < T.onsetNoiseEstimateSamples) {
      copyInto(0, 0, Math.min(n, windowSize))
      return out
    }
    // The onset threshold for a stretch of noise: 10× its RMS, floored for digital silence.
    const thresholdForNoiseAt = (start: number): number => {
      let sumSq = 0
      for (let i = start; i < start + T.onsetNoiseEstimateSamples; i++) sumSq += (samples[i] as number) ** 2
      return Math.max(Math.sqrt(sumSq / T.onsetNoiseEstimateSamples) * T.onsetThresholdMultiplier, T.onsetMinThreshold)
    }
    const firstSampleAbove = (threshold: number): number => {
      for (let i = 0; i < n; i++) if (Math.abs(samples[i] as number) > threshold) return i
      return -1
    }
    // A first estimate: the noise at the start of the buffer, and the first sample above its threshold.
    let onset = firstSampleAbove(thresholdForNoiseAt(0))
    if (onset < 0) {
      copyInto(0, 0, Math.min(n, windowSize))
      return out
    }
    // Then the noise is measured again just before the tap, and the onset found again, until it stops
    // moving. Where the buffer starts depends on the chunk boundary the trigger fired on, so the noise
    // at its start is a different stretch of audio from one capture of a tap to another, and its
    // threshold can put the onset a sample or two apart. The noise just before the tap is the same
    // stretch whichever capture it is. Mirrors Swift alignCaptureToOnset.
    for (let pass = 0; pass < T.onsetRefinementPasses; pass++) {
      const noiseStart = onset - T.onsetNoiseGuardSamples - T.onsetNoiseEstimateSamples
      if (noiseStart < 0) break
      const refined = firstSampleAbove(thresholdForNoiseAt(noiseStart))
      if (refined < 0 || refined === onset) break
      onset = refined
    }
    onset = Math.max(0, onset - T.onsetBackupSamples)
    const extractStart = onset - preOnsetSamples
    if (extractStart >= 0 && extractStart + windowSize <= n) {
      copyInto(extractStart, 0, windowSize)
    } else if (extractStart < 0) {
      const pad = -extractStart
      const avail = Math.min(windowSize - pad, n)
      copyInto(0, pad, avail)
    } else {
      const avail = Math.min(windowSize, n - extractStart)
      copyInto(extractStart, 0, avail)
    }
    return out
  }

  // ── Peak analysis (Swift TapToneAnalyzer+PeakAnalysis) ──────────────────────────────────────

  /** Peaks closer than this (Hz) are one resonance; the louder is kept. Swift `peakProximityHz`. */
  static readonly peakProximityHz = 2.0
  /** The fixed detection floor (dB): capture finds peaks down to this, and Peak Min is applied
   *  afterwards as a display projection. Swift `peakDetectionFloor`. */
  static readonly peakDetectionFloor = -100

  /**
   * Find every significant spectral peak within the analysis range. Swift
   * `findPeaks(magnitudes:frequencies:minHz:maxHz:peakMinOverride:)`.
   *
   * **Detection only — this knows nothing about guitar modes.** A single sweep over the spectrum in
   * ascending frequency order: each bin is visited once and mints at most one peak, so two peaks can
   * never describe the same spectral feature. Classification and mode claiming belong to
   * `classifyAll`, which works on the returned list — where each peak has one identity and is claimed
   * once. Do not reintroduce mode-band awareness here.
   *
   * Each accepted peak's frequency and magnitude are refined by parabolic interpolation, and its Q
   * comes from the −3 dB bandwidth.
   * @param magnitudes Magnitude spectrum, in dB.
   * @param frequencies Bin centre frequencies, in Hz (same length as `magnitudes`).
   * @param options `minHz` / `maxHz` (default the analyzer's `minFrequency` / `maxFrequency`), and
   *   `peakMinOverride` (default the analyzer's `peakMinThreshold`).
   * @returns Detected peaks, sorted by descending magnitude.
   */
  // @parity dsp/peak-analysis
  findPeaks(
    magnitudes: SpectrumValues,
    frequencies: SpectrumValues,
    options: { minHz?: number; maxHz?: number; peakMinOverride?: number } = {},
  ): ResonantPeak[] {
    const n = magnitudes.length
    if (n !== frequencies.length) return []

    const windowSize = 5 // look at ±5 bins around each point
    const loFreq = options.minHz ?? this.minFrequency
    const hiFreq = options.maxHz ?? this.maxFrequency
    const firstIndex = (pred: (f: number) => boolean): number | null => {
      for (let i = 0; i < n; i++) if (pred(frequencies[i] as number)) return i
      return null
    }
    const startIdx = firstIndex((f) => f >= loFreq) ?? 0
    const endIdx = firstIndex((f) => f > hiFreq) ?? n - 1

    const effectiveThreshold = options.peakMinOverride ?? this.peakMinThreshold

    // The ±windowSize local-maximum test needs that many neighbours on each side.
    const scanStart = startIdx + windowSize
    const scanEnd = endIdx - windowSize
    if (scanStart >= scanEnd) return []

    const peaks: ResonantPeak[] = []
    for (let i = scanStart; i < scanEnd; i++) {
      const magnitude = magnitudes[i] as number
      if (!(magnitude > effectiveThreshold)) continue
      let isLocalMax = true
      for (let offset = -windowSize; offset <= windowSize; offset++) {
        if (offset === 0) continue
        if ((magnitudes[i + offset] as number) >= magnitude) {
          isLocalMax = false
          break
        }
      }
      if (!isLocalMax) continue
      peaks.push(this.makePeak(i, magnitudes, frequencies))
    }

    // Two adjacent bins can still resolve to interpolated vertices within peakProximityHz of one
    // another; collapse those, keeping the louder.
    return this.removeDuplicatePeaks(peaks).sort((a, b) => b.magnitude - a.magnitude)
  }

  /** A peak at bin `index`: interpolated frequency and magnitude, Q and bandwidth, and pitch. Swift `makePeak(at:)`. */
  private makePeak(index: number, magnitudes: SpectrumValues, frequencies: SpectrumValues): ResonantPeak {
    const { frequency, magnitude } = this.parabolicInterpolate(magnitudes, frequencies, index)
    const { quality, bandwidth } = this.calculateQFactor(magnitudes, frequencies, index, magnitude)
    return makeResonantPeak({
      frequency,
      magnitude,
      quality,
      bandwidth,
      pitchNote: this.pitchCalculator.note(frequency),
      pitchCents: this.pitchCalculator.cents(frequency),
      pitchFrequency: this.pitchCalculator.freq0(frequency),
    })
  }

  /**
   * Collapse near-coincident peaks: within `peakProximityHz` of an existing entry, keep the louder;
   * otherwise append. First-seen order is preserved. Swift `removeDuplicatePeaks(_:)`.
   * @param peaks Peaks in any order.
   * @returns The peaks with near-duplicates removed.
   */
  removeDuplicatePeaks(peaks: ResonantPeak[]): ResonantPeak[] {
    const unique: ResonantPeak[] = []
    const tolerance = TapToneAnalyzer.peakProximityHz
    for (const peak of peaks) {
      const existing = unique.findIndex((e) => Math.abs(e.frequency - peak.frequency) < tolerance)
      if (existing === -1) unique.push(peak)
      else if (peak.magnitude > unique[existing]!.magnitude) unique[existing] = peak
    }
    return unique
  }

  /**
   * Refine a bin-level peak with a parabola through the bin and its two neighbours (α left, β centre,
   * γ right): `δ = 0.5(α−γ)/(α−2β+γ)`, `f = f_bin + δ·Δf`, `A = β − 0.25(α−γ)·δ`. An edge bin, or a flat
   * top (denominator ≈ 0), returns the raw bin. Swift `parabolicInterpolate(magnitudes:frequencies:peakIndex:)`.
   * @param magnitudes Magnitude spectrum, in dB.
   * @param frequencies Bin centre frequencies, in Hz.
   * @param i Index of the local-maximum bin.
   * @returns The interpolated `{ frequency, magnitude }`.
   */
  parabolicInterpolate(
    magnitudes: SpectrumValues,
    frequencies: SpectrumValues,
    i: number,
  ): { frequency: number; magnitude: number } {
    if (!(i > 0 && i < magnitudes.length - 1)) {
      return { frequency: frequencies[i] as number, magnitude: magnitudes[i] as number }
    }
    const val = magnitudes[i] as number
    const lval = magnitudes[i - 1] as number
    const rval = magnitudes[i + 1] as number
    const denom = lval - 2 * val + rval
    // Avoid division by near-zero (flat top — the bin is already accurate).
    if (!(Math.abs(denom) > 1e-6)) return { frequency: frequencies[i] as number, magnitude: val }
    const delta = (0.5 * (lval - rval)) / denom
    const binWidth = (frequencies[i] as number) - (frequencies[i - 1] as number)
    return { frequency: (frequencies[i] as number) + delta * binWidth, magnitude: val - 0.25 * (lval - rval) * delta }
  }

  /**
   * Q factor and −3 dB bandwidth: walk outward from `peakIndex` until the magnitude first drops below
   * `peakMagnitude − 3 dB`; `bandwidth = f_upper − f_lower`, `Q = f_centre / bandwidth`. Swift
   * `calculateQFactor(magnitudes:frequencies:peakIndex:peakMagnitude:)`.
   * @param magnitudes Magnitude spectrum, in dB.
   * @param frequencies Bin centre frequencies, in Hz.
   * @param peakIndex Index of the peak bin.
   * @param peakMagnitude Reference magnitude (the interpolated peak), in dB.
   * @returns `{ quality, bandwidth }`; both 0 when an index is out of bounds.
   */
  calculateQFactor(
    magnitudes: SpectrumValues,
    frequencies: SpectrumValues,
    peakIndex: number,
    peakMagnitude: number,
  ): { quality: number; bandwidth: number } {
    const threshold = peakMagnitude - 3.0
    let lowerIdx = peakIndex
    while (lowerIdx > 0 && (magnitudes[lowerIdx] as number) > threshold) lowerIdx--
    let upperIdx = peakIndex
    while (upperIdx < magnitudes.length - 1 && (magnitudes[upperIdx] as number) > threshold) upperIdx++
    if (!(peakIndex < frequencies.length && lowerIdx < frequencies.length && upperIdx < frequencies.length)) {
      return { quality: 0, bandwidth: 0 }
    }
    const bandwidth = (frequencies[upperIdx] as number) - (frequencies[lowerIdx] as number)
    const quality = bandwidth > 0 ? (frequencies[peakIndex] as number) / bandwidth : 0
    return { quality, bandwidth }
  }

  /**
   * Select the dominant resonance from a gated-FFT spectrum. Swift
   * `findDominantPeak(magnitudes:frequencies:minHz:maxHz:preferLowestSignificant:)`.
   *
   * Step 1 — candidates: local maxima above the median (noise floor) of the search range, each scored
   * with magnitude (dB), an order-3 HPS (`linear[i]·linear[2i]·linear[3i]`), and a −3 dB-bandwidth Q.
   * Step 2 — selection: drop candidates with Q below 3 (impact thuds / noise). If
   * `preferLowestSignificant` (plate longitudinal/FLC phases), take the lowest-frequency candidate within
   * 6 dB of the strongest; otherwise the strongest wins unless a lower-frequency candidate is within 6 dB
   * and has an HPS within one order of magnitude (prefers the fundamental over harmonics). The winner is
   * refined by parabolic interpolation.
   *
   * @returns The best peak, or null if no candidate clears the noise floor.
   */
  findDominantPeak(
    magnitudesDb: number[],
    frequencies: number[],
    minHz: number,
    maxHz: number,
    preferLowestSignificant = false,
  ): ResonantPeak | null {
    const n = magnitudesDb.length
    if (n !== frequencies.length || n <= 10) return null
    const startIdx = frequencies.findIndex((f) => f >= minHz)
    let endIdx = frequencies.findIndex((f) => f > maxHz)
    if (endIdx < 0) endIdx = n
    if (startIdx < 0 || startIdx >= endIdx) return null

    const WINDOW = 5
    const searchMags = magnitudesDb.slice(startIdx, endIdx).sort((a, b) => a - b)
    const noiseFloor = searchMags[Math.floor(searchMags.length / 2)]!
    const linear = magnitudesDb.map((m) => 10 ** (Math.max(m, -160) / 20))

    interface Cand { index: number; magnitude: number; hps: number; q: number }
    const candidates: Cand[] = []
    for (let i = startIdx + WINDOW; i < endIdx - WINDOW; i++) {
      const mag = magnitudesDb[i]!
      if (mag <= noiseFloor) continue
      let isLocal = true
      for (let off = -WINDOW; off <= WINDOW; off++) {
        if (off === 0) continue
        if (magnitudesDb[i + off]! >= mag) {
          isLocal = false
          break
        }
      }
      if (!isLocal) continue
      let hps = linear[i]!
      for (const k of [2, 3]) {
        const h = i * k
        if (h < n) hps *= linear[h]!
      }
      const { quality } = this.calculateQFactor(magnitudesDb, frequencies, i, mag)
      candidates.push({ index: i, magnitude: mag, hps, q: quality })
    }
    if (candidates.length === 0) return null

    const minQ = 3.0
    const highQ = candidates.filter((c) => c.q >= minQ)
    const pool = highQ.length > 0 ? highQ : candidates
    const byMag = [...pool].sort((a, b) => b.magnitude - a.magnitude)
    const strongest = byMag[0]!

    let best: Cand
    if (preferLowestSignificant) {
      const thr = strongest.magnitude - 6.0
      best = pool.filter((c) => c.magnitude >= thr).reduce((a, b) => (b.index < a.index ? b : a))
    } else {
      let current = strongest
      for (const c of byMag.slice(1)) {
        if (c.index >= current.index) continue
        if (current.magnitude - c.magnitude < 6.0 && c.hps >= current.hps * 0.1) current = c
      }
      best = current
    }

    const { frequency, magnitude } = this.parabolicInterpolate(magnitudesDb, frequencies, best.index)
    const { quality, bandwidth } = this.calculateQFactor(magnitudesDb, frequencies, best.index, magnitude)
    return makeResonantPeak({
      frequency,
      magnitude,
      quality,
      bandwidth,
      pitchNote: this.pitchCalculator.note(frequency),
      pitchCents: this.pitchCalculator.cents(frequency),
      pitchFrequency: this.pitchCalculator.freq0(frequency),
    })
  }

  /** A material (plate/brace) gated capture is complete: compute its gated spectrum and record the tap
   *  for `phase`. Mirrors Swift/Python `finishGatedFFTCapture(samples:sampleRate:phase:)` — public, as
   *  there, so tests drive the same production path the audio does. The analyzer owns the
   *  per-tap validity gate, the tap count, the re-arm and the L→C→FLC advance (recordMaterialTap). */
  finishGatedFFTCapture(samples: Float32Array, sampleRate: number, phase: MaterialTapPhase): void {
    // Align to the sample-level onset, then the calibrated gated transform — Swift's
    // `alignCaptureToOnset` → `fftAnalyzer.computeGatedFFT`. With no engine attached (tests) an engine
    // with no calibration gives the bare transform, which is the same thing.
    const aligned = this.alignCaptureToOnset(
      samples,
      Math.round(sampleRate * TapToneAnalyzer.gatedFFTWindowDuration),
      Math.round(sampleRate * TapToneAnalyzer.preOnsetDuration),
    )
    // Diagnostic for cross-edition material multi-tap differences: fingerprint the buffer on both
    // sides of the alignment step. Inert unless captureProbe.enabled. Mirrors Swift's
    // CaptureProbe.record call in the material capture.
    captureProbe.record(samples, aligned)
    const { magnitudesDb, frequencies } = (this.attachedDevice ?? new RealtimeFFTAnalyzer()).computeGatedFFT(aligned, sampleRate)
    // Disarm BEFORE recording, so the analyzer's re-arm (guarded on state !== 'capturing') isn't
    // blocked; during file playback the next phase is armed synchronously from here.
    this.gatedCaptureActive = false
    this.detectionState = 'idle'
    this.recordMaterialTap({ magnitudesDb, frequencies })
  }

  /** A guitar gated capture is complete: align it to the tap onset, compute its spectrum, record the
   *  tap — then rest through the tap cooldown and re-arm, or, after the last tap, average.
   *
   *  Mirrors Swift/Python `finishGuitarGatedCapture(samples:sampleRate:)` — public, with the same job
   *  and the same timing: before the next tap, detection stops for `tapCooldown` (0.5 s) and then
   *  re-anchors the latch from the current level; after the last tap, "All taps captured.
   *  Processing..." shows for `captureWindow` (0.2 s) before the taps are averaged. Both waits run on
   *  the audio clock.
   *
   *  The capture window is aligned to the sample-level tap onset so chunk-boundary differences (live
   *  vs file playback) don't shift the FFT input. */
  finishGuitarGatedCapture(samples: Float32Array, sampleRate: number): void {
    const fftSize = this.attachedDevice?.fftSize ?? GUITAR_FFT_SIZE
    const preOnsetSamples = Math.round(sampleRate * TapToneAnalyzer.preOnsetDuration)
    const aligned = this.alignCaptureToOnset(samples, fftSize, preOnsetSamples)
    // The window's audio ends at a fixed length, and zeros follow: where the capture ran out depends
    // on the trigger's chunk boundary, and the window must not. Mirrors Swift finishGuitarGatedCapture.
    const audioSamples = this.guitarWindowAudioSamples(sampleRate)
    aligned.fill(0, audioSamples)
    // Diagnostic for capture-window alignment: fingerprint the buffer on both sides of the alignment
    // step, so a cross-edition comparison can say whether the editions captured the same samples,
    // aligned them differently, or differ only in the arithmetic afterwards. Inert unless
    // captureProbe.enabled. Mirrors Swift finishGuitarGatedCapture's CaptureProbe.record call.
    captureProbe.record(samples, aligned)
    // The live path's rectangular window and fftSize, so the spectrum is bin-compatible with the live
    // frames (Swift `fftAnalyzer.computeFFT(on: chunk)`), then the input's calibration.
    const engine = this.attachedDevice ?? new RealtimeFFTAnalyzer()
    const spectrum = this.applyCalibration({ magnitudesDb: engine.computeFFT(aligned), frequencies: engine.frequencies })
    this.gatedCaptureActive = false
    this.guitarTapCount += 1
    this.recordGuitarTap(spectrum)
    // The tap's own peaks, shown until the next tap or the average: all selected, classified — as Swift's
    // finishGuitarGatedCapture.
    const tapPeaks = this.findPeaks(spectrum.magnitudesDb, spectrum.frequencies, { peakMinOverride: TapToneAnalyzer.peakDetectionFloor })
    this.peaks = tapPeaks
    this.selectedPeakIds = new Set(tapPeaks.map((p) => p.id))
    this.modeByPeak = classifyAll(tapPeaks, this.guitarType)
    this.refreshDisplayedPeaks()
    // The ring-out, from the window's audio: from the onset to where the audio ends. Mirrors Swift
    // finishGuitarGatedCapture.
    this.setDecayTime(TapToneAnalyzer.ringOutTime(aligned, preOnsetSamples, Math.min(audioSamples, aligned.length),
      sampleRate, this.decayThreshold))
    this.tapProgress = Math.min(1, this.currentTapCount / this.numberOfTaps)

    const total = this.numberOfTaps
    // A tap was captured: stop listening until the cooldown re-arms (Swift leaves `listening` here).
    this.detectionState = 'idle'
    if (this.guitarTapCount < total) {
      this.setStatusMessage(this.guitarLoopStatus(false)) // Swift SpectrumCapture:742
      this.scheduleGuitarReEnable()
      this.notify()
      return
    }

    this.guitarTapCount = 0
    this.finishSessionRecording(`Guitar_${total}tap`) // write the continuous session WAV (dump-gated)
    this.setStatusMessage('All taps captured. Processing...')
    this.notify()
    // `captureWindow` of AUDIO. Released at file end: when the last capture ends with the file,
    // the audio clock stops and would never make it due.
    const generation = this.captureGeneration
    this.afterAudio(this.captureWindow, () => {
      if (generation === this.captureGeneration) this.processMultipleTaps()
    }, true)
  }

  /** Re-arm guitar detection after the rest: `tapCooldown` of AUDIO, then the latch is
   *  re-anchored from the chunk that made the rest due. After each captured tap of a multi-tap
   *  sequence, and when a capture timed out with no audio. Swift `scheduleGuitarReEnable`. */
  private scheduleGuitarReEnable(): void {
    const generation = this.captureGeneration
    this.afterAudio(this.tapCooldown, () => {
      if (generation !== this.captureGeneration) return
      this.reArmFromCurrentChunk()
      this.notify()
    })
  }

  // ── React external-store seam (D2: immutable snapshot) ─────────────────────
  // App subscribes via useSyncExternalStore(subscribe, getSnapshot). getSnapshot returns a frozen
  // snapshot that is referentially stable until a mutation calls notify() (Object.is short-circuits
  // React). Only the audio-driven setters below notify — the direct-field transitions above are used
  // by the unit tests (which don't subscribe), and by later 3c phases which will route through here.
  private listeners = new Set<() => void>()
  private cachedSnapshot: TapToneSnapshot | null = null
  // The settings the cached snapshot was built under. The store hands out a new object on every change,
  // so a settings change rebuilds the snapshot at the next read — the view re-reads what depends on a
  // setting when it redraws, as Swift's views re-read the analyzer's computed values.
  private snapshotSettings: Settings | null = null
  // Referentially-stable frozen spectrum: rebuilt only when frozenMagnitudes is reassigned (never
  // mutated in place), so downstream memos keyed on snapshot.frozenSpectrum don't churn on unrelated
  // notifies (e.g. currentTapCount ticks during live detection). tapSpectra is likewise reassigned-only.
  private frozenSrc: number[] | null = null
  private frozenSpectrumCache: Spectrum | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private frozenSpectrum(): Spectrum | null {
    if (this.frozenMagnitudes !== this.frozenSrc) {
      this.frozenSrc = this.frozenMagnitudes
      this.frozenSpectrumCache =
        this.frozenMagnitudes.length > 0
          ? { magnitudesDb: this.frozenMagnitudes, frequencies: this.frozenFrequencies }
          : null
    }
    return this.frozenSpectrumCache
  }

  getSnapshot = (): TapToneSnapshot => {
    if (this.cachedSnapshot === null || this.snapshotSettings !== settingsStore.get()) {
      this.snapshotSettings = settingsStore.get()
      this.cachedSnapshot = Object.freeze({
        detectionState: this.detectionState,
        isSettling: this.isSettling,
        isDetecting: this.isDetecting,
        isDetectionPaused: this.isDetectionPaused,
        isPlayingFile: this.isPlayingFile,
        hasResultToSaveOrExport: this.hasResultToSaveOrExport,
        playingFileName: this.attachedDevice?.playingFileName ?? null,
        resultProvenance: this.resultProvenance,
        isReadyForDetection: this.isReadyForDetection,
        isMeasurementComplete: this.isMeasurementComplete,
        currentTapCount: this.currentTapCount,
        numberOfTaps: this.numberOfTaps,
        totalPlateTaps: this.totalPlateTaps,
        tapProgress: this.tapProgress,
        materialTapPhase: this.materialTapPhase,
        measurementType: settingsStore.get().measurementType,
        isGuitar: this.isGuitar,
        frozenSpectrum: this.frozenSpectrum(),
        tapEntries: this.tapEntries,
        peaks: this.peaks,
        peaksAbovePeakMin: this.peaksAbovePeakMin,
        peakMinThreshold: this.peakMinThreshold,
        modeByPeak: this.modeByPeak,
        overrides: this.overrides,
        annotationVisibilityMode: this.annotationVisibilityMode,
        visiblePeaks: this.visiblePeaks,
        chartPeaks: this.chartPeaks,
        chartAnnotationPeaks: this.chartAnnotationPeaks,
        showsModeBoundaries: this.showsModeBoundaries,
        annotationOffsets: this.annotationOffsets,
        selectedPeakIds: this.selectedPeakIds,
        userModifiedSelection: this.userModifiedSelection,
        highlightedPeakId: this.highlightedPeakId,
        canReanalyze: this.canReanalyze,
        matSpectra: this.matSpectra,
        selectedLongitudinalPeak: this.selectedLongitudinalPeak,
        selectedCrossPeak: this.selectedCrossPeak,
        selectedFlcPeak: this.selectedFlcPeak,
        materialIdentifiedPeaks: this.materialIdentifiedPeaks,
        gatedCaptureActive: this.gatedCaptureActive,
        materialInputs: this.materialInputs,
        displayMode: this.displayMode,
        comparisonEntries: this.comparisonEntries,
        showingMultiTapComparison: this.showingMultiTapComparison,
        isSavedMeasurementComparison: this.isSavedMeasurementComparison,
        statusMessage: this.statusMessage,
        isClipping: this.isClipping,
        inputAppearsDead: this.inputAppearsDead,
        notRunningMessage: this.attachedDevice?.notRunningMessage ?? 'Starting...',
        captureAudioSaved: this.captureAudioSaved,
        materialPeaksFromLoad: this.materialPeaksFromLoad,
        sequenceStarts: this.sequenceStarts,
        showLoadedSettingsWarning: this.showLoadedSettingsWarning,
        loadedMeasurementName: this.loadedMeasurementName,
        loadedNotes: this.loadedNotes,
        sourceMeasurementTimestamp: this.sourceMeasurementTimestamp,
        loadedAxisRange: this.loadedAxisRange,
        microphoneWarning: this.microphoneWarning,
        microphoneWarningTitle: this.microphoneWarningTitle,
        currentDecayTime: this.currentDecayTime,
        savedMeasurements: this.savedMeasurements,
        libraryLoadFailure: this.libraryLoadFailure,
      })
    }
    return this.cachedSnapshot
  }

  // ── Display-mode transitions ────────────────────────────────────────────────────────────────
  // One method per transition Swift and Python perform, so the set is comparable line for line:
  //   loadComparison      Swift MeasMgmt:992  · Python :1163  — empty data ⇒ 'live'
  //   clearComparison     Swift :1046         · Python :1177  — what a load, New Tap and the per-tap overlay off call
  //   applyMultiTapComparisonOverlays(true/false)  Swift :1134 / :1073 · Python :969 / :895

  // @parity model/measurement-management tests=test/measurement-load,test/import-persistence,test/comparison
  /** Overlay saved measurements. An EMPTY list leaves the mode 'live', matching
   *  `comparisonSpectra.isEmpty ? .live : .comparison` — the mode follows the data. */
  /** Compare saved measurements: one entry per measurement with a spectrum — its label (made unique
   *  with " (2)" …), a series colour by position, its selected peaks, and its definitive Air/Top/Back
   *  resolved from the measurement itself (selection and overrides) — then shown as an overlay. Mirrors
   *  Swift `loadComparison(measurements:)`, which builds the entries in the analyzer. */
  loadComparison(measurements: TapToneMeasurementModel[]): void {
    // An unsaved comparison has no date of its own: its exports use the time of export.
    this.sourceMeasurementTimestamp = null
    this.resultProvenance = null // a comparison has no microphone of its own
    // Clear any active multi-tap comparison so the Taps button and per-tap table are hidden when the
    // saved-measurement comparison is displayed.
    this.tapEntries = []
    this.showingMultiTapComparison = false
    const withSnapshots = measurements.filter((m) => m.spectrumSnapshot)
    const baseLabels = withSnapshots.map((m) => m.measurementName?.trim() || formatDisplayDateCompact(m.timestamp))
    const counts = new Map<string, number>()
    for (const label of baseLabels) counts.set(label, (counts.get(label) ?? 0) + 1)
    const occurrence = new Map<string, number>()
    const labels = baseLabels.map((label) => {
      if ((counts.get(label) ?? 0) <= 1) return label
      occurrence.set(label, (occurrence.get(label) ?? 0) + 1)
      return `${label} (${occurrence.get(label)})`
    })
    this.comparisonEntries = withSnapshots.map((m, i) => {
      const snapshot = m.spectrumSnapshot!
      const selected = effectiveSelectedPeakIDs(m)
      return {
        id: newId(),
        label: labels[i]!,
        colorComponents: storedComponents(seriesRole(i)),
        snapshot,
        peaks: m.peaks.filter((p) => selected.has(p.id)),
        guitarType: snapshot.guitarType,
        sourceMeasurementID: m.id,
        modePeakIDs: comparisonModeIDMap(m),
      }
    })
    this.loadedMeasurementName = null
    this.loadedNotes = null
    // A comparison spans its entries' ranges, whatever was shown before.
    const spanned = spanningRange(withSnapshots.map((m) => m.spectrumSnapshot!))
    if (spanned) this.loadedAxisRange = spanned
    this.displayMode = this.comparisonEntries.length === 0 ? 'live' : 'comparison'
    // An overlay is frozen, exactly like a loaded measurement — so stand the detector down, as
    // loadMeasurement does for the same reason. Empty data means we stayed live, so there is nothing to
    // freeze and nothing to disarm.
    if (this.comparisonEntries.length > 0) {
      this.detectionState = 'idle'
      this.abandonCapture()
      this.cancelSessionRecording()
    }
    this.notify()
  }

  /** The current measurement's tap comparison — the entries its report and its saved form show, from
   *  the one builder ({@link measurementMultiTapComparisonEntries}). What the on-screen per-tap overlay
   *  draws. Swift `applyMultiTapComparisonOverlays`. */
  multiTapComparisonEntries(view: ChartView): ComparisonEntryModel[] {
    const m = this.buildMeasurement('', '', view)
    return m ? measurementMultiTapComparisonEntries(m) : []
  }

  /** Ends a comparison: its overlay entries go, and the chart is live. The one place a comparison ends — a
   *  load, New Tap, and turning the per-tap overlay off call it. Swift `clearComparison`. */
  clearComparison(): void {
    this.comparisonEntries = []
    this.displayMode = 'live'
    this.notify()
  }

  /** The per-tap overlay of the CURRENT measurement. Enabling enters 'comparison'; disabling
   *  returns to 'live' — the measurement itself still displays, because it is complete. */
  applyMultiTapComparisonOverlays(enabled: boolean): void {
    this.showingMultiTapComparison = enabled
    if (!enabled) {
      // Leave comparison; the chart goes back to the averaged spectrum on its own, because the
      // measurement is complete.
      this.clearComparison()
      return
    }
    if (this.tapEntries.length === 0) {
      this.notify()
      return
    }
    // The measurement's tap comparison — the same entries its report and its saved form show — as the
    // comparison the chart draws, built at the saved range, as Swift's makeMeasurement() builds it.
    const s = settingsStore.get()
    this.comparisonEntries = this.multiTapComparisonEntries({
      minHz: minFrequency(s, settingsStore.get().measurementType),
      maxHz: maxFrequency(s, settingsStore.get().measurementType),
      minDb: s.minDb,
      maxDb: s.maxDb,
    })
    this.displayMode = 'comparison'
    this.notify()
  }

  /** True for the saved-measurement overlay, false for the per-tap overlay, even though both are
   *  `displayMode === 'comparison'`. Mirrors Swift `isSavedMeasurementComparison` and Python
   *  `is_saved_measurement_comparison`. Use wherever the two sub-types must behave differently —
   *  save routing, export routing, annotation suppression. */
  get isSavedMeasurementComparison(): boolean {
    return this.displayMode === 'comparison' && !this.showingMultiTapComparison
  }

  private notify(): void {
    this.cachedSnapshot = null
    this.listeners.forEach((l) => l())
  }

  // ── Status-message helpers (mirror Python `_set_status_message` / `_set_clipping`) ─────────────
  // Every real status write goes through setStatusMessage: it stashes `latestRealStatus` and displays
  // the message UNLESS clipping is active (then the warning stays pinned). setClipping swaps the display
  // to the warning and, when it clears, restores `latestRealStatus`. Callers notify (setStatusMessage
  // does not) so multi-field transitions render once.
  private setStatusMessage(msg: string): void {
    this.latestRealStatus = msg
    this.applyStatusOverrides()
  }

  /** Resolves the displayed status against the active input-condition overrides.
   *
   *  One place decides precedence — the microphone permission refused, then an input that could not
   *  be started, then one that could not be restarted, then dead input, then
   *  clipping, then whatever the analyzer last set — so the overrides cannot fight each other or leave a stale warning on screen after its
   *  condition clears. Dead input outranks clipping: a dead input cannot also be clipping, and "no
   *  audio" is the more actionable message. Mirrors Swift `applyStatusOverrides()` and Python
   *  `_apply_status_overrides()`. */
  private applyStatusOverrides(): void {
    this.statusMessage = this.microphonePermissionDenied
      ? MICROPHONE_ACCESS_WARNING
      : this.inputCouldNotStart
      ? COULD_NOT_START_WARNING
      : this.inputCouldNotRestart
      ? COULD_NOT_RESTART_WARNING
      : this.inputAppearsDead
      ? DEAD_INPUT_WARNING
      : this.isClipping
        ? CLIPPING_WARNING
        : this.latestRealStatus
  }

  /** Edge-triggered input clipping, from the device's input level (Swift `fftAnalyzer.level.$isClipping`
   *  sink / Python `level.clippingChanged` → `_set_clipping`). Overrides the status with the warning, restores on clear. */
  setClipping(clipping: boolean): void {
    if (clipping === this.isClipping) return
    this.isClipping = clipping
    this.applyStatusOverrides()
    this.notify()
  }

  /** The device forwards its dead-input watchdog here (Swift `fftAnalyzer.$inputAppearsDead` sink /
   *  Python `_set_input_appears_dead`). Raises the "no audio input" warning over the status while the
   *  engine reports a silent input, and restores the status when it clears, as both natives do. */
  setInputAppearsDead(dead: boolean): void {
    if (dead === this.inputAppearsDead) return
    this.inputAppearsDead = dead
    this.applyStatusOverrides()
    this.notify()
  }

  /** The device forwards a start failing for anything but the permission here (Swift
   *  `fftAnalyzer.$inputCouldNotStart` sink / Python `_set_input_could_not_start`). Raises its warning
   *  over the status, just below the permission's, and restores the status when it clears. */
  setInputCouldNotStart(failed: boolean): void {
    if (failed === this.inputCouldNotStart) return
    this.inputCouldNotStart = failed
    this.applyStatusOverrides()
    this.notify()
  }

  /** The device forwards the microphone permission being refused here (Swift
   *  `fftAnalyzer.$microphonePermissionDenied` sink / Python `_set_microphone_permission_denied`). Raises
   *  its warning over the status, above every other, and restores the status when it clears. */
  setMicrophonePermissionDenied(denied: boolean): void {
    if (denied === this.microphonePermissionDenied) return
    this.microphonePermissionDenied = denied
    this.applyStatusOverrides()
    this.notify()
  }

  /** The device forwards its recovery giving up after failed restarts here (Swift
   *  `fftAnalyzer.$inputCouldNotRestart` sink / Python `_set_input_could_not_restart`). Raises its warning
   *  over the status, above the dead input, and restores the status when it clears. */
  setInputCouldNotRestart(failed: boolean): void {
    if (failed === this.inputCouldNotRestart) return
    this.inputCouldNotRestart = failed
    this.applyStatusOverrides()
    this.notify()
  }

  /** The user acknowledged the microphone warning — it has been read, so it ends here. Mirrors
   *  Swift, where the alert's OK button and its binding both clear `microphoneWarning`, and Python's
   *  `_on_microphone_warning_changed` clearing after the modal. */
  clearMicrophoneWarning(): void {
    if (this.microphoneWarning === null) return
    this.microphoneWarning = null
    this.notify()
  }

  /** Write the ring-out value and tell the view. Swift writes its `@Published currentDecayTime`
   *  directly; the web's snapshot needs the notify. */
  private setDecayTime(decayTime: number | null): void {
    if (decayTime === this.currentDecayTime) return
    this.currentDecayTime = decayTime
    this.notify()
  }

  // ── Status derivation ──────────────────────────────────────────────────────────────────────────

  /** The guitar resting prompt (post-warm-up steady state) — the single source for the "Tap the
   *  guitar…" / "Tap the guitar N times…" strings. Mirrors Swift `tapPrompt()` and Python `_tap_prompt()`. */
  tapPrompt(): string {
    return this.numberOfTaps === 1 ? 'Tap the guitar...' : `Tap the guitar ${this.numberOfTaps} times...`
  }

  /** The status shown while a sequence is PAUSED. One literal, used by `pauseTapDetection()` and by
   *  `statusAfterSettle()` so a device change cannot silently reword a paused sequence. Mirrors Swift
   *  `pausedStatus` and Python `PAUSED_STATUS`. */
  static readonly pausedStatus = 'Detection paused – tap freely, then resume'

  /** The prompt for an ARMED analyzer, whatever it is measuring — guitar count-aware, material
   *  phase-aware. Mirrors Swift `armedPrompt()` and Python `_armed_prompt()`. */
  armedPrompt(): string {
    if (this.isGuitar) return this.guitarLoopStatus(false)
    return this.materialArmPrompt()
  }

  /** The prompt a material (plate/brace) sequence shows while armed and waiting in its CURRENT phase —
   *  the single source for these strings.
   *
   *  Three callers, which is the point: `startTapSequence` (which sets the phase before the status),
   *  the phase advances in `acceptCurrentPhase`, and `armedPrompt()`. All three say the same words for
   *  a phase, so resuming or changing the tap count never rewords the instruction the user is
   *  following. Mirrors Swift `materialArmPrompt()` and Python `_material_arm_prompt()`.
   *
   *  The fL branch is count-aware, because that is the phase whose prompt names the tap count and the
   *  only phase where the Taps control is still unlocked. */
  materialArmPrompt(): string {
    switch (this.materialTapPhase) {
      case 'capturingC':
        return 'Rotate 90° and tap for fC'
      case 'capturingFlc':
      case 'waitingForFlcTap':
        return 'Set up for fLC tap, then tap'
      default: {
        // capturingL / notStarted. "fL", not "L", for plate as well.
        if (this.numberOfTaps <= 1) return 'Ready for fL tap'
        if (settingsStore.get().measurementType !== 'plate') return `Ready for fL tap (×${this.numberOfTaps})`
        const phases = settingsStore.get().measureFlc ? 'L, C, FLC' : 'L, C'
        return `Ready for fL tap (×${this.numberOfTaps} each for ${phases})`
      }
    }
  }

  /** The status to restore when a device/route-change settle ends — or `null` to leave the current
   *  status alone.
   *
   *  The status is a function of state, so it is derived rather than chosen from fixed strings:
   *  mid-sequence it counts the taps already captured, and a finished measurement keeps "Analysis
   *  complete! N peaks…". It says nothing at all where the status is a RESULT announcement rather than
   *  a live prompt, because a completed or loaded measurement's status is not re-derivable and must
   *  not be thrown away. Mirrors Swift `statusAfterSettle()` and Python `_status_after_settle()`. */
  statusAfterSettle(): string | null {
    if (this.isMeasurementComplete) return null   // "Analysis complete…" / "Loaded measurement…"
    if (this.displayMode === 'comparison') return null  // an overlay is not a tap prompt
    if (this.isDetectionPaused) return TapToneAnalyzer.pausedStatus
    if (this.isDetecting) {
      // A material phase prompt is an INSTRUCTION tied to a transition that already happened —
      // "Rotate 90° and tap for fC" — not a description of the state the analyzer is in. It is
      // therefore not re-derivable here: after a device swap the user has already rotated the plate,
      // and a redo's "Ready for fC tap — tap again" is a different, equally correct string for the
      // same phase. Preserve it, exactly as a completed measurement's announcement is preserved.
      // Guitar's prompt IS a function of count and total, both of which the analyzer holds, so it is
      // still derived.
      if (!this.isGuitar) return null
      return this.armedPrompt()
    }
    return 'Ready'
  }

  /** The status to show when a settle ends, given what the status said before it began.
   *
   *  The whole decision in one pure function, so every edition can pin it: derive from state, and
   *  where the state's status is a result announcement rather than a prompt, put back what was there —
   *  so the "Audio device changed - reinitializing…" transient never stays up on a completed
   *  measurement. Mirrors Swift `restoredStatus(before:)` and Python `_restored_status()`. */
  restoredStatus(before: string): string {
    return this.statusAfterSettle() ?? before
  }

  /** Guitar detection-loop status derived from the current state. `capturing` false → the resting
   *  prompt (count 0) or the between-taps "…captured. Tap again…"; true → the in-progress "Tap n/N
   *  capturing…" or, on the final tap, "All taps captured. Processing…". Mirrors Swift
   *  `guitarLoopStatus(capturing:)` and Python `_guitar_loop_status()`. */
  guitarLoopStatus(capturing: boolean): string {
    const total = this.numberOfTaps
    const count = this.currentTapCount
    if (capturing) {
      const prov = Math.min(count + 1, total)
      return prov < total ? `Tap ${prov}/${total} capturing...` : 'All taps captured. Processing...'
    }
    return count === 0 ? this.tapPrompt() : `Tap ${count}/${total} captured. Tap again...`
  }

  /** Material completion string: plate without FLC shows fL + fC; otherwise a generic complete. */
  private materialCompleteString(): string {
    if (settingsStore.get().measurementType !== 'brace' && !settingsStore.get().measureFlc) {
      return `Complete — fL: ${fHz(this.selectedLongitudinalPeak)} Hz, fC: ${fHz(this.selectedCrossPeak)} Hz`
    }
    return 'Complete - check Results'
  }

  // ── Audio-device-driven setters (the RealtimeFFTAnalyzer drives these; each notifies) ──────────
  setNumberOfTaps(n: number): void {
    this.numberOfTaps = n
    // A tap-count change while armed and waiting for the first tap refreshes the prompt ("Tap the
    // guitar N times…"), mirroring Swift numberOfTaps.didSet. (No-op mid-capture / when complete:
    // completion sets detectionState to idle in all three editions, so isDetecting covers it.)
    if (this.isDetecting && this.currentTapCount === 0) {
      this.setStatusMessage(this.armedPrompt())
    }
    // A count other than the loaded measurement's means its settings no longer describe what is on
    // screen. Mirrors Swift numberOfTaps.didSet.
    if (n !== this.loadedNumberOfTaps) this.showLoadedSettingsWarning = false
    this.notify()
  }


  setComplete(v: boolean): void {
    this.isMeasurementComplete = v // uses the didSet (clears the loaded-settings warning)
    this.notify()
  }

  // @parity state/route-change-settle tests=test/notification
  /** Responds to an engine restart on a device change. Stands the detector down, re-anchors the
   *  warm-up and blanks a live chart; then, once 3 s of AUDIO have passed since the change (the FFT
   *  window refilled with the new device's audio, plus margin for its startup transient) and the next
   *  FFT frame has arrived, re-anchors the level latch from that frame, unblanks, sets readiness, puts
   *  detection back to listening if it was, and restores the status. A later change inside the settle
   *  supersedes this one's restore, so the settle always ends 3 s after the last change. Mirrors Swift
   *  `handleRouteChangeRestart()`. */
  handleRouteChangeRestart(): void {
    const wasDetecting = this.detectionState === 'listening'
    // The change that begins a settle decides whether its end re-arms; a later change inside it finds
    // the detector already stood down.
    if (this.detectingBeforeSettle === null) this.detectingBeforeSettle = wasDetecting

    // New Tap and Resume are disabled while reinitialising. Stand the detector down only if it was
    // listening: a sequence paused before the change must still be paused after it.
    this.isReadyForDetection = false
    if (wasDetecting) this.detectionState = 'idle'

    // The new engine session starts its warm-up afresh.
    this.warmupStartAudioTime = this.attachedDevice?.audioTime ?? 0

    // Hold the latch up so the first frame cannot fire a false rising edge; the settle's end
    // re-anchors it.
    this.isAboveThreshold = true

    // Blank the chart only if a LIVE spectrum is on screen — a completed or loaded measurement keeps
    // its result.
    const wasShowingLive = !this.isMeasurementComplete && this.displayMode !== 'comparison'
    if (wasShowingLive) {
      this.isSettling = true
      // Clear the peak annotations so they don't float on a blank chart during the settle.
      this.peaks = []
      this.modeByPeak = new Map()
      this.refreshDisplayedPeaks()
    }

    // Remember what the status said BEFORE the transient replaces it: statusAfterSettle() returns null
    // for the states whose status is a result announcement rather than a prompt, and "leave it alone"
    // means restoring THIS. `latestRealStatus`, NOT `statusMessage`: the latter is the
    // OVERRIDE-RESOLVED string, and a clipping or dead-input warning fed back as the real status would
    // outlive its condition. The settle's end clears it, so a value already here means a settle is in
    // flight and the change that began it captured the real status.
    if (this.statusBeforeSettle === null) this.statusBeforeSettle = this.latestRealStatus
    this.setStatusMessage('Audio device changed - reinitializing...')

    this.routeChangeGeneration += 1
    const generation = this.routeChangeGeneration
    this.afterAudio(3.0, () => {
      if (generation !== this.routeChangeGeneration || !this.attachedDevice?.running) return
      // Wait for the next FFT frame, so the re-anchor and the unblanking happen on the first frame
      // the user sees.
      this.afterNextFrame((peakMagnitude) => {
        if (generation !== this.routeChangeGeneration) return
        this.isAboveThreshold = peakMagnitude > this.tapDetectionThreshold
        if (wasShowingLive) this.isSettling = false
        this.isReadyForDetection = true
        if (this.detectingBeforeSettle) this.detectionState = 'listening'
        this.detectingBeforeSettle = null
        // Derive the status from the state we are now in; where that is a result announcement rather
        // than a prompt, put back what was there before the settle.
        this.setStatusMessage(this.restoredStatus(this.statusBeforeSettle ?? 'Ready'))
        this.statusBeforeSettle = null
        this.notify()
      })
    })
    this.notify()
  }
}

/** Immutable view of the lifecycle facts App reads via useSyncExternalStore. */
export interface TapToneSnapshot {
  detectionState: DetectionState
  /** True while a device change settles — the chart shows nothing. */
  isSettling: boolean
  /** Derived from `detectionState`, as on the analyzer — Swift's views read the same two. */
  isDetecting: boolean
  isDetectionPaused: boolean
  /** A file is playing through the device. */
  isPlayingFile: boolean
  /** Save and the exports are enabled only when this holds (see the analyzer's getter). */
  hasResultToSaveOrExport: boolean
  /** The file being played or last played, for the chart title; null once a new sequence starts. */
  playingFileName: string | null
  /** Where the current result came from when it is not the live input (see the analyzer's field). */
  resultProvenance: TapToneAnalyzer['resultProvenance']
  /** False while the input is reinitialising after a device change — disables New Tap. */
  isReadyForDetection: boolean
  isMeasurementComplete: boolean
  /** Taps captured so far. Guitar: 0…numberOfTaps. Material: CUMULATIVE across phases, 0…totalPlateTaps. */
  currentTapCount: number
  numberOfTaps: number
  /** Total taps across all phases of the material sequence (brace: n; plate: n×2, or n×3 with FLC). */
  totalPlateTaps: number
  /** currentTapCount / (numberOfTaps | totalPlateTaps), clamped to 1 — the status-bar progress bar. */
  tapProgress: number
  materialTapPhase: MaterialTapPhase
  measurementType: MeasurementType
  isGuitar: boolean
  /** Frozen guitar result (averaged capture or loaded measurement); null while live/not complete. */
  frozenSpectrum: Spectrum | null
  /** Per-tap entries (snapshot + peaks + auto-selection) for the multi-tap comparison view ([] unless a multi-tap result). */
  tapEntries: TapEntry[]
  /** The DURABLE guitar peak set, found at the -100 dB floor — what selection and the save path read. */
  peaks: ResonantPeak[]
  /** The Peak-Min display projection of `peaks` (material passes through unfiltered). What the peak
   *  list, the chart dots and the live ratio read. Never the set to save. */
  peaksAbovePeakMin: ResonantPeak[]
  /** The Peak Min display threshold the projection was computed at. */
  peakMinThreshold: number
  /** Mode classification for `peaks`, keyed by peak id. */
  modeByPeak: Map<Uuid, ResolvedMode>
  /** Manual mode-label overrides, keyed by peak `id` (analyzer-owned). */
  overrides: Map<Uuid, string>
  /** Which peaks are annotated: all, the selected ones, or none. */
  annotationVisibilityMode: AnnotationMode
  /** The peaks to annotate for that mode — the chart's cards (in range) and a report's peaks (all). */
  visiblePeaks: ResonantPeak[]
  /** The peaks the chart marks; null while a comparison is shown. Swift `chartPeaks`. */
  chartPeaks: ResonantPeak[] | null
  /** The peaks the chart labels; null while a comparison is shown. Swift `chartAnnotationPeaks`. */
  chartAnnotationPeaks: ResonantPeak[] | null
  /** Whether the chart draws the guitar mode lines. Swift `showsModeBoundaries`. */
  showsModeBoundaries: boolean
  /** Dragged annotation-label positions, keyed by peak `id` (one store for guitar + material). */
  annotationOffsets: Map<Uuid, [number, number]>
  /** The definitive-peak selection, by peak `id` (concrete analyzer state). */
  selectedPeakIds: Set<Uuid>
  /** Whether the selection was hand-modified since the last auto-select (drives the wand's enabled state). */
  userModifiedSelection: boolean
  /** The highlighted peak id (chart-dot ↔ results-row cross-highlight), or null. Transient view state. */
  highlightedPeakId: Uuid | null
  /** Whether the Re-analyze button is offered (any complete guitar measurement with a frozen
   *  spectrum; never material). See `TapToneAnalyzer.canReanalyze` for why it is not a dirty flag. */
  canReanalyze: boolean
  /** Material (plate/brace) per-phase result spectra. */
  matSpectra: MatSpectra
  /** The identified peak of each material phase (Swift selectedLongitudinalPeak / Cross / Flc). */
  selectedLongitudinalPeak: ResonantPeak | null
  selectedCrossPeak: ResonantPeak | null
  selectedFlcPeak: ResonantPeak | null
  /** The identified peaks found so far, in phase order — a material measurement's peaks (Swift
   *  `materialIdentifiedPeaks`); empty for guitar. */
  materialIdentifiedPeaks: ResonantPeak[]
  /** A gated capture window is filling — the status bar's "capturing" distinction. Swift
   *  `gatedCaptureActive`. */
  gatedCaptureActive: boolean
  /** Store B — the current material measurement's own dimensions; `null` for guitar and before a
   *  material measurement completes. Seeded at the completion transition. */
  materialInputs: MaterialMeasurementInputs | null
  /** What the spectrum is showing: live input or the measurement's frozen result ('live'), or an
   *  overlay ('comparison'). One value, so "frozen AND comparison" cannot be represented. */
  displayMode: DisplayMode
  /** Saved measurements currently overlaid; empty unless `displayMode` is 'comparison'. */
  comparisonEntries: ComparisonEntryModel[]
  /** True while the per-tap overlay of the current measurement is shown. */
  showingMultiTapComparison: boolean
  /** 'comparison' via SAVED measurements rather than the per-tap overlay. */
  isSavedMeasurementComparison: boolean
  /** The imperative status-bar message (set at every transition; clipping override applied). */
  statusMessage: string
  /** Input clipping (drives the threshold-slider red zone; the status override reads the private field). */
  isClipping: boolean
  /** Input delivering chunks with no signal — the dead-input watchdog's user-visible state. */
  inputAppearsDead: boolean
  /** What the not-running placeholders say: why the engine is not running. Swift `fft.notRunningMessage`. */
  notRunningMessage: string
  /** The file name of the last capture audio handed to the browser as a download (Dump Capture
   *  Audio), for the "saved" notice; null when none is shown. A new sequence clears it. */
  captureAudioSaved: string | null
  /** The plate / brace peaks were restored by a load, not identified by a capture. */
  materialPeaksFromLoad: boolean
  /** How many sequences have started; a change is a new sequence. */
  sequenceStarts: number
  /** A loaded measurement's Threshold/Taps are in force — drives the loaded-settings banner. */
  showLoadedSettingsWarning: boolean
  /** What the loaded measurement left on the model — Swift's `loaded*` published properties. Null
   *  when nothing is loaded (a new sequence clears them all). */
  loadedMeasurementName: string | null
  loadedNotes: string | null
  sourceMeasurementTimestamp: string | null
  loadedAxisRange: ChartView | null
  /** The loaded measurement's microphone is missing, or its calibration / sample rate differs. */
  microphoneWarning: string | null
  /** The title of the alert that shows `microphoneWarning`. */
  microphoneWarningTitle: string
  /** Ring-out of what is on screen — the file's when loaded, the live tracker's during a capture. */
  currentDecayTime: number | null
  /** The saved measurements, in the order they were saved. */
  savedMeasurements: TapToneMeasurementModel[]
  /** Saved measurements could not be read at launch: what the alert says, until the user has read it. */
  libraryLoadFailure: string | null
}
