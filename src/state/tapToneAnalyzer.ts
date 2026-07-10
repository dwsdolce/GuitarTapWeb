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
import { averageSpectra } from '../dsp/spectrumAverage'
import { computeGatedFFT } from '../dsp/gatedFFT'
import type { Spectrum } from '../dsp/guitarFFT'

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

  /** Merge point for both capture paths: clear detection, append the captured tap. */
  finishGuitarGatedCapture(samples: Float32Array | Float64Array | number[], sampleRate: number): void {
    this.isDetecting = false
    const spec = computeGatedFFT(samples, sampleRate)
    this.capturedTaps.push({ magnitudes: spec.magnitudesDb, frequencies: spec.frequencies, captureTime: 0 })
    this.currentTapCount = this.capturedTaps.length
  }

  /** Complete the measurement: power-average the captured taps into the frozen
   *  spectrum and set isMeasurementComplete. No-op when no taps were captured. */
  processMultipleTaps(): void {
    if (this.capturedTaps.length === 0) return // guard: nothing to freeze (MC6)
    const spectra: Spectrum[] = this.capturedTaps.map((t) => ({
      magnitudesDb: t.magnitudes,
      frequencies: t.frequencies,
    }))
    const avg = averageSpectra(spectra)
    this.frozenMagnitudes = avg.magnitudesDb
    this.frozenFrequencies = avg.frequencies
    this.isMeasurementComplete = true
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

  /** Load a saved measurement: freeze its spectrum and mark complete. */
  loadMeasurement(snapshot: { magnitudes: number[]; frequencies: number[] }): void {
    this.frozenMagnitudes = snapshot.magnitudes
    this.frozenFrequencies = snapshot.frequencies
    this.isMeasurementComplete = true
  }
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