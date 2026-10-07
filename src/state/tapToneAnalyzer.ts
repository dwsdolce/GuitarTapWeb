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
// @parity state/tap-tone-analyzer  tests=test/state-invariants,test/scenario-trace,test/start-tap-race,test/measurement-complete
// @parity audio/tap-analyzer  tests=test/tap-decisions
import type { Spectrum } from '../dsp/guitarFFT'
import type { Calibration } from '../dsp/calibration'
import { classifyAll, type ResolvedMode } from '../dsp/classify'
// The one override-aware mode resolver (mirrors Swift GuitarMode.effectiveMode). A minor state→presentation
// import (precedent: MaterialPeaks from components) — the resolver lives with the mode↔label map it needs.
import { effectiveMode as resolveEffectiveMode } from '../presentation/modeColors'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { guitarTypeNameFromRaw, isoNow, makeResonantPeak, TapEntry, type AnnotationOffsets, type ComparisonEntryModel, type ResonantPeak, type SpectrumSnapshotModel, type TapEntryModel, type TapToneMeasurementModel } from '../measurement/types'
import { normalizedMeasurementNotes } from '../measurement/measurementName'
import { newId } from '../measurement/newId'
import { Pitch } from '../dsp/pitch'
import { comparisonAxisRange, GUITAR_TYPE_RAW, measurementToLive, measurementToLiveMaterial } from '../measurement/fromLive'
import { saveMeasurement as storeMeasurement } from '../measurement/store'
import type { ChartView } from '../presentation/chartTypes'
import { GUITAR_FFT_SIZE } from '../dsp/guitarFFT'
import { RealtimeFFTAnalyzer, failedOpenMessage, type MaterialSearch, type MaterialPhaseName, type EngineState } from '../audio/realtimeFFTAnalyzer'
// Single shared MeasurementType + guard (mirrors Swift's shared MeasurementType enum) — the settings
// store owns them; the analyzer no longer duplicates the type.
import { ANALYSIS_MAX_HZ, ANALYSIS_MIN_HZ, isGuitarType, minFrequency, maxFrequency, DEFAULT_SETTINGS, MEASUREMENT_FULL_NAME, STIFFNESS_RAW_NAME, type MeasurementType, type Settings } from '../settings'
import { materialInputsFromSettings, type MaterialMeasurementInputs } from '../measurement/materialMeasurementInputs'
import { dumpCaptureWav } from '../measurement/dumpWav'
import { FieldPrecision } from '../precision'

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
const CLIPPING_WARNING = '⚠ Input clipping — reduce mic gain'
/** Shown while the input delivers buffers that carry no signal. Outranks the clipping warning.
 *  Mirrors Swift `TapToneAnalyzer.deadInputStatus` / Python `DEAD_INPUT_STATUS`. */
const DEAD_INPUT_WARNING = '⚠ No audio input — check the microphone connection'

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
/** Shown while a sequence is PAUSED. One literal, used by pauseTapDetection() and by
 *  statusAfterSettle(), so a device change cannot silently reword a paused sequence. */
const PAUSED_STATUS = 'Detection paused – tap freely, then resume'
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

// ── The saved record ────────────────────────────────────────────────────────────────────────
// The record builders behind `buildMeasurement` / `buildComparisonMeasurement`: the analyzer's save is the
// only caller, as Swift builds the record inside `saveMeasurement` / `saveComparison`.

