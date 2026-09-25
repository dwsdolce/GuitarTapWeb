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
import { averageSpectra } from '../dsp/spectrumAverage'
import type { Spectrum } from '../dsp/guitarFFT'
import { findPeaks, PEAK_DETECTION_FLOOR, type Peak } from '../dsp/peaks'
import { classifyAll, resolvedModePeaks, type ResolvedMode } from '../dsp/classify'
// The one override-aware mode resolver (mirrors Swift GuitarMode.effectiveMode). A minor state→presentation
// import (precedent: MaterialPeaks from components) — the resolver lives with the mode↔label map it needs.
import { effectiveMode as resolveEffectiveMode } from '../presentation/modeColors'
import type { GuitarTypeName } from '../dsp/guitarModes'
import type { ComparisonEntryModel, TapToneMeasurementModel } from '../measurement/types'
import { comparisonAxisRange, measurementToLive, measurementToLiveMaterial, measurementWarning } from '../measurement/fromLive'
import type { ChartView } from '../presentation/chartTypes'
import { PLATE_PHASES, BRACE_PHASE, findDominantPeak, alignCaptureToOnset, GATED_FFT_WINDOW_DURATION, PRE_ONSET_DURATION, type MaterialPeak, type DetectedMaterialPeak } from '../dsp/gatedCapture'
import { gatedHannFFT } from '../dsp/gatedFFT'
import { dftAnalRect, GUITAR_FFT_SIZE } from '../dsp/guitarFFT'
import type { RealtimeFFTAnalyzer, MaterialSearch, MaterialPhaseName, EngineState } from '../audio/realtimeFFTAnalyzer'
import type { MaterialPeaks } from '../components/MaterialResults'
// Single shared MeasurementType + guard (mirrors Swift's shared MeasurementType enum) — the settings
// store owns them; the analyzer no longer duplicates the type.
import { isGuitarType, DEFAULT_SETTINGS, type MeasurementType, type Settings } from '../settings'
import { materialInputsFromSettings, type MaterialMeasurementInputs } from '../measurement/materialMeasurementInputs'
import { dumpCaptureWav } from '../measurement/dumpWav'

/** The tap detector's state. Mirrors Swift `DetectionState` (DetectionState.swift) and Python
 *  `DetectionState` (models/detection_state.py).
 *
 *      idle ──────▶ listening ──────▶ idle
 *                      │   ▲            (tap captured, sequence cancelled,
 *                      ▼   │             measurement loaded, stop)
 *                   paused ┘
 *             (pause/resume, mid-sequence)
 *
 *  This replaced an `isDetecting` / `isDetectionPaused` boolean pair. Two booleans can express
 *  "detecting AND paused" — a state no code path intends, which every site touching either flag
 *  had to avoid by hand, and which the invariant suite existed partly to catch after the fact.
 *  One value makes it unrepresentable. Both booleans survive as derived reads (#17 F30). */
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
const EMPTY_MAT_PEAKS: MaterialPeaks = { longitudinal: null, cross: null, flc: null }

/** The clipping-override warning (Swift `TapToneAnalyzer.clippingWarningStatus` / Python
 *  `_set_clipping`). Displayed while the input clips, then the real status is restored. */
const CLIPPING_WARNING = '⚠ Input clipping — reduce mic gain'
/** Shown while the input delivers buffers that carry no signal. Outranks the clipping warning.
 *  Mirrors Swift `TapToneAnalyzer.deadInputStatus` / Python `DEAD_INPUT_STATUS`. */
const DEAD_INPUT_WARNING = '⚠ No audio input — check the microphone connection'

/** A material phase peak's frequency, 1 dp, or '?' when none — for the status-bar review/complete strings. */
const fHz = (p: { frequency: number } | null): string => (p ? p.frequency.toFixed(1) : '?')
/**
 * What the main spectrum display is currently showing — the authoritative mode gate.
 *
 * Mirrors Swift `AnalysisDisplayMode` and Python `AnalysisDisplayMode`, including the rule that
 * the mode is DERIVED from whether there is overlay data: an empty comparison is `live`, not
 * `comparison` (Swift `comparisonSpectra.isEmpty ? .live : .comparison`).
 *
 * This lived in the view as a derived boolean (`comparison != null` in App.tsx) until #17 F24.
 * Three states in one value make "frozen AND comparison" unrepresentable, which is the property
 * both natives rely on and the view could only approximate by clearing at every call site.
 */
/** The main spectrum is shown ('live' — live input, or the measurement's own frozen result once
 *  `isMeasurementComplete` is set), or saved measurements are overlaid ('comparison').
 *
 *  Those first two are NOT distinguished: there used to be a 'frozen' value, but nothing in any
 *  edition ever branched on it, because whether a result is displayed is what
 *  `isMeasurementComplete` says. Keeping both meant two fields describing one fact — and in the
 *  natives no completion path set it, so the device-settle guard wiped finished measurements
 *  (#17 F35). */
export type DisplayMode = 'live' | 'comparison'

/** Loaded-measurement (frozen) status — curly quotes around New Tap match Swift/Python. */
const LOADED_STATUS = 'Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.'
/** Shown while a sequence is PAUSED. One literal, used by pauseTapDetection() and by
 *  statusAfterSettle(), so a device change cannot silently reword a paused sequence. */
const PAUSED_STATUS = 'Detection paused – tap freely, then resume'
/** Short phase label for the "L/C/FLC tap X/N captured" progress strings. */
const matPhaseLabel = (ph: MaterialPhaseName): string => (ph === 'cross' ? 'fC' : ph === 'flc' ? 'fLC' : 'fL')

// Swift tapCooldown (0.5 s): after the C tap is accepted, the FLC capture is held disarmed for this
// long while the user repositions the plate, so the repositioning bump can't be taken as the FLC tap.
const FLC_COOLDOWN_MS = 500
// Swift tapCooldown (0.5 s): after each guitar tap of a multi-tap sequence, detection rests this long
// before re-arming, so a bounce or a hurried second strike is not captured as the next tap.
const TAP_COOLDOWN_MS = 500
// Swift captureWindow (0.2 s): after the LAST guitar tap, "All taps captured. Processing..." shows for
// this long before the taps are averaged into the result.
const CAPTURE_WINDOW_MS = 200

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

/** One per-tap entry for the multi-tap comparison view: its spectrum + the peaks found on it (at the
 *  current Peak Min). Mirrors Swift `TapEntry` (snapshot + peaks). The web derives per-mode selection
 *  on demand (the multi-tap table is read-only) rather than storing selectedPeakIDs. */
export interface TapEntry {
  tapIndex: number
  spectrum: Spectrum
  peaks: Peak[]
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
   *  device's not-yet-valid audio. Swift and Python blanked here and web did not — a behaviour
   *  divergence rather than a deliberate difference (#17 F35). */
  isSettling = false
  private _currentTapCount = 0
  /** Taps captured so far. Guitar: 0…numberOfTaps. Material: CUMULATIVE across phases.
   *
   *  An accessor rather than a plain field so that `tapProgress` is snapshotted on EVERY write,
   *  including from App and from tests — the explicit-call-site version missed external writers. */
  get currentTapCount(): number { return this._currentTapCount }
  set currentTapCount(n: number) {
    this._currentTapCount = n
    this.syncTapProgress()
  }
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
  // Per-tap entries for the multi-tap comparison view (spectrum + peaks). Mirrors Swift `tapEntries`.
  // Built from capturedTaps at completion (>1 tap), restored on load, cleared on reset — distinct from
  // the raw `capturedTaps` (which are NOT restored on load), exactly like Swift's tapEntries vs
  // capturedTaps split. Each entry's peaks are (re)found by recalculatePeaks at the current Peak Min.
  tapEntries: TapEntry[] = []
  // Main peaks detected on the frozen spectrum (or filtered from a loaded measurement's authoritative
  // peaks) + their mode classification. Owned by the analyzer, mirroring Swift `currentPeaks` /
  // `identifiedModes` (recomputed by recalculatePeaks — the web's recalculateFrozenPeaksIfNeeded). 3c §10 P1.
  peaks: Peak[] = []
  // The Peak-Min DISPLAY projection of `peaks` — the same peak objects, filtered to the slider.
  // Mirrors Swift `peaksAbovePeakMin` / Python `peaks_above_peak_min`. Assigning `peaks` or
  // `peakMinThreshold` is the ONLY way this changes; nothing else may write it.
  //
  // This lives on the analyzer, not in the view. "Peak Min is guitar-only, material is never
  // filtered" is a rule about the MEASUREMENT, and it had been implemented in App.tsx as a useMemo
  // — so every other consumer (the save path, the PDF, the multi-tap table, the unit tests) had to
  // re-derive it and could disagree. One rule, one home.
  peaksAbovePeakMin: Peak[] = []
  // The authoritative saved peaks of a LOADED measurement, or null for a live capture. Owned by the
  // analyzer, not the view, so that it and the frozen spectrum can never be seen half-applied:
  // a render that saw the spectrum set while this was still null would take the live branch,
  // re-detect, mint fresh ids, and wipe the overrides/offsets/selection just restored from the file.
  // Mirrors Swift `loadedMeasurementPeaks` / Python `loaded_measurement_peaks`.
  loadedPeaks: Peak[] | null = null
  // True for the duration of `loadMeasurement`, which applies the whole restore — spectrum, per-tap
  // entries, peaks, overrides, offsets, selection — as ONE step. `recalculatePeaks` returns early
  // while it is set, so nothing can recalculate against a half-applied measurement and clobber what
  // is being loaded. Mirrors Swift `isLoadingMeasurement` / Python `is_loading_measurement`.
  //
  // Web-specific note: this used to be absent, and the parity table recorded it as "n/a — the view
  // drives the load, so there is no state to construct". The restore was five separate analyzer
  // calls orchestrated by App.tsx, so the protection came from React batching the handler rather
  // than from the model. That made correctness of a loaded measurement's per-peak state depend on
  // statement order inside a 100-line view handler, untested and easy to break.
  isLoadingMeasurement = false
  modeByPeak: Map<number, ResolvedMode> = new Map()
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
  // Per-peak manual mode-label overrides, keyed by peak `id` (RA — was the view's frequency-keyed
  // `useAnnotations` map). The value stays the display label string (a predefined mode name or a
  // freeform label), matching the web's existing override idiom; only the KEY moved from frequency to
  // id, so the state now lives with the peaks it describes. Carried across a peak re-mint by
  // `applyFrozenPeakState` (±REMAP_TOLERANCE_HZ) and cleared on a blank-slate reset (`clearResult`).
  // Mirrors Swift `peakModeOverrides` / Python `_peak_mode_overrides` (both id/UUID-keyed).
  overrides: Map<number, string> = new Map()
  // Dragged annotation-label positions, keyed by peak `id` → [absFreqHz, absDB] (RB — moved off the
  // view's frequency-keyed useAnnotations store). ONE store for guitar AND material, matching Swift's
  // single `peakAnnotationOffsets: [UUID: CGPoint]` and Python's `peak_annotation_offsets` — whose
  // material peaks are id-bearing too. Guitar entries are carried across a re-mint by
  // `applyFrozenPeakState`; material entries never re-mint. Guitar and material never coexist (cleared
  // between by clearResult / resetMaterial), so their ids share one map without collision.
  annotationOffsets: Map<number, [number, number]> = new Map()
  // Monotonic id source for STORED material (L/C/FLC) peaks, so each identified peak gets a stable id
  // its dragged offset keys on. Fresh per store (like Swift minting a new UUID per capture), so a Redo
  // orphans the old offset, matching Swift/Python.
  private nextMaterialPeakId = 0
  // Selection — which peak is the DEFINITIVE Air/Top/Back (RC — moved off the view's useAnnotations).
  // CONCRETE state (full-Swift paradigm, not a derived set): always recomputed on a peak re-mint by
  // applyFrozenPeakState (unmodified → auto; modified → carry-forward). Mirrors Swift `selectedPeakIDs`.
  selectedPeakIds: Set<number> = new Set()
  // Stable frequency cache for the selection, mirroring Swift `selectedPeakFrequencies`: a selected peak
  // hidden below Peak Min keeps its frequency here so it re-selects when the slider reveals it again.
  selectedPeakFrequencies: number[] = []
  // Whether the user has hand-modified the selection since the last auto-select. False → a re-mint
  // re-runs auto-selection; true → the selection is carried forward by frequency. Swift
  // `userHasModifiedPeakSelection`. (Phase 5's enforce-uniqueness will read/maintain this same state.)
  userModifiedSelection = false
  // The highlighted peak — transient VIEW state for the chart-dot ↔ results-row cross-highlight; NOT
  // selection and NOT measurement state (lives here like Swift/Python `highlightedPeakID`, but is never
  // persisted). Toggled by clicking a peak dot or its results row (desktop only); cleared on a fresh sequence.
  highlightedPeakId: number | null = null
  materialTapPhase: MaterialTapPhase = 'notStarted'
  // Material (plate/brace) result data — the per-phase averaged spectra + located peaks. Owned by the
  // analyzer, mirroring Swift longitudinalSpectrum/crossSpectrum/flcSpectrum + the material peaks. 3c-C3.
  matSpectra: MatSpectra = EMPTY_MAT_SPECTRA
  matPeaks: MaterialPeaks = EMPTY_MAT_PEAKS
  // Whether the plate FLC tap is measured. Swift reads TapDisplaySettings.measureFlc / Python
  // _tds.measure_flc(); the web has no analyzer-visible global, so App mirrors it via setMeasureFlc.
  measureFlc = false
  measurementType: MeasurementType = 'classical'
  /** A measurement was just loaded and its Threshold/Taps are in force — the banner's state.
   *  MODEL state, as in Swift (`@Published var showLoadedSettingsWarning`) and Python. It used to be
   *  declared here, set false once, and read by nobody, while the real flag lived in an `App.tsx`
   *  useState with its clears spread across five view call sites — a stub that made the analyzer
   *  look like it owned something it did not (#17 F40, the shape of F24). */
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
  /** Ring-out (decay) time in seconds of what is on screen: the file's when a measurement is loaded,
   *  the live tracker's during a capture (the device pushes it through `setDecayTime`). ONE value, as
   *  Swift `currentDecayTime` and Python `current_decay_time` — the view used to hold two and choose
   *  between them. Cleared by startTapSequence, as in Swift. */
  currentDecayTime: number | null = null

  // The settings the model needs to seed Store B at a material completion. Swift and Python read the
  // TapDisplaySettings singleton from inside the model; the web has no analyzer-visible global, so App
  // mirrors the whole object in via setSettings from the same layout effect that pushes
  // measurementType and measureFlc. Held for the material seed below — anything else that wants a
  // setting should get its own explicit push, so the model's dependencies stay readable.
  settings: Settings = DEFAULT_SETTINGS
  // Store B — the current material measurement's OWN dimensions. `null` for guitar and before a
  // material measurement completes. Seeded from Settings at the completion transition (the setter
  // below), restored from the file's snapshot by restoreMaterial, and edited through
  // setMaterialInputs. The sole source for MaterialResults' calc and for Save; never the live
  // Settings. Mirrors Swift `analyzer.materialInputs` / Python `analyzer.material_inputs`.
  materialInputs: MaterialMeasurementInputs | null = null

  // ── Status-bar message (imperative field — mirrors Swift @Published `statusMessage` / Python
  // `status_message`, set at every transition; 6-TEST 3c-C4 D3). `latestRealStatus` stashes the last
  // analyzer-set string so the clipping override can restore it (Swift `latestRealStatus` / Python
  // `_latest_real_status`). Written only through `setStatusMessage` / `setClipping`.
  // @parity state/status-message  tests=test/status-message
  statusMessage = 'Tap the guitar to begin'
  private latestRealStatus = 'Tap the guitar to begin'
  private isClipping = false
  /** Input delivering chunks that carry no signal — outranks clipping in the status override. */
  private inputAppearsDead = false
  // The device owns the guitar detection loop, so the guitar status strings derive from these transitions
  // (the web equivalent of Swift's TapToneAnalyzer+TapDetection setting statusMessage in the loop).
  // The "Analysis complete! N peaks…" string is set ONCE at completion (Swift/Python set it in the guitar
  // processing path, NOT in the peak recalc — so N is frozen at completion, not updated by the Peak-Min
  // slider). The web computes peaks in recalculatePeaks (App-driven), so this flag makes the first
  // post-completion recalc announce and later recalcs (slider moves) leave the status alone. 6-TEST 3c-C4.
  private analysisAnnounced = false

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
   *  refilling each phase. Mirrors Swift `tapProgress` (SpectrumCapture:698 guitar / :953 material). */
  tapProgress = 0
  /** The status from before a device-change settle began, restored when the settle has nothing of
   *  its own to say. `null` when no settle is in flight. */
  private statusBeforeSettle: string | null = null

  /** Snapshot the progress from the CURRENT count. Called wherever `currentTapCount` changes, and
   *  nowhere else.
   *
   *  This was a computed getter, which re-derived on every render — so raising the tap count after
   *  a finished measurement retroactively shrank its progress bar (complete a 1-tap measurement,
   *  set Taps to 3, and the full bar dropped to a third). Swift and Python both STORE it, writing
   *  at each capture site and pinning 1.0 at completion, so a completed measurement's bar records
   *  what was actually measured and a later count change — which only configures the NEXT
   *  measurement — cannot rewrite it (#17 F34). */
  private syncTapProgress(): void {
    const total = this.isGuitar ? this.numberOfTaps : this.totalPlateTaps
    this.tapProgress = total > 0 ? Math.min(1, this._currentTapCount / total) : 0
  }

  /** Cumulative taps completed in the phases BEFORE `phase` — the base the material `currentTapCount`
   *  rebases to on accept / redo / file auto-advance. Guarded on the prior phases actually having been
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
   *  This is the web's `startTapSequence(skipWarmup:initialPhase:)` / `start_tap_sequence(skip_warmup,
   *  initial_phase)`. Both natives route EVERY New Tap through their single method, which is why
   *  neither can forget to clear the comparison on one type's path — the bug #17 F24 shipped with,
   *  when material New Tap went through a separate `startMaterial` that never returned to live.
   *
   *  `arm: false` is for file playback, where the engine owns the L→C→FLC auto-advance and must not be
   *  re-armed underneath it, and for tests that run without a device.
   *
   *  `detectionState` is owned here, as it is in Swift and Python: the arming paths below set it
   *  directly, and the `arm: false` branch covers the direct/test path where no device reports back. */
  startTapSequence(opts: { initialPhase?: MaterialTapPhase; arm?: boolean; skipWarmup?: boolean } = {}): void {
    const { initialPhase, arm = true, skipWarmup = false } = opts
    this.clearFlcCooldown()
    // The shared reset — result data, per-peak state, completion flag, and the return to live.
    this.clearResult()
    this.currentTapCount = 0
    // The user is explicitly starting a new sequence, so the loaded measurement's Threshold/Taps are
    // now theirs. Mirrors Swift startTapSequence (Control.swift:149) and Python start_tap_sequence;
    // covers the measurement-type change, file playback and New Tap/Cancel paths, each of which the
    // view used to clear by hand (#17 F40).
    this.showLoadedSettingsWarning = false
    // …and with it everything else the loaded measurement left behind: this sequence is no longer
    // "the loaded one". Mirrors Swift startTapSequence (Control.swift:135-136, :163).
    this.loadedMeasurementName = null
    this.loadedNotes = null
    this.loadedAxisRange = null
    this.loadedSettings = null
    this.currentDecayTime = null
    this.showingMultiTapComparison = false
    // No pause-clear here: the arming below moves straight to 'listening', which leaves 'paused'
    // on its own. Mirrors Swift/Python startTapSequence.

    if (this.isGuitar) {
      if (arm) {
        // skipWarmup mirrors Swift startTapSequence(skipWarmup:) — guitar file playback skips it,
        // because an externally recorded file may put the tap inside the first 0.5 s and guitar
        // detects against the absolute threshold, so it never reads the noise floor.
        this.armGuitarDetection(skipWarmup)
        this.startSessionRecording() // begin the continuous session WAV (dump-gated)
      } else {
        this.detectionState = 'listening'
      }
      // Guitar resting prompt (canonical post-warm-up steady state). In the app the device's arm →
      // setEngineState('listening') also sets this; here it covers the direct/test path.
      this.setStatusMessage(this.tapPrompt())
    } else {
      this.matPeaks = EMPTY_MAT_PEAKS
      this.matSpectra = EMPTY_MAT_SPECTRA
      this.materialBuffer = []
      this.nextMaterialPeakId = 0
      this.materialTapPhase = initialPhase ?? 'capturingL'
      if (arm) {
        // startSessionRecording seeds checkpoint [0] (the L-phase truncation anchor), so no explicit
        // checkpoint is needed here.
        this.startSessionRecording()
        this.armMaterialDetection(this.matSearch('longitudinal'))
      } else {
        // Same as the guitar branch above: leaving `arm` out must not leave the detection state
        // untouched, or a sequence started from `paused` would stay paused. Swift and Python have
        // no `arm` parameter at all — they always end startTapSequence listening — so this keeps
        // the unarmed path saying the same thing they do (#17 F30).
        this.detectionState = 'listening'
      }
      // capturingL arm prompt = "Ready for L tap" (mirrors Swift startTapSequence; the silent
      // warm-up on Swift/Python now shows this too — was "Tap the guitar…", a divergence).
      this.setStatusMessage(this.materialArmPrompt())
    }
    this.notify()
  }

  /** Begin a fresh guitar tap accumulation (the device armed at 0 taps): drop any prior per-tap
   *  spectra so the next recordGuitarTap starts clean. Only the accumulation — detection / pause /
   *  completion are driven by the device's state events (6-TEST 3c-C2a). */
  beginGuitarAccumulation(): void {
    this.capturedTaps = []
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
   *  per-tap display spectra (>1 tap only, mirroring Swift processMultipleTaps building tapEntries),
   *  and set isMeasurementComplete. No-op when no taps were captured. */
  processMultipleTaps(): void {
    if (this.capturedTaps.length === 0) return // guard: nothing to freeze (MC6)
    const spectra: Spectrum[] = this.capturedTaps.map((t) => ({
      magnitudesDb: t.magnitudes,
      frequencies: t.frequencies,
    }))
    const avg = averageSpectra(spectra)
    this.frozenMagnitudes = avg.magnitudesDb
    this.frozenFrequencies = avg.frequencies
    // Per-tap entries only for a genuine multi-tap capture (Swift tapEntries gate: count > 1). Phase 3:
    // each entry's peaks are found ONCE here, at the -100 floor, and are thereafter DURABLE —
    // recalculatePeaks no longer re-derives them (mirrors Swift building tapEntries at capture +
    // deleting recalculateTapEntryPeaks). findPeaks ignores guitarType; classification is at render.
    this.tapEntries =
      this.capturedTaps.length > 1
        ? spectra.map((sp, i) => ({
            tapIndex: i + 1,
            spectrum: sp,
            peaks: findPeaks(sp.magnitudesDb, sp.frequencies, { peakMinOverride: PEAK_DETECTION_FLOOR }),
          }))
        : []
    this.isMeasurementComplete = true
    this.notify()
  }

  /** Cancel the sequence by restarting it: re-arm a fresh sequence (≡ New Tap), NOT
   *  complete the measurement. Mirrors Swift cancelTapSequence (which delegates to
   *  startTapSequence). Cancel is only offered while a multi-step sequence is active. */
  cancelTapSequence(): void {
    this.startTapSequence()
  }

  /** Load a saved measurement — guitar, material or comparison record. THE load entry point.
   *
   *  Mirrors Swift `loadMeasurement(_:)` and Python `load_measurement()`: hand it the saved
   *  measurement and the model works out what kind it is, converts it, restores itself, and records
   *  what it loaded (name, notes, axis range, settings, microphone warning, ring-out) for the view
   *  to react to. It used to be ~110 lines in `App.tsx` that converted the file, wrote five pieces of
   *  React state, told the engine, and handed the analyzer the already-converted parts — so "load a
   *  measurement" existed only as a sequence in the view, and no other caller (an import, a test)
   *  could perform one (#17 F41).
   *
   *  The view still does what only it can: apply `loadedSettings` to the settings store and the
   *  axis range to the chart, exactly as Swift's `.onReceive(tap.$loaded…)` handlers do. */
  loadMeasurement(m: TapToneMeasurementModel): void {
    // A comparison record restores its overlay spectra directly and is not a single measurement.
    if (m.comparisonEntries) {
      this.loadedPeaks = null
      this.clearResult() // returns to live and drops any overlay...
      this.loadComparisonRecord(m.comparisonEntries) // ...then enters comparison (clears loaded state)
      this.loadedMeasurementName = m.measurementName ?? null // ...but a SAVED record has a name
      this.loadedNotes = m.notes ?? null
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
        matPeaks: mat.matPeaks,
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
        taps: (m.tapEntries ?? []).map((e) => ({
          magnitudesDb: e.snapshot.magnitudes,
          frequencies: e.snapshot.frequencies,
        })),
        loadedPeaks: live.loadedPeaks,
        overrides: live.overridesById,
        annotationOffsets: live.annotationOffsetsById,
        selection: {
          ids: live.selectedIndices,
          frequencies: live.loadedPeaks
            .filter((p) => live.selectedIndices.has(p.id))
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
    // Load-time provenance: the microphone, calibration and sample rate this was recorded with,
    // against what is connected now. The device carries all three, so the model can ask it — the
    // check used to sit in App because only App could see them.
    this.microphoneWarning = measurementWarning(m, {
      microphoneName: this.device?.deviceLabel,
      sampleRate: this.device?.sampleRate ?? null,
      calibrationName: this.device?.activeCalibration?.name,
    })
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
   *  restored under `isLoadingMeasurement`, so `recalculatePeaks` cannot run against a partly
   *  applied measurement. Mirrors Swift/Python `loadMeasurement`, which are likewise one method.
   *
   *  The per-peak arguments are optional: the material load path restores only offsets, and the
   *  unit tests that just need a frozen spectrum pass none. */
  restoreSnapshot(snapshot: {
    magnitudes: number[]
    frequencies: number[]
    /** The file's tap count. Restored HERE, not by the caller: Swift writes `numberOfTaps` inside
     *  loadMeasurement (MeasMgmt:784) between the completion assignment and the settings-warning
     *  raise. App used to call `setNumberOfTaps` AFTER this method, so the tap-count hook's own
     *  clear wiped the banner this method had just raised — the view sequencing what the model
     *  owns, which is the F24/F26 shape all over again (#17 F40). */
    numberOfTaps?: number
    taps?: Spectrum[]
    /** The saved peaks — authoritative, never re-derived. Omit to leave `loadedPeaks` unchanged. */
    loadedPeaks?: Peak[] | null
    overrides?: Map<number, string>
    annotationOffsets?: Map<number, [number, number]>
    selection?: { ids: Set<number>; frequencies: number[]; userModified: boolean }
  }): void {
    this.isLoadingMeasurement = true
    this.frozenMagnitudes = snapshot.magnitudes
    this.frozenFrequencies = snapshot.frequencies
    // Phase 3: per-tap peaks found ONCE from the saved per-tap spectrum at the -100 floor and durable
    // thereafter. findPeaks is deterministic + the golden is frozen, so this equals the file's saved
    // per-tap peaks (which the web restores as spectra, not peaks).
    this.tapEntries = (snapshot.taps ?? []).map((sp, i) => ({
      tapIndex: i + 1,
      spectrum: sp,
      peaks: findPeaks(sp.magnitudesDb, sp.frequencies, { peakMinOverride: PEAK_DETECTION_FLOOR }),
    }))
    this.capturedTaps = [] // a loaded measurement has no raw taps (Swift doesn't restore them) — keeps
    this.analysisAnnounced = false // the "Analysis complete" guard off so load shows "Loaded measurement (frozen)"
    // Tear down any in-progress capture the load interrupts (e.g. a plate sequence abandoned mid-phase),
    // mirroring Swift loadMeasurement (SpectrumCapture:724-728 + materialTapPhase = .complete). Without
    // this, an interrupted material capture leaves currentTapCount/isDetecting/materialTapPhase stale, so
    // the status bar's progress bar (gated on currentTapCount > 0) and Analyzing indicator (isDetecting)
    // linger over the loaded "frozen" measurement.
    this.detectionState = 'idle'
    this.currentTapCount = 0
    this.materialTapPhase = 'complete'
    this.isMeasurementComplete = true
    // The file's tap count, BEFORE the raise — its hook clears the warning, so restoring it
    // afterwards (as App used to) wipes the banner the load is about to raise.
    if (snapshot.numberOfTaps != null) this.setNumberOfTaps(snapshot.numberOfTaps)
    // AFTER the completion assignment and the tap-count restore, both of whose hooks clear this
    // flag — the ordering Swift has between MeasMgmt:709, :784 and :834 (#17 F40).
    this.showLoadedSettingsWarning = true
    // A single measurement is now displayed — and any overlay it interrupted is gone. Swift
    // MeasMgmt:562, Python :476. Set here, not by the caller: the view used to clear the
    // comparison at each load site by hand, twice over on the guitar path (#17 F24).
    // Through enterFrozen, so the freeze — including disarming the device — happens in ONE place.
    // Duplicating it here is what let the disarm go missing when it moved off the view.
    this.enterFrozen()
    this.setStatusMessage(LOADED_STATUS)
    // The peaks and the state keyed to them land together with the spectrum above — that pairing is
    // the whole point of doing this in one method.
    if (snapshot.loadedPeaks !== undefined) this.loadedPeaks = snapshot.loadedPeaks
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
   *  drop the frozen spectrum, the per-tap display spectra, the raw tap accumulation, and completion.
   *  Mirrors Swift startTapSequence's result reset (frozen + tapEntries + capturedTaps + complete). */
  clearResult(): void {
    this.frozenMagnitudes = []
    this.frozenFrequencies = []
    this.tapEntries = []
    this.capturedTaps = []
    this.analysisAnnounced = false
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

  /** Recompute the guitar peaks + their mode classification from the current analysis settings.
   *  Mirrors Swift `recalculateFrozenPeaksIfNeeded`: material has no guitar peaks; a loaded
   *  measurement's saved peaks are authoritative (FILTER by threshold, never re-run findPeaks); a
   *  live/frozen guitar spectrum runs findPeaks. The web's analysis settings live in the persisted
   *  settings store, so they are passed in per recompute (App drives this on any of them changing —
   *  the web's equivalent of TapDisplaySettings.didSet). 3c §10 P1. */
  recalculatePeaks(p: {
    material: boolean
    /** The current live-FFT spectrum, so peaks track it while waiting/detecting (null once frozen). */
    liveSpectrum: Spectrum | null
    guitarType: GuitarTypeName
    minHz: number
    maxHz: number
  }): void {
    // Loading guard. `loadMeasurement` applies the spectrum, the peaks and the per-peak state as one
    // step; until it finishes there is no coherent measurement to recalculate against, and running
    // here would re-detect on a spectrum whose peaks have not landed yet — minting fresh ids and
    // wiping the overrides, offsets and selection being restored. Mirrors Swift
    // `guard !isLoadingMeasurement else { return }` / Python's `if is_loading_measurement: return`.
    if (this.isLoadingMeasurement) return
    // Phase 1: detection stores the FULL peak set, found at the fixed -100 dB floor — Peak Min is NOT
    // an input here (it moved to a display selector in App, so a slider tick no longer re-mints peaks
    // or destroys per-peak state). Mirrors Swift `allPeaks` found via `peakMinOverride: peakDetectionFloor`.
    let peaks: Peak[]
    let reminted = false // did this branch mint FRESH ids (findPeaks)? then per-peak state must be carried
    if (p.material) {
      peaks = [] // peaks are guitar-only; material uses matPeaks
    } else if (this.loadedPeaks) {
      // Read from the analyzer, not from a caller argument: the peaks and the frozen spectrum are
      // set together in loadMeasurement, so this branch cannot be entered with one but not the other.
      peaks = this.loadedPeaks // the authoritative FULL set; Peak Min projects them for display
    } else {
      // Peaks follow the DISPLAYED spectrum: the frozen result once complete, otherwise the live
      // spectrum while waiting/detecting — so the list + annotations update on each live FFT frame,
      // mirroring Swift analyzeMagnitudes running continuously during detection.
      const frozen = this.frozenMagnitudes.length > 0
      const mags = frozen ? this.frozenMagnitudes : p.liveSpectrum?.magnitudesDb
      const freqs = frozen ? this.frozenFrequencies : p.liveSpectrum?.frequencies
      peaks =
        mags && freqs && mags.length > 0
          ? findPeaks(mags, freqs, {
              guitarType: p.guitarType,
              minHz: p.minHz,
              maxHz: p.maxHz,
              peakMinOverride: PEAK_DETECTION_FLOOR,
            })
          : []
      reminted = true // findPeaks assigns fresh ids on every call
    }
    const oldPeaks = this.peaks
    this.peaks = peaks
    this.modeByPeak = classifyAll(peaks, p.guitarType)
    this.refreshDisplayedPeaks() // the projection follows the durable set (Swift allPeaks.didSet)
    // Carry per-peak state across a re-mint (Re-analyze, guitar-type/range change, a re-run while
    // frozen). The loaded/material branches keep STABLE ids (same peak objects), so their per-peak
    // state needs no remap — only the findPeaks branch mints new ids. Mirrors Swift calling
    // applyFrozenPeakState only where UUIDs change. RA carries overrides; RB/RC add offsets + selection.
    //
    // Empty-peaks guard. When detection yields nothing — every peak below the floor, an empty or
    // flat spectrum — the carry-forward is SKIPPED, so `selectedPeakIds` is left alone rather than
    // being rebuilt as empty. The selection is a fact about the measurement, not about what the
    // detector just managed to find: lowering the threshold again must bring back the peaks the
    // user chose, not an empty set. Mirrors Swift `guard !peaks.isEmpty else { … return }` and
    // Python's `if not peaks: … return`, both of which return before applyFrozenPeakState.
    if (reminted && peaks.length > 0) this.applyFrozenPeakState(oldPeaks, peaks, p.guitarType)
    // Phase 3: per-tap entry peaks are NO LONGER re-derived here. They are found ONCE when the entry is
    // built (processMultipleTaps / loadMeasurement) at the -100 floor and are durable — nothing may
    // re-derive them, least of all a display control. (This was the web's `recalculateTapEntryPeaks`
    // equivalent; deleted, mirroring Swift 11689b6. Do not reintroduce it as a "missing" recompute.)
    // Guitar completion string — set ONCE at completion, matching Swift/Python (which set it in the guitar
    // processing path, not in the peak recalc — so N is FROZEN at completion, unaffected by later Peak-Min
    // slider moves). The web computes peaks here (App-driven), so the first post-completion recalc announces
    // (analysisAnnounced latch) and later recalcs leave the status alone. Only a freshly-captured, complete
    // guitar result: a loaded measurement has no capturedTaps, so it keeps its "Loaded measurement (frozen)".
    if (!p.material && this.isMeasurementComplete && this.capturedTaps.length > 0 && !this.analysisAnnounced) {
      this.setStatusMessage(
        `Analysis complete! ${peaks.length} peaks identified (from ${this.capturedTaps.length} averaged taps).`,
      )
      this.analysisAnnounced = true
    }
    this.notify()
  }

  // ── Per-peak mode overrides (RA — moved off the view's frequency-keyed useAnnotations) ────────────

  /** Assign a manual mode-label override to a peak (mirrors Swift `setModeOverride`). The label is the
   *  display string (a predefined mode name or a freeform label). Overriding an already-SELECTED peak into
   *  a single-holder mode displaces the previous definitive holder (see enforceDefinitiveModeUniqueness). */
  setModeOverride(id: number, label: string): void {
    // Reassign a fresh Map (never mutate in place): the snapshot exposes this reference, and App memos
    // keyed on `overrides` identity (overriddenPeakIds → displayPeaks → chart layers) must see the change.
    this.overrides = new Map(this.overrides).set(id, label)
    // Changing the mode of an already-selected peak can create two definitive holders of the new mode —
    // the only way an override touches selection (Swift setModeOverride). No-op if this peak isn't selected.
    this.enforceDefinitiveModeUniqueness(id)
    this.notify()
  }

  /** Clear a peak's override, reverting it to its auto-classified mode (Swift `resetModeOverride`). */
  resetModeOverride(id: number): void {
    if (!this.overrides.has(id)) return
    const next = new Map(this.overrides)
    next.delete(id)
    this.overrides = next
    this.notify()
  }

  /** Replace the whole override map from a loaded measurement (id-keyed to the loaded peaks). The load
   *  path calls this AFTER `loadMeasurement`; the loaded peaks keep stable ids, so no remap follows. */
  restoreOverrides(map: Map<number, string>): void {
    this.overrides = new Map(map)
    this.notify()
  }

  // ── Dragged annotation offsets (RB — one id-keyed store for guitar + material, mirrors Swift/Python) ─

  /** Set a peak's dragged annotation-label position (absolute [Hz, dB]). Fresh Map for memo identity.
   *  Mirrors Swift `updateAnnotationOffset` / Python `update_annotation_offset`. */
  updateAnnotationOffset(id: number, pos: [number, number]): void {
    this.annotationOffsets = new Map(this.annotationOffsets).set(id, pos)
    this.notify()
  }

  /** Clear one peak's dragged offset (Swift `resetAnnotationOffset`). */
  resetAnnotationOffset(id: number): void {
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
  restoreOffsets(map: Map<number, [number, number]>): void {
    this.annotationOffsets = new Map(map)
    this.notify()
  }

  /** Assign a stored id to a freshly detected material (L/C/FLC) peak so its dragged offset can live in
   *  the shared id-keyed store. Fresh id per store (Swift mints a new UUID per capture). */
  private identifyMaterialPeak(p: DetectedMaterialPeak | null): MaterialPeak | null {
    return p ? { ...p, id: this.nextMaterialPeakId++ } : null
  }

  /** Carry per-peak state across a peak RE-MINT (findPeaks assigns fresh ids), the web equivalent of
   *  Swift `applyFrozenPeakState`. Snapshots the old state BY FREQUENCY from the DURABLE old set (never
   *  a display projection — this is the Swift 178/184 fix), then re-attaches it to the new peaks by
   *  ±REMAP_TOLERANCE_HZ proximity. RA carries overrides; RB adds offsets; RC adds selection. Called
   *  only on the findPeaks branch (loaded/material keep stable ids). `guitarType` is passed in (not read
   *  from `measurementType`) because recalc's layout-effect can run before the type-sync effect. Notify
   *  is left to the caller. */
  private applyFrozenPeakState(oldPeaks: Peak[], newPeaks: Peak[], guitarType: GuitarTypeName): void {
    if (this.overrides.size > 0) {
      // Snapshot {frequency → label} from the OLD durable peaks, then remap onto the new ids.
      const byFreq: Array<{ frequency: number; label: string }> = []
      for (const [id, label] of this.overrides) {
        const old = oldPeaks.find((q) => q.id === id)
        if (old) byFreq.push({ frequency: old.frequency, label })
      }
      const remapped = new Map<number, string>()
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
      const remapped = new Map<number, [number, number]>()
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
      const carriedIds = new Set<number>()
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
      const autoIds = this.guitarModeSelectedPeakIds(newPeaks, guitarType)
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

  /** Set the Peak Min display threshold and publish the new projection. The persisted value lives in
   *  the settings store; App mirrors it in here on change, the web's equivalent of Swift reading
   *  `TapDisplaySettings.peakMinThreshold` into the analyzer. */
  setPeakMinThreshold(v: number): void {
    this.peakMinThreshold = v
    this.notify()
  }

  // ── Peak selection (RC — moved off the view; concrete state, full-Swift paradigm) ─────────────────

  /** The selected peaks over the DURABLE set (Swift `selectedPeaks`). */
  get selectedPeaks(): Peak[] {
    return this.peaks.filter((p) => this.selectedPeakIds.has(p.id))
  }

  /** One peak per named mode — the strongest `classifyAll` assigns to that mode — over `peaks`.
   *  Mirrors Swift `guitarModeSelectedPeakIDs(from:)`. `guitarType` passed in (see applyFrozenPeakState). */
  guitarModeSelectedPeakIds(peaks: Peak[], guitarType: GuitarTypeName): Set<number> {
    return new Set([...resolvedModePeaks(peaks, guitarType).values()].map((p) => p.id))
  }

  /** The override-aware mode of a peak (mirrors Swift `peakMode(for:)` → `GuitarMode.effectiveMode`): a
   *  present override resolves to its mode — a FREEFORM label to `'unknown'`, NOT the auto mode — otherwise
   *  the auto classification. The selection invariant resolves modes through this, never the override-blind
   *  `modeByPeak`. */
  effectiveMode(id: number): ResolvedMode {
    return resolveEffectiveMode(this.overrides.get(id), this.modeByPeak.get(id) ?? 'unknown')
  }

  /** The DEFINITIVE peak for a mode — the *selected* peak whose *effective* (override-aware) mode is that
   *  mode, strongest wins. Deselecting or relabelling a peak removes it here exactly as on screen. Mirrors
   *  Swift analyzer `getPeak(for:)`. (Phase 5's invariant means normally ≤1 candidate; `max` guards a
   *  transient double-selection.) */
  definitivePeak(mode: ResolvedMode): Peak | undefined {
    let best: Peak | undefined
    for (const p of this.selectedPeaks) {
      if (this.effectiveMode(p.id) === mode && (!best || p.magnitude > best.magnitude)) best = p
    }
    return best
  }

  /** Tap-tone ratio f_Top / f_Air over the DEFINITIVE Air/Top peaks — null if either is absent (a
   *  renamed/deselected Top drops the ratio, matching every other surface). Mirrors Swift
   *  `calculateTapToneRatio`. */
  tapToneRatio(): number | null {
    const air = this.definitivePeak('air')
    const top = this.definitivePeak('top')
    return air && top && air.frequency > 0 ? top.frequency / air.frequency : null
  }

  /** The definitive Air / Top / Back for the multi-tap Averaged row, each with an override flag so an
   *  overridden value can be marked (italic + " *"). Mirrors Swift `definitiveModeInfo` — `definitivePeak`
   *  per mode + `hasManualOverride` (= the peak carries any override). */
  definitiveModeInfo(): DefinitiveModeInfo {
    const of = (mode: ResolvedMode): DefinitiveMode | null => {
      const p = this.definitivePeak(mode)
      return p ? { frequency: p.frequency, isOverride: this.overrides.has(p.id) } : null
    }
    return { air: of('air'), top: of('top'), back: of('back') }
  }

  /** Keep the selection invariant: at most one SELECTED peak per Air/Top/Back. The preferred peak stays;
   *  every OTHER selected peak with the same override-aware mode is deselected. Only ever REMOVES from the
   *  selection — never reclassifies, never promotes. Guitar-only; a no-op unless `id` is selected and its
   *  effective mode is single-holder. Notify is left to the caller. Mirrors Swift
   *  `enforceDefinitiveModeUniqueness(preferring:)`. */
  enforceDefinitiveModeUniqueness(id: number): void {
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
  togglePeakSelection(id: number): void {
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

  /** The wand: drop manual edits and re-run auto-selection over the durable set (Swift
   *  `resetToAutoSelection`). `guitarType` from the caller (App knows the current type). */
  resetToAutoSelection(guitarType: GuitarTypeName): void {
    this.userModifiedSelection = false
    this.selectedPeakFrequencies = []
    this.selectedPeakIds = this.guitarModeSelectedPeakIds(this.peaks, guitarType)
    this.notify()
  }

  /** A guitar-subtype change (e.g. Classical → Flamenco) as a CLEAN SLATE for the new type: the type
   *  changes what each mode BAND means, so manual labels — made against the OLD bands — are dropped and
   *  selection reverts to auto for the new type. Dragged offsets are kept (peaks are unchanged; position
   *  is orthogonal to mode). `modeByPeak` is reclassified by the subsequent `recalculatePeaks` for the
   *  new type; the fresh auto-selection here is computed via `guitarModeSelectedPeakIds`, which
   *  self-classifies over the new type, so it is correct before `modeByPeak` is rebuilt. Mirrors Swift
   *  `reclassifyForGuitarTypeChange` (peakModeOverrides=[:] → reclassifyPeaks → resetToAutoSelection) /
   *  Python `reclassify_for_guitar_type_change`. Deliberately NOT the wand (`resetToAutoSelection`
   *  alone), which keeps labels. */
  reclassifyForGuitarTypeChange(guitarType: GuitarTypeName): void {
    this.overrides = new Map()
    this.resetToAutoSelection(guitarType)
  }

  /** Restore selection from a loaded measurement (ids keyed to the loaded peaks, + the frequency cache
   *  and the manual/auto flag). Loaded peaks keep stable ids, so no remap follows. */
  restoreSelection(ids: Set<number>, freqs: number[], userModified: boolean): void {
    this.selectedPeakIds = new Set(ids)
    this.selectedPeakFrequencies = [...freqs]
    this.userModifiedSelection = userModified
    this.notify()
  }

  /** Toggle the highlighted peak (clicking its chart dot or its results row): same id → clear, else set.
   *  Mirrors Swift's macOS dot `.onTapGesture` toggle and the results-row tap (both toggle). Transient
   *  view state — not selection, not persisted. */
  toggleHighlightedPeak(id: number): void {
    this.highlightedPeakId = this.highlightedPeakId === id ? null : id
    this.notify()
  }

  // ── Material (plate/brace) phase machine (mirrors Swift TapToneAnalyzer+SpectrumCapture) ──────────
  // The analyzer holds a REFERENCE to the device (Swift's TapToneAnalyzer owns fftAnalyzer); its
  // lifecycle stays in useAudioEngine until C5. Material transitions arm/checkpoint it and read its
  // calibration + playingFile. 3c-C3 (orchestration + state up, bridged — the device still averages
  // each phase's taps + finds the peak, emitting onMaterialCapture; C3b moves that up).
  private device: RealtimeFFTAnalyzer | null = null
  private flcCooldownTimer: ReturnType<typeof setTimeout> | null = null
  // Raw gated taps accumulated for the CURRENT material phase (6-TEST 3c-C3b — the device now delivers
  // each per-tap spectrum raw; the analyzer averages them + findDominantPeak at phase completion).
  private materialBuffer: Spectrum[] = []

  /** Set the audio device this analyzer drives (useAudioEngine calls this on creation). */
  setDevice(device: RealtimeFFTAnalyzer | null): void {
    this.device = device
  }

  /** Mirror the plate FLC-measurement setting (App drives it from the settings store). */
  setMeasureFlc(v: boolean): void {
    this.measureFlc = v
  }

  private clearFlcCooldown(): void {
    if (this.flcCooldownTimer != null) {
      clearTimeout(this.flcCooldownTimer)
      this.flcCooldownTimer = null
    }
  }

  /** Build the gated search for a material phase: its frequency range and peak-selection rule. The
   *  calibration is not part of it — the gated transform applies the active calibration itself, at
   *  the moment of the capture, as Swift and Python do (#17 F49). */
  private matSearch(phase: MaterialPhaseName): MaterialSearch {
    const base =
      phase === 'cross'
        ? PLATE_PHASES[1]
        : phase === 'flc'
          ? PLATE_PHASES[2]
          : this.measurementType === 'brace'
            ? BRACE_PHASE
            : PLATE_PHASES[0]
    return { ...base }
  }

  /** Continuous session WAV label for a completed material measurement (Swift Plate_LC / Plate_LCF / Brace). */
  private finishMaterialSession(): void {
    const label = this.measurementType === 'brace' ? 'Brace' : this.measureFlc ? 'Plate_LCF' : 'Plate_LC'
    this.finishSessionRecording(label)
  }

  /** Begin a fresh L→C→FLC capture. `arm` false for file playback (playFile arms phase L on the device;
   *  the analyzer then auto-advances L→C→FLC as taps arrive — 3c-C4 Option C). */
  /** Review → advance to the next phase (Accept). */
  acceptMaterial(): void {
    const phase = this.materialTapPhase
    if (phase === 'reviewingL') {
      this.materialTapPhase = 'capturingC'
      this.currentTapCount = this.materialPhaseBase('capturingC') // cumulative: L's taps stay counted
      this.materialBuffer = []
      this.checkpointSession() // C phase start (so a redo can drop it)
      this.armMaterialDetection(this.matSearch('cross'))
      this.setStatusMessage(this.materialArmPrompt()) // phase is capturingC — one source (#17 F37)
      this.notify()
    } else if (phase === 'reviewingC') {
      if (this.measureFlc) {
        // Mirror Swift acceptCurrentPhase: show the FLC reposition prompt during a tapCooldown with
        // detection DISARMED (waitingForFlcTap) so the plate-repositioning bump isn't taken as the FLC
        // tap; then arm the FLC capture.
        this.materialTapPhase = 'waitingForFlcTap'
        this.currentTapCount = this.materialPhaseBase('waitingForFlcTap') // cumulative: L+C stay counted
        this.materialBuffer = []
        this.checkpointSession() // FLC phase start (so a redo can drop it)
        this.setStatusMessage(this.materialArmPrompt()) // phase is waitingForFlcTap (#17 F37)
        this.notify()
        this.flcCooldownTimer = setTimeout(() => {
          this.flcCooldownTimer = null
          if (this.materialTapPhase !== 'waitingForFlcTap') return // canceled (reset / type change)
          this.materialTapPhase = 'capturingFlc'
          this.armMaterialDetection(this.matSearch('flc'))
          this.setStatusMessage(this.materialArmPrompt()) // phase is capturingFlc (#17 F37)
          this.notify()
        }, FLC_COOLDOWN_MS)
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
    if (phase === 'reviewingL') {
      this.materialTapPhase = 'capturingL'
      this.armMaterialDetection(this.matSearch('longitudinal'))
      this.setStatusMessage('Ready for fL tap — tap again')
    } else if (phase === 'reviewingC') {
      this.materialTapPhase = 'capturingC'
      this.armMaterialDetection(this.matSearch('cross'))
      this.setStatusMessage('Ready for fC tap — tap again')
    } else if (phase === 'reviewingFlc') {
      this.materialTapPhase = 'capturingFlc'
      this.armMaterialDetection(this.matSearch('flc'))
      this.setStatusMessage('Ready for fLC tap — tap again')
    }
    // Rebase the cumulative count to the taps completed in the PRIOR phases — redoing C keeps L's taps
    // counted, redoing FLC keeps L+C's (Swift redo: `currentTapCount = lCount` / `= lcCount`).
    this.currentTapCount = this.materialPhaseBase(this.materialTapPhase)
    this.notify()
  }

  /** Device onMaterialTap: one raw gated tap for the current phase (3c-C4 Option C — the analyzer owns the
   *  per-tap validity gate + count + re-arm + phase advance, mirroring Swift `finishGatedFFTCapture` +
   *  `handle{L,C,Flc}GatedProgress`; the device is now just a gated-FFT emitter that re-arms on command).
   *  Runs the per-tap `findDominantPeak` validity check: a tap with no in-band resonance is rejected
   *  (EG-1: "No resonance detected — tap again", re-arm the same phase, no count). A valid tap is buffered
   *  and counted; when the phase's tap count is reached, its taps are averaged + the peak found on the
   *  average, then the phase advances (review when live; auto-advance to the next phase when playing). */
  recordMaterialTap(spectrum: Spectrum): void {
    const ph: MaterialPhaseName =
      this.materialTapPhase === 'capturingC' ? 'cross' : this.materialTapPhase === 'capturingFlc' ? 'flc' : 'longitudinal'
    const search = this.matSearch(ph)
    const peak = findDominantPeak(
      spectrum.magnitudesDb,
      spectrum.frequencies,
      search.minHz,
      search.maxHz,
      search.preferLowestSignificant,
    )
    // EG-1: no detectable resonance in the phase band → reject the tap and re-arm the SAME phase (no
    // count, no buffer). Mirrors Swift/Python `finishGatedFFTCapture`'s `dominantPeak == nil` branch.
    if (peak == null) {
      this.setStatusMessage('No resonance detected — tap again')
      this.armMaterialDetection(search)
      this.notify()
      return
    }
    this.materialBuffer.push(spectrum)
    // Cumulative across phases (Swift): prior phases' taps + this phase's buffered taps. The phase
    // machinery below keys on `materialBuffer.length` (the WITHIN-phase count), never on currentTapCount.
    this.currentTapCount = this.materialPhaseBase(this.materialTapPhase) + this.materialBuffer.length
    const total = this.numberOfTaps
    if (this.materialBuffer.length < total) {
      // More taps for this phase — re-arm the same phase (Swift reEnableDetectionForNextPlateTap).
      this.setStatusMessage(`${matPhaseLabel(ph)} tap ${this.materialBuffer.length}/${total} captured. Tap again...`)
      this.armMaterialDetection(search)
      this.notify()
      return
    }
    // Phase complete: average the phase's taps + read the dominant peak off the AVERAGED spectrum (the
    // stored result value — value-preserving vs the C3b phase-end averaging; REG-B1/P1/P2).
    const avg = averageSpectra(this.materialBuffer)
    const avgPeak = findDominantPeak(
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
   *  the L→C→FLC auto-advance, Swift `isPlayingFile`). Sets the phase's status string. 3c-C4 Option C. */
  private advanceAfterPhase(ph: MaterialPhaseName, avg: Spectrum, avgPeak: DetectedMaterialPeak | null): void {
    const playing = this.device?.playingFile ?? false
    // Mint the stored id once for this phase's peak (RB) so its dragged offset has a stable key.
    const stored = this.identifyMaterialPeak(avgPeak)
    if (ph === 'longitudinal') {
      this.matSpectra = { ...this.matSpectra, longitudinal: avg }
      this.matPeaks = { ...this.matPeaks, longitudinal: stored }
      if (this.measurementType === 'brace') {
        this.materialTapPhase = 'complete'
        this.isMeasurementComplete = true // Swift brace complete sets isMeasurementComplete (SpectrumCapture:1217)
        this.finishMaterialSession() // brace = single phase → session done
        this.setStatusMessage(this.materialCompleteString())
      } else if (playing) {
        this.materialTapPhase = 'capturingC'
        this.currentTapCount = this.materialPhaseBase('capturingC') // cumulative: L's taps stay counted
        this.setStatusMessage('File: fL complete, capturing fC...')
        this.armMaterialDetection(this.matSearch('cross'))
      } else {
        this.materialTapPhase = 'reviewingL'
        this.setStatusMessage(`fL: ${fHz(avgPeak)} Hz — Accept to continue or Redo to re-tap`)
      }
    } else if (ph === 'cross') {
      this.matSpectra = { ...this.matSpectra, cross: avg }
      this.matPeaks = { ...this.matPeaks, cross: stored }
      if (playing) {
        if (this.measureFlc) {
          this.materialTapPhase = 'capturingFlc'
          this.currentTapCount = this.materialPhaseBase('capturingFlc') // cumulative: L+C stay counted
          this.setStatusMessage('File: fC complete, capturing fLC...')
          this.armMaterialDetection(this.matSearch('flc'))
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
      this.matPeaks = { ...this.matPeaks, flc: stored }
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
    this.clearFlcCooldown()
    this.materialTapPhase = 'notStarted'
    this.matPeaks = EMPTY_MAT_PEAKS
    this.matSpectra = EMPTY_MAT_SPECTRA
    this.materialBuffer = []
    this.annotationOffsets = new Map() // drop dragged material labels (RB)
    this.nextMaterialPeakId = 0
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
  restoreMaterial(m: { matSpectra: MatSpectra; matPeaks: MaterialPeaks; materialInputs: MaterialMeasurementInputs | null; numberOfTaps?: number }): void {
    this.isLoadingMeasurement = true
    try {
      this.matSpectra = m.matSpectra
      this.matPeaks = m.matPeaks
      this.materialInputs = m.materialInputs // Store B ← the file's own dims, never Settings
      this.materialTapPhase = 'complete'
      this.isMeasurementComplete = true // a loaded material measurement is complete (Swift loadMeasurement)
      // The file's tap count BEFORE the raise — its hook clears the warning (#17 F40).
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
    // mirrors it in here, the same way measurementType and measureFlc arrive.
    //
    // Without this line the detector read a field nothing ever wrote. #17 F30 moved detection from
    // the engine onto the analyzer; the engine had been reading `config.tapDetectionThreshold`,
    // which App pushed on every slider move, and the move left the threshold behind. The slider
    // kept writing settings and the engine config, both now unread by the detector, which sat at
    // its -40 dB default for guitar AND as the base for material's relative rule.
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
  // the microphone, the FFT primitive and the watchdogs — nothing more. Web had put the detector
  // and the capture on the engine, which is the root of several findings recorded under #17 F30:
  // arming as a refusable request, isDetecting as a mirror rather than state, and status strings
  // the web analyzer had no site to set. This is that line moved back (#17 F30).

  /** Hysteresis below the rising threshold; the latch only clears here. Swift `hysteresisMargin`. */
  readonly hysteresisMargin = 3.0
  /** Noise-floor EMA coefficient, material only. Swift `noiseFloorAlpha`. */
  readonly noiseFloorAlpha = 0.05
  /** Detection warm-up, in seconds of AUDIO. Swift `warmupPeriod`. */
  readonly warmupPeriod = 0.5
  /** Consecutive above-threshold chunks required to confirm a tap. */
  readonly confirmChunks = 2
  private readonly noiseFloorInitialDb = -60
  private readonly noiseFloorMinHeadroomDb = 10
  private readonly noiseFloorMinFallingHeadroomDb = 4

  /** Absolute detection threshold (dBFS). Owned here, as Swift owns it; App pushes the setting. */
  /** The tap-detection threshold in dBFS, mirrored in from settings by `setSettings`. Read by
   *  `detectTap` — absolute for guitar, the base of the relative rule for material. Swift and
   *  Python hold the same value on the analyzer (#17 F30/F40). */
  tapDetectionThreshold = -40

  /** A gated capture window is filling. Swift `gatedCaptureActive`. */
  gatedCaptureActive = false

  // ── Hysteresis (OUT-4) — mirrors Swift/Python `isAboveThreshold` ────────────────────────────────
  // A LATCH, and the gate on counting: it goes true when a tap is CONFIRMED and clears only at the
  // lower FALLING threshold, so the ring-out decay envelope cannot re-trigger a tap on its way down.
  // While it is up nothing counts, which is what makes the hysteresis real rather than advisory.
  //
  // It used to share that job with a separate `prevAbove` edge flag — the latch raised on the first
  // above-rising chunk, the firing gated on the edge — and because the edge cleared at RISING while
  // the latch cleared at FALLING, a ring-out in the 3 dB between them re-armed the detector. One
  // flag now, as in Swift and Python (#17). The web had no hysteresis at all before OUT-4; Swift and
  // Python have carried `hysteresisMargin = 3.0` all along.

  // ── Noise-floor EMA (OUT-4) — mirrors Swift/Python `noiseFloorEstimate` ─────────────────────────
  // Material (plate/brace) detects RELATIVE to the tracked ambient floor, not against a fixed dBFS
  // level. The rule reduces to `rising = max(threshold, noiseFloor + 10 dB)` — i.e. it is the absolute
  // threshold with a FLOOR under it, so it only differs once the room gets loud. That is what keeps
  // detection working when ambient noise is elevated; a fixed threshold simply saturates (the level
  // never drops below it, so no rising edge can ever be confirmed) and the app goes deaf.
  // Guitar stays absolute. See Development/OUT-4-DETECTION-SPEC.md.

  // ── Detection warm-up (OUT-4) — mirrors Swift/Python `warmupStartAudioTime` ─────────────────────
  // Value of the AUDIO clock when the sequence armed; detection is suppressed for WARMUP_SECONDS of
  // AUDIO after it. SILENT — it never writes a status message (that was OUT-1). Its real job is to
  // let the noise-floor EMA converge before the first tap is judged, and to re-anchor the floor to
  // real audio at exit. Measured on the audio clock, never the wall clock: the warm-up must cover the
  // first 0.5 s of AUDIO however long setup took. `null` = not armed / warm-up skipped.

  // Detector state (Swift TapToneAnalyzer+TapDetection).
  private isAboveThreshold = false
  /** The latest chunk's input level — Swift `fftAnalyzer.inputLevelDB`; seeds the latch at re-arm. */
  private inputLevelDb = -100
  private consecutive = 0
  private noiseFloorEstimate = -60
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
  private captureSampleRate = 48000

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
  /** Begin accumulating every pipeline chunk for the session WAV (no-op unless the dump setting is on).
   *  Guitar calls this from `arm()`; live material drives it from useMaterialSession. */
  startSessionRecording(): void {
    if (!this.settings.dumpCaptureAudio) return
    this.sessionSamples = []
    this.sessionCheckpoints = [0] // first-phase truncation anchor (Swift/Python seed [0] at start)
    this.sessionRate = this.device?.sampleRate ?? 48000
    this.sessionActive = true
    this.sessionRecording = true
    this.sessionPreRollActive = true // bound the pre-first-tap audio to ~2 s (§6)
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
      // bounded pre-roll (§6). Later phases keep the latch frozen. Mirrors Swift redoCurrentPhase.
      if (cp === 0) this.sessionPreRollActive = true
    }
  }

  /** Append one chunk to the session WAV buffer and maintain the bounded pre-roll (§6).
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
      // Python (`if gatedCaptureActive { sessionPreRollActive = false }`); it used to be cleared in
      // beginCapture instead, a second owner of one rule (#17 F47).
      this.sessionPreRollActive = false
    } else {
      const excess = this.sessionSamples.length - this.sessionPreRollSamples
      if (excess > 0) this.sessionSamples.splice(0, excess)
    }
  }

  /** Finish the session: write the accumulated audio (if any) as one WAV, then clear. Swift's analyzer
   *  calls its own dumpCaptureWAV helper here, gated on the dump setting. */
  finishSessionRecording(label: string): void {
    this.sessionRecording = false
    this.sessionActive = false
    const samples = this.sessionSamples
    const rate = this.sessionRate
    this.sessionSamples = []
    this.sessionCheckpoints = []
    if (samples.length === 0) return
    dumpCaptureWav(new Float32Array(samples), rate, `session_${label}`)
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
   *  audio-queue level-crossing handler (#17 F30). */
  processAudioFrame(samples: Float32Array, levelDb: number, audioTime: number): void {
    this.inputLevelDb = levelDb
    const rate = this.device?.sampleRate ?? this.captureSampleRate
    if (rate !== this.captureSampleRate || this.preroll.length === 0) this.resizeCaptureBuffers(rate)
    this.maintainSessionRecording(samples)
    this.feedPreroll(samples)
    if (this.gatedCaptureActive) this.feedCapture(samples)
    // Detection keeps running THROUGH a capture, as it does in Swift: `onRmsLevelChanged` gates only
    // on isDetecting / !isDetectionPaused / !isMeasurementComplete and never on gatedCaptureActive.
    // That matters because the hysteresis latch and the noise-floor EMA go on tracking across the
    // capture window, so the NEXT tap is judged from state that saw it. Re-entry is blocked in
    // beginCapture rather than here — Swift blocks it too, by capture id (#17 F30).
    if (this.isDetecting && !this.isDetectionPaused) this.detectTap(levelDb, audioTime)
  }

  /** Flush a partial in-flight GUITAR capture so a tap near the end of a played file still yields a
   *  result. Material gated capture needs a full window, so a partial final phase is dropped. */
  flushPartialGuitarCapture(): void {
    if (this.captureKind !== 'guitar' || !this.gatedCaptureActive || this.captureIdx === 0) return
    this.capture.fill(0, this.captureIdx)
    this.finishCapture()
  }

  /** Size the pre-roll ring and capture windows for the current rate. Swift derives both from
   *  `fftAnalyzer.actualSampleRate` on demand, so a file at another rate re-sizes them. */
  private resizeCaptureBuffers(rate: number): void {
    this.captureSampleRate = rate
    this.prerollSamples = Math.round(rate * 0.2)
    this.preroll = new Float32Array(this.prerollSamples)
    this.prerollIdx = 0
    this.prerollFilled = 0
    this.guitarCaptureBuf = new Float32Array(this.device?.fftSize ?? GUITAR_FFT_SIZE)
    this.materialCapture = new Float32Array(Math.round(rate * 0.5))
    this.capture = this.captureKind === 'material' ? this.materialCapture : this.guitarCaptureBuf
    this.captureIdx = 0
  }

  /** Arm guitar tap detection — a fresh sequence. Swift startTapSequence's guitar arm. */
  private armGuitarDetection(skipWarmup: boolean): void {
    this.resizeCaptureBuffers(this.device?.sampleRate ?? this.captureSampleRate)
    this.captureKind = 'guitar'
    this.capture = this.guitarCaptureBuf
    this.guitarTapCount = 0
    this.consecutive = 0
    this.armWarmup(skipWarmup)
    this.gatedCaptureActive = false
    this.detectionState = 'listening'
  }

  /** Arm (or re-arm) a gated material phase with its search range. Swift's per-phase re-arm. */
  private armMaterialDetection(search: MaterialSearch): void {
    if (this.preroll.length === 0) this.resizeCaptureBuffers(this.device?.sampleRate ?? this.captureSampleRate)
    this.captureKind = 'material'
    this.materialSearch = search
    this.capture = this.materialCapture
    this.captureIdx = 0
    this.consecutive = 0
    // Material ALWAYS runs the warm-up — it is the only mode using the relative noise-floor
    // detector, and the warm-up is what establishes the floor.
    this.armWarmup(false)
    this.gatedCaptureActive = false
    this.detectionState = 'listening'
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
    this.consecutive = 0
    this.armWarmup((this.device?.playingFile ?? false) && this.captureKind === 'guitar')
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
    const useRelative = this.captureKind === 'material'
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

    // 3a. Warm-up — SILENT (it never writes a status message; that was OUT-1). Suppresses detection
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
    // `falling` before another tap is possible.
    //
    // This used to raise the latch on the FIRST above-`rising` frame and gate firing on a separate
    // `prevAbove` edge, which cleared as soon as the level dipped below `rising`. Between taps of a
    // multi-tap sequence — capture finished, signal not yet settled — a ring-out that decayed past
    // `rising` but never reached `falling` therefore re-armed the detector, and its next swing up
    // was taken as the following tap: the sequence finished early with a decay averaged in place of
    // a strike. Three dB of margin is a narrow window, which is why no run-review ever hit it (#17).
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
        // Seed the ring-out from the PEAK-HELD level (Swift tapPeakLevel = recentPeakLevelDB), not the
        // instantaneous level: tap confirmation lags the strike by ~2 chunks, so the true peak would
        // otherwise be missed and the −15 dB reference under-stated. Guitar only.
        if (this.captureKind === 'guitar') this.device?.startDecayFromPeak()
        this.beginCapture()
      }
    } else {
      this.consecutive = 0
    }
  }

  private armWarmup(skip: boolean): void {
    this.warmupStartAudioTime = skip ? (this.device?.audioTime ?? 0) - (this.warmupPeriod + 0.1) : (this.device?.audioTime ?? 0)
    this.justExitedWarmup = false
    // Mirrors Swift startTapSequence's `isAboveThreshold = skipWarmup`. With the warm-up running,
    // the post-warm-up sync frame sets the latch from the first real level; when it is SKIPPED there
    // is no such frame, so the detector starts latched and a tap needs a genuine fall first. This is
    // what `prevAbove = true` used to do at each arm site.
    this.isAboveThreshold = skip
    this.noiseFloorEstimate = this.noiseFloorInitialDb
  }

  private beginCapture(): void {
    // A capture already filling absorbs the tap — Swift guards the same re-entry, comparing capture
    // ids because its window can start on the audio queue and finish before the main thread runs.
    if (this.gatedCaptureActive) return
    // Seed the capture window with the pre-roll (in chronological order).
    const out = this.capture
    out.fill(0)
    const count = this.prerollFilled
    const startRing = (this.prerollIdx - count + this.prerollSamples) % this.prerollSamples
    for (let k = 0; k < count; k++) {
      out[k] = this.preroll[(startRing + k) % this.prerollSamples]!
    }
    this.captureIdx = count
    this.gatedCaptureActive = true // (the session WAV's pre-roll freezes on the next chunk — maintainSessionRecording)
    if (this.isGuitar) this.setStatusMessage(this.guitarLoopStatus(true)) // Swift TapDetection:355
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
      this.finishGatedFFTCapture(samples, this.captureSampleRate, this.materialTapPhase)
    } else {
      this.finishGuitarGatedCapture(samples, this.captureSampleRate)
    }
  }

  /** A material (plate/brace) gated capture is complete: compute its gated spectrum and record the tap
   *  for `phase`. Mirrors Swift/Python `finishGatedFFTCapture(samples:sampleRate:phase:)` — public, as
   *  there, so tests drive the same production path the audio does (#17 F45). The analyzer owns the
   *  per-tap validity gate, the tap count, the re-arm and the L→C→FLC advance (recordMaterialTap). */
  finishGatedFFTCapture(samples: Float32Array, sampleRate: number, phase: MaterialTapPhase): void {
    // Align to the sample-level onset, then the calibrated gated transform — Swift's
    // `alignCaptureToOnset` → `fftAnalyzer.computeGatedFFT`. With no engine attached there is no
    // calibration to apply, so the bare transform is the same thing.
    const aligned = alignCaptureToOnset(
      samples,
      Math.round(sampleRate * GATED_FFT_WINDOW_DURATION),
      Math.round(sampleRate * PRE_ONSET_DURATION),
    )
    const { magnitudesDb, frequencies } = this.device
      ? this.device.computeGatedFFT(aligned, sampleRate)
      : gatedHannFFT(aligned, sampleRate)
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
   *  and the same timing (#17 F45). The web used to do this inside `finishCapture` and re-arm
   *  IMMEDIATELY, relying on the hysteresis latch alone, where both natives stop detecting for
   *  `tapCooldown` (0.5 s) and then re-anchor the latch from the current level; and it averaged the
   *  taps at once, where both natives show "All taps captured. Processing..." for `captureWindow`
   *  (0.2 s) first. Both waits are wall-clock timers, as in the natives — #19 moves all three editions
   *  to audio time together.
   *
   *  The capture window is aligned to the sample-level tap onset so chunk-boundary differences (live
   *  vs file playback) don't shift the FFT input. */
  finishGuitarGatedCapture(samples: Float32Array, sampleRate: number): void {
    const fftSize = this.device?.fftSize ?? GUITAR_FFT_SIZE
    const aligned = alignCaptureToOnset(samples, fftSize, Math.round(sampleRate * PRE_ONSET_DURATION))
    const spectrum = this.applyCalibration(dftAnalRect(aligned, sampleRate, fftSize))
    this.gatedCaptureActive = false
    this.guitarTapCount += 1
    this.recordGuitarTap(spectrum)

    const total = this.numberOfTaps
    // A tap was captured: stop listening until the cooldown re-arms (Swift leaves `listening` here).
    this.detectionState = 'idle'
    if (this.guitarTapCount < total) {
      this.consecutive = 0
      this.currentTapCount = this.guitarTapCount
      this.setStatusMessage(this.guitarLoopStatus(false)) // Swift SpectrumCapture:742
      this.scheduleGuitarReEnable()
      this.notify()
      return
    }

    this.guitarTapCount = 0
    this.currentTapCount = total
    this.finishSessionRecording(`Guitar_${total}tap`) // write the continuous session WAV (dump-gated)
    this.setStatusMessage('All taps captured. Processing...')
    this.notify()
    setTimeout(() => this.processMultipleTaps(), CAPTURE_WINDOW_MS) // Swift: asyncAfter(captureWindow)
  }

  /** After the tap cooldown, re-anchor the hysteresis latch from the current input level and listen
   *  for the next tap. Mirrors Swift scheduleGuitarReEnable, which has no other guard. */
  private scheduleGuitarReEnable(): void {
    setTimeout(() => {
      const falling = this.tapDetectionThreshold - this.hysteresisMargin
      this.isAboveThreshold = this.inputLevelDb > falling
      this.detectionState = 'listening'
      this.notify()
    }, TAP_COOLDOWN_MS)
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
        matPeaks: this.matPeaks,
        gatedCaptureActive: this.gatedCaptureActive,
        materialInputs: this.materialInputs,
        displayMode: this.displayMode,
        comparisonEntries: this.comparisonEntries,
        showingMultiTapComparison: this.showingMultiTapComparison,
        isSavedMeasurementComparison: this.isSavedMeasurementComparison,
        statusMessage: this.statusMessage,
        isClipping: this.isClipping,
        inputAppearsDead: this.inputAppearsDead,
        showLoadedSettingsWarning: this.showLoadedSettingsWarning,
        loadedMeasurementName: this.loadedMeasurementName,
        loadedNotes: this.loadedNotes,
        loadedAxisRange: this.loadedAxisRange,
        loadedSettings: this.loadedSettings,
        microphoneWarning: this.microphoneWarning,
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
  // does not) so multi-field transitions render once. 3c-C4 D3.
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
   *  Python `_set_input_appears_dead`). The engine has detected and retried a silent input since the
   *  watchdog landed; until now nothing read the flag, so web alone told the user nothing while both
   *  natives showed the warning (#17 F37). */
  setInputAppearsDead(dead: boolean): void {
    if (dead === this.inputAppearsDead) return
    this.inputAppearsDead = dead
    this.applyStatusOverrides()
    this.notify()
  }

  /** The user acknowledged the microphone warning — it has been read, so it ends here. Mirrors
   *  Swift, where the alert's OK button and its binding both clear `microphoneWarning`, and Python's
   *  `_on_microphone_warning_changed` clearing after the modal (#17 F41). */
  clearMicrophoneWarning(): void {
    if (this.microphoneWarning === null) return
    this.microphoneWarning = null
    this.notify()
  }

  /** The live ring-out from the device's decay tracker (the engine owns the TRACKER; the analyzer
   *  owns the VALUE, as Swift's `currentDecayTime` does — written here during a capture and by
   *  `loadMeasurement` from the file). */
  setDecayTime(decayTime: number | null): void {
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
   *  the phase advances in `acceptMaterial`, and `restingPrompt()`. They used to hold two sets of
   *  literals, so a resume or a tap-count change could reword the instruction the user was
   *  following. Mirrors Swift `materialArmPrompt()` and Python `_material_arm_prompt()` (#17 F37).
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
   *  The settle used to CHOOSE between two strings, which is wrong in both directions: mid-sequence
   *  it said "Tap the guitar 3 times…" when a tap was already captured, and on a finished
   *  measurement it said "Tap 1/1 captured. Tap again..." — instructing the user to tap again on a
   *  sequence that was done, quoting an N that went stale the moment the tap count changed. The
   *  status is a function of state, so derive it rather than guessing — and say nothing where the
   *  status is a RESULT announcement rather than a live prompt, because a completed or loaded
   *  measurement's status ("Analysis complete! N peaks…", "Loaded measurement (frozen)") is not
   *  re-derivable and must not be thrown away. Mirrors Swift statusAfterSettle() and Python
   *  _status_after_settle() (#17 F33). */
  /** The status to show when a settle ends, given what it said before the settle began. The whole
   *  decision in one pure function, so every edition can pin it. Mirrors Swift
   *  restoredStatus(before:) and Python _restored_status() (#17 F33). */
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
      return `Complete — fL: ${fHz(this.matPeaks.longitudinal)} Hz, fC: ${fHz(this.matPeaks.cross)} Hz`
    }
    return 'Complete - check Results'
  }

  // ── Audio-device-driven setters (the RealtimeFFTAnalyzer drives these; each notifies) ──────────
  setNumberOfTaps(n: number): void {
    this.numberOfTaps = n
    // A tap-count change while armed and waiting for the first tap refreshes the prompt ("Tap the
    // guitar N times…"), mirroring Swift numberOfTaps.didSet. (No-op mid-capture / when complete.)
    // The `!isMeasurementComplete` term this used to carry was a third spelling of one predicate —
    // completion sets detectionState to idle in all three editions, so isDetecting already covers
    // it, and three spellings is how the guards came to differ in the first place (#17 F36).
    if (this.isDetecting && this.currentTapCount === 0) {
      this.setStatusMessage(this.restingPrompt())
    }
    // The user changed Taps, so the loaded measurement's settings no longer describe what is on
    // screen. Mirrors Swift numberOfTaps.didSet and Python set_tap_num (#17 F40).
    this.showLoadedSettingsWarning = false
    this.notify()
  }

  /** The user changed a setting the loaded measurement also carries, so its banner no longer
   *  applies. Swift and Python do this inside `tapDetectionThreshold`'s setter, which they can
   *  because the threshold is analyzer state there; on the web it lives in `settings`, so the view
   *  reports the change instead. That the web's threshold is not analyzer state is a SEPARATE
   *  divergence, deliberately not folded in here (#17 F40). */
  noteLoadedSettingsDeviation(): void {
    if (!this.showLoadedSettingsWarning) return
    this.showLoadedSettingsWarning = false
    this.notify()
  }

  setCurrentTapCount(n: number): void {
    this.currentTapCount = n
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
    // fftSettleTime) and Python. New Tap is disabled while the input is reinitialising; the field
    // was declared here and never written until #17 F32, so web showed no disable at all.
    this.isReadyForDetection = !settling
    if (settling) {
      // Remember what the status said BEFORE the transient replaces it. statusAfterSettle() returns
      // null for the states whose status is a result announcement rather than a prompt, and "leave
      // it alone" has to mean restoring THIS — not leaving the transient up forever, which is what
      // it meant on the first pass (#17 F33). Guarded so a repeated settling edge cannot capture
      // the transient itself.
      // `latestRealStatus`, NOT `statusMessage`: the latter is the OVERRIDE-RESOLVED string, so a
      // route change while the input was clipping or dead preserved the warning sentinel and fed it
      // back through setStatusMessage() as the real status — after which clearing the condition
      // restored the warning. The override layer re-resolves on its own (#17 F37).
      if (this.statusBeforeSettle === null) this.statusBeforeSettle = this.latestRealStatus
      // Blank the chart only if a LIVE spectrum is on screen — a completed or loaded measurement
      // keeps its result, exactly as in Swift/Python (#17 F35).
      if (!this.isMeasurementComplete && this.displayMode !== 'comparison') this.isSettling = true
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
  /** Per-tap entries (spectrum + peaks) for the multi-tap comparison view ([] unless a multi-tap result). */
  tapEntries: TapEntry[]
  /** The DURABLE guitar peak set, found at the -100 dB floor — what selection and the save path read. */
  peaks: Peak[]
  /** A loaded measurement's authoritative saved peaks, or null for a live capture. Analyzer-owned so
   *  it can never be seen out of step with the frozen spectrum. */
  loadedPeaks: Peak[] | null
  /** The Peak-Min display projection of `peaks` (material passes through unfiltered). What the peak
   *  list, the chart dots and the live ratio read. Never the set to save. */
  peaksAbovePeakMin: Peak[]
  /** The Peak Min display threshold the projection was computed at. */
  peakMinThreshold: number
  /** Mode classification for `peaks`, keyed by peak id. */
  modeByPeak: Map<number, ResolvedMode>
  /** Manual mode-label overrides, keyed by peak `id` (RA — analyzer-owned, was the view's freq map). */
  overrides: Map<number, string>
  /** Dragged annotation-label positions, keyed by peak `id` (RB — one store for guitar + material). */
  annotationOffsets: Map<number, [number, number]>
  /** The definitive-peak selection, by peak `id` (RC — concrete analyzer state). */
  selectedPeakIds: Set<number>
  /** Whether the selection was hand-modified since the last auto-select (drives the wand's enabled state). */
  userModifiedSelection: boolean
  /** The highlighted peak id (chart-dot ↔ results-row cross-highlight), or null. Transient view state. */
  highlightedPeakId: number | null
  /** Whether the Re-analyze button is offered (any complete guitar measurement with a frozen
   *  spectrum; never material). See `TapToneAnalyzer.canReanalyze` for why it is not a dirty flag. */
  canReanalyze: boolean
  /** Material (plate/brace) per-phase result spectra. */
  matSpectra: MatSpectra
  /** Material (plate/brace) per-phase located peaks. */
  matPeaks: MaterialPeaks
  /** A gated capture window is filling — the status bar's "capturing" distinction. Swift
   *  `gatedCaptureActive`. */
  gatedCaptureActive: boolean
  /** Store B — the current material measurement's own dimensions; `null` for guitar and before a
   *  material measurement completes. Seeded at the completion transition (#17 F26). */
  materialInputs: MaterialMeasurementInputs | null
  /** What the spectrum is showing: live input, one frozen measurement, or an overlay.
   *  Three states in one value, so "frozen AND comparison" cannot be represented (#17 F24). */
  displayMode: DisplayMode
  /** Saved measurements currently overlaid; empty unless `displayMode` is 'comparison'. */
  comparisonEntries: ComparisonEntryModel[]
  /** True while the per-tap overlay of the current measurement is shown. */
  showingMultiTapComparison: boolean
  /** 'comparison' via SAVED measurements rather than the per-tap overlay. */
  isSavedMeasurementComparison: boolean
  /** The imperative status-bar message (set at every transition; clipping override applied). */
  statusMessage: string
  /** The device engine state (idle/listening/capturing/paused) mirrored on the analyzer — the single
   *  source for the status-bar className + the capturing/waiting distinction (3c-C5). */
  /** Input clipping (drives the threshold-slider red zone; the status override reads the private field). */
  isClipping: boolean
  /** Input delivering chunks with no signal — the dead-input watchdog's user-visible state. */
  inputAppearsDead: boolean
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
  /** Ring-out of what is on screen — the file's when loaded, the live tracker's during a capture. */
  currentDecayTime: number | null
}
