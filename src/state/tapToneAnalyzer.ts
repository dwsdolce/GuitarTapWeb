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

export type MeasurementType = 'acoustic' | 'classical' | 'flamenco' | 'plate' | 'brace'

/** Guitar (acoustic/classical/flamenco) vs material (plate/brace). Mirrors Swift `MeasurementType.isGuitar`. */
export function isGuitarType(t: MeasurementType): boolean {
  return t !== 'plate' && t !== 'brace'
}

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
  measurementType: MeasurementType = 'classical'
  showLoadedSettingsWarning = false

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

  /** currentTapCount / numberOfTaps, unclamped (invariant I5 pins it to [0, 1]). */
  get tapProgress(): number {
    return this.numberOfTaps > 0 ? this.currentTapCount / this.numberOfTaps : 0
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
    this.isMeasurementComplete = true
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
        materialTapPhase: this.materialTapPhase,
        measurementType: this.measurementType,
        isGuitar: this.isGuitar,
        frozenSpectrum: this.frozenSpectrum(),
        tapEntries: this.tapEntries,
        peaks: this.peaks,
        modeByPeak: this.modeByPeak,
      })
    }
    return this.cachedSnapshot
  }

  private notify(): void {
    this.cachedSnapshot = null
    this.listeners.forEach((l) => l())
  }

  // ── Audio-device-driven setters (the RealtimeFFTAnalyzer drives these; each notifies) ──────────
  setNumberOfTaps(n: number): void {
    this.numberOfTaps = n
    this.notify()
  }

  setCurrentTapCount(n: number): void {
    this.currentTapCount = n
    this.notify()
  }

  setDetecting(detecting: boolean, paused: boolean): void {
    this.isDetecting = detecting
    this.isDetectionPaused = paused
    this.notify()
  }

  setComplete(v: boolean): void {
    this.isMeasurementComplete = v // uses the didSet (clears the loaded-settings warning)
    this.notify()
  }

  setMeasurementTypeAndNotify(t: MeasurementType): void {
    this.measurementType = t
    this.notify()
  }

  setMaterialTapPhase(p: MaterialTapPhase): void {
    this.materialTapPhase = p
    this.notify()
  }
}

/** Immutable view of the lifecycle facts App reads via useSyncExternalStore. */
export interface TapToneSnapshot {
  isDetecting: boolean
  isDetectionPaused: boolean
  isMeasurementComplete: boolean
  currentTapCount: number
  numberOfTaps: number
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