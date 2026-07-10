// @parity audio/tap-analyzer tests=test/tap-decisions
import { dftAnalRect, GUITAR_FFT_SIZE, type Spectrum } from '../dsp/guitarFFT'
import { applyCalibration, interpolateToBins, type Calibration } from '../dsp/calibration'
import { averageSpectra } from '../dsp/spectrumAverage'
import { DecayTracker } from '../dsp/decay'
import {
  gatedCaptureResult,
  findDominantPeak,
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

/** Lifecycle state of the {@link AudioEngine}. */
export type EngineState = 'idle' | 'listening' | 'capturing' | 'paused'

/** Optional callbacks the caller supplies to observe the engine (spectrum, level, captures, state…). */
export interface AudioEngineCallbacks {
  onSpectrum?: (spectrum: Spectrum) => void
  onLevel?: (db: number) => void
  /** Frozen result. For a multi-tap capture, `taps` holds each tap's individual
   *  spectrum (in order) so the caller can build the multi-tap comparison view. */
  onCapture?: (spectrum: Spectrum, taps?: Spectrum[]) => void
  onState?: (state: EngineState) => void
  /** Multi-tap progress: taps collected so far / total requested. */
  onProgress?: (collected: number, total: number) => void
  /** Edge-triggered input clipping (peak ≥ 0.99 or RMS ≥ 0 dBFS, 1.5 s hold). */
  onClipping?: (clipping: boolean) => void
  /** A gated material tap was captured (one phase of a plate/brace measurement). */
  onMaterialCapture?: (result: MaterialCaptureResult) => void
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
}

/** Tunable engine settings the caller can change while running (threshold, tap count, diagnostics). */
export interface AudioEngineConfig {
  /** Level-crossing threshold for tap onset (dBFS). */
  tapDetectionThreshold: number
  /** Number of taps to average (1–10). */
  numberOfTaps: number
  /** "Dump Capture Audio" diagnostic on — gates continuous session recording (no buffer cost when off). */
  dumpCaptureAudio: boolean
}

const DEFAULT_CONFIG: AudioEngineConfig = {
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
export class AudioEngine {
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private readonly callbacks: AudioEngineCallbacks
  private config: AudioEngineConfig

  sampleRate = 48000
  state: EngineState = 'idle'
  /** True while a file is playing through the pipeline (mic chunks are ignored meanwhile). */
  playingFile = false
  /** Test seam: when true, the pure pipeline (playFile/arm/capture) runs without a browser
   *  AudioContext (no mic). The web equivalent of Swift TapToneAnalyzer.forTesting(). */
  private headless = false
  /** Active material file-playback session: the engine auto-advances these phases (L→C→FLC),
   *  mirroring Swift's isPlayingFile auto-advance. null during live capture (App drives phases). */
  private materialSession: { phases: { name: MaterialPhaseName; search: MaterialSearch }[]; idx: number } | null = null
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

  // Continuous session recording (Swift sessionRecordingBuffer) — every pipeline chunk while
  // `sessionRecording`, accumulated as chunk slices. `sessionActive` survives pause/resume (which
  // toggle `sessionRecording`); `sessionCheckpoints` hold the chunk-count at each phase start so a
  // redone material phase can be truncated away. Only runs when the dump-capture setting is on.
  private sessionChunks: Float32Array[] = []
  private sessionCheckpoints: number[] = []
  private sessionRecording = false
  private sessionActive = false
  private sessionRate = 48000

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
  // Gated spectra collected for the CURRENT material phase — averaged when numberOfTaps is reached,
  // exactly as guitar averages `collected` (Swift materialCapturedTaps + handleLongitudinalGatedProgress).
  private materialCollected: Spectrum[] = []

  // Multi-tap accumulation.
  private collected: Spectrum[] = []

  // Clipping detection.
  private lastClipTime: number | null = null
  private clipState = false

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

  constructor(callbacks: AudioEngineCallbacks = {}, config?: Partial<AudioEngineConfig>) {
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

  setConfig(config: Partial<AudioEngineConfig>): void {
    const prevTaps = this.config.numberOfTaps
    this.config = { ...this.config, ...config }
    // A tap-count change while armed and waiting must immediately refresh the progress display so
    // the status prompt ("Tap the guitar N times…") tracks the new count without needing a re-arm
    // (New Tap is disabled until complete). Mirrors Swift numberOfTaps.didSet updating the prompt.
    // Skipped mid-capture and when idle: the stepper is locked once a tap is captured, and on load
    // the result is frozen (setConfig(loadedTaps) runs while idle).
    if (this.config.numberOfTaps !== prevTaps && (this.state === 'listening' || this.state === 'paused')) {
      const collected = this.captureKind === 'material' ? this.materialCollected.length : this.collected.length
      this.callbacks.onProgress?.(collected, this.config.numberOfTaps)
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
    this.collected = []
    this.prevAbove = true
    this.consecutive = 0
    this.decay.reset() // New Tap → drop any prior ring-out (the next tap re-seeds it)
    this.lastDecay = null
    this.callbacks.onDecay?.(null)
    this.callbacks.onProgress?.(0, this.config.numberOfTaps)
    this.startSessionRecording() // begin the continuous session WAV for this guitar sequence (dump-gated)
    this.setState('listening')
  }

  /** Arm a gated material phase (a fresh L/C/FLC phase, or a redo of one) with its search range. */
  armMaterial(search: MaterialSearch): void {
    if (!this.running || this.state === 'capturing') return
    this.captureKind = 'material'
    this.materialSearch = search
    this.capture = this.materialCapture
    this.materialCollected = [] // a new (or redone) phase starts averaging from zero
    this.prevAbove = true
    this.consecutive = 0
    this.callbacks.onProgress?.(0, this.config.numberOfTaps) // per-phase tap progress starts at 0
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
    if (this.sessionActive) this.sessionRecording = true // resume accumulating into the session WAV
    this.setState('listening')
  }

  /** Abort the current sequence (guitar multi-tap or material), discarding any partial
   *  captures, and return to idle so New Tap re-arms. Mirrors Swift `cancelTapSequence()`. */
  cancel(): void {
    this.collected = []
    this.materialCollected = []
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
    this.sessionChunks = []
    this.sessionCheckpoints = [0] // first-phase truncation anchor (Swift/Python seed [0] at start)
    this.sessionRate = this.sampleRate
    this.sessionActive = true
    this.sessionRecording = true
  }

  /** Mark a phase boundary so a later redo can truncate the rejected phase's audio (Swift sessionCheckpoints). */
  checkpointSession(): void {
    if (this.sessionActive) this.sessionCheckpoints.push(this.sessionChunks.length)
  }

  /** Redo the current phase: drop everything recorded since the last checkpoint (Swift redo truncation). */
  redoSession(): void {
    if (!this.sessionActive) return
    const cp = this.sessionCheckpoints[this.sessionCheckpoints.length - 1] ?? 0
    if (cp < this.sessionChunks.length) this.sessionChunks.length = cp
  }

  /** Finish the session: emit the accumulated audio (if any) as one WAV via onSessionAudio, then clear. */
  finishSessionRecording(label: string): void {
    this.sessionRecording = false
    this.sessionActive = false
    const chunks = this.sessionChunks
    const rate = this.sessionRate
    this.sessionChunks = []
    this.sessionCheckpoints = []
    const total = chunks.reduce((n, c) => n + c.length, 0)
    if (total === 0) return
    const out = new Float32Array(total)
    let o = 0
    for (const c of chunks) {
      out.set(c, o)
      o += c.length
    }
    this.callbacks.onSessionAudio?.(out, rate, label)
  }

  /** Abandon the session without writing (cancel / measurement-type change / New Tap of a fresh kind). */
  cancelSessionRecording(): void {
    this.sessionRecording = false
    this.sessionActive = false
    this.sessionChunks = []
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

    // Continuous session recording: keep every chunk that flows through the pipeline while active
    // (Swift sessionRecordingBuffer.append). Paused segments are excluded (pause() clears the flag).
    if (this.sessionRecording) this.sessionChunks.push(s.slice())

    this.feedContinuous(s)
    this.feedPreroll(s)
    if (this.state === 'capturing') this.feedCapture(s)
    else if (this.state === 'listening') this.detectTap(db)
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
    this.collected = []
    this.prevAbove = true
    this.consecutive = 0
    this.materialSession = null
    if (opts?.material) {
      // Material: build the phase plan (L, C, [FLC] for plate; L for brace) and arm phase L.
      // finishCapture auto-advances through the plan as each tap is captured.
      const cal = opts.material.calibration ?? null
      const plate = [
        { name: 'longitudinal' as const, search: { ...PLATE_PHASES[0], calibration: cal } },
        { name: 'cross' as const, search: { ...PLATE_PHASES[1], calibration: cal } },
        ...(opts.material.measureFlc
          ? [{ name: 'flc' as const, search: { ...PLATE_PHASES[2], calibration: cal } }]
          : []),
      ]
      const phases = opts.material.brace
        ? [{ name: 'longitudinal' as const, search: { ...BRACE_PHASE, calibration: cal } }]
        : plate
      this.materialSession = { phases, idx: 0 }
      this.captureKind = 'material'
      this.materialSearch = phases[0]!.search
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
    this.materialSession = null
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
  private detectTap(levelDb: number): void {
    const above = levelDb > this.config.tapDetectionThreshold
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
      const search = this.materialSearch!
      // Each material phase averages `numberOfTaps` taps, exactly like guitar (Swift
      // handleLongitudinalGatedProgress: collect materialCapturedTaps, then averageSpectra).
      const { magnitudesDb, frequencies } = gatedCaptureResult(this.capture, this.sampleRate, search)
      this.materialCollected.push({ magnitudesDb, frequencies })
      this.captureIdx = 0

      const total = this.config.numberOfTaps
      if (this.materialCollected.length < total) {
        // Need more taps for THIS phase — re-arm the same phase (Swift reEnableDetectionForNextPlateTap).
        this.prevAbove = true
        this.consecutive = 0
        this.callbacks.onProgress?.(this.materialCollected.length, total)
        this.setState('listening')
        return
      }

      // Phase complete: average the phase's taps and find the dominant peak ON THE AVERAGED spectrum
      // (within the phase's search range) — the whole point of averaging is to read the peak off the
      // averaged waveform, exactly as guitar multi-tap does (Swift processMultipleTaps findPeaks on the
      // average). NB: Swift/Python material historically used the LAST tap's peak (a UUID-hack
      // side-effect in buildAllPeaks) — that was a latent bug; all three now use the averaged peak.
      const averaged = averageSpectra(this.materialCollected)
      const peak = findDominantPeak(
        averaged.magnitudesDb,
        averaged.frequencies,
        search.minHz,
        search.maxHz,
        search.preferLowestSignificant,
      )
      this.materialCollected = []
      this.callbacks.onProgress?.(total, total)
      this.setState('idle')
      const sess = this.materialSession
      this.callbacks.onMaterialCapture?.({
        spectrum: averaged,
        peak,
        phase: sess ? sess.phases[sess.idx]?.name : undefined,
      })
      // File-playback material session: auto-advance to the next phase (Swift isPlayingFile),
      // re-arming so the next tap is captured. arm/prevAbove reset requires a falling edge first
      // (Swift isAboveThreshold=true) so the prior tap's ring-out can't fire a bogus onset.
      if (sess) {
        sess.idx += 1
        const next = sess.phases[sess.idx]
        if (next) {
          this.materialSearch = next.search
          this.capture = this.materialCapture
          this.prevAbove = true
          this.consecutive = 0
          this.setState('listening')
        } else {
          this.materialSession = null
        }
      }
      return
    }

    const spectrum = this.applyCal(dftAnalRect(this.capture, this.sampleRate, GUITAR_FFT_SIZE))
    this.captureIdx = 0
    this.collected.push(spectrum)

    const total = this.config.numberOfTaps
    if (this.collected.length < total) {
      // Need more taps — re-arm for the next without clearing the accumulation.
      this.prevAbove = true
      this.consecutive = 0
      this.callbacks.onProgress?.(this.collected.length, total)
      this.setState('listening')
      return
    }

    const result = averageSpectra(this.collected)
    // Retain each tap's spectrum for the multi-tap comparison view (>1 tap only).
    const taps = total > 1 ? this.collected : undefined
    this.collected = []
    this.callbacks.onProgress?.(total, total)
    this.finishSessionRecording(`Guitar_${total}tap`) // write the continuous session WAV (dump-gated)
    this.setState('idle')
    this.callbacks.onCapture?.(result, taps)
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
    this.collected = []
    this.cancelSessionRecording()
    this.lastClipTime = null
    this.clipState = false
    this.setState('idle')
    await ctx?.close()
  }
}
