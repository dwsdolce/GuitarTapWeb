// @parity audio/realtime-analyzer
import { dftAnalRect, GUITAR_FFT_SIZE, type Spectrum } from '../dsp/guitarFFT'
import { applyCalibration, interpolateToBins, type Calibration } from '../dsp/calibration'
import { DecayTracker } from '../dsp/decay'
import {
  gatedCaptureResult,
  GATED_CAPTURE_DURATION,
  PLATE_PHASES,
  BRACE_PHASE,
  type MaterialPeak,
} from '../dsp/gatedCapture'

/** Identity of a captured material phase (mirrors the plate/brace gated phase order). */
export type MaterialPhaseName = 'longitudinal' | 'cross' | 'flc'

/** Search parameters for locating a material peak in a gated plate/brace capture. */
export interface MaterialSearch {
  /** Low edge of the search range, in Hz. */
  minHz: number
  /** High edge of the search range, in Hz. */
  maxHz: number
  /** Prefer the lowest significant peak over the tallest (the plate longitudinal rule). */
  preferLowestSignificant: boolean
  /** Active mic calibration applied to the gated spectrum before peak-finding (see gatedCapture). */
  calibration?: Calibration | null
}
/** One captured material phase: its gated spectrum, the located peak, and which phase it is. */
export interface MaterialCaptureResult {
  spectrum: Spectrum
  peak: MaterialPeak | null
  /** Which phase this capture is for. Set by the engine during a file-playback material session
   *  (auto-advance); undefined during live capture, where the App derives it from its phase state. */
  phase?: MaterialPhaseName
}

/** Lifecycle state of the {@link RealtimeFFTAnalyzer}. */
export type EngineState = 'idle' | 'listening' | 'capturing' | 'paused'

/** Optional callbacks the caller supplies to observe the engine (spectrum, level, captures, state…). */
export interface RealtimeFFTAnalyzerCallbacks {
  onSpectrum?: (spectrum: Spectrum) => void
  onLevel?: (db: number) => void
  /** One captured guitar tap's spectrum, delivered RAW as soon as its window fills. The device no
   *  longer averages (6-TEST 3c-C2a); the TapToneAnalyzer accumulates these + averages them into the
   *  frozen result. Fires once per tap, in order, for both single- and multi-tap sequences. */
  onGuitarTap?: (spectrum: Spectrum) => void
  /** The guitar tap sequence finished (the requested tap count was reached). The analyzer averages
   *  the accumulated taps and freezes the result. Pairs with onGuitarTap. */
  onGuitarComplete?: () => void
  onState?: (state: EngineState) => void
  /** Multi-tap progress: taps collected so far / total requested. */
  onProgress?: (collected: number, total: number) => void
  /** Edge-triggered input clipping (peak ≥ 0.99 or RMS ≥ 0 dBFS, 1.5 s hold). */
  onClipping?: (clipping: boolean) => void
  /** One raw gated material tap's spectrum (3c-C4 Option C). The device is now purely a gated-FFT
   *  emitter for material: it computes the per-tap gated spectrum, delivers it here, and DISARMS — the
   *  TapToneAnalyzer owns the per-tap validity gate, the tap count, the re-arm (via armMaterial), and
   *  the L→C→FLC phase advance (mirroring Swift `finishGatedFFTCapture` + `handle*GatedProgress`). */
  onMaterialTap?: (spectrum: Spectrum) => void
  /** Continuous session recording for the "Dump Capture Audio" diagnostic — fired ONCE at the end of a
   *  measurement with every chunk that flowed through the pipeline while recording (minus paused
   *  segments and redone phases), so replaying it reproduces the session. `label` identifies the
   *  measurement ("Guitar_8tap" / "Plate_LC" / "Plate_LCF" / "Brace"). Mirrors Swift finishSessionRecording. */
  onSessionAudio?: (samples: Float32Array, sampleRate: number, label: string) => void
  /** Live-FFT performance, emitted once per continuous spectrum (FFTAnalysisMetricsView). */
  onMetrics?: (m: EngineMetrics) => void
  /** The active input device changed on its own (a mic was attached → auto-selected, or the active
   *  mic was unplugged → fell back). The caller re-syncs device state + reloads the per-device
   *  calibration for `deviceId`. Mirrors Swift's CoreAudio device-change → selectedInputDevice.didSet. */
  onInputChanged?: (deviceId: string | null) => void
  /** Live ring-out (decay) time in seconds, or null — fired when it changes (the value refines as
   *  the post-tap level decays, and clears to null on New Tap). Drives the live Ring-Out box. */
  onDecay?: (decayTime: number | null) => void
}

/** Live-FFT performance counters (mirrors FFTAnalysisMetricsView's Performance section). */
export interface EngineMetrics {
  /** Wall-clock of the last continuous FFT (ms). */
  processingMs: number
  /** 30-frame moving average of the FFT wall-clock (ms). */
  avgProcessingMs: number
  /** Continuous FFT calculations per second (sampleRate / FFT size; 0% overlap). */
  frameRate: number
  /** Input level (dBFS) sampled at the FFT-frame rate — the status-bar / Metrics readout updates at the
   *  same cadence as the spectrum + Peak, mirroring Swift `displayLevelDB` (inputLevelDB gated by the
   *  graph publish rate), NOT the fast per-chunk `onLevel` (which drives the responsive threshold meter). */
  displayLevelDB: number
}

/** Tunable engine settings the caller can change while running (threshold, tap count, diagnostics). */
export interface RealtimeFFTAnalyzerConfig {
  /** Level-crossing threshold for tap onset (dBFS). */
  tapDetectionThreshold: number
  /** Number of taps to average (1–10). */
  numberOfTaps: number
  /** "Dump Capture Audio" diagnostic on — gates continuous session recording (no buffer cost when off). */
  dumpCaptureAudio: boolean
}

const DEFAULT_CONFIG: RealtimeFFTAnalyzerConfig = {
  tapDetectionThreshold: -40,
  numberOfTaps: 1,
  dumpCaptureAudio: false,
}

const CLIP_HOLD_SECONDS = 1.5
// Decay-seed peak hold (Swift `peakHoldDuration`): how long recentPeakDb latches its max before
// releasing to the current level. Canonical value is Swift's CODE (2.0 s); the Swift "0.5 s" comment
// was stale (never updated after the value changed during testing).
const PEAK_HOLD_SECONDS = 2.0

const CONFIRM_CHUNKS = 2

// ── OUT-4 detection constants — canonical values from Swift/Python ────────────────────────────────
// Falling threshold = rising − HYSTERESIS_MARGIN, so the ring-out decay cannot re-trigger a tap on
// its way down. Swift `hysteresisMargin` / Python `hysteresis_margin`, both 3.0. It was once
// user-settable (the `.guitartap` format still has the fossil) and is now a constant.
const HYSTERESIS_MARGIN = 3.0

// Noise-floor EMA (material only). Swift `noiseFloorAlpha` / Python `noise_floor_alpha`.
const NOISE_FLOOR_ALPHA = 0.05
const NOISE_FLOOR_INITIAL_DB = -60

// Minimum headroom over the noise floor for a material tap. The 10 dB floor rejects small ambient
// spikes (typically 1–4 dB above the floor) while still catching real taps (12–30 dB above it).
const NOISE_FLOOR_MIN_HEADROOM_DB = 10
// The falling threshold keeps at least this much headroom over the floor.
const NOISE_FLOOR_MIN_FALLING_HEADROOM_DB = 4

// Detection warm-up, in seconds of AUDIO. Swift `warmupPeriod` / Python `warmup_period`.
const WARMUP_SECONDS = 0.5

interface ChunkMessage {
  samples: Float32Array
  rms: number
}

/**
 * Live audio engine. The mic feeds an AudioWorklet that posts 1024-sample chunks
 * (+ RMS) to the main thread, where the tested `src/dsp` core runs:
 *   - continuous live spectrum (accumulate 65536 → `dftAnalRect`; 0% overlap);
 *   - tap detection (2-chunk level-crossing), always-on once started (matching
 *     GuitarTap) → 65536 capture → the captured spectrum is emitted and the view
 *     freezes. New Tap simply re-arms a frozen result. Peak-finding/classification
 *     happen in the UI so Peak Min / guitar type re-analyze the frozen spectrum live.
 *
 * Sample rate is read from the live AudioContext (not forced — the OS/Audio MIDI
 * Setup defines the actual capture rate). Mirrors Swift `TapToneAnalyzer` / Python
 * `tap_tone_analyzer`.
 */
export class RealtimeFFTAnalyzer {
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private readonly callbacks: RealtimeFFTAnalyzerCallbacks
  private config: RealtimeFFTAnalyzerConfig

  sampleRate = 48000
  state: EngineState = 'idle'
  /** True while a file is playing through the pipeline (mic chunks are ignored meanwhile). */
  playingFile = false
  /** Test seam: when true, the pure pipeline (playFile/arm/capture) runs without a browser
   *  AudioContext (no mic). The web equivalent of Swift TapToneAnalyzer.forTesting(). */
  private headless = false
  /** Applied mic-track settings (AGC/EC/NS etc.) — for diagnosing capture gain. */
  audioSettings: MediaTrackSettings | null = null
  /** Label of the active input device (track.label), for the Settings panel. */
  deviceLabel = ''
  /** deviceId of the active input (for the device picker + per-device calibration mapping). */
  inputDeviceId: string | null = null
  /** Last-enumerated input deviceIds — baseline for detecting attach (new id) vs detach (id gone). */
  private knownDevices: string[] = []

  // Active mic calibration applied to the continuous + guitar-capture spectra (material/gated
  // applies it via the MaterialSearch passed to armMaterial). guitarCorr caches the per-bin
  // corrections for the fixed guitar FFT bins; null = recompute on next use.
  private calibration: Calibration | null = null
  private guitarCorr: number[] | null = null

  // Continuous live spectrum (0% overlap).
  private readonly accum = new Float32Array(GUITAR_FFT_SIZE)
  private accumIdx = 0

  // Tap detection state.
  private prevAbove = true
  private consecutive = 0

  // ── Hysteresis (OUT-4) — mirrors Swift/Python `isAboveThreshold` ────────────────────────────────
  // NOT the same thing as `prevAbove`. `prevAbove` is edge-detection state (was the LAST chunk above
  // the rising threshold?). `isAboveThreshold` is a LATCH: it goes true at the rising threshold and
  // only clears at the lower FALLING threshold, so the ring-out decay envelope cannot re-trigger a
  // tap on its way down. The web had no hysteresis at all — in guitar mode either. Swift and Python
  // have carried `hysteresisMargin = 3.0` all along.
  private isAboveThreshold = false

  // ── Noise-floor EMA (OUT-4) — mirrors Swift/Python `noiseFloorEstimate` ─────────────────────────
  // Material (plate/brace) detects RELATIVE to the tracked ambient floor, not against a fixed dBFS
  // level. The rule reduces to `rising = max(threshold, noiseFloor + 10 dB)` — i.e. it is the absolute
  // threshold with a FLOOR under it, so it only differs once the room gets loud. That is what keeps
  // detection working when ambient noise is elevated; a fixed threshold simply saturates (the level
  // never drops below it, so no rising edge can ever be confirmed) and the app goes deaf.
  // Guitar stays absolute. See Development/OUT-4-DETECTION-SPEC.md.
  private noiseFloorEstimate = NOISE_FLOOR_INITIAL_DB

  // ── Detection warm-up (OUT-4) — mirrors Swift/Python `warmupStartAudioTime` ─────────────────────
  // Value of the AUDIO clock when the sequence armed; detection is suppressed for WARMUP_SECONDS of
  // AUDIO after it. SILENT — it never writes a status message (that was OUT-1). Its real job is to
  // let the noise-floor EMA converge before the first tap is judged, and to re-anchor the floor to
  // real audio at exit. Measured on the audio clock, never the wall clock: the warm-up must cover the
  // first 0.5 s of AUDIO however long setup took. `null` = not armed / warm-up skipped.
  private warmupStartAudioTime: number | null = null
  private justExitedWarmup = false

  // Ring-out (decay) tracking — guitar only; fed the broadband level per chunk on an audio clock.
  private decay = new DecayTracker()
  private audioElapsed = 0 // accumulated audio time (s) — the decay tracker's clock
  private lastDecay: number | null = null // last value emitted via onDecay (de-dupe)
  // Peak-held broadband level for the decay SEED — mirrors Swift `recentPeakLevelDB`
  // (RealtimeFFTAnalyzer+FFTProcessing.swift): latch the running max, release to the current level
  // only after PEAK_HOLD_SECONDS without a higher peak. Captures the true tap strike even though tap
  // detection confirms a couple of chunks late, so the −15 dB reference isn't under-stated. Uses the
  // audio clock (deterministic / file-playback-safe), not wall-clock. Canonical value = Swift's CODE.
  private recentPeakDb = -100
  private recentPeakTime = 0

  // Continuous session recording — a flat sample buffer, mirroring Swift `sessionRecordingBuffer`
  // ([Float]) and Python `_session_recording_buffer` (list). `sessionActive` survives pause/resume
  // (which toggle `sessionRecording`); `sessionCheckpoints` hold the SAMPLE COUNT at each phase
  // start so a redone material phase can be truncated away. Only runs when the dump-capture setting
  // is on. (number[], not Float32Array, so it grows cheaply and truncates like the native lists;
  // flattened to a Float32Array at finishSessionRecording.)
  private sessionSamples: number[] = []
  private sessionCheckpoints: number[] = []
  private sessionRecording = false
  private sessionActive = false
  private sessionRate = 48000
  // Bounded pre-roll for the session WAV (FILE-PATHS-AND-NAMES-SPEC §6). True from
  // startSessionRecording until the first capture begins, then false for the rest of the session:
  // while true, only the last SESSION_PRE_ROLL_SECONDS of audio is kept; after the first tap the
  // buffer grows straight through. Mirrors Swift sessionPreRollActive.
  private sessionPreRollActive = false

  /** Latest measured ring-out time (s), read into the measurement at save (Swift currentDecayTime). */
  get decayTime(): number | null {
    return this.decay.decayTime
  }

  // Tap capture state (pre-roll ring buffer → capture window). Guitar uses a fixed
  // 65536 window (non-gated); material uses a ~500 ms window (gated FFT).
  private prerollSamples = 0
  private preroll = new Float32Array(0)
  private prerollIdx = 0
  private prerollFilled = 0
  private readonly guitarCapture = new Float32Array(GUITAR_FFT_SIZE)
  private materialCapture = new Float32Array(0)
  private capture: Float32Array = this.guitarCapture
  private captureIdx = 0
  private captureKind: 'guitar' | 'material' = 'guitar'
  private materialSearch: MaterialSearch | null = null

  // Guitar tap counter. The device no longer accumulates per-tap spectra (6-TEST 3c-C2a — the
  // TapToneAnalyzer owns accumulation + averaging); it keeps only this lightweight count to know
  // when the sequence is done (re-arm vs complete) and to label the session WAV.
  private guitarTapCount = 0

  // Clipping detection.
  private lastClipTime: number | null = null
  private clipState = false
  // Latest per-chunk input level (dBFS), sampled into the FFT-frame metrics as displayLevelDB.
  private lastLevelDb = -100

  // Buffer-delivery watchdog (mirrors Swift RealtimeFFTAnalyzer+Watchdog / Python).
  // Recovers from a silently-starved mic stream: the worklet stops posting chunks with
  // no error (the active track ends/mutes, the OS reconfigures the device, another app
  // takes it). A timer detects the silence and re-acquires the stream with bounded backoff.
  private lastChunkTime = 0
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private engineStartTime = 0
  private isRecovering = false
  private recoveryAttempts = 0
  private readonly watchdogSilenceMs = 2500
  private readonly watchdogMaxAttempts = 6
  private readonly watchdogBackoffsMs = [500, 1000, 2000, 4000]

  // Live-FFT performance (30-frame moving average), for the Metrics panel.
  private readonly procTimes: number[] = []
  processingMs = 0
  avgProcessingMs = 0

  constructor(callbacks: RealtimeFFTAnalyzerCallbacks = {}, config?: Partial<RealtimeFFTAnalyzerConfig>) {
    this.callbacks = callbacks
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  get running(): boolean {
    return this.context !== null || this.headless
  }

  /** Enable the headless pipeline for regression tests: drive the SAME playFile path the app uses,
   *  with no AudioContext/mic. Mirrors Swift TapToneAnalyzer.forTesting() + playFileForTesting. */
  initForTesting(): void {
    this.headless = true
  }

  setConfig(config: Partial<RealtimeFFTAnalyzerConfig>): void {
    const prevTaps = this.config.numberOfTaps
    this.config = { ...this.config, ...config }
    // A tap-count change while armed and waiting must immediately refresh the progress display so
    // the status prompt ("Tap the guitar N times…") tracks the new count without needing a re-arm
    // (New Tap is disabled until complete). Mirrors Swift numberOfTaps.didSet updating the prompt.
    // Skipped mid-capture and when idle: the stepper is locked once a tap is captured, and on load
    // the result is frozen (setConfig(loadedTaps) runs while idle). Guitar only — material progress +
    // its "Tap N times…" prompt are owned by the analyzer now (3c-C4 Option C: analyzer.setNumberOfTaps).
    if (
      this.config.numberOfTaps !== prevTaps &&
      this.captureKind === 'guitar' &&
      (this.state === 'listening' || this.state === 'paused')
    ) {
      this.callbacks.onProgress?.(this.guitarTapCount, this.config.numberOfTaps)
    }
  }

  /** Set (or clear) the active mic calibration for the continuous + guitar-capture paths.
   *  Adds interpolated per-bin dB corrections to the magnitude spectrum before it leaves the
   *  engine, so the App finds peaks on calibrated data — mirroring Swift's vDSP_vadd in FFT
   *  processing. The gated/material path receives the same calibration via armMaterial's search. */
  setCalibration(cal: Calibration | null): void {
    this.calibration = cal
    this.guitarCorr = null
  }

  /** The active mic calibration. Read by the TapToneAnalyzer when it builds a material search
   *  (mirrors Swift reading `fftAnalyzer.calibrationCorrections` / Python `self.mic._calibration`). */
  get activeCalibration(): Calibration | null {
    return this.calibration
  }

  /** Add calibration corrections to a freshly-computed spectrum (no-op when no calibration).
   *  The fixed guitar FFT bins are cached; any other bin layout (gated) is interpolated fresh. */
  private applyCal(spec: Spectrum): Spectrum {
    if (!this.calibration) return spec
    const guitarBins = (GUITAR_FFT_SIZE >> 1) + 1
    let corr: number[]
    if (spec.magnitudesDb.length === guitarBins) {
      if (!this.guitarCorr) this.guitarCorr = interpolateToBins(this.calibration, spec.frequencies)
      corr = this.guitarCorr
    } else {
      corr = interpolateToBins(this.calibration, spec.frequencies)
    }
    return { magnitudesDb: applyCalibration(spec.magnitudesDb, corr), frequencies: spec.frequencies }
  }

  /** Arm guitar tap detection (New Tap). Starts a fresh tap sequence. */
  arm(): void {
    if (!this.running || this.state === 'capturing') return
    this.captureKind = 'guitar'
    this.capture = this.guitarCapture
    this.guitarTapCount = 0
    this.prevAbove = true
    this.consecutive = 0
    // Guitar SKIPS the warm-up during file playback: an externally recorded guitar file may put the
    // tap inside the first 0.5 s, and guitar detects against the absolute threshold so it never reads
    // the noise floor. Live, it runs the warm-up like everything else.
    this.armWarmup(this.playingFile)
    this.decay.reset() // New Tap → drop any prior ring-out (the next tap re-seeds it)
    this.lastDecay = null
    this.callbacks.onDecay?.(null)
    this.callbacks.onProgress?.(0, this.config.numberOfTaps)
    this.startSessionRecording() // begin the continuous session WAV for this guitar sequence (dump-gated)
    this.setState('listening')
  }

  /** Arm (or re-arm) a gated material phase with its search range — the analyzer's re-arm-on-command
   *  (3c-C4 Option C). Used for a fresh phase, the next tap of a multi-tap phase, a redo, and the
   *  file-playback auto-advance; the analyzer owns the tap count + progress, so this only resets the
   *  level-crossing warm-up and re-arms. Called after finishCapture has disarmed (state 'idle'). */
  armMaterial(search: MaterialSearch): void {
    if (!this.running || this.state === 'capturing') return
    this.captureKind = 'material'
    this.materialSearch = search
    this.capture = this.materialCapture
    this.prevAbove = true
    this.consecutive = 0
    // Material ALWAYS runs the warm-up — live and playback alike. It is the only mode that uses the
    // relative noise-floor detector, and the warm-up is what establishes that floor (it feeds the EMA
    // and re-anchors it to real audio at exit). Also re-armed between taps/phases, which additionally
    // stops the previous tap's ring-out from re-triggering while the plate is repositioned.
    this.armWarmup(false)
    this.setState('listening')
  }

  /** Cancel an armed/listening sequence (no effect mid-capture). */
  disarm(): void {
    if (this.state === 'listening') this.setState('idle')
  }

  /** Pause an active tap sequence: stop detecting while the live spectrum keeps flowing and
   *  the collected taps are preserved. Mirrors Swift `pauseTapDetection()`. Only acts while
   *  listening — the capture window is sub-second and finishes on its own. */
  pause(): void {
    if (this.state === 'listening') {
      this.sessionRecording = false // exclude the paused segment from the session WAV (Swift)
      this.setState('paused')
    }
  }

  /** Resume after a pause, continuing the sequence from the current tap count. Resets the
   *  level-crossing warm-up (so the first chunk after resume can't false-trigger), exactly
   *  like Swift `resumeTapDetection()`. No-op unless paused. */
  resume(): void {
    if (this.state !== 'paused') return
    this.prevAbove = true
    this.consecutive = 0
    // Resuming re-arms detection, so it re-runs the warm-up (mirrors Swift resumeTapDetection).
    this.armWarmup(this.playingFile && this.captureKind === 'guitar')
    if (this.sessionActive) this.sessionRecording = true // resume accumulating into the session WAV
    this.setState('listening')
  }

  /** Abort the current sequence (guitar multi-tap or material), discarding any partial
   *  captures, and return to idle so New Tap re-arms. Mirrors Swift `cancelTapSequence()`. */
  cancel(): void {
    this.guitarTapCount = 0
    this.materialSearch = null
    this.captureKind = 'guitar'
    this.capture = this.guitarCapture
    this.captureIdx = 0
    this.prevAbove = true
    this.consecutive = 0
    this.cancelSessionRecording() // discard the partial session WAV
    this.setState('idle')
  }

  // ── Continuous session recording (Swift TapToneAnalyzer session WAV) ────────
  /** Begin accumulating every pipeline chunk for the session WAV (no-op unless the dump setting is on).
   *  Guitar calls this from `arm()`; live material drives it from useMaterialSession. */
  startSessionRecording(): void {
    if (!this.config.dumpCaptureAudio) return
    this.sessionSamples = []
    this.sessionCheckpoints = [0] // first-phase truncation anchor (Swift/Python seed [0] at start)
    this.sessionRate = this.sampleRate
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

  /** Seconds of audio retained before the first tap (>= the 0.5 s warm-up, with margin). */
  static readonly SESSION_PRE_ROLL_SECONDS = 2.0

  /** ``SESSION_PRE_ROLL_SECONDS`` in samples at the current session rate (Swift sessionPreRollSamples). */
  private get sessionPreRollSamples(): number {
    return Math.round(this.sessionRate * RealtimeFFTAnalyzer.SESSION_PRE_ROLL_SECONDS)
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
    if (this.state === 'capturing') {
      this.sessionPreRollActive = false // first tap started — freeze the pre-roll
      return
    }
    const excess = this.sessionSamples.length - this.sessionPreRollSamples
    if (excess > 0) this.sessionSamples.splice(0, excess)
  }

  /** Finish the session: emit the accumulated audio (if any) as one WAV via onSessionAudio, then clear. */
  finishSessionRecording(label: string): void {
    this.sessionRecording = false
    this.sessionActive = false
    const samples = this.sessionSamples
    const rate = this.sessionRate
    this.sessionSamples = []
    this.sessionCheckpoints = []
    if (samples.length === 0) return
    this.callbacks.onSessionAudio?.(new Float32Array(samples), rate, label)
  }

  /** Abandon the session without writing (cancel / measurement-type change / New Tap of a fresh kind). */
  cancelSessionRecording(): void {
    this.sessionRecording = false
    this.sessionActive = false
    this.sessionSamples = []
    this.sessionCheckpoints = []
  }

  private setState(state: EngineState): void {
    this.state = state
    this.callbacks.onState?.(state)
  }

  private removeGestureResume: (() => void) | null = null

  private installGestureResume(ctx: AudioContext): void {
    const resume = () => {
      void ctx.resume()
      this.removeGestureResume?.()
    }
    const remove = () => {
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
      this.removeGestureResume = null
    }
    this.removeGestureResume = remove
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)
  }

  // Processing-off constraints (AGC/EC/NS), shared across acquisitions. Optionally pin a deviceId.
  private baseAudio(deviceId?: string | null): MediaTrackConstraints {
    return {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // Chrome legacy goog flags — belt-and-suspenders to kill input processing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ googAutoGainControl: false, googNoiseSuppression: false, googEchoCancellation: false } as any),
    }
  }

  /** Acquire a mic stream for `deviceId`, falling back to the DEFAULT input when an exact
   *  deviceId can't be satisfied — a saved id goes stale across sessions (Safari rotates input
   *  deviceIds for privacy) or when the device is unplugged. Without this, auto-start would fail
   *  with OverconstrainedError ("Invalid constraint") instead of just using the default mic. */
  private async acquireStream(deviceId?: string | null): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: this.baseAudio(deviceId) })
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        return navigator.mediaDevices.getUserMedia({ audio: this.baseAudio(null) }) // default input
      }
      throw e
    }
  }

  /** Enumerate available audio input devices (labels are populated once permission is granted).
   *  Chrome exposes synthetic "default"/"communications" aliases that duplicate a real device
   *  (e.g. "Default - MacBook Pro Microphone" alongside "MacBook Pro Microphone"); drop them so the
   *  picker lists each physical mic once, matching the native apps. */
  async listInputs(): Promise<{ deviceId: string; label: string }[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      // Chrome appends a USB "(vid:pid)" hex suffix to labels (e.g. "UMIK-1 … (2752:0007)"); strip it
      // so labels match Safari + the native apps' CoreAudio device names. deviceId is untouched.
      .map((d) => ({ deviceId: d.deviceId, label: d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') }))
  }

  /** Swap the live source to `stream`, keeping the same AudioContext/worklet (so the sample rate
   *  and DSP state survive). Updates inputDeviceId/label/settings from the new track. */
  private async applyStream(stream: MediaStream, requestedDeviceId?: string | null): Promise<void> {
    if (!this.context || !this.node) return
    const track = stream.getAudioTracks()[0]!
    this.watchTrack(track)
    try {
      await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
    } catch {
      /* not all browsers support applyConstraints on these */
    }
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = stream
    this.source = this.context.createMediaStreamSource(stream)
    this.source.connect(this.node)
    this.audioSettings = track.getSettings() ?? null
    this.deviceLabel = track.label ?? ''
    this.inputDeviceId = track.getSettings().deviceId ?? requestedDeviceId ?? null
  }

  /** Switch the live input to `deviceId` (explicit user choice — no default fallback; the picker
   *  caller surfaces any error). The web equivalent of RealtimeFFTAnalyzer.setInputDevice. */
  async setInputDevice(deviceId: string): Promise<void> {
    if (!this.context || !this.node) return
    await this.applyStream(await navigator.mediaDevices.getUserMedia({ audio: this.baseAudio(deviceId) }), deviceId)
  }

  /** Hardware-change handler (mic attached / unplugged), mirroring Swift's CoreAudio device listener:
   *   • a NEW device appeared → auto-select it (Swift switches to the first newly-connected device);
   *   • the ACTIVE device was unplugged → fall back to the default input;
   *  then fire onInputChanged so the per-device calibration is reloaded for the now-active device.
   *  Bound field so add/removeEventListener match. */
  private handleDeviceChange = async (): Promise<void> => {
    if (!this.context || !this.node) return
    const ids = (await this.listInputs()).map((d) => d.deviceId)
    const prev = this.knownDevices
    this.knownDevices = ids
    const attached = ids.find((id) => !prev.includes(id))
    try {
      if (prev.length && attached) {
        await this.applyStream(await navigator.mediaDevices.getUserMedia({ audio: this.baseAudio(attached) }), attached)
      } else if (this.inputDeviceId && !ids.includes(this.inputDeviceId)) {
        await this.applyStream(await this.acquireStream(null)) // active mic gone → default
      } else {
        this.callbacks.onInputChanged?.(this.inputDeviceId) // unrelated change — just resync the picker
        return
      }
    } catch {
      try {
        await this.applyStream(await this.acquireStream(null)) // chosen device failed → last-resort default
      } catch {
        return /* mic fully unavailable */
      }
    }
    this.callbacks.onInputChanged?.(this.inputDeviceId)
  }

  async start(deviceId?: string | null): Promise<void> {
    if (this.context) return
    // Don't force a rate: browsers expose no device "nominal" rate (no constraint →
    // system default; getCapabilities → device MAX), so we let the OS decide. The rate
    // is set in macOS Audio MIDI Setup (the AudioContext follows the default OUTPUT
    // device, so input AND output must be set to the same rate). The DSP reads the
    // actual ctx.sampleRate — there is no forced/expected rate. (Provenance is
    // recorded per measurement; a load-time warning compares a saved measurement's
    // recorded rate against the current one — see measurement/fromLive.ts.)
    this.stream = await this.acquireStream(deviceId) // exact saved device, else default (Safari stale ids)
    const track = this.stream.getAudioTracks()[0]!
    this.watchTrack(track)
    // Re-assert processing-off; some UAs only honor applyConstraints.
    try {
      await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
    } catch {
      /* not all browsers support applyConstraints on these */
    }
    this.audioSettings = track.getSettings() ?? null
    this.deviceLabel = track.label ?? ''
    this.inputDeviceId = track.getSettings().deviceId ?? deviceId ?? null
    const ctx = new AudioContext()
    this.context = ctx
    this.sampleRate = ctx.sampleRate
    this.prerollSamples = Math.round(this.sampleRate * 0.2)
    this.preroll = new Float32Array(this.prerollSamples)
    this.materialCapture = new Float32Array(Math.round(this.sampleRate * GATED_CAPTURE_DURATION))
    await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}spectrum-processor.js`)
    await ctx.resume()
    // Browsers may bring the context up suspended without a user gesture (e.g. on
    // reload with permission already granted). Resume transparently on first input.
    if (ctx.state === 'suspended') this.installGestureResume(ctx)

    this.source = ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(ctx, 'spectrum-processor')
    this.node.port.onmessage = (e: MessageEvent<ChunkMessage>) => this.onChunk(e.data)
    this.source.connect(this.node)
    this.node.connect(ctx.destination) // processor emits no output → silent

    // Arming is driven by the caller after start resolves (App's armForCurrentType, via
    // useAudioEngine's onStarted) so guitar and material go through one branch — mirrors
    // Swift/Python start() → startTapSequence(). start() no longer self-arms guitar.

    // Baseline the device list + watch for hot-plug changes (attach → auto-select, unplug → fall back).
    this.knownDevices = (await this.listInputs()).map((d) => d.deviceId)
    navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange)

    this.startBufferWatchdog()
  }

  // ── Buffer-delivery watchdog ────────────────────────────────────────────────
  // Detects a silently-starved mic stream (worklet stops posting chunks, no error)
  // and re-acquires the input with bounded backoff. Mirrors Swift/Python.

  private startBufferWatchdog(): void {
    this.stopBufferWatchdog()
    this.engineStartTime = performance.now()
    this.lastChunkTime = performance.now()
    this.watchdogTimer = setInterval(() => this.checkBufferWatchdog(), 1000)
  }

  private stopBufferWatchdog(): void {
    if (this.watchdogTimer != null) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  private checkBufferWatchdog(): void {
    // Only watch a live, running mic context (a suspended context — backgrounded tab —
    // legitimately delivers no chunks and must not be "recovered").
    if (!this.context || this.context.state !== 'running' || this.playingFile || this.isRecovering) return
    if (performance.now() - this.engineStartTime <= 4000) return // startup grace
    const silentFor = performance.now() - this.lastChunkTime
    if (silentFor <= this.watchdogSilenceMs) {
      if (this.recoveryAttempts !== 0) this.recoveryAttempts = 0 // healthy — clear the streak
      return
    }
    console.warn(`[engine] buffer watchdog: no audio for ${Math.round(silentFor)}ms — re-acquiring input`)
    this.isRecovering = true
    void this.attemptWatchdogRecovery()
  }

  private async attemptWatchdogRecovery(): Promise<void> {
    this.recoveryAttempts += 1
    if (this.recoveryAttempts > this.watchdogMaxAttempts) {
      console.error(`[engine] buffer watchdog: gave up after ${this.watchdogMaxAttempts} attempts`)
      this.isRecovering = false
      this.stopBufferWatchdog()
      return
    }
    const backoff = this.watchdogBackoffsMs[Math.min(this.recoveryAttempts - 1, this.watchdogBackoffsMs.length - 1)]!
    await new Promise((r) => setTimeout(r, backoff))
    try {
      // Re-acquire the current input (exact device, else default) and reconnect the
      // source to the existing worklet node — the context/worklet survive.
      await this.applyStream(await this.acquireStream(this.inputDeviceId), this.inputDeviceId)
      this.lastChunkTime = performance.now() // give the fresh stream a grace window
      this.engineStartTime = performance.now()
      console.warn('[engine] buffer watchdog: input re-acquired')
      this.isRecovering = false
    } catch (e) {
      console.warn('[engine] buffer watchdog: re-acquire failed, retrying', e)
      void this.attemptWatchdogRecovery() // bounded retry
    }
  }

  private onChunk(data: ChunkMessage): void {
    this.lastChunkTime = performance.now() // watchdog liveness stamp (the mic worklet is alive)
    if (this.playingFile) return // mic chunks are ignored while a file plays through the pipeline
    this.processChunk(data.samples, data.rms)
  }

  /** Wire a fresh input track's loss signals: `ended` (device truly gone) forces the watchdog
   *  to recover on its next tick; `mute` is informational (a persistent mute is caught by the
   *  watchdog's silence threshold; a transient one self-resolves without a disruptive re-acquire). */
  private watchTrack(track: MediaStreamTrack): void {
    track.onended = () => {
      this.lastChunkTime = 0 // force "starved" so the next watchdog tick re-acquires
    }
    track.onmute = () => {
      /* no-op: the watchdog recovers only if the silence persists past the threshold */
    }
  }

  // The shared per-chunk core, fed by BOTH the live mic (onChunk) and file playback (playFile),
  // so a played file runs the exact same level-crossing + FFT + capture path as the mic.
  private processChunk(s: Float32Array, rms: number): void {
    const db = 20 * Math.log10(Math.max(rms, 1e-10))
    this.lastLevelDb = db // sampled into the FFT-frame metrics (displayLevelDB) at the graph rate
    this.callbacks.onLevel?.(db)
    this.detectClipping(s, db)

    // Ring-out clock: track the broadband level on an audio timeline (runs through capture + idle).
    this.audioElapsed += s.length / this.sampleRate
    // Recent-peak hold for the decay seed (Swift recentPeakLevelDB): latch the max, release to the
    // current level after 2.0 s without a higher peak.
    if (db > this.recentPeakDb || this.audioElapsed - this.recentPeakTime > PEAK_HOLD_SECONDS) {
      this.recentPeakDb = db
      this.recentPeakTime = this.audioElapsed
    }
    this.decay.track(this.audioElapsed, db)
    if (this.decay.decayTime !== this.lastDecay) {
      this.lastDecay = this.decay.decayTime
      this.callbacks.onDecay?.(this.lastDecay)
    }

    // Continuous session recording with the bounded pre-roll (§6): keep every chunk while active,
    // trimming only the pre-first-tap idle. Paused segments are excluded (pause() clears the flag).
    this.maintainSessionRecording(s)

    this.feedContinuous(s)
    this.feedPreroll(s)
    if (this.state === 'capturing') this.feedCapture(s)
    else if (this.state === 'listening') this.detectTap(db, this.audioElapsed)
  }

  /** Play decoded mono samples through the live pipeline (no mic) — the web equivalent of Swift
   *  startFromFile/processFileData. The file defines the analysis sample rate. Guitar: arms a tap
   *  sequence (single- or multi-tap). Material: the ENGINE owns the session — it arms phase L and
   *  AUTO-ADVANCES L→C→(FLC)→done as taps are detected (Swift isPlayingFile), so this same path is
   *  exercised by both the app and the headless regression tests. `pace` (default true) real-time-
   *  paces the chunks; tests pass `pace:false` to run synchronously. Mic chunks are ignored meanwhile. */
  async playFile(
    samples: Float32Array,
    fileSampleRate: number,
    opts?: {
      calibration?: Calibration | null
      material?: { brace: boolean; measureFlc: boolean; calibration?: Calibration | null }
      pace?: boolean
    },
  ): Promise<void> {
    if ((!this.context && !this.headless) || this.playingFile) return
    this.playingFile = true
    // Swap to the file's rate + rate-dependent buffers (Swift prepareForFilePlayback).
    const saved = {
      rate: this.sampleRate,
      preroll: this.preroll,
      prerollSamples: this.prerollSamples,
      material: this.materialCapture,
      cal: this.calibration,
    }
    this.sampleRate = fileSampleRate
    this.prerollSamples = Math.round(fileSampleRate * 0.2)
    this.preroll = new Float32Array(this.prerollSamples)
    this.materialCapture = new Float32Array(Math.round(fileSampleRate * GATED_CAPTURE_DURATION))
    if (opts && 'calibration' in opts) this.setCalibration(opts.calibration ?? null)
    // Fresh tap sequence (mirrors startTapSequence before startFromFile).
    this.accumIdx = 0
    this.prerollIdx = 0
    this.prerollFilled = 0
    this.captureIdx = 0
    this.guitarTapCount = 0
    this.prevAbove = true
    this.consecutive = 0
    if (opts?.material) {
      // Material (3c-C4 Option C): arm phase L; the TapToneAnalyzer auto-advances L→C→FLC as each tap
      // arrives (its recordMaterialTap sees playingFile → arms the next phase via armMaterial). Set the
      // device calibration to the file's material calibration so the analyzer's matSearch (which reads
      // `activeCalibration`) gates every phase with the right corrections; restored after the loop.
      const cal = opts.material.calibration ?? null
      this.setCalibration(cal)
      const lSearch = opts.material.brace ? { ...BRACE_PHASE, calibration: cal } : { ...PLATE_PHASES[0], calibration: cal }
      this.captureKind = 'material'
      this.materialSearch = lSearch
      this.capture = this.materialCapture
      this.setState('listening')
    } else {
      this.captureKind = 'guitar'
      this.capture = this.guitarCapture
      this.startSessionRecording() // continuous session WAV for the played guitar sequence (dump-gated)
      this.setState('listening')
      this.callbacks.onProgress?.(0, this.config.numberOfTaps)
    }

    const pace = opts?.pace ?? true
    const CHUNK = 1024
    const chunkMs = (CHUNK / fileSampleRate) * 1000
    for (let i = 0; i < samples.length && this.playingFile; i += CHUNK) {
      const chunk = samples.subarray(i, Math.min(i + CHUNK, samples.length))
      let sumSq = 0
      for (let k = 0; k < chunk.length; k++) sumSq += chunk[k]! * chunk[k]!
      this.processChunk(chunk, Math.sqrt(sumSq / Math.max(1, chunk.length)))
      if (pace) await new Promise((r) => setTimeout(r, chunkMs))
    }
    // Flush a partial in-flight GUITAR capture so a tap near the end still emits a result.
    // (Material gated capture needs a full window; a partial final phase is dropped.)
    if (this.playingFile && this.captureKind === 'guitar' && this.state === 'capturing' && this.captureIdx > 0) {
      this.capture.fill(0, this.captureIdx)
      this.finishCapture()
    }
    // Restore live state; the mic worklet kept running, so clearing the flag resumes it.
    this.sampleRate = saved.rate
    this.preroll = saved.preroll
    this.prerollSamples = saved.prerollSamples
    this.materialCapture = saved.material
    this.setCalibration(saved.cal)
    this.playingFile = false
  }

  // ── Input clipping (peak ≥ 0.99 or RMS ≥ 0 dBFS; 1.5 s hold) ──────────────
  private detectClipping(s: Float32Array, db: number): void {
    let peakAbs = 0
    for (let i = 0; i < s.length; i++) {
      const a = Math.abs(s[i]!)
      if (a > peakAbs) peakAbs = a
    }
    const now = performance.now() / 1000
    if (peakAbs >= 0.99 || db >= 0) this.lastClipTime = now
    const next = this.lastClipTime !== null && now - this.lastClipTime < CLIP_HOLD_SECONDS
    if (next !== this.clipState) {
      this.clipState = next
      this.callbacks.onClipping?.(next)
    }
  }

  private recordProcessing(ms: number): void {
    this.processingMs = ms
    this.procTimes.push(ms)
    if (this.procTimes.length > 30) this.procTimes.shift()
    this.avgProcessingMs = this.procTimes.reduce((a, b) => a + b, 0) / this.procTimes.length
  }

  // ── Continuous live spectrum (0% overlap) ────────────────────────────────
  private feedContinuous(s: Float32Array): void {
    let i = 0
    while (i < s.length) {
      const n = Math.min(s.length - i, this.accum.length - this.accumIdx)
      this.accum.set(s.subarray(i, i + n), this.accumIdx)
      this.accumIdx += n
      i += n
      if (this.accumIdx >= this.accum.length) {
        const t0 = performance.now()
        const spectrum = this.applyCal(dftAnalRect(this.accum, this.sampleRate, GUITAR_FFT_SIZE))
        this.recordProcessing(performance.now() - t0)
        this.callbacks.onSpectrum?.(spectrum)
        this.callbacks.onMetrics?.({
          processingMs: this.processingMs,
          avgProcessingMs: this.avgProcessingMs,
          frameRate: this.sampleRate / GUITAR_FFT_SIZE,
          displayLevelDB: this.lastLevelDb,
        })
        this.accumIdx = 0
      }
    }
  }

  // ── Pre-roll ring buffer (recent samples before a crossing) ───────────────
  private feedPreroll(s: Float32Array): void {
    for (let i = 0; i < s.length; i++) {
      this.preroll[this.prerollIdx] = s[i]!
      this.prerollIdx = (this.prerollIdx + 1) % this.prerollSamples
      if (this.prerollFilled < this.prerollSamples) this.prerollFilled++
    }
  }

  // ── Tap detection (2-chunk rising-edge level crossing) ────────────────────
  /** Rising-edge tap detector. Mirrors Swift `detectTap(level:audioTime:…)` / Python `detect_tap`.
   *
   *  `audioTime` is THIS chunk's audio-clock value, passed in rather than read from `this.audioElapsed`,
   *  so the warm-up is anchored to the chunk being judged. (On the web the pipeline is synchronous so
   *  the two coincide, but Swift delivers this across a thread hop where they do NOT — reading the clock
   *  at the consumer there silently skipped the warm-up entirely. Same signature everywhere.)
   *
   *  Three things happen here, in the canonical order:
   *    1. noise-floor EMA (material only, and only while NOT latched above — tap energy must not
   *       inflate the floor). Runs during the warm-up too: that is the most valuable time, since no
   *       taps have happened yet.
   *    2. effective thresholds — absolute for guitar, noise-floor-relative for material.
   *    3. warm-up gate, then hysteresis + N-chunk confirmation.
   */
  private detectTap(levelDb: number, audioTime: number): void {
    const useRelative = this.captureKind === 'material'
    const threshold = this.config.tapDetectionThreshold

    // 1. Noise-floor EMA — only while below threshold, so a tap cannot inflate the floor.
    if (useRelative && !this.isAboveThreshold) {
      this.noiseFloorEstimate =
        NOISE_FLOOR_ALPHA * levelDb + (1 - NOISE_FLOOR_ALPHA) * this.noiseFloorEstimate
    }

    // 2. Effective thresholds.
    //    Guitar   — absolute (unchanged behaviour), now WITH a falling threshold it never had.
    //    Material — relative to the tracked floor. Note this reduces to
    //                   rising = max(threshold, noiseFloor + 10)
    //               so it IS the absolute rule until the room gets loud enough to lift the floor.
    let rising: number
    let falling: number
    if (useRelative) {
      const headroom = Math.max(threshold - this.noiseFloorEstimate, NOISE_FLOOR_MIN_HEADROOM_DB)
      rising = this.noiseFloorEstimate + headroom
      falling =
        this.noiseFloorEstimate +
        Math.max(headroom - HYSTERESIS_MARGIN, NOISE_FLOOR_MIN_FALLING_HEADROOM_DB)
    } else {
      rising = threshold
      falling = threshold - HYSTERESIS_MARGIN
    }

    // 3a. Warm-up — SILENT (it never writes a status message; that was OUT-1). Suppresses detection
    //     while the EMA converges, measured on the AUDIO clock against this chunk's timestamp.
    if (this.warmupStartAudioTime !== null && audioTime - this.warmupStartAudioTime < WARMUP_SECONDS) {
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
        const h = Math.max(threshold - this.noiseFloorEstimate, NOISE_FLOOR_MIN_HEADROOM_DB)
        this.isAboveThreshold = levelDb > this.noiseFloorEstimate + h
      } else {
        this.isAboveThreshold = levelDb > rising
      }
      return // sync state only; do not detect on this frame
    }

    // 3c. Hysteresis + confirmation. `isAboveThreshold` latches at `rising` and only clears at the
    //     lower `falling`, so the ring-out decay cannot re-trigger. A tap additionally requires
    //     CONFIRM_CHUNKS consecutive above-rising chunks, which rejects brief noise bumps.
    const above = levelDb > rising
    if (this.isAboveThreshold) {
      if (levelDb <= falling) this.isAboveThreshold = false
    } else if (above) {
      this.isAboveThreshold = true
    }

    if (above) {
      if (this.consecutive > 0) this.consecutive++
      else if (!this.prevAbove) this.consecutive = 1
      if (this.consecutive >= CONFIRM_CHUNKS) {
        this.consecutive = 0
        // Seed the ring-out from the PEAK-HELD level (Swift tapPeakLevel = recentPeakLevelDB), not the
        // instantaneous level: tap confirmation lags the strike by ~2 chunks, so the true peak would
        // otherwise be missed and the −15 dB reference under-stated. Guitar only.
        if (this.captureKind === 'guitar') this.decay.start(this.audioElapsed, this.recentPeakDb)
        this.beginCapture()
      }
    } else {
      this.consecutive = 0
    }
    this.prevAbove = above
  }

  /** Arm the detection warm-up on the AUDIO clock, and reset the noise floor for a fresh sequence.
   *
   *  `skip` backdates the window so it has already elapsed — used for GUITAR file playback only:
   *  an externally recorded guitar file may put the tap inside the first 0.5 s, and guitar detects
   *  against the absolute threshold, so it never reads the noise floor and loses nothing.
   *  MATERIAL always runs the warm-up (live and playback): it is the only mode that uses the floor,
   *  and the warm-up is what establishes it. See Development/OUT-4-DETECTION-SPEC.md.
   */
  private armWarmup(skip: boolean): void {
    this.warmupStartAudioTime = skip ? this.audioElapsed - (WARMUP_SECONDS + 0.1) : this.audioElapsed
    this.justExitedWarmup = false
    this.isAboveThreshold = false
    this.noiseFloorEstimate = NOISE_FLOOR_INITIAL_DB
  }

  private beginCapture(): void {
    // Seed the capture window with the pre-roll (in chronological order).
    const out = this.capture
    out.fill(0)
    const count = this.prerollFilled
    const startRing = (this.prerollIdx - count + this.prerollSamples) % this.prerollSamples
    for (let k = 0; k < count; k++) {
      out[k] = this.preroll[(startRing + k) % this.prerollSamples]!
    }
    this.captureIdx = count
    this.setState('capturing')
  }

  private feedCapture(s: Float32Array): void {
    const n = Math.min(s.length, this.capture.length - this.captureIdx)
    this.capture.set(s.subarray(0, n), this.captureIdx)
    this.captureIdx += n
    if (this.captureIdx >= this.capture.length) this.finishCapture()
  }

  private finishCapture(): void {
    if (this.captureKind === 'material') {
      // Material (3c-C4 Option C): the device computes this tap's gated spectrum (gatedCaptureResult —
      // gated FFT + calibration, unchanged), DISARMS, and hands the raw spectrum up. The TapToneAnalyzer
      // owns the per-tap validity gate, the tap count, the re-arm (armMaterial → back to 'listening'),
      // and the L→C→FLC phase advance — so the device no longer counts, re-arms, or auto-advances.
      // Disarm BEFORE the callback so the analyzer's re-arm (armMaterial, guarded on state!=='capturing')
      // isn't blocked; during file playback the analyzer arms the next phase synchronously from here.
      const { magnitudesDb, frequencies } = gatedCaptureResult(this.capture, this.sampleRate, this.materialSearch!)
      this.captureIdx = 0
      this.setState('idle')
      this.callbacks.onMaterialTap?.({ magnitudesDb, frequencies })
      return
    }

    // Guitar: the device computes each per-tap spectrum (its FFT + calibration, unchanged) and
    // delivers it RAW; the TapToneAnalyzer accumulates the taps and averages them into the frozen
    // result (processMultipleTaps). The device keeps only a lightweight tap counter — it no longer
    // owns averaging (6-TEST 3c-C2a).
    const spectrum = this.applyCal(dftAnalRect(this.capture, this.sampleRate, GUITAR_FFT_SIZE))
    this.captureIdx = 0
    this.guitarTapCount += 1
    this.callbacks.onGuitarTap?.(spectrum)

    const total = this.config.numberOfTaps
    if (this.guitarTapCount < total) {
      // Need more taps — re-arm for the next.
      this.prevAbove = true
      this.consecutive = 0
      this.callbacks.onProgress?.(this.guitarTapCount, total)
      this.setState('listening')
      return
    }

    this.guitarTapCount = 0
    this.callbacks.onProgress?.(total, total)
    this.finishSessionRecording(`Guitar_${total}tap`) // write the continuous session WAV (dump-gated)
    this.setState('idle')
    this.callbacks.onGuitarComplete?.() // sequence done — the analyzer averages the accumulated taps
  }

  async stop(): Promise<void> {
    this.stopBufferWatchdog()
    navigator.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange)
    this.knownDevices = []
    this.removeGestureResume?.()
    this.node?.disconnect()
    this.source?.disconnect()
    this.node = null
    this.source = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    const ctx = this.context
    this.context = null
    this.accumIdx = 0
    this.captureIdx = 0
    this.guitarTapCount = 0
    this.cancelSessionRecording()
    this.lastClipTime = null
    this.clipState = false
    this.setState('idle')
    await ctx?.close()
  }
}
