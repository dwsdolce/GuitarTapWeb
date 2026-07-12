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
import { findPeaks, type Peak } from '../dsp/peaks'
import { classifyAll, type ResolvedMode } from '../dsp/classify'
import type { GuitarTypeName } from '../dsp/guitarModes'
import { PLATE_PHASES, BRACE_PHASE, findDominantPeak } from '../dsp/gatedCapture'
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
    // Per-tap entries only for a genuine multi-tap capture (Swift tapEntries gate: count > 1). Peaks
    // start empty and are filled by recalculatePeaks (App drives it right after completion).
    this.tapEntries =
      this.capturedTaps.length > 1 ? spectra.map((sp, i) => ({ tapIndex: i + 1, spectrum: sp, peaks: [] })) : []
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
    this.tapEntries = (snapshot.taps ?? []).map((sp, i) => ({ tapIndex: i + 1, spectrum: sp, peaks: [] }))
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
    this.isMeasurementComplete = false // setter also clears the loaded-settings warning
    this.notify()
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
    peakMin: number
  }): void {
    let peaks: Peak[]
    if (p.material) {
      peaks = [] // peaks are guitar-only; material uses matPeaks
    } else if (p.loadedPeaks) {
      peaks = p.loadedPeaks.filter((pk) => pk.magnitude >= p.peakMin) // loaded peaks are authoritative
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
              peakMinThreshold: p.peakMin,
            })
          : []
    }
    this.peaks = peaks
    this.modeByPeak = classifyAll(peaks, p.guitarType)
    // Per-tap peaks (Swift recalculateTapEntryPeaks): re-find each entry's peaks at the current Peak Min.
    // Guitar-only, and the default findPeaks range (matches the multi-tap table's modePeaksFromSpectrum).
    if (!p.material && this.tapEntries.length > 0) {
      this.tapEntries = this.tapEntries.map((e) => ({
        ...e,
        peaks: findPeaks(e.spectrum.magnitudesDb, e.spectrum.frequencies, {
          guitarType: p.guitarType,
          peakMinThreshold: p.peakMin,
        }),
      }))
    }
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
  private advanceAfterPhase(ph: MaterialPhaseName, avg: Spectrum, avgPeak: MaterialPeaks['longitudinal']): void {
    const playing = this.device?.playingFile ?? false
    if (ph === 'longitudinal') {
      this.matSpectra = { ...this.matSpectra, longitudinal: avg }
      this.matPeaks = { ...this.matPeaks, longitudinal: avgPeak }
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
      this.matPeaks = { ...this.matPeaks, cross: avgPeak }
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
      this.matPeaks = { ...this.matPeaks, flc: avgPeak }
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