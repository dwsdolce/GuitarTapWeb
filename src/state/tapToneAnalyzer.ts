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
// Override→mode resolution for the override-aware effectiveMode (mirrors Swift GuitarMode.fromDisplayName).
// A minor state→presentation import (precedent: MaterialPeaks from components); the shared resolver is unified later.
import { MODE_BY_DISPLAY_NAME } from '../presentation/modeColors'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { PLATE_PHASES, BRACE_PHASE, findDominantPeak, type MaterialPeak, type DetectedMaterialPeak } from '../dsp/gatedCapture'
import type { RealtimeFFTAnalyzer, MaterialSearch, MaterialPhaseName, EngineState } from '../audio/realtimeFFTAnalyzer'
import type { MaterialPeaks } from '../components/MaterialResults'
// Single shared MeasurementType + guard (mirrors Swift's shared MeasurementType enum) — the settings
// store owns them; the analyzer no longer duplicates the type.
import { isGuitarType, type MeasurementType } from '../settings'

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

/** A material phase peak's frequency, 1 dp, or '?' when none — for the status-bar review/complete strings. */
const fHz = (p: { frequency: number } | null): string => (p ? p.frequency.toFixed(1) : '?')
/** Loaded-measurement (frozen) status — curly quotes around New Tap match Swift/Python. */
const LOADED_STATUS = 'Loaded measurement (frozen). Press ‘New Tap’ to start a new measurement.'
/** Short phase label for the "L/C/FLC tap X/N captured" progress strings. */
const matPhaseLabel = (ph: MaterialPhaseName): string => (ph === 'cross' ? 'C' : ph === 'flc' ? 'FLC' : 'L')

// Swift tapCooldown (0.5 s): after the C tap is accepted, the FLC capture is held disarmed for this
// long while the user repositions the plate, so the repositioning bump can't be taken as the FLC tap.
const FLC_COOLDOWN_MS = 500

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

export class TapToneAnalyzer {
  // ── Published-equivalent state (settable; the audio layer / tests mutate these directly) ──
  isDetecting = false
  isDetectionPaused = false
  isReadyForDetection = true
  currentTapCount = 0
  numberOfTaps = 1
  capturedTaps: CapturedTap[] = []
  frozenMagnitudes: number[] = []
  frozenFrequencies: number[] = []
  // Per-tap entries for the multi-tap comparison view (spectrum + peaks). Mirrors Swift `tapEntries`.
  // Built from capturedTaps at completion (>1 tap), restored on load, cleared on reset — distinct from
  // the raw `capturedTaps` (which are NOT restored on load), exactly like Swift's tapEntries vs
  // capturedTaps split. Each entry's peaks are (re)found by recalculatePeaks at the current Peak Min.
  tapEntries: TapEntry[] = []
  // Main peaks detected on the frozen spectrum (or filtered from a loaded measurement's authoritative
  // peaks) + their mode classification. Owned by the analyzer, mirroring Swift `currentPeaks` /
  // `identifiedModes` (recomputed by recalculatePeaks — the web's recalculateFrozenPeaksIfNeeded). 3c §10 P1.
  peaks: Peak[] = []
  modeByPeak: Map<number, ResolvedMode> = new Map()
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
  materialTapPhase: MaterialTapPhase = 'notStarted'
  // Material (plate/brace) result data — the per-phase averaged spectra + located peaks. Owned by the
  // analyzer, mirroring Swift longitudinalSpectrum/crossSpectrum/flcSpectrum + the material peaks. 3c-C3.
  matSpectra: MatSpectra = EMPTY_MAT_SPECTRA
  matPeaks: MaterialPeaks = EMPTY_MAT_PEAKS
  // Whether the plate FLC tap is measured. Swift reads TapDisplaySettings.measureFlc / Python
  // _tds.measure_flc(); the web has no analyzer-visible global, so App mirrors it via setMeasureFlc.
  measureFlc = false
  measurementType: MeasurementType = 'classical'
  showLoadedSettingsWarning = false

  // ── Status-bar message (imperative field — mirrors Swift @Published `statusMessage` / Python
  // `status_message`, set at every transition; 6-TEST 3c-C4 D3). `latestRealStatus` stashes the last
  // analyzer-set string so the clipping override can restore it (Swift `latestRealStatus` / Python
  // `_latest_real_status`). Written only through `setStatusMessage` / `setClipping`.
  // @parity state/status-message  tests=test/status-message
  statusMessage = 'Tap the guitar to begin'
  private latestRealStatus = 'Tap the guitar to begin'
  private isClipping = false
  // Mirror of the device's engine state (idle/listening/capturing/paused), forwarded via setEngineState.
  // The device owns the guitar detection loop, so the guitar status strings derive from these transitions
  // (the web equivalent of Swift's TapToneAnalyzer+TapDetection setting statusMessage in the loop).
  private engineState: EngineState = 'idle'
  // The "Analysis complete! N peaks…" string is set ONCE at completion (Swift/Python set it in the guitar
  // processing path, NOT in the peak recalc — so N is frozen at completion, not updated by the Peak-Min
  // slider). The web computes peaks in recalculatePeaks (App-driven), so this flag makes the first
  // post-completion recalc announce and later recalcs (slider moves) leave the status alone. 6-TEST 3c-C4.
  private analysisAnnounced = false