interface BuildMeasurementArgs {
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
function makeGuitarMeasurement(a: BuildMeasurementArgs): TapToneMeasurementModel {
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
  annotationOffsetsById?: Map<string, [number, number]>
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
function makeComparisonMeasurement(a: { name: string; notes: string; entries: ComparisonEntryModel[] }): TapToneMeasurementModel {
  return {
    id: newId(),
    timestamp: isoNow(),
    peaks: [],
    measurementName: a.name.trim() || undefined,
    notes: normalizedMeasurementNotes(a.notes),
    comparisonEntries: a.entries,
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
  // The authoritative saved peaks of a LOADED measurement, or null for a live capture. Owned by the
  // analyzer, not the view, so that it and the frozen spectrum can never be seen half-applied:
  // a render that saw the spectrum set while this was still null would take the live branch,
  // re-detect, mint fresh ids, and wipe the overrides/offsets/selection just restored from the file.
  // Mirrors Swift `loadedMeasurementPeaks` / Python `loaded_measurement_peaks`.
  loadedPeaks: ResonantPeak[] | null = null
  // True for the duration of `loadMeasurement`, which applies the whole restore — spectrum, per-tap
  // entries, peaks, overrides, offsets, selection — as ONE step. `recalculateFrozenPeaksIfNeeded` returns early
  // while it is set, so nothing can recalculate against a half-applied measurement and clobber what
  // is being loaded. Mirrors Swift `isLoadingMeasurement` / Python `is_loading_measurement`.
  //
  // Web-specific note: this used to be absent, and the parity table recorded it as "n/a — the view
  // drives the load, so there is no state to construct". The restore was five separate analyzer
  // calls orchestrated by App.tsx, so the protection came from React batching the handler rather
  // than from the model. That made correctness of a loaded measurement's per-peak state depend on
  // statement order inside a 100-line view handler, untested and easy to break.
  isLoadingMeasurement = false
  modeByPeak: Map<string, ResolvedMode> = new Map()
  // Minimum magnitude (dBFS) for a peak to be DISPLAYED. A display control and nothing more:
  // assigning it re-projects `peaksAbovePeakMin` from the durable set — no detection, no
  // classification, no per-peak state touched — so selection, overrides and dragged labels all
  // survive a slider sweep, and a peak hidden then revealed comes back as the SAME object.
  // Mirrors Swift `@Published var peakMinThreshold { didSet { refreshDisplayedPeaks() } }` and
  // Python's `peak_min_threshold` setter. The persisted value still lives in the settings store
  // (the web's TapDisplaySettings); App pushes it in here, exactly as Swift's settings do.
  private _peakMinThreshold = -60
  get peakMinThreshold(): number {
    return this._peakMinThreshold
  }
  set peakMinThreshold(v: number) {
    this._peakMinThreshold = v
    this.refreshDisplayedPeaks()
  }
  // Per-peak manual mode-label overrides, keyed by peak `id`. The value is the display label string
  // (a predefined mode name or a freeform label); the id key keeps the state with the peaks it
  // describes. Carried across a peak re-mint by
  // `applyFrozenPeakState` (±REMAP_TOLERANCE_HZ) and cleared on a blank-slate reset (`clearResult`).
  // Mirrors Swift `peakModeOverrides` / Python `_peak_mode_overrides` (both id/UUID-keyed).
  overrides: Map<string, string> = new Map()
  // Dragged annotation-label positions, keyed by peak `id` → [absFreqHz, absDB]. ONE store for guitar
  // AND material, matching Swift's
  // single `peakAnnotationOffsets: [UUID: CGPoint]` and Python's `peak_annotation_offsets` — whose
  // material peaks are id-bearing too. Guitar entries are carried across a re-mint by
  // `applyFrozenPeakState`; material entries never re-mint. Guitar and material never coexist (cleared
  // between by clearResult / resetMaterial), so their ids share one map without collision.
  annotationOffsets: Map<string, [number, number]> = new Map()
  // Selection — which peak is the DEFINITIVE Air/Top/Back.
  // CONCRETE state (full-Swift paradigm, not a derived set): always recomputed on a peak re-mint by
  // applyFrozenPeakState (unmodified → auto; modified → carry-forward). Mirrors Swift `selectedPeakIDs`.
  selectedPeakIds: Set<string> = new Set()
  // Stable frequency cache for the selection, mirroring Swift `selectedPeakFrequencies`: a selected peak
  // hidden below Peak Min keeps its frequency here so it re-selects when the slider reveals it again.
  selectedPeakFrequencies: number[] = []
  // Whether the user has hand-modified the selection since the last auto-select. False → a re-mint
  // re-runs auto-selection; true → the selection is carried forward by frequency. Swift
  // `userHasModifiedPeakSelection`.
  userModifiedSelection = false
  // The highlighted peak — transient VIEW state for the chart-dot ↔ results-row cross-highlight; NOT
  // selection and NOT measurement state (lives here like Swift/Python `highlightedPeakID`, but is never
  // persisted). Toggled by clicking a peak dot or its results row (desktop only); cleared on a fresh sequence.
  highlightedPeakId: string | null = null
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
  // Whether the plate FLC tap is measured. Swift reads TapDisplaySettings.measureFlc / Python
  // _tds.measure_flc(); the web has no analyzer-visible global, so App mirrors it via setMeasureFlc.
  measureFlc = false
  measurementType: MeasurementType = 'generic'
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
  /** The loaded measurement's saved axis range — a TRANSIENT override of the persisted display
   *  range, which is left untouched (Swift `loadedAxisRange`). */
  loadedAxisRange: ChartView | null = null
  /** The display settings the loaded measurement carries (type, measureFlc, thresholds, annotation
   *  mode). Swift publishes one `loaded*` property per setting and its view writes each into the
   *  TapDisplaySettings singleton; the web's settings are a single object, so they travel as one
   *  patch for App to apply — same direction, one field instead of nine. */
  loadedSettings: Partial<Settings> | null = null
  /** The loaded measurement's microphone is not connected, or its calibration / sample rate differs
   *  (Swift `@Published var microphoneWarning`). An IMPORT never sets this — only a load, which is
   *  what puts the user in front of the data. The view shows it and clears it on acknowledgement. */
  microphoneWarning: string | null = null
  /** The title of the alert that shows `microphoneWarning`; set with it. Swift `microphoneWarningTitle`. */
  microphoneWarningTitle = 'Microphone Not Found'
  /** Ring-out (decay) time in seconds of what is on screen: the file's when a measurement is loaded,
   *  the live ring-out's during a capture (`trackDecayFast` writes it). ONE value, as
   *  Swift `currentDecayTime` and Python `current_decay_time` — the view used to hold two and choose
   *  between them. Cleared by startTapSequence, as in Swift. */
  currentDecayTime: number | null = null

  // The settings the model needs to seed Store B at a material completion. Swift and Python read the
  // TapDisplaySettings singleton from inside the model; the web has no analyzer-visible global, so App
  // mirrors the whole object in via setSettings from the same layout effect that pushes
  // measurementType and measureFlc. Read for the material seed below and for the display settings a
  // per-tap entry's snapshot records at capture (processMultipleTaps, as Swift reads TapDisplaySettings) —
  // anything else that wants a setting should get its own explicit push, so the model's dependencies
  // stay readable.
  settings: Settings = DEFAULT_SETTINGS
  /** Pitch at concert A (440 Hz) for the peaks the analyzer makes. Swift `pitchCalculator`. */
  readonly pitchCalculator = new Pitch(440)
  /** The analysis range for peak detection, in Hz. Swift `minFrequency` / `maxFrequency`. */
  minFrequency = ANALYSIS_MIN_HZ
  maxFrequency = ANALYSIS_MAX_HZ
  // Store B — the current material measurement's OWN dimensions. `null` for guitar and before a
  // material measurement completes. Seeded from Settings at the completion transition (the setter
  // below), restored from the file's snapshot by restoreMaterial, and edited through
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
    // is what Swift and Python do. Material types only, and never during a load — restoreMaterial
    // sets Store B from the file's own snapshot instead. Mirrors Swift didSet:
    // !oldValue && !isGuitar && !isLoadingMeasurement.
    if (oldValue || this.isGuitar || this.isLoadingMeasurement) return
    this.materialInputs = materialInputsFromSettings(
      this.measurementType === 'brace' ? 'brace' : 'plate',
      this.settings,
    )
  }

  get isGuitar(): boolean {
    return isGuitarType(this.measurementType)
  }

  /** Total individual taps expected across ALL phases of the current material sequence.
   *  Brace: `numberOfTaps` (longitudinal only). Plate: `numberOfTaps × 2` (L+C), or `× 3` with FLC.
   *  Mirrors Swift `totalPlateTaps` (TapDetection:360) / Python `total_plate_taps`. */
  get totalPlateTaps(): number {
    if (this.measurementType === 'brace') return this.numberOfTaps
    return this.numberOfTaps * (this.measureFlc ? 3 : 2)
  }

  /** Fraction of the sequence captured, 0…1 — the value the status-bar progress bar renders.
   *  Guitar divides by `numberOfTaps`; material divides by `totalPlateTaps`, because the material
   *  `currentTapCount` is CUMULATIVE across phases — so the bar fills once across L→C→FLC rather than
   *  refilling each phase. Written where Swift writes it: a new sequence, each guitar and material tap, Redo's
   *  rebase and a load — the last tap leaves it at 1. Mirrors Swift `tapProgress`. */
  tapProgress = 0
  /** The status from before a device-change settle began, restored when the settle has nothing of
   *  its own to say. `null` when no settle is in flight. */
  private statusBeforeSettle: string | null = null

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
   *  `arm: false` is for tests that run without a device; the natives have no such parameter.
   *
   *  `detectionState` is owned here, as it is in Swift and Python: the arming paths below set it
   *  directly, and the `arm: false` branch covers the direct/test path where no device reports back. */
  startTapSequence(opts: { arm?: boolean; skipWarmup?: boolean } = {}): void {
    const { arm = true, skipWarmup = false } = opts
    this.sequenceStarts += 1
    // The shared reset — result data, per-peak state, completion flag, and the return to live.
    this.clearResult()
    this.currentTapCount = 0
    this.tapProgress = 0
    // The user is explicitly starting a new sequence, so the loaded measurement's Threshold/Taps are
    // now theirs. Mirrors Swift startTapSequence (Control.swift:149) and Python start_tap_sequence;
    // covers the measurement-type change, file playback and New Tap/Cancel paths.
    this.showLoadedSettingsWarning = false
    // …and with it everything else the loaded measurement left behind: this sequence is no longer
    // "the loaded one". Mirrors Swift startTapSequence (Control.swift:135-136, :163).
    this.loadedMeasurementName = null
    this.loadedNotes = null
    this.loadedAxisRange = null
    this.loadedSettings = null
    this.currentDecayTime = null
    this.peakMagnitudeHistory = []
    this.resetDecayTracking()
    this.showingMultiTapComparison = false
    this.captureAudioSaved = null
    this.materialPeaksFromLoad = false
    // A new sequence listens to the input until playFile says otherwise, and no longer names a file.
    this.resultProvenance = null
    if (this.device) this.device.playingFileName = null
    // No pause-clear here: the arming below moves straight to 'listening', which leaves 'paused'
    // on its own. Mirrors Swift/Python startTapSequence.

    // A new sequence starts its tap confirmation from zero: a chunk counted before it cannot help confirm
    // its first tap. Swift's and Python's startTapSequence do the same.
    this.consecutive = 0

    if (this.isGuitar) {
      if (arm) {
        // skipWarmup mirrors Swift startTapSequence(skipWarmup:) — guitar file playback skips it,
        // because an externally recorded file may put the tap inside the first 0.5 s and guitar
        // detects against the absolute threshold, so it never reads the noise floor.
        this.armGuitarDetection(skipWarmup)
        this.startSessionRecording() // begin the continuous session WAV
      } else {
        this.detectionState = 'listening'
      }
      // Guitar resting prompt (canonical post-warm-up steady state). In the app the device's arm →
      // setEngineState('listening') also sets this; here it covers the direct/test path.
      this.setStatusMessage(this.tapPrompt())
    } else {
      this.clearMaterialPeaks()
      this.matSpectra = EMPTY_MAT_SPECTRA
      this.materialBuffer = []
      this.materialTapPhase = 'capturingL'
      if (arm) {
        // startSessionRecording seeds checkpoint [0] (the L-phase truncation anchor), so no explicit
        // checkpoint is needed here.
        this.startSessionRecording()
        this.armMaterialDetection(this.matSearch('longitudinal'))
      } else {
        // Same as the guitar branch above: leaving `arm` out must not leave the detection state
        // untouched, or a sequence started from `paused` would stay paused. Swift and Python have
        // no `arm` parameter at all — they always end startTapSequence listening — so this keeps
        // the unarmed path saying the same thing they do.
        this.detectionState = 'listening'
      }
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
    this.loadedPeaks = null // a new live result — no longer remapping from a loaded measurement
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
      const s = this.settings
      const range = { minHz: minFrequency(s, this.measurementType), maxHz: maxFrequency(s, this.measurementType) }
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
          guitarType: GUITAR_TYPE_RAW[this.measurementType] ?? 'Generic',
          measurementType: MEASUREMENT_FULL_NAME[this.measurementType],
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
    this.device?.stopFilePlayback()
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
    const type = this.measurementType
    const settings = { ...this.settings, measurementType: type }
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

  /** Save the current measurement to the measurement store. Mirrors Swift `saveMeasurement`. */
  async saveMeasurement(name: string, notes: string, view: ChartView): Promise<void> {
    const m = this.buildMeasurement(name, notes, view)
    if (m) await storeMeasurement(m)
  }

  /** The current comparison as a saved record — its entries as they are, no peaks of its own — or null
   *  when no comparison is showing. The comparison save and the comparison PDF both use it. */
  buildComparisonMeasurement(name: string, notes: string): TapToneMeasurementModel | null {
    if (this.displayMode !== 'comparison' || this.comparisonEntries.length === 0) return null
    return makeComparisonMeasurement({ name, notes, entries: this.comparisonEntries })
  }

  /** Save the current comparison to the measurement store. Mirrors Swift `saveComparison(measurementName:notes:)`. */
  async saveComparison(name: string, notes: string): Promise<void> {
    const m = this.buildComparisonMeasurement(name, notes)
    if (m) await storeMeasurement(m)
  }

  /** Load a saved measurement — guitar, material or comparison record. THE load entry point.
   *
   *  Mirrors Swift `loadMeasurement(_:)` and Python `load_measurement()`: hand it the saved
   *  measurement and the model works out what kind it is, converts it, restores itself, and records
   *  what it loaded (name, notes, axis range, settings, microphone warning, ring-out) for the view
   *  to react to. Because the whole load lives here, any caller — the view, an import, a test —
   *  performs the same load.
   *
   *  The view still does what only it can: apply `loadedSettings` to the settings store and the
   *  axis range to the chart, exactly as Swift's `.onReceive(tap.$loaded…)` handlers do. */
  loadMeasurement(m: TapToneMeasurementModel): void {
    // A load replaces the guitar peaks (Swift `allPeaks = measurement.peaks`). A comparison record has
    // none, and the web keeps a material measurement's L/C/FLC in `matPeaks`, so both leave the set
    // empty; the guitar branch restores the saved peaks in restoreSnapshot.
    if (m.comparisonEntries || m.longitudinalSnapshot) {
      this.peaks = []
      this.modeByPeak = new Map()
      this.refreshDisplayedPeaks()
    }
    // A comparison record restores its overlay spectra directly and is not a single measurement.
    if (m.comparisonEntries) {
      this.loadedPeaks = null
      this.clearResult() // returns to live and drops any overlay...
      this.loadComparisonRecord(m.comparisonEntries) // ...then enters comparison (clears loaded state)
      this.loadedMeasurementName = m.measurementName ?? null // ...but a SAVED record has a name
      this.loadedNotes = m.notes ?? null
      this.resultProvenance = null // a comparison has no microphone of its own
      this.notify()
      return
    }

    if (m.longitudinalSnapshot) {
      // Material (plate/brace): per-phase snapshots, no guitar spectrum.
      const mat = measurementToLiveMaterial(m)
      this.loadedSettings = mat.settingsPatch // only the type (+ measureFlc); NOT the dims
      this.loadedAxisRange = mat.view
      this.loadedPeaks = null
      this.clearResult() // material uses matSpectra; no frozen guitar spectrum or per-tap entries
      this.restoreMaterial({
        matSpectra: mat.matSpectra,
        selectedLongitudinalPeak: mat.selectedLongitudinalPeak,
        selectedCrossPeak: mat.selectedCrossPeak,
        selectedFlcPeak: mat.selectedFlcPeak,
        materialInputs: mat.materialInputs,
        numberOfTaps: m.numberOfTaps ?? 1,
      })
      this.restoreOffsets(mat.annotationOffsetsById) // dragged L/C/FLC labels (id-keyed shared store)
    } else {
      if (!m.spectrumSnapshot) return // neither guitar nor material: nothing to show
      const live = measurementToLive(m)
      this.loadedSettings = live.settingsPatch
      this.loadedAxisRange = live.view
      this.restoreSnapshot({
        magnitudes: live.captured.magnitudesDb,
        frequencies: live.captured.frequencies,
        numberOfTaps: m.numberOfTaps ?? 1,
        tapEntries: live.tapEntries,
        loadedPeaks: live.loadedPeaks,
        overrides: live.overridesById,
        annotationOffsets: live.annotationOffsetsById,
        selection: {
          ids: live.selectedIds,
          frequencies: live.loadedPeaks
            .filter((p) => live.selectedIds.has(p.id))
            .map((p) => p.frequency),
          userModified: live.userModified,
        },
      })
    }

    this.showingMultiTapComparison = false
    this.loadedMeasurementName = m.measurementName ?? null
    this.loadedNotes = m.notes ?? null
    // The FILE's stored ring-out, not whatever the live tracker last reported.
    this.currentDecayTime = m.decayTime ?? null
    // The loaded result's provenance is what the file recorded; no microphone means unknown.
    this.resultProvenance = {
      microphoneName: m.microphoneName ?? null,
      microphoneUID: m.microphoneUID ?? null,
      calibrationName: m.calibrationName ?? null,
      sampleRate: m.sampleRate ?? null,
    }
    // Select the recorded microphone if it is connected; warn if it is not. The id is tried first
    // (a measurement made in this browser); then the name, so a measurement from another edition —
    // a CoreAudio UID, or Python's "Name:SampleRate" fingerprint — still resolves. Swift
    // `loadMeasurement(_:)`.
    const device = this.device
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
    }
    this.notify()
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
   *  @param save Persists each decoded measurement and returns what was stored (the store's
   *              `importMeasurements`), injected so the model does not reach into storage itself. */
  async importAndLoadMeasurements(
    text: string,
    save: (text: string) => Promise<TapToneMeasurementModel[]>,
  ): Promise<string> {
    this.microphoneWarning = null
    const imported = await save(text)
    if (imported.length !== 1) return `Successfully imported ${imported.length} measurements`
    this.loadMeasurement(imported[0]!)
    let message = 'Successfully imported and loaded 1 measurement'
    if (this.microphoneWarning) {
      message += '\n\n⚠️ ' + this.microphoneWarning
      this.microphoneWarning = null
      this.notify()
    }
    return message
  }

  /** The guitar restore STEP of {@link loadMeasurement} — the frozen spectrum and everything keyed
   *  to it, applied as one.
   *
   *  Everything the file carries — the frozen spectrum, the per-tap entries, the authoritative
   *  peaks, and the per-peak state keyed to them (overrides, dragged offsets, selection) — is
   *  restored under `isLoadingMeasurement`, so `recalculateFrozenPeaksIfNeeded` cannot run against a partly
   *  applied measurement. Mirrors Swift/Python `loadMeasurement`, which are likewise one method.
   *
   *  The per-peak arguments are optional: the material load path restores only offsets, and the
   *  unit tests that just need a frozen spectrum pass none. */
  restoreSnapshot(snapshot: {
    magnitudes: number[]
    frequencies: number[]
    /** The file's tap count. Restored HERE, not by the caller: Swift writes `numberOfTaps` inside
     *  loadMeasurement (MeasMgmt:784) between the completion assignment and the settings-warning
     *  raise. The tap-count hook clears the banner, so a restore after this method would wipe the
     *  banner this method raises. */
    numberOfTaps?: number
    tapEntries?: TapEntry[]
    /** The saved peaks — authoritative, never re-derived. Omit to leave `loadedPeaks` unchanged. */
    loadedPeaks?: ResonantPeak[] | null
    overrides?: Map<string, string>
    annotationOffsets?: Map<string, [number, number]>
    selection?: { ids: Set<string>; frequencies: number[]; userModified: boolean }
  }): void {
    this.isLoadingMeasurement = true
    this.frozenMagnitudes = snapshot.magnitudes
    this.frozenFrequencies = snapshot.frequencies
    this.tapEntries = snapshot.tapEntries ?? [] // restored as saved — peaks and selection included (Swift)
    this.capturedTaps = [] // a loaded measurement has no raw taps (Swift doesn't restore them)
    // Tear down any in-progress capture the load interrupts (e.g. a plate sequence abandoned mid-phase),
    // mirroring Swift loadMeasurement (SpectrumCapture:724-728 + materialTapPhase = .complete). Without
    // this, an interrupted material capture leaves currentTapCount/isDetecting/materialTapPhase stale, so
    // the status bar's progress bar (gated on currentTapCount > 0) and Analyzing indicator (isDetecting)
    // linger over the loaded "frozen" measurement.
    this.detectionState = 'idle'
    this.currentTapCount = 0
    this.tapProgress = 0
    this.materialTapPhase = 'complete'
    this.isMeasurementComplete = true
    // The file's tap count, BEFORE the raise — its hook clears the warning, so restoring it
    // afterwards (as App used to) wipes the banner the load is about to raise.
    if (snapshot.numberOfTaps != null) this.setNumberOfTaps(snapshot.numberOfTaps)
    // AFTER the completion assignment and the tap-count restore, both of whose hooks clear this
    // flag — the ordering Swift has between MeasMgmt:709, :784 and :834.
    this.showLoadedSettingsWarning = true
    // A single measurement is now displayed — and any overlay it interrupted is gone. Swift
    // MeasMgmt:562, Python :476. Set here, not by the caller, so every load clears the comparison.
    // Through enterFrozen, so the freeze — including disarming the device — happens in ONE place.
    this.enterFrozen()
    this.setStatusMessage(LOADED_STATUS)
    // The peaks and the state keyed to them land together with the spectrum above — that pairing is
    // the whole point of doing this in one method.
    if (snapshot.loadedPeaks !== undefined) {
      // The saved peaks ARE the durable set (Swift `allPeaks = measurement.peaks`), kept as the
      // authoritative reference too (`loadedMeasurementPeaks`), and classified (`reclassifyPeaks`).
      this.loadedPeaks = snapshot.loadedPeaks
      this.peaks = snapshot.loadedPeaks ?? []
      this.reclassifyPeaks()
      this.refreshDisplayedPeaks()
    }
    if (snapshot.overrides) this.overrides = new Map(snapshot.overrides)
    if (snapshot.annotationOffsets) this.annotationOffsets = new Map(snapshot.annotationOffsets)
    if (snapshot.selection) {
      this.selectedPeakIds = new Set(snapshot.selection.ids)
      this.selectedPeakFrequencies = [...snapshot.selection.frequencies]
      this.userModifiedSelection = snapshot.selection.userModified
    }
    this.isLoadingMeasurement = false
    this.notify()
  }

  /** Drop the loaded-measurement peaks, returning the analyzer to the live/frozen branch.
   *  Used by New Tap, a fresh capture, and Re-analyze (which deliberately re-detects). */
  clearLoadedPeaks(): void {
    this.loadedPeaks = null
    this.notify()
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
    // with the result they are clearing. Swift Control:134 (comparisonSpectra = []; .live),
    // Python control:621.
    this.comparisonEntries = []
    this.showingMultiTapComparison = false
    this.displayMode = 'live'
    this.notify()
  }

  /** Whether the Re-analyze button is offered: ANY complete guitar measurement with a frozen
   *  spectrum, and never a plate/brace one.
   *
   *  Re-analyze is a RESET, not a dirty-flag indicator. It is offered whenever it COULD do
   *  something, not only when we can prove it WILL — deliberately. What can leave the displayed
   *  analysis differing from a clean re-derivation is open-ended: the peaks came from a file; mode
   *  assignments were carried forward across Peak Min moves rather than re-claimed; selections were
   *  hand-edited. Proving "it will definitely change something" means
   *  enumerating all of those correctly, forever, with nothing to tell us when we got it wrong. The
   *  two failure modes are not symmetric: a wrongly-DISABLED button is a dead end (the user cannot
   *  force the recomputation they want), while a wrongly-ENABLED one costs a click that recomputes
   *  the same answer.
   *
   *  (The previous rule, `loadedPeaks == null`, was a proxy for "the peaks are stale" and was wrong
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

  /** The guitar type the analyzer classifies under — the measurement type when it is a guitar, else
   *  Generic. The web's reading of Swift `TapDisplaySettings.guitarType`. */
  private get guitarType(): GuitarTypeName {
    return isGuitarType(this.measurementType) ? this.measurementType : 'generic'
  }

  /** FFT-frame entry point: the device hands each live spectrum here. Mirrors Swift `onFftFrame`. */
  onFftFrame(magnitudes: number[], frequencies: number[]): void {
    this.analyzeMagnitudes(magnitudes, frequencies)
  }

  /** Live peaks from one FFT frame, while a sequence is running (detecting, paused, or a capture window
   *  filling) and not complete: found at the Peak Min threshold, all selected, classified. A complete
   *  measurement's peaks are never overwritten here. Mirrors Swift `analyzeMagnitudes`, guitar path; the
   *  web shows no live material peaks (Swift finds them against an adaptive median threshold). */
  analyzeMagnitudes(magnitudes: number[], frequencies: number[]): void {
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

  /** Re-run the frozen-spectrum peak analysis — reached only through Re-analyze ({@link reanalyzePeaks}).
   *  A loaded measurement's saved peaks are authoritative (stored whole, never re-detected); otherwise the
   *  FULL set is re-detected at the floor and per-peak state carried across by frequency. Mirrors Swift
   *  `recalculateFrozenPeaksIfNeeded`. */
  recalculateFrozenPeaksIfNeeded(): void {
    // Loading guard. `loadMeasurement` applies the spectrum, the peaks and the per-peak state as one
    // step; until it finishes there is no coherent measurement to recalculate against. Mirrors Swift
    // `guard !isLoadingMeasurement else { return }` / Python's `if is_loading_measurement: return`.
    if (this.isLoadingMeasurement) return
    if (!this.isMeasurementComplete || this.frozenFrequencies.length === 0 || this.frozenMagnitudes.length === 0) return
    const guitarType = this.guitarType
    if (this.loadedPeaks) {
      // Loaded-measurement path: the saved peaks are the durable set, stored whole; ids are stable, so
      // no per-peak state needs carrying.
      this.peaks = this.loadedPeaks
      this.modeByPeak = classifyAll(this.peaks, guitarType)
      this.refreshDisplayedPeaks()
      this.notify()
      return
    }
    // Live-tap path: detect the FULL set (floor -100) on the frozen spectrum; Peak Min only projects it.
    const oldPeaks = this.peaks
    const peaks = this.findPeaks(this.frozenMagnitudes, this.frozenFrequencies, {
      peakMinOverride: TapToneAnalyzer.peakDetectionFloor,
    })
    this.peaks = peaks
    this.modeByPeak = classifyAll(peaks, guitarType)
    this.refreshDisplayedPeaks()
    // Nothing detected at all: leave the per-peak state alone, so the selection survives (Swift returns
    // before applyFrozenPeakState; Python likewise).
    if (peaks.length > 0) this.applyFrozenPeakState(oldPeaks, peaks)
    // Per-tap entries are deliberately NOT recomputed here: each is detected once, at capture, and is
    // durable (Swift removed `recalculateTapEntryPeaks` for the same reason).
    this.notify()
  }

  /** Re-analyze: drop the loaded peaks and any manual selection, then re-detect the frozen spectrum's
   *  peaks. The stored ring-out is untouched. Mirrors Swift `reanalyzePeaks()` / Python
   *  `reanalyze_peaks()`. No-op without a frozen spectrum. */
  reanalyzePeaks(): void {
    if (!this.isMeasurementComplete || this.frozenFrequencies.length === 0 || this.frozenMagnitudes.length === 0) return
    this.loadedPeaks = null
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

  /** Assign a manual mode-label override to a peak (mirrors Swift `setModeOverride`). The label is the
   *  display string (a predefined mode name or a freeform label). Overriding an already-SELECTED peak into
   *  a single-holder mode displaces the previous definitive holder (see enforceDefinitiveModeUniqueness). */
  setModeOverride(id: string, label: string): void {
    // Reassign a fresh Map (never mutate in place): the snapshot exposes this reference, and App memos
    // keyed on `overrides` identity (overriddenPeakIds → displayPeaks → chart layers) must see the change.
    this.overrides = new Map(this.overrides).set(id, label)
    // Changing the mode of an already-selected peak can create two definitive holders of the new mode —
    // the only way an override touches selection (Swift setModeOverride). No-op if this peak isn't selected.
    this.enforceDefinitiveModeUniqueness(id)
    this.notify()
  }

  /** Clear a peak's override, reverting it to its auto-classified mode (Swift `resetModeOverride`). */
  resetModeOverride(id: string): void {
    if (!this.overrides.has(id)) return
    const next = new Map(this.overrides)
    next.delete(id)
    this.overrides = next
    this.notify()
  }

  /** Replace the whole override map from a loaded measurement (id-keyed to the loaded peaks). The load
   *  path calls this AFTER `loadMeasurement`; the loaded peaks keep stable ids, so no remap follows. */
  restoreOverrides(map: Map<string, string>): void {
    this.overrides = new Map(map)
    this.notify()
  }

  // ── Dragged annotation offsets (one id-keyed store for guitar + material, mirrors Swift/Python) ──────

  /** Set a peak's dragged annotation-label position (absolute [Hz, dB]). Fresh Map for memo identity.
   *  Mirrors Swift `updateAnnotationOffset` / Python `update_annotation_offset`. */
  updateAnnotationOffset(id: string, pos: [number, number]): void {
    this.annotationOffsets = new Map(this.annotationOffsets).set(id, pos)
    this.notify()
  }

  /** Clear one peak's dragged offset (Swift `resetAnnotationOffset`). */
  resetAnnotationOffset(id: string): void {
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

  /** Replace the whole offset map from a loaded measurement (id-keyed). Guitar loaded peaks and restored
   *  material peaks both keep stable ids, so no remap follows. */
  restoreOffsets(map: Map<string, [number, number]>): void {
    this.annotationOffsets = new Map(map)
    this.notify()
  }

  /** Carry per-peak state across a peak RE-MINT (findPeaks assigns fresh ids), the web equivalent of
   *  Swift `applyFrozenPeakState`. Snapshots the old state BY FREQUENCY from the DURABLE old set (never
   *  a display projection), then re-attaches it — overrides, offsets and selection — to the new peaks by
   *  ±REMAP_TOLERANCE_HZ proximity. Called
   *  only on the findPeaks branch (loaded/material keep stable ids). Notify is left to the caller. */
  private applyFrozenPeakState(oldPeaks: ResonantPeak[], newPeaks: ResonantPeak[]): void {
    if (this.overrides.size > 0) {
      // Snapshot {frequency → label} from the OLD durable peaks, then remap onto the new ids.
      const byFreq: Array<{ frequency: number; label: string }> = []
      for (const [id, label] of this.overrides) {
        const old = oldPeaks.find((q) => q.id === id)
        if (old) byFreq.push({ frequency: old.frequency, label })
      }
      const remapped = new Map<string, string>()
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
      const remapped = new Map<string, [number, number]>()
      for (const np of newPeaks) {
        const match = byFreq.find((o) => Math.abs(o.frequency - np.frequency) <= REMAP_TOLERANCE_HZ)
        if (match) remapped.set(np.id, match.pos)
      }
      this.annotationOffsets = remapped
    }
    // Selection (guitar-only — the web has no per-peak material selection). CONCRETE recompute, mirroring
    // Swift's applyFrozenPeakState branches: MODIFIED → carry forward by ±5 Hz, keeping below-threshold
    // frequencies in the cache so they re-select on reveal; UNMODIFIED → re-run auto-selection over the
    // new durable set.
    if (this.userModifiedSelection) {
      const prevFreqs =
        this.selectedPeakFrequencies.length > 0
          ? this.selectedPeakFrequencies
          : oldPeaks.filter((q) => this.selectedPeakIds.has(q.id)).map((q) => q.frequency)
      const carriedIds = new Set<string>()
      const carriedFreqs: number[] = []
      for (const oldFreq of prevFreqs) {
        const closest = newPeaks
          .filter((np) => Math.abs(np.frequency - oldFreq) <= REMAP_TOLERANCE_HZ)
          .sort((a, b) => Math.abs(a.frequency - oldFreq) - Math.abs(b.frequency - oldFreq))[0]
        if (closest) {
          if (!carriedIds.has(closest.id)) {
            carriedIds.add(closest.id)
            carriedFreqs.push(closest.frequency)
          }
        } else {
          carriedFreqs.push(oldFreq) // below threshold — preserve so it re-selects when revealed
        }
      }
      this.selectedPeakIds = carriedIds
      this.selectedPeakFrequencies = carriedFreqs
    } else {
      const autoIds = this.guitarModeSelectedPeakIds(newPeaks)
      this.selectedPeakIds = autoIds
      this.selectedPeakFrequencies = newPeaks.filter((np) => autoIds.has(np.id)).map((np) => np.frequency)
    }
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

  /** Drop the three identified material peaks (a new sequence, a reset). */
  private clearMaterialPeaks(): void {
    this.selectedLongitudinalPeak = null
    this.selectedCrossPeak = null
    this.selectedFlcPeak = null
  }

  /** Set the Peak Min display threshold and publish the new projection. The persisted value lives in
   *  the settings store; App mirrors it in here on change, the web's equivalent of Swift reading
   *  `TapDisplaySettings.peakMinThreshold` into the analyzer. */
  setPeakMinThreshold(v: number): void {
    this.peakMinThreshold = v
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
  guitarModeSelectedPeakIds(peaks: ResonantPeak[] = this.peaks): Set<string> {
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
  effectiveMode(id: string): ResolvedMode {
    return resolveEffectiveMode(this.overrides.get(id), this.modeByPeak.get(id) ?? 'unknown')
  }

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
  enforceDefinitiveModeUniqueness(id: string): void {
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
  togglePeakSelection(id: string): void {
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

  /** Restore selection from a loaded measurement (ids keyed to the loaded peaks, + the frequency cache
   *  and the manual/auto flag). Loaded peaks keep stable ids, so no remap follows. */
  restoreSelection(ids: Set<string>, freqs: number[], userModified: boolean): void {
    this.selectedPeakIds = new Set(ids)
    this.selectedPeakFrequencies = [...freqs]
    this.userModifiedSelection = userModified
    this.notify()
  }

  /** Toggle the highlighted peak (clicking its chart dot or its results row): same id → clear, else set.
   *  Mirrors Swift's macOS dot `.onTapGesture` toggle and the results-row tap (both toggle). Transient
   *  view state — not selection, not persisted. */
  toggleHighlightedPeak(id: string): void {
    this.highlightedPeakId = this.highlightedPeakId === id ? null : id
    this.notify()
  }

  // ── Material (plate/brace) phase machine (mirrors Swift TapToneAnalyzer+SpectrumCapture) ──────────
  // The analyzer holds a REFERENCE to the device (Swift's TapToneAnalyzer owns fftAnalyzer); its
  // lifecycle stays in useAudioEngine. Material transitions arm/checkpoint it and read its
  // calibration + playingFile.
  private device: RealtimeFFTAnalyzer | null = null
  // Raw gated taps accumulated for the CURRENT material phase; the analyzer averages them +
  // findDominantPeak at phase completion.
  private materialBuffer: Spectrum[] = []

  /** Set the audio device this analyzer drives (useAudioEngine calls this on creation). As Swift's
   *  analyzer sets `fftAnalyzer.preMicRestartHandler`, it asks the engine to flush its gated capture
   *  when a played file ends. */
  setDevice(device: RealtimeFFTAnalyzer | null): void {
    if (this.device && this.device !== device) this.device.preMicRestartHandler = null
    this.device = device
    if (device) device.preMicRestartHandler = () => this.flushGatedCaptureOnFileEnd()
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
    const device = this.device
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
    return this.device?.playingFile ?? false
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
    return this.device?.deviceLabel || undefined
  }

  /** The id of `captureMicrophoneName`'s device. Mirrors Swift `captureMicrophoneUID`. */
  get captureMicrophoneUID(): string | undefined {
    if (this.resultProvenance) return this.resultProvenance.microphoneUID ?? undefined
    return this.device?.inputDeviceId ?? undefined
  }

  /** The calibration the current result was captured with: the input's for a live result, the recorded
   *  one otherwise (none for a file played uncalibrated). Mirrors Swift `captureCalibrationName`. */
  get captureCalibrationName(): string | undefined {
    if (this.resultProvenance) return this.resultProvenance.calibrationName ?? undefined
    return this.device?.activeCalibration?.name
  }

  /** The sample rate the current result was captured at: the input's for a live result (null when there is
   *  no rate yet), the recorded one otherwise. Mirrors Swift `captureSampleRate`. */
  get captureSampleRate(): number | null {
    if (this.resultProvenance) return this.resultProvenance.sampleRate
    return this.device?.sampleRate || null
  }

  /** User-initiated arming (New Tap, a measurement-type change). A file that is playing is stopped
   *  first: a new sequence — for a changed measurement type, say — must not be fed the rest of the
   *  file. Mirrors Swift `requestStartTapSequence` (the web has no dump-folder guard to check). */
  requestStartTapSequence(): void {
    this.device?.stopFilePlayback()
    this.startTapSequence()
  }

  /** Mirror the plate FLC-measurement setting (App drives it from the settings store). */
  setMeasureFlc(v: boolean): void {
    this.measureFlc = v
  }

  /** Build the gated search for a material phase: its frequency range and peak-selection rule. The
   *  calibration is not part of it — the gated transform applies the active calibration itself, at
   *  the moment of the capture, as Swift and Python do. */
  private matSearch(phase: MaterialPhaseName): MaterialSearch {
    // Swift `finishGatedFFTCapture`'s per-phase search window, by measurement type and phase.
    if (this.measurementType === 'brace') {
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
    const label = this.measurementType === 'brace' ? 'Brace' : this.measureFlc ? 'Plate_LCF' : 'Plate_LC'
    this.finishSessionRecording(label)
  }

  /** Review → advance to the next phase (Accept). */
  acceptMaterial(): void {
    const phase = this.materialTapPhase
    if (phase === 'reviewingL') {
      this.materialTapPhase = 'capturingC'
      this.materialBuffer = []
      this.checkpointSession() // C phase start (so a redo can drop it)
      this.armMaterialPhase(this.matSearch('cross'), this.inputLevelDb, this.device?.audioTime ?? 0)
      this.setStatusMessage(this.materialArmPrompt()) // phase is capturingC — one source
      this.notify()
    } else if (phase === 'reviewingC') {
      if (this.measureFlc) {
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
          this.armMaterialPhase(this.matSearch('flc'), this.lastChunkLevelDb, this.lastAudioTime)
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
  redoMaterial(): void {
    const phase = this.materialTapPhase
    this.redoSession() // drop the rejected phase's audio from the session WAV
    this.materialBuffer = []
    // Clear the redone phase's spectrum and identified peak, as Swift's redoCurrentPhase does.
    if (phase === 'reviewingL') {
      this.matSpectra = { ...this.matSpectra, longitudinal: null }
      this.selectedLongitudinalPeak = null
      this.materialTapPhase = 'capturingL'
      this.armMaterialPhase(this.matSearch('longitudinal'), this.inputLevelDb, this.device?.audioTime ?? 0)
      this.setStatusMessage('Ready for fL tap — tap again')
    } else if (phase === 'reviewingC') {
      this.matSpectra = { ...this.matSpectra, cross: null }
      this.selectedCrossPeak = null
      this.materialTapPhase = 'capturingC'
      this.armMaterialPhase(this.matSearch('cross'), this.inputLevelDb, this.device?.audioTime ?? 0)
      this.setStatusMessage('Ready for fC tap — tap again')
    } else if (phase === 'reviewingFlc') {
      this.matSpectra = { ...this.matSpectra, flc: null }
      this.selectedFlcPeak = null
      this.materialTapPhase = 'capturingFlc'
      this.armMaterialPhase(this.matSearch('flc'), this.inputLevelDb, this.device?.audioTime ?? 0)
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
    const playing = this.device?.playingFile ?? false
    const stored = avgPeak // a fresh peak (its own id) per phase, as Swift's findDominantPeak returns
    if (ph === 'longitudinal') {
      this.matSpectra = { ...this.matSpectra, longitudinal: avg }
      this.selectedLongitudinalPeak = stored
      if (this.measurementType === 'brace') {
        this.materialTapPhase = 'complete'
        this.isMeasurementComplete = true // Swift brace complete sets isMeasurementComplete (SpectrumCapture:1217)
        this.finishMaterialSession() // brace = single phase → session done
        this.setStatusMessage(this.materialCompleteString())
      } else if (playing) {
        this.materialTapPhase = 'capturingC'
        this.setStatusMessage('File: fL complete, capturing fC...')
        this.autoAdvanceMaterialPhase(this.matSearch('cross'))
      } else {
        this.materialTapPhase = 'reviewingL'
        this.setStatusMessage(`fL: ${fHz(avgPeak)} Hz — Accept to continue or Redo to re-tap`)
      }
    } else if (ph === 'cross') {
      this.matSpectra = { ...this.matSpectra, cross: avg }
      this.selectedCrossPeak = stored
      if (playing) {
        if (this.measureFlc) {
          this.materialTapPhase = 'capturingFlc'
          this.setStatusMessage('File: fC complete, capturing fLC...')
          this.autoAdvanceMaterialPhase(this.matSearch('flc'))
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

  /** Restore a loaded material measurement (per-phase spectra + peaks, dimensions, phase=complete).
   *
   *  Runs under `isLoadingMeasurement`, which is what suppresses the completion setter's Store B
   *  seed: a load must show the measurement's OWN dimensions, not the current Settings defaults.
   *  Swift gets this from loadMeasurement holding the flag across the whole restore; the web load is
   *  orchestrated from App, so the window is held here, around the assignment that triggers didSet. */
  restoreMaterial(m: {
    matSpectra: MatSpectra
    selectedLongitudinalPeak: ResonantPeak | null
    selectedCrossPeak: ResonantPeak | null
    selectedFlcPeak: ResonantPeak | null
    materialInputs: MaterialMeasurementInputs | null
    numberOfTaps?: number
  }): void {
    this.isLoadingMeasurement = true
    try {
      this.matSpectra = m.matSpectra
      this.materialPeaksFromLoad = true
      this.selectedLongitudinalPeak = m.selectedLongitudinalPeak
      this.selectedCrossPeak = m.selectedCrossPeak
      this.selectedFlcPeak = m.selectedFlcPeak
      this.materialInputs = m.materialInputs // Store B ← the file's own dims, never Settings
      this.materialTapPhase = 'complete'
      this.isMeasurementComplete = true // a loaded material measurement is complete (Swift loadMeasurement)
      // A sequence the load interrupts leaves no count behind — else the status bar's progress bar
      // (gated on currentTapCount > 0) lingers over the loaded measurement. Swift loadMeasurement.
      this.currentTapCount = 0
      this.tapProgress = 0
      // The file's tap count BEFORE the raise — its hook clears the warning.
      if (m.numberOfTaps != null) this.setNumberOfTaps(m.numberOfTaps)
      this.showLoadedSettingsWarning = true // after both clearing hooks have run
      this.disarmDetection() // a loaded result is frozen — see enterFrozen
    } finally {
      this.isLoadingMeasurement = false
    }
    this.setStatusMessage(LOADED_STATUS)
    this.notify()
  }

  /** Mirror the settings store onto the analyzer (App drives it; see the `settings` field). */
  setSettings(s: Settings): void {
    this.settings = s
    // The tap threshold is ANALYZER state, as in Swift (`@Published var tapDetectionThreshold`) and
    // Python (the `tap_detection_threshold` property) — `detectTap` reads it. The natives get it
    // from TapDisplaySettings inside the model; the web has no analyzer-visible global, so App
    // mirrors it in here, the same way measurementType and measureFlc arrive. This line is the
    // detector's only source for the slider's value; the engine config is not read for detection.
    this.tapDetectionThreshold = s.tapDetectionThreshold
  }

  /** Replace Store B — the Results-panel dimension editor. Mirrors Swift's
   *  `set: { analyzer.materialInputs = $0 }` binding in TapAnalysisResultsView. */
  setMaterialInputs(v: MaterialMeasurementInputs | null): void {
    this.materialInputs = v
    this.notify()
  }

  // ── Tap detection + gated capture ───────────────────────────────────────────────────────────
  // @parity state/tap-detection  tests=test/tap-decisions,test/status-message
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

  /** Absolute detection threshold (dBFS). Owned here, as Swift owns it; App pushes the setting. */
  /** The tap-detection threshold in dBFS, mirrored in from settings by `setSettings`. Read by
   *  `detectTap` — absolute for guitar, the base of the relative rule for material. Swift and
   *  Python hold the same value on the analyzer. */
  tapDetectionThreshold = -40

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
  /** The latest chunk's input level — Swift `fftAnalyzer.inputLevelDB`; seeds the latch at Accept/Redo. */
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
  /** The WALL time (`performance.now()`) at which the latest chunk reached `processAudioFrame` — what the
   *  capture safety timeout measures its silence from. Swift `lastChunkWallTime`. */
  private lastChunkWallTime = 0
  /** Identity of the current gated capture, so a stale safety timeout does nothing. Swift `gatedCaptureID`. */
  private gatedCaptureId = 0
  private consecutive = 0
  /** dB drop that defines "rung out". Swift `decayThreshold` (15). */
  decayThreshold = 15
  /** The post-tap level history, audio time + dB. Swift `peakMagnitudeHistory`. */
  peakMagnitudeHistory: { time: number; magnitude: number }[] = []
  /** Audio time of the tap the ring-out is measured from. Swift `decayTapAudioTime`. */
  decayTapAudioTime: number | null = null
  /** The peak-held level at the tap — the ring-out's first entry. Swift `tapPeakLevel`. */
  tapPeakLevel = -100
  /** Stop recording this long, in audio, after the tap. Swift `decayTrackingDuration`. */
  readonly decayTrackingDuration = 3.0
  /** Swift `isTrackingDecay`. */
  isTrackingDecay = false
  /** The EMA-tracked input noise floor (dBFS) the relative detector rises from. Swift/Python
   *  `noiseFloorEstimate` — readable, as there (the noisy-plate regression checks it converged). */
  noiseFloorEstimate = -60
  private justExitedWarmup = false
  private warmupStartAudioTime: number | null = null

  // Pre-roll ring + capture window (Swift preRollBuffer / gatedAccumBuffer).
  private prerollSamples = 0
  private preroll = new Float32Array(0)
  private prerollIdx = 0
  private prerollFilled = 0
  private guitarCaptureBuf = new Float32Array(0)
  private materialCapture = new Float32Array(0)
  private capture = new Float32Array(0)
  private captureIdx = 0
  private captureKind: 'guitar' | 'material' = 'guitar'
  private materialSearch: MaterialSearch | null = null
  private guitarTapCount = 0
  /** The rate of the audio feeding the gated capture. Mirrors Swift `mpmSampleRate`. */
  private mpmSampleRate = 48000

  // ── Continuous session recording (Swift TapToneAnalyzer+SpectrumCapture) ────────────────────
  // Swift keeps the whole session WAV on the analyzer: the buffer, the bounded pre-roll, the phase
  // checkpoints and the write. Web had it on the engine, which is why the first tap had to be
  // signalled across the seam; both live here now, so the latch freezes where the capture starts.

  private sessionSamples: number[] = []
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
  /** Begin accumulating every pipeline chunk for the session WAV. Every sequence is recorded; the dump
   *  setting is read when the session finishes, so turning it on mid-sequence saves that sequence
   *  (Swift/Python). Guitar calls this from `arm()`; live material drives it from useMaterialSession. */
  startSessionRecording(): void {
    this.sessionSamples = []
    this.sessionCheckpoints = [0] // first-phase truncation anchor (Swift/Python seed [0] at start)
    this.sessionRate = this.device?.sampleRate ?? 48000
    this.sessionActive = true
    this.sessionRecording = true
    this.sessionPreRollActive = true // bound the pre-first-tap audio to ~2 s
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
      this.sessionSamples.length = cp
      // Redoing the FIRST phase empties the buffer back to the pre-first-tap state, so re-arm the
      // bounded pre-roll. Later phases keep the latch frozen. Mirrors Swift redoCurrentPhase.
      if (cp === 0) this.sessionPreRollActive = true
    }
  }

  /** Append one chunk to the session WAV buffer and maintain the bounded pre-roll.
   *
   *  Before the first tap (sessionPreRollActive): keep only the last ~2 s — the tap is always in
   *  the tail, so trimming the head never eats it; this just discards accumulated idle. The first
   *  capture (state === 'capturing') freezes the latch. Everything after — subsequent taps, plate
   *  phases, and the gaps between them — is completely live. Mirrors Swift maintainSessionRecording. */
  private maintainSessionRecording(s: Float32Array): void {
    if (!this.sessionRecording) return
    for (let i = 0; i < s.length; i++) this.sessionSamples.push(s[i]!)
    if (!this.sessionPreRollActive) return // frozen after the first tap → fully live
    if (this.gatedCaptureActive) {
      // The first tap has started — freeze the pre-roll. The latch is owned HERE, as in Swift and
      // Python (`if gatedCaptureActive { sessionPreRollActive = false }`), so one rule has one owner.
      this.sessionPreRollActive = false
    } else {
      const excess = this.sessionSamples.length - this.sessionPreRollSamples
      if (excess > 0) this.sessionSamples.splice(0, excess)
    }
  }

  /** Finish the session: if the dump setting is on, download the accumulated audio (if any) as one WAV
   *  and name it in `captureAudioSaved`; then clear. Swift's analyzer calls its own dumpCaptureWAV
   *  helper here, gated on the dump setting. */
  finishSessionRecording(label: string): void {
    this.sessionRecording = false
    this.sessionActive = false
    const samples = this.sessionSamples
    const rate = this.sessionRate
    this.sessionSamples = []
    this.sessionCheckpoints = []
    if (samples.length === 0 || !this.settings.dumpCaptureAudio) return
    this.captureAudioSaved = dumpCaptureWav(new Float32Array(samples), rate, `session_${label}`)
    this.notify()
  }

  /** The user dismissed the "Capture audio saved" notice. */
  dismissCaptureAudioSaved(): void {
    if (this.captureAudioSaved === null) return
    this.captureAudioSaved = null
    this.notify()
  }

  /** Abandon the session without writing (cancel / measurement-type change / New Tap of a fresh kind). */
  cancelSessionRecording(): void {
    this.sessionRecording = false
    this.sessionActive = false
    this.sessionSamples = []
    this.sessionCheckpoints = []
  }

  /** Exclude a paused segment from the session WAV (Swift clears its flag in pauseTapDetection). */
  suspendSessionRecording(): void {
    this.sessionRecording = false
  }

  /** Resume accumulating into the session WAV after a pause. */
  resumeSessionRecording(): void {
    if (this.sessionActive) this.sessionRecording = true
  }

  /** The audio pipeline hands every chunk here: the analyzer keeps the pre-roll, judges the level
   *  and fills the capture window. Swift's analyzer does the same from its FFT subscriber and the
   *  audio-queue level-crossing handler. */
  processAudioFrame(samples: Float32Array, levelDb: number, audioTime: number): void {
    this.inputLevelDb = levelDb
    const rate = this.device?.sampleRate ?? this.mpmSampleRate
    if (rate !== this.mpmSampleRate || this.preroll.length === 0) this.resizeCaptureBuffers(rate)
    this.maintainSessionRecording(samples)
    this.feedPreroll(samples)
    if (this.gatedCaptureActive) this.feedCapture(samples)
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
    this.lastChunkWallTime = performance.now()
    if (!this.runDueAudioActions()) {
      // Detection is off through a capture: a detected tap turns it off first, as Swift's and Python's
      // `handleTapDetection` does, and the capture's finish and the rest keep it off until the re-arm.
      if (this.isDetecting && !this.isDetectionPaused && !this.isMeasurementComplete) this.detectTap(levelDb, audioTime)
    }
    // Ring-out tracking rides the same chunk and its audio time, AFTER detection and outside its
    // guards — Swift's rmsLevelHandler calls `onRmsLevelChanged` and then `trackDecayFast`. It gates
    // itself on `isTrackingDecay`, and runs on past the measurement's completion, which is exactly the
    // window it measures.
    this.trackDecayFast(levelDb, audioTime)
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
      if (this.captureIdx === 0) return
      this.capture.fill(0, this.captureIdx)
      this.finishCapture()
    } finally {
      this.releaseAudioActionsAtFileEnd()
    }
  }

  /** Size the pre-roll ring and capture windows for the current rate. Swift derives both from
   *  `fftAnalyzer.actualSampleRate` on demand, so a file at another rate re-sizes them. */
  private resizeCaptureBuffers(rate: number): void {
    this.mpmSampleRate = rate
    this.prerollSamples = Math.round(rate * 0.2)
    this.preroll = new Float32Array(this.prerollSamples)
    this.prerollIdx = 0
    this.prerollFilled = 0
    this.guitarCaptureBuf = new Float32Array(this.device?.fftSize ?? GUITAR_FFT_SIZE)
    this.materialCapture = new Float32Array(Math.round(rate * TapToneAnalyzer.gatedCaptureDuration))
    this.capture = this.captureKind === 'material' ? this.materialCapture : this.guitarCaptureBuf
    this.captureIdx = 0
  }

  /** Arm guitar tap detection — a fresh sequence. Swift startTapSequence's guitar arm. */
  private armGuitarDetection(skipWarmup: boolean): void {
    this.resizeCaptureBuffers(this.device?.sampleRate ?? this.mpmSampleRate)
    this.captureKind = 'guitar'
    this.capture = this.guitarCaptureBuf
    this.guitarTapCount = 0
    this.armWarmup(skipWarmup)
    this.gatedCaptureActive = false
    this.detectionState = 'listening'
  }

  /** Point the capture at a material phase's search range — the buffers only. How detection then
   *  resumes is the caller's: the natives arm a material phase in three different shapes. */
  private prepareMaterialCapture(search: MaterialSearch): void {
    if (this.preroll.length === 0) this.resizeCaptureBuffers(this.device?.sampleRate ?? this.mpmSampleRate)
    this.captureKind = 'material'
    this.materialSearch = search
    this.capture = this.materialCapture
    this.captureIdx = 0
    this.gatedCaptureActive = false
  }

  /** Start a material sequence: the warm-up runs, as it does for Swift's startTapSequence — material
   *  is the only mode using the relative noise-floor detector, and the warm-up establishes the floor. */
  private armMaterialDetection(search: MaterialSearch): void {
    this.prepareMaterialCapture(search)
    this.armWarmup(false)
    this.detectionState = 'listening'
  }

  /** Arm a phase at a user transition — Accept, Redo — or when the FLC hold ends: the latch from the
   *  given level and the warm-up restarted at the given audio time; the noise floor is left alone.
   *  Swift acceptCurrentPhase / redoCurrentPhase and the FLC hold's closure. */
  private armMaterialPhase(search: MaterialSearch, levelDb: number, warmupAt: number): void {
    this.prepareMaterialCapture(search)
    this.isAboveThreshold = levelDb > this.tapDetectionThreshold - this.hysteresisMargin
    this.warmupStartAudioTime = warmupAt
    this.justExitedWarmup = false
    this.detectionState = 'listening'
  }

  /** File playback's auto-advance to the next phase: listening at once, the latch ABOVE, so the last
   *  tap's ring-out must fall before anything counts; no warm-up, the noise floor left alone. Swift's
   *  file-playback L → C / C → FLC advance. */
  private autoAdvanceMaterialPhase(search: MaterialSearch): void {
    this.prepareMaterialCapture(search)
    this.isAboveThreshold = true
    this.detectionState = 'listening'
  }

  /** Between taps of one plate/brace phase, and after a rejected tap: rest `tapCooldown` of AUDIO,
   *  then re-arm from the chunk that made the rest due. The warm-up and the noise floor are NOT
   *  restarted. Swift `reEnableDetectionForNextPlateTap`. */
  private reEnableDetectionForNextPlateTap(): void {
    this.afterAudio(this.tapCooldown, () => {
      this.reArmFromCurrentChunk()
      this.notify()
    })
  }

  /** Stop detecting without discarding the result (a load, or entering comparison). */
  private disarmDetection(): void {
    this.detectionState = 'idle'
    this.gatedCaptureActive = false
  }

  /** Pause detection while the live spectrum keeps flowing. Swift `pauseTapDetection()`. */
  pauseTapDetection(): void {
    if (this.detectionState !== 'listening') return
    this.detectionState = 'paused'
    this.suspendSessionRecording()
    this.setStatusMessage(PAUSED_STATUS)
    this.notify()
  }

  /** Resume after a pause, continuing from the current tap count. Swift `resumeTapDetection()`. */
  resumeTapDetection(): void {
    if (this.detectionState !== 'paused') return
    // Swift `resumeTapDetection`: the warm-up restarts from now and the latch goes down; the noise floor
    // and the sync flag are left as they were. The tap counter restarts too, so a chunk counted before
    // the pause cannot help confirm a tap after it, as in Swift and Python.
    this.warmupStartAudioTime = this.device?.audioTime ?? 0
    this.isAboveThreshold = false
    this.consecutive = 0
    this.detectionState = 'listening'
    this.resumeSessionRecording()
    this.setStatusMessage(this.restingPrompt())
    this.notify()
  }

  /** Apply the engine's per-bin calibration corrections — Swift reads
   *  `fftAnalyzer.calibrationCorrections` and applies them in finishGuitarGatedCapture. */
  private applyCalibration(spec: Spectrum): Spectrum {
    const corr = this.device?.calibrationCorrections ?? null
    if (!corr || corr.length !== spec.magnitudesDb.length) return spec
    return { ...spec, magnitudesDb: spec.magnitudesDb.map((m: number, i: number) => m + corr[i]!) }
  }

  private feedPreroll(s: Float32Array): void {
    for (let i = 0; i < s.length; i++) {
      this.preroll[this.prerollIdx] = s[i]!
      this.prerollIdx = (this.prerollIdx + 1) % this.prerollSamples
      if (this.prerollFilled < this.prerollSamples) this.prerollFilled++
    }
  }

  private detectTap(levelDb: number, audioTime: number): void {
    // Plate and brace detect relative to the noise floor — decided by the measurement type, as Swift's
    // `detectTap` does.
    const useRelative = this.measurementType === 'plate' || this.measurementType === 'brace'
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
        // The ring-out's reference is the PEAK-HELD level (Swift `tapPeakLevel = recentPeakLevelDB`),
        // not this chunk's: confirmation lags the strike by ~2 chunks, so the true peak would otherwise
        // be missed and the −15 dB target under-stated.
        if (this.device) this.tapPeakLevel = this.device.recentPeakLevelDb
        this.handleTapDetection(audioTime)
      }
    } else {
      this.consecutive = 0
    }
  }

  // ── Ring-out (decay) tracking ─────────────────────────────────────────────────────────────────
  // @parity dsp/decay tests=test/decay-tracking
  // Swift TapToneAnalyzer+DecayTracking / Python tap_tone_analyzer_decay_tracking. After a guitar tap
  // the per-chunk broadband level (the same dB detection sees) is recorded against AUDIO time; the
  // ring-out is the time from the post-tap peak down to peak − `decayThreshold`. It is on the analyzer,
  // as in the natives, and starts from the confirming chunk's audio time.

  /** Start a fresh ring-out window for a tap confirmed at `tapAudioTime`, seeded with the peak-held
   *  level. Swift `startDecayTracking(tapAudioTime:)`. */
  startDecayTracking(tapAudioTime: number): void {
    this.peakMagnitudeHistory = [{ time: tapAudioTime, magnitude: this.tapPeakLevel }]
    this.decayTapAudioTime = tapAudioTime
    this.setDecayTime(null)
    this.isTrackingDecay = true
  }

  /** Swift `stopDecayTracking()`. */
  stopDecayTracking(): void {
    this.isTrackingDecay = false
  }

  /** Stops any active ring-out tracking — a new sequence must not keep measuring the previous tap. Swift
   *  `resetDecayTracking()`. */
  private resetDecayTracking(): void {
    this.isTrackingDecay = false
  }

  /** Record one chunk's level, and re-measure. Stops — without recording — once the chunk is
   *  `decayTrackingDuration` of audio after the tap. Swift `trackDecayFast(inputLevel:audioTime:)`. */
  trackDecayFast(inputLevel: number, audioTime: number): void {
    if (!this.isTrackingDecay) return
    const tapTime = this.decayTapAudioTime
    if (tapTime !== null && audioTime - tapTime >= this.decayTrackingDuration) {
      this.stopDecayTracking()
      return
    }
    this.peakMagnitudeHistory.push({ time: audioTime, magnitude: inputLevel })
    const minimumDecayHistoryCount = 10
    if (tapTime !== null && this.peakMagnitudeHistory.length > minimumDecayHistoryCount) {
      this.setDecayTime(this.measureDecayTime(tapTime))
    }
  }

  /** Ring-out = post-tap PEAK → first later entry below (peak − `decayThreshold`), in seconds, or null
   *  if the level has not dropped that far. Only entries at or after `tapTime` count. Swift
   *  `measureDecayTime(tapTime:)`. */
  measureDecayTime(tapTime: number): number | null {
    const postTap = this.peakMagnitudeHistory.filter((e) => e.time >= tapTime)
    let peak: { time: number; magnitude: number } | null = null
    for (const e of postTap) if (peak === null || e.magnitude > peak.magnitude) peak = e
    if (peak === null) return null
    const target = peak.magnitude - this.decayThreshold
    const decayed = postTap.find((e) => e.magnitude < target && e.time > peak!.time)
    return decayed ? decayed.time - peak.time : null
  }

  private armWarmup(skip: boolean): void {
    this.warmupStartAudioTime = skip ? (this.device?.audioTime ?? 0) - (this.warmupPeriod + 0.1) : (this.device?.audioTime ?? 0)
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
   *  the tap is routed by capture kind. Swift `handleTapDetection(magnitudes:frequencies:time:audioTime:)`:
   *  a guitar tap starts the ring-out at its audio time, shows "capturing", and opens the guitar capture;
   *  a plate/brace tap goes to `handlePlateTapDetection`. */
  private handleTapDetection(audioTime: number): void {
    this.detectionState = 'idle'
    if (!this.isGuitar) {
      this.handlePlateTapDetection()
      return
    }
    this.startDecayTracking(audioTime)
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

  /** Seed the capture window with the pre-roll, in chronological order, and open it. Returns the new
   *  capture's id. The part both capture starts share. */
  private openCaptureWindow(): number {
    const out = this.capture
    out.fill(0)
    const count = this.prerollFilled
    const startRing = (this.prerollIdx - count + this.prerollSamples) % this.prerollSamples
    for (let k = 0; k < count; k++) {
      out[k] = this.preroll[(startRing + k) % this.prerollSamples]!
    }
    this.captureIdx = count
    this.gatedCaptureActive = true // (the session WAV's pre-roll freezes on the next chunk — maintainSessionRecording)
    this.gatedCaptureId += 1
    return this.gatedCaptureId
  }

  /** Open a plate/brace gated capture — `gatedCaptureDuration` of audio, pre-roll first — for `phase`.
   *  Swift `startGatedCapture(phase:)`, with its safety timeout: once NO audio has arrived for 2 s, finish
   *  whatever arrived, or with nothing, say so and rest before re-arming (T6). On the WALL clock, since it
   *  exists for when the audio STOPS, and measured from the LAST chunk, so it never fires while audio is
   *  merely slow. */
  private startGatedCapture(phase: MaterialTapPhase): void {
    // A capture already filling absorbs the tap — Swift guards the same re-entry, comparing capture ids
    // because its window can start on the audio queue and finish before the main thread runs.
    if (this.gatedCaptureActive) return
    this.captureKind = 'material'
    this.capture = this.materialCapture
    const captureId = this.openCaptureWindow()
    this.afterAudioStall(MATERIAL_CAPTURE_SAFETY_MS, () => captureId === this.gatedCaptureId && this.gatedCaptureActive, () => {
      this.gatedCaptureActive = false
      const partial = this.capture.slice(0, this.captureIdx)
      this.captureIdx = 0
      if (partial.length > 0) {
        this.finishGatedFFTCapture(partial, this.mpmSampleRate, phase)
      } else {
        this.setStatusMessage('No signal detected — tap again')
        this.reEnableDetectionForNextPlateTap()
        this.notify()
      }
    })
  }

  /** Open a guitar gated capture — one FFT window of audio, pre-roll first. Swift
   *  `startGuitarGatedCapture()`, with its safety timeout: once NO audio has arrived for the window plus
   *  0.5 s, finish whatever arrived, or with nothing, say so and rest before re-arming (T6, as above). */
  private startGuitarGatedCapture(): void {
    if (this.gatedCaptureActive) return
    this.captureKind = 'guitar'
    this.capture = this.guitarCaptureBuf
    const captureId = this.openCaptureWindow()
    const timeoutMs = (this.capture.length / Math.max(this.mpmSampleRate, 1)) * 1000 + GUITAR_CAPTURE_SAFETY_EXTRA_MS
    this.afterAudioStall(timeoutMs, () => captureId === this.gatedCaptureId && this.gatedCaptureActive, () => {
      this.gatedCaptureActive = false
      const partial = this.capture.slice(0, this.captureIdx)
      this.captureIdx = 0
      if (partial.length > 0) {
        this.finishGuitarGatedCapture(partial, this.mpmSampleRate)
      } else {
        this.setStatusMessage('No signal detected — tap again')
        this.scheduleGuitarReEnable()
        this.notify()
      }
    })
  }

  /** Run `action` once NO audio has arrived for `intervalMs` of WALL time; stops checking once
   *  `relevant()` is false. Swift `afterAudioStall`. */
  private afterAudioStall(intervalMs: number, relevant: () => boolean, action: () => void): void {
    setTimeout(() => {
      if (!relevant()) return
      const quiet = performance.now() - this.lastChunkWallTime
      if (quiet >= intervalMs) action()
      else this.afterAudioStall(intervalMs - quiet, relevant, action)
    }, intervalMs)
  }

  private feedCapture(s: Float32Array): void {
    const n = Math.min(s.length, this.capture.length - this.captureIdx)
    this.capture.set(s.subarray(0, n), this.captureIdx)
    this.captureIdx += n
    if (this.captureIdx >= this.capture.length) this.finishCapture()
  }

  /** The capture window filled: hand its samples to the finisher for its kind — Swift's device side
   *  handing a full gated buffer to finishGuitarGatedCapture / finishGatedFFTCapture. */
  private finishCapture(): void {
    const samples = this.capture
    this.captureIdx = 0
    if (this.captureKind === 'material') {
      this.finishGatedFFTCapture(samples, this.mpmSampleRate, this.materialTapPhase)
    } else {
      this.finishGuitarGatedCapture(samples, this.mpmSampleRate)
    }
  }

  // ── The gated capture's alignment and peak selection ──────────────────────────────────────────
  // @parity dsp/gated-capture tests=test/file-playback,test/tap-decisions
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
  /** Samples at the start of a capture used to estimate its noise. Swift `onsetNoiseEstimateSamples`. */
  static readonly onsetNoiseEstimateSamples = 2048
  /** The onset is the first sample above this multiple of the noise RMS. Swift `onsetThresholdMultiplier`. */
  static readonly onsetThresholdMultiplier = 10.0
  /** The onset threshold's floor, for digital silence. Swift `onsetMinThreshold`. */
  static readonly onsetMinThreshold = 0.001
  /** Samples the onset is moved back, to keep the attack. Swift `onsetBackupSamples`. */
  static readonly onsetBackupSamples = 32

  /**
   * Re-anchor a captured buffer so the tap onset sits at a fixed index, making the FFT input independent
   * of level-crossing chunk boundaries. Swift `alignCaptureToOnset(_:windowSize:preOnsetSamples:)`:
   * estimate the noise from the first `onsetNoiseEstimateSamples`, set the onset threshold at
   * `onsetThresholdMultiplier` × that RMS (floored at `onsetMinThreshold`), scan for the first sample
   * above it, back up `onsetBackupSamples`, then extract `windowSize` samples with the onset at
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
    let sumSq = 0
    for (let i = 0; i < T.onsetNoiseEstimateSamples; i++) sumSq += (samples[i] as number) ** 2
    const noiseRms = Math.sqrt(sumSq / T.onsetNoiseEstimateSamples)
    const threshold = Math.max(noiseRms * T.onsetThresholdMultiplier, T.onsetMinThreshold)

    let onset = -1
    for (let i = 0; i < n; i++) {
      if (Math.abs(samples[i] as number) > threshold) {
        onset = i
        break
      }
    }
    if (onset < 0) {
      copyInto(0, 0, Math.min(n, windowSize))
      return out
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
    const { magnitudesDb, frequencies } = (this.device ?? new RealtimeFFTAnalyzer()).computeGatedFFT(aligned, sampleRate)
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
    const fftSize = this.device?.fftSize ?? GUITAR_FFT_SIZE
    const aligned = this.alignCaptureToOnset(samples, fftSize, Math.round(sampleRate * TapToneAnalyzer.preOnsetDuration))
    // The live path's rectangular window and fftSize, so the spectrum is bin-compatible with the live
    // frames (Swift `fftAnalyzer.computeFFT(on: chunk)`), then the input's calibration.
    const engine = this.device ?? new RealtimeFFTAnalyzer()
    const spectrum = this.applyCalibration({ magnitudesDb: engine.computeFFT(aligned), frequencies: engine.frequencies })
    this.gatedCaptureActive = false
    this.guitarTapCount += 1
    this.recordGuitarTap(spectrum)
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
    this.afterAudio(this.captureWindow, () => this.processMultipleTaps(), true)
  }

  /** Re-arm guitar detection after the rest: `tapCooldown` of AUDIO, then the latch is
   *  re-anchored from the chunk that made the rest due. After each captured tap of a multi-tap
   *  sequence, and when a capture timed out with no audio. Swift `scheduleGuitarReEnable`. */
  private scheduleGuitarReEnable(): void {
    this.afterAudio(this.tapCooldown, () => {
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
    if (this.cachedSnapshot === null) {
      this.cachedSnapshot = Object.freeze({
        detectionState: this.detectionState,
        isSettling: this.isSettling,
        isDetecting: this.isDetecting,
        isDetectionPaused: this.isDetectionPaused,
        isPlayingFile: this.isPlayingFile,
        hasResultToSaveOrExport: this.hasResultToSaveOrExport,
        playingFileName: this.device?.playingFileName ?? null,
        resultProvenance: this.resultProvenance,
        isReadyForDetection: this.isReadyForDetection,
        isMeasurementComplete: this.isMeasurementComplete,
        currentTapCount: this.currentTapCount,
        numberOfTaps: this.numberOfTaps,
        totalPlateTaps: this.totalPlateTaps,
        tapProgress: this.tapProgress,
        materialTapPhase: this.materialTapPhase,
        measurementType: this.measurementType,
        isGuitar: this.isGuitar,
        frozenSpectrum: this.frozenSpectrum(),
        tapEntries: this.tapEntries,
        peaks: this.peaks,
        loadedPeaks: this.loadedPeaks,
        peaksAbovePeakMin: this.peaksAbovePeakMin,
        peakMinThreshold: this.peakMinThreshold,
        modeByPeak: this.modeByPeak,
        overrides: this.overrides,
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
        captureAudioSaved: this.captureAudioSaved,
        materialPeaksFromLoad: this.materialPeaksFromLoad,
        sequenceStarts: this.sequenceStarts,
        showLoadedSettingsWarning: this.showLoadedSettingsWarning,
        loadedMeasurementName: this.loadedMeasurementName,
        loadedNotes: this.loadedNotes,
        loadedAxisRange: this.loadedAxisRange,
        loadedSettings: this.loadedSettings,
        microphoneWarning: this.microphoneWarning,
        microphoneWarningTitle: this.microphoneWarningTitle,
        currentDecayTime: this.currentDecayTime,
      })
    }
    return this.cachedSnapshot
  }

  // ── Display-mode transitions ────────────────────────────────────────────────────────────────
  // One method per transition Swift and Python perform, so the set is comparable line for line:
  //   loadComparison      Swift MeasMgmt:992  · Python :1163  — empty data ⇒ 'live'
  //   clearComparison     Swift :1046         · Python :1177
  //   setMultiTapComparison(true/false)  Swift :1134 / :1073 · Python :969 / :895
  //   enterFrozen         Swift :562          · Python :476   — loading one measurement
  //   loadComparisonRecord Swift :545         · Python :464   — loading a SAVED comparison
  //   enterLive           Swift Control:134   · Python control:621 — New Tap

  /** Overlay saved measurements. An EMPTY list leaves the mode 'live', matching
   *  `comparisonSpectra.isEmpty ? .live : .comparison` — the mode follows the data. */
  loadComparison(entries: ComparisonEntryModel[]): void {
    this.comparisonEntries = entries
    this.showingMultiTapComparison = false
    this.displayMode = entries.length === 0 ? 'live' : 'comparison'
    // An overlay is nobody's measurement: no name, notes, ring-out or recorded microphone. Its axis
    // range is the union of the overlaid ones. Mirrors Swift loadComparison (MeasMgmt:983-984 + the
    // setLoadedAxisRange below it). `loadMeasurement` re-applies the name when the overlay came from
    // a SAVED comparison record, which is the one case that has one.
    this.loadedMeasurementName = null
    this.loadedNotes = null
    this.microphoneWarning = null
    this.currentDecayTime = null
    this.loadedAxisRange = comparisonAxisRange(entries)
    // An overlay is frozen, like a loaded measurement — see enterFrozen. Empty entries mean we
    // stayed live, so there is nothing to freeze.
    if (entries.length > 0) this.disarmDetection()
    this.notify()
  }

  /** Loading a SAVED comparison record: like loadComparison, but the per-tap overlay is dropped
   *  first (Swift clears tapEntries and showingMultiTapComparison at :545). */
  loadComparisonRecord(entries: ComparisonEntryModel[]): void {
    this.tapEntries = []
    this.loadComparison(entries)
  }

  /** Stop comparing; back to live. Swift clearComparison. */
  clearComparison(): void {
    this.comparisonEntries = []
    this.showingMultiTapComparison = false
    this.displayMode = 'live'
    this.notify()
  }

  /** The per-tap overlay of the CURRENT measurement. Enabling enters 'comparison'; disabling
   *  returns to 'live' — the measurement itself still displays, because it is complete. */
  setMultiTapComparison(enabled: boolean): void {
    this.showingMultiTapComparison = enabled
    if (!enabled) this.comparisonEntries = []
    this.displayMode = enabled ? 'comparison' : 'live'
    this.notify()
  }

  /** A single measurement is displayed — loaded from the library, or just captured. */
  enterFrozen(): void {
    this.comparisonEntries = []
    this.showingMultiTapComparison = false
    // The loaded measurement displays because it is complete, not because of the mode.
    this.displayMode = 'live'
    // A frozen result must not keep listening: the engine arms into 'listening' at startup, so
    // without this a stray tap captures over the loaded measurement, and isDetecting stays true
    // alongside isMeasurementComplete (invariant I1). Mirrors Swift loadMeasurement ("Tap detection
    // is disabled", isDetecting = false) / Python load_measurement (is_detecting = False).
    this.disarmDetection()
    this.notify()
  }

  /** Live input. New Tap, and the end of a device-change settle. */
  enterLive(): void {
    this.comparisonEntries = []
    this.showingMultiTapComparison = false
    this.displayMode = 'live'
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
   *  One place decides precedence — dead input, then clipping, then whatever the analyzer last set
   *  — so the two overrides cannot fight each other or leave a stale warning on screen after its
   *  condition clears. Dead input outranks clipping: a dead input cannot also be clipping, and "no
   *  audio" is the more actionable message. Mirrors Swift `applyStatusOverrides()` and Python
   *  `_apply_status_overrides()`. */
  private applyStatusOverrides(): void {
    this.statusMessage = this.inputAppearsDead
      ? DEAD_INPUT_WARNING
      : this.isClipping
        ? CLIPPING_WARNING
        : this.latestRealStatus
  }

  /** The device forwards edge-triggered input clipping here (Swift `fftAnalyzer.$isClipping` sink /
   *  Python `clippingChanged` → `_set_clipping`). Overrides the status with the warning, restores on clear. */
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

  /** The guitar resting prompt (canonical post-warm-up steady state). */
  private tapPrompt(): string {
    return this.numberOfTaps === 1 ? 'Tap the guitar...' : `Tap the guitar ${this.numberOfTaps} times...`
  }

  /** The prompt a material (plate/brace) sequence shows while armed in its CURRENT phase — the
   *  single source for these strings.
   *
   *  Three callers, which is the point: `startTapSequence` (which sets the phase before the status),
   *  the phase advances in `acceptMaterial`, and `restingPrompt()` — so a resume or a tap-count
   *  change cannot reword the instruction the user is following. Mirrors Swift `materialArmPrompt()`
   *  and Python `_material_arm_prompt()`.
   *
   *  The fL branch is count-aware, because that is the phase whose prompt names the tap count and
   *  the only phase where the Taps stepper is still unlocked. */
  private materialArmPrompt(): string {
    switch (this.materialTapPhase) {
      case 'capturingC':
        return 'Rotate 90° and tap for fC'
      case 'waitingForFlcTap':
      case 'capturingFlc':
        return 'Set up for fLC tap, then tap'
      default: {
        // capturingL / notStarted.
        if (this.numberOfTaps <= 1) return 'Ready for fL tap'
        if (this.measurementType === 'brace') return `Ready for fL tap (×${this.numberOfTaps})`
        const phases = this.measureFlc ? 'L, C, FLC' : 'L, C'
        return `Ready for fL tap (×${this.numberOfTaps} each for ${phases})`
      }
    }
  }

  /** The status to restore when a device-change settle ends, or `null` to leave it alone.
   *
   *  A live prompt is a function of state, so it is derived rather than chosen from fixed strings —
   *  a mid-sequence prompt then counts the taps already captured, and a finished measurement is
   *  never told to tap again. Nothing is returned where the status is a RESULT announcement rather
   *  than a live prompt, because a completed or loaded measurement's status ("Analysis complete! N
   *  peaks…", "Loaded measurement (frozen)") is not re-derivable and must not be thrown away.
   *  Mirrors Swift statusAfterSettle() and Python _status_after_settle(). */
  /** The status to show when a settle ends, given what it said before the settle began. The whole
   *  decision in one pure function, so every edition can pin it. Mirrors Swift
   *  restoredStatus(before:) and Python _restored_status(). */
  restoredStatus(before: string): string {
    return this.statusAfterSettle() ?? before
  }

  statusAfterSettle(): string | null {
    if (this.isMeasurementComplete) return null   // "Analysis complete…" / "Loaded measurement…"
    if (this.displayMode === 'comparison') return null  // an overlay is not a tap prompt
    if (this.isDetectionPaused) return PAUSED_STATUS
    if (this.isDetecting) {
      // A material phase prompt is an INSTRUCTION tied to a transition that already happened —
      // "Rotate 90° and tap for fC" — not a description of the state the analyzer is in, so it is
      // not re-derivable here: after a device swap the user has already rotated the plate. Preserve
      // it, exactly as a completed measurement's announcement is preserved. Guitar's prompt IS a
      // function of count and total, both of which the analyzer holds, so it is still derived.
      if (!this.isGuitar) return null
      return this.restingPrompt()
    }
    return 'Ready'
  }

  /** The resting "waiting for a tap" prompt for the current mode/phase (used on resume + tap-count change). */
  private restingPrompt(): string {
    if (this.isGuitar) {
      return this.currentTapCount === 0
        ? this.tapPrompt()
        : `Tap ${this.currentTapCount}/${this.numberOfTaps} captured. Tap again...`
    }
    return this.materialArmPrompt()
  }

  /** Material completion string: plate without FLC shows fL + fC; otherwise a generic complete. */
  private materialCompleteString(): string {
    if (this.measurementType !== 'brace' && !this.measureFlc) {
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
      this.setStatusMessage(this.restingPrompt())
    }
    // The user changed Taps, so the loaded measurement's settings no longer describe what is on
    // screen. Mirrors Swift numberOfTaps.didSet and Python set_tap_num.
    this.showLoadedSettingsWarning = false
    this.notify()
  }

  /** The user changed a setting the loaded measurement also carries, so its banner no longer
   *  applies. Swift and Python do this inside `tapDetectionThreshold`'s setter, which they can
   *  because the threshold is analyzer state there; on the web the slider writes `settings`, so the
   *  view reports the change instead. */
  noteLoadedSettingsDeviation(): void {
    if (!this.showLoadedSettingsWarning) return
    this.showLoadedSettingsWarning = false
    this.notify()
  }


  /** The device forwards its engine-state transitions here (was setDetecting). Drives isDetecting/
   *  isDetectionPaused AND the guitar status strings (the device owns the guitar detection loop, so the
   *  guitar "capturing…/captured…" strings derive from these transitions — Swift's TapDetection loop).
   *  Pause applies to both modes; resume restores the resting prompt; material status is otherwise owned
   *  by the material transitions (recordMaterialTap / accept / redo), so it is left untouched here. */
  /** The guitar loop's status string. Mirrors Swift `guitarLoopStatus(capturing:)`, and is called
   *  at the same transitions Swift calls it at: capture begin, capture end/re-arm, and resume. */
  guitarLoopStatus(capturing: boolean): string {
    const total = this.numberOfTaps
    const count = this.currentTapCount
    if (capturing) {
      const prov = Math.min(count + 1, total)
      return prov < total ? `Tap ${prov}/${total} capturing...` : 'All taps captured. Processing...'
    }
    return count === 0 ? this.tapPrompt() : `Tap ${count}/${total} captured. Tap again...`
  }

  setComplete(v: boolean): void {
    this.isMeasurementComplete = v // uses the didSet (clears the loaded-settings warning)
    this.notify()
  }

  setMeasurementTypeAndNotify(t: MeasurementType): void {
    this.measurementType = t
    // The type decides whether Peak Min applies at all (guitar-only), so the projection is stale
    // the instant it changes. Mirrors Swift's refreshDisplayedPeaks() reading measurementType.
    this.refreshDisplayedPeaks()
    this.notify()
  }

  /** A hardware input change: show "Audio device changed - reinitializing…" while settling, then restore
   *  the resting prompt (Swift route-change status). The device layer drives both edges. */
  handleDeviceChange(settling: boolean): void {
    // Readiness follows the settle, as it does in Swift (`isReadyForDetection`, false for
    // fftSettleTime) and Python. New Tap is disabled while the input is reinitialising.
    this.isReadyForDetection = !settling
    if (settling) {
      // Remember what the status said BEFORE the transient replaces it. statusAfterSettle() returns
      // null for the states whose status is a result announcement rather than a prompt, and "leave
      // it alone" means restoring THIS, not leaving the transient up. Guarded so a repeated settling
      // edge cannot capture the transient itself.
      // `latestRealStatus`, NOT `statusMessage`: the latter is the OVERRIDE-RESOLVED string, and
      // feeding a clipping or dead-input warning back through setStatusMessage() as the real status
      // would restore the warning after its condition cleared. The override layer re-resolves on its own.
      if (this.statusBeforeSettle === null) this.statusBeforeSettle = this.latestRealStatus
      // Blank the chart only if a LIVE spectrum is on screen — a completed or loaded measurement
      // keeps its result, exactly as in Swift/Python.
      if (!this.isMeasurementComplete && this.displayMode !== 'comparison') {
        this.isSettling = true
        // Clear the peak annotations so they don't float on a blank chart during the settle (Swift).
        this.peaks = []
        this.modeByPeak = new Map()
        this.refreshDisplayedPeaks()
      }
      this.setStatusMessage('Audio device changed - reinitializing...')
    } else {
      this.isSettling = false
      this.setStatusMessage(this.restoredStatus(this.statusBeforeSettle ?? 'Ready'))
      this.statusBeforeSettle = null
    }
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
  /** A loaded measurement's authoritative saved peaks, or null for a live capture. Analyzer-owned so
   *  it can never be seen out of step with the frozen spectrum. */
  loadedPeaks: ResonantPeak[] | null
  /** The Peak-Min display projection of `peaks` (material passes through unfiltered). What the peak
   *  list, the chart dots and the live ratio read. Never the set to save. */
  peaksAbovePeakMin: ResonantPeak[]
  /** The Peak Min display threshold the projection was computed at. */
  peakMinThreshold: number
  /** Mode classification for `peaks`, keyed by peak id. */
  modeByPeak: Map<string, ResolvedMode>
  /** Manual mode-label overrides, keyed by peak `id` (analyzer-owned). */
  overrides: Map<string, string>
  /** Dragged annotation-label positions, keyed by peak `id` (one store for guitar + material). */
  annotationOffsets: Map<string, [number, number]>
  /** The definitive-peak selection, by peak `id` (concrete analyzer state). */
  selectedPeakIds: Set<string>
  /** Whether the selection was hand-modified since the last auto-select (drives the wand's enabled state). */
  userModifiedSelection: boolean
  /** The highlighted peak id (chart-dot ↔ results-row cross-highlight), or null. Transient view state. */
  highlightedPeakId: string | null
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
  loadedAxisRange: ChartView | null
  loadedSettings: Partial<Settings> | null
  /** The loaded measurement's microphone is missing, or its calibration / sample rate differs. */
  microphoneWarning: string | null
  /** The title of the alert that shows `microphoneWarning`. */
  microphoneWarningTitle: string
  /** Ring-out of what is on screen — the file's when loaded, the live tracker's during a capture. */
  currentDecayTime: number | null
}