  // isMeasurementComplete has a didSet side-effect, mirroring Swift: setting it
  // true clears the loaded-settings warning.
  private _isMeasurementComplete = false
  get isMeasurementComplete(): boolean {
    return this._isMeasurementComplete
  }
  set isMeasurementComplete(v: boolean) {
    this._isMeasurementComplete = v
    if (v) this.showLoadedSettingsWarning = false
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
  get tapProgress(): number {
    const total = this.isGuitar ? this.numberOfTaps : this.totalPlateTaps
    return total > 0 ? Math.min(1, this.currentTapCount / total) : 0
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

  /** Arm detection for a new sequence: clears any prior completion, counts, and frozen spectrum. */
  startTapSequence(): void {
    this.isDetecting = true
    this.isDetectionPaused = false
    this.currentTapCount = 0
    this.capturedTaps = []
    this.frozenMagnitudes = []
    this.frozenFrequencies = []
    this.isMeasurementComplete = false
    this.analysisAnnounced = false
    // Guitar resting prompt (canonical post-warm-up steady state). In the app the device's arm →
    // setEngineState('listening') also sets this; here it covers the direct/test path.
    this.setStatusMessage(this.tapPrompt())
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
   *  process_multiple_taps). Replaces the old finishGuitarGatedCapture(samples) — computing the FFT
   *  is the device's job now (D1: RealtimeFFTAnalyzer delivers the spectrum, TapToneAnalyzer averages). */
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

  pauseTapDetection(): void {
    this.isDetecting = false
    this.isDetectionPaused = true
  }

  resumeTapDetection(): void {
    this.isDetecting = true
    this.isDetectionPaused = false
  }

  /** Load a saved measurement: freeze its spectrum, restore its per-tap display spectra (for the
   *  multi-tap comparison view), and mark complete. Mirrors Swift loadMeasurement restoring both
   *  frozenMagnitudes/Frequencies and tapEntries (the raw capturedTaps are NOT restored). */
  loadMeasurement(snapshot: { magnitudes: number[]; frequencies: number[]; taps?: Spectrum[] }): void {
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
    this.isMeasurementComplete = true
    this.setStatusMessage(LOADED_STATUS)
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
    this.isMeasurementComplete = false // setter also clears the loaded-settings warning
    this.notify()
  }

  /** Whether the Re-analyze button is offered: ANY complete guitar measurement with a frozen
   *  spectrum, and never a plate/brace one.
   *
   *  Re-analyze is a RESET, not a dirty-flag indicator. It is offered whenever it COULD do
   *  something, not only when we can prove it WILL — deliberately. What can leave the displayed
   *  analysis differing from a clean re-derivation is open-ended: the peaks came from a file; mode
   *  assignments were carried forward across Peak Min moves rather than re-claimed; the analysis
   *  range moved; selections were hand-edited. Proving "it will definitely change something" means
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
    loadedPeaks: Peak[] | null
    /** The current live-FFT spectrum, so peaks track it while waiting/detecting (null once frozen). */
    liveSpectrum: Spectrum | null
    guitarType: GuitarTypeName
    minHz: number
    maxHz: number
  }): void {
    // Phase 1: detection stores the FULL peak set, found at the fixed -100 dB floor — Peak Min is NOT
    // an input here (it moved to a display selector in App, so a slider tick no longer re-mints peaks
    // or destroys per-peak state). Mirrors Swift `allPeaks` found via `peakMinOverride: peakDetectionFloor`.
    let peaks: Peak[]
    let reminted = false // did this branch mint FRESH ids (findPeaks)? then per-peak state must be carried
    if (p.material) {
      peaks = [] // peaks are guitar-only; material uses matPeaks
    } else if (p.loadedPeaks) {
      peaks = p.loadedPeaks // loaded peaks are the authoritative FULL set; Peak Min projects them for display
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
    // Carry per-peak state across a re-mint (Re-analyze, guitar-type/range change, a re-run while
    // frozen). The loaded/material branches keep STABLE ids (same peak objects), so their per-peak
    // state needs no remap — only the findPeaks branch mints new ids. Mirrors Swift calling
    // applyFrozenPeakState only where UUIDs change. RA carries overrides; RB/RC add offsets + selection.
    if (reminted) this.applyFrozenPeakState(oldPeaks, peaks, p.guitarType)
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
    const override = this.overrides.get(id)
    if (override != null) return MODE_BY_DISPLAY_NAME[override] ?? 'unknown'
    return this.modeByPeak.get(id) ?? 'unknown'
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

  /** Restore selection from a loaded measurement (ids keyed to the loaded peaks, + the frequency cache
   *  and the manual/auto flag). Loaded peaks keep stable ids, so no remap follows. */
  restoreSelection(ids: Set<number>, freqs: number[], userModified: boolean): void {
    this.selectedPeakIds = new Set(ids)
    this.selectedPeakFrequencies = [...freqs]
    this.userModifiedSelection = userModified
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

  /** Build the gated search for a material phase: its frequency range + rule, with the device's active
   *  calibration applied to the gated spectrum before its peak-find (mirrors Swift reading
   *  fftAnalyzer.calibrationCorrections / Python self.mic._calibration). */
  private matSearch(phase: MaterialPhaseName): MaterialSearch {
    const base =
      phase === 'cross'
        ? PLATE_PHASES[1]
        : phase === 'flc'
          ? PLATE_PHASES[2]
          : this.measurementType === 'brace'
            ? BRACE_PHASE
            : PLATE_PHASES[0]
    return { ...base, calibration: this.device?.activeCalibration ?? null }
  }

  /** Continuous session WAV label for a completed material measurement (Swift Plate_LC / Plate_LCF / Brace). */
  private finishMaterialSession(): void {
    const label = this.measurementType === 'brace' ? 'Brace' : this.measureFlc ? 'Plate_LCF' : 'Plate_LC'
    this.device?.finishSessionRecording(label)
  }

  /** Begin a fresh L→C→FLC capture. `arm` false for file playback (playFile arms phase L on the device;
   *  the analyzer then auto-advances L→C→FLC as taps arrive — 3c-C4 Option C). */
  startMaterial(arm = true): void {
    this.clearFlcCooldown()
    this.matPeaks = EMPTY_MAT_PEAKS
    this.matSpectra = EMPTY_MAT_SPECTRA
    this.materialBuffer = []
    this.annotationOffsets = new Map() // a fresh material sequence drops any dragged labels (RB)
    this.nextMaterialPeakId = 0
    this.materialTapPhase = 'capturingL'
    this.currentTapCount = 0 // the analyzer owns the material tap count now (Option C)
    this.analysisAnnounced = false
    this.isMeasurementComplete = false // a fresh plate/brace clears any prior completion (Swift startTapSequence)
    if (arm) {
      // startSessionRecording seeds checkpoint [0] (the L-phase truncation anchor), so no explicit
      // checkpoint is needed here.
      this.device?.startSessionRecording()
      this.device?.armMaterial(this.matSearch('longitudinal'))
    }
    // capturingL arm prompt = "Ready for L tap" (mirrors Swift startTapSequence; the silent
    // warm-up on Swift/Python now shows this too — was "Tap the guitar…", a divergence).
    this.setStatusMessage(this.materialArmPrompt())
    this.notify()
  }

  /** Review → advance to the next phase (Accept). */
  acceptMaterial(): void {
    const phase = this.materialTapPhase
    if (phase === 'reviewingL') {
      this.materialTapPhase = 'capturingC'
      this.currentTapCount = this.materialPhaseBase('capturingC') // cumulative: L's taps stay counted
      this.materialBuffer = []
      this.device?.checkpointSession() // C phase start (so a redo can drop it)
      this.device?.armMaterial(this.matSearch('cross'))
      this.setStatusMessage('Rotate 90° and tap for C')
      this.notify()
    } else if (phase === 'reviewingC') {
      if (this.measureFlc) {
        // Mirror Swift acceptCurrentPhase: show the FLC reposition prompt during a tapCooldown with
        // detection DISARMED (waitingForFlcTap) so the plate-repositioning bump isn't taken as the FLC
        // tap; then arm the FLC capture.
        this.materialTapPhase = 'waitingForFlcTap'
        this.currentTapCount = this.materialPhaseBase('waitingForFlcTap') // cumulative: L+C stay counted
        this.materialBuffer = []
        this.device?.checkpointSession() // FLC phase start (so a redo can drop it)
        this.setStatusMessage('Set up for FLC tap, then tap')
        this.notify()
        this.flcCooldownTimer = setTimeout(() => {
          this.flcCooldownTimer = null
          if (this.materialTapPhase !== 'waitingForFlcTap') return // canceled (reset / type change)
          this.materialTapPhase = 'capturingFlc'
          this.device?.armMaterial(this.matSearch('flc'))
          this.setStatusMessage('Set up for FLC tap, then tap') // capturingFlc resting = same prompt
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
    this.device?.redoSession() // drop the rejected phase's audio from the session WAV
    this.materialBuffer = []
    if (phase === 'reviewingL') {
      this.materialTapPhase = 'capturingL'
      this.device?.armMaterial(this.matSearch('longitudinal'))
      this.setStatusMessage('Ready for L tap — tap again')
    } else if (phase === 'reviewingC') {
      this.materialTapPhase = 'capturingC'
      this.device?.armMaterial(this.matSearch('cross'))
      this.setStatusMessage('Ready for C tap — tap again')
    } else if (phase === 'reviewingFlc') {
      this.materialTapPhase = 'capturingFlc'
      this.device?.armMaterial(this.matSearch('flc'))
      this.setStatusMessage('Ready for FLC tap — tap again')
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
      this.device?.armMaterial(search)
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
      this.device?.armMaterial(search)
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
        this.setStatusMessage('File: L complete, capturing C...')
        this.device?.armMaterial(this.matSearch('cross'))
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
          this.setStatusMessage('File: C complete, capturing FLC...')
          this.device?.armMaterial(this.matSearch('flc'))
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
    this.device?.cancelSessionRecording() // abandon any partial session WAV
    this.notify()
  }

  /** Restore a loaded material measurement (per-phase spectra + peaks, phase=complete). */
  restoreMaterial(m: { matSpectra: MatSpectra; matPeaks: MaterialPeaks }): void {
    this.matSpectra = m.matSpectra
    this.matPeaks = m.matPeaks
    this.materialTapPhase = 'complete'
    this.isMeasurementComplete = true // a loaded material measurement is complete (Swift loadMeasurement)
    this.setStatusMessage(LOADED_STATUS)
    this.notify()
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
        isDetecting: this.isDetecting,
        isDetectionPaused: this.isDetectionPaused,
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
        modeByPeak: this.modeByPeak,
        overrides: this.overrides,
        annotationOffsets: this.annotationOffsets,
        selectedPeakIds: this.selectedPeakIds,
        userModifiedSelection: this.userModifiedSelection,
        canReanalyze: this.canReanalyze,
        matSpectra: this.matSpectra,
        matPeaks: this.matPeaks,
        statusMessage: this.statusMessage,
        engineState: this.engineState,
        isClipping: this.isClipping,
      })
    }
    return this.cachedSnapshot
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
    this.statusMessage = this.isClipping ? CLIPPING_WARNING : msg
  }

  /** The device forwards edge-triggered input clipping here (Swift `fftAnalyzer.$isClipping` sink /
   *  Python `clippingChanged` → `_set_clipping`). Overrides the status with the warning, restores on clear. */
  setClipping(clipping: boolean): void {
    if (clipping === this.isClipping) return
    this.isClipping = clipping
    this.statusMessage = clipping ? CLIPPING_WARNING : this.latestRealStatus
    this.notify()
  }

  /** The guitar resting prompt (canonical post-warm-up steady state). */
  private tapPrompt(): string {
    return this.numberOfTaps === 1 ? 'Tap the guitar...' : `Tap the guitar ${this.numberOfTaps} times...`
  }

  /** The material arm prompt for the longitudinal (first) phase — mirrors Swift startTapSequence's
   *  brace/plate branch, including the multi-tap "×N each for …" variant. */
  private materialArmPrompt(): string {
    if (this.measurementType === 'brace') {
      return this.numberOfTaps > 1 ? `Ready for fL tap (×${this.numberOfTaps})` : 'Ready for fL tap'
    }
    if (this.numberOfTaps > 1) {
      const phases = this.measureFlc ? 'L, C, FLC' : 'L, C'
      return `Ready for L tap (×${this.numberOfTaps} each for ${phases})`
    }
    return 'Ready for L tap'
  }

  /** The resting "waiting for a tap" prompt for the current mode/phase (used on resume + tap-count change). */
  private restingPrompt(): string {
    if (this.isGuitar) {
      return this.currentTapCount === 0
        ? this.tapPrompt()
        : `Tap ${this.currentTapCount}/${this.numberOfTaps} captured. Tap again...`
    }
    switch (this.materialTapPhase) {
      case 'capturingC':
        return 'Rotate 90° and tap for C'
      case 'waitingForFlcTap':
      case 'capturingFlc':
        return 'Set up for FLC tap, then tap'
      default:
        return this.materialArmPrompt() // capturingL / notStarted → "Ready for L tap" (mirrors Swift)
    }
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
    if (!this.isMeasurementComplete && this.isDetecting && this.currentTapCount === 0) {
      this.setStatusMessage(this.restingPrompt())
    }
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
  setEngineState(s: EngineState): void {
    const prev = this.engineState
    this.engineState = s
    this.isDetecting = s === 'listening' || s === 'capturing'
    this.isDetectionPaused = s === 'paused'
    if (s === 'paused') {
      this.setStatusMessage('Detection paused – tap freely, then resume')
    } else if (prev === 'paused' && (s === 'listening' || s === 'capturing')) {
      this.setStatusMessage(this.restingPrompt()) // resume → restore the mode/phase prompt
    } else if (this.isGuitar) {
      this.setGuitarStatus(s)
    }
    this.notify()
  }

  /** Guitar status derived from the engine state (listening/capturing). `idle` is left to
   *  recalculatePeaks (the completion string) or the pre-arm default. */
  private setGuitarStatus(s: EngineState): void {
    const total = this.numberOfTaps
    const count = this.currentTapCount
    if (s === 'listening') {
      this.setStatusMessage(count === 0 ? this.tapPrompt() : `Tap ${count}/${total} captured. Tap again...`)
    } else if (s === 'capturing') {
      const prov = Math.min(count + 1, total)
      this.setStatusMessage(prov < total ? `Tap ${prov}/${total} capturing...` : 'All taps captured. Processing...')
    }
  }

  setComplete(v: boolean): void {
    this.isMeasurementComplete = v // uses the didSet (clears the loaded-settings warning)
    this.notify()
  }

  setMeasurementTypeAndNotify(t: MeasurementType): void {
    this.measurementType = t
    this.notify()
  }

  /** A hardware input change: show "Audio device changed - reinitializing…" while settling, then restore
   *  the resting prompt (Swift route-change status). The device layer drives both edges. */
  handleDeviceChange(settling: boolean): void {
    this.setStatusMessage(settling ? 'Audio device changed - reinitializing...' : this.restingPrompt())
    this.notify()
  }
}

/** Immutable view of the lifecycle facts App reads via useSyncExternalStore. */
export interface TapToneSnapshot {
  isDetecting: boolean
  isDetectionPaused: boolean
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
  /** Guitar peaks (findPeaks on the frozen spectrum, or a loaded measurement's filtered peaks). */
  peaks: Peak[]
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
  /** Whether the Re-analyze button is offered (any complete guitar measurement with a frozen
   *  spectrum; never material). See `TapToneAnalyzer.canReanalyze` for why it is not a dirty flag. */
  canReanalyze: boolean
  /** Material (plate/brace) per-phase result spectra. */
  matSpectra: MatSpectra
  /** Material (plate/brace) per-phase located peaks. */
  matPeaks: MaterialPeaks
  /** The imperative status-bar message (set at every transition; clipping override applied). */
  statusMessage: string
  /** The device engine state (idle/listening/capturing/paused) mirrored on the analyzer — the single
   *  source for the status-bar className + the capturing/waiting distinction (3c-C5). */
  engineState: EngineState
  /** Input clipping (drives the threshold-slider red zone; the status override reads the private field). */
  isClipping: boolean
}

/**
 * Checks that `s` does not violate any documented state-machine invariant.
 * Returns null when all hold, or a string describing the first violation.
 * Mirrors Swift `stateInvariantViolation` (I1–I6).
 */
export function stateInvariantViolation(s: TapToneAnalyzer): string | null {
  const isGuitar = s.isGuitar

  // I1: guitar mode — isDetecting && isMeasurementComplete is illegal.
  if (isGuitar && s.isDetecting && s.isMeasurementComplete) {
    return 'I1: isDetecting && isMeasurementComplete is illegal in guitar mode'
  }

  // I2: cannot be paused once the measurement is complete.
  if (s.isDetectionPaused && s.isMeasurementComplete) {
    return 'I2: isDetectionPaused && isMeasurementComplete is illegal (cannot be paused once measurement is done)'
  }

  // I3: capturedTaps.count must never exceed numberOfTaps.
  if (s.capturedTaps.length > s.numberOfTaps) {
    return `I3: capturedTaps.count (${s.capturedTaps.length}) > numberOfTaps (${s.numberOfTaps})`
  }

  // I4: guitar mode — currentTapCount must match capturedTaps.count.
  if (isGuitar && s.currentTapCount !== s.capturedTaps.length) {
    return `I4: currentTapCount (${s.currentTapCount}) != capturedTaps.count (${s.capturedTaps.length}) in guitar mode`
  }

  // I5: tapProgress must be in [0, 1].
  if (s.tapProgress < 0 || s.tapProgress > 1) {
    return `I5: tapProgress (${s.tapProgress}) outside [0, 1]`
  }

  // I6: during a plate/brace review phase, isDetecting must be false.
  if (!isGuitar) {
    if (
      s.materialTapPhase === 'reviewingL' ||
      s.materialTapPhase === 'reviewingC' ||
      s.materialTapPhase === 'reviewingFlc'
    ) {
      if (s.isDetecting) {
        return `I6: isDetecting must be false during a plate/brace review phase (phase=${s.materialTapPhase})`
      }
    }
  }

  return null
}