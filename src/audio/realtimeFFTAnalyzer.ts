// @parity audio/realtime-analyzer
import { BUFFER_DELIVERY_TIMEOUT_MS, DEAD_INPUT_DWELL_MS, chunkCarriesSignal, watchdogDecision } from './deadInput'
import { dftAnalRect, GUITAR_FFT_SIZE, spectrumPeak, type Spectrum } from '../dsp/guitarFFT'
import { applyCalibration, interpolateToBins, type Calibration } from '../dsp/calibration'
import { DecayTracker } from '../dsp/decay'
import { gatedHannFFT, type GatedFFTResult } from '../dsp/gatedFFT'
import {
  alignCaptureToOnset,
  PLATE_PHASES,
  BRACE_PHASE,
  type DetectedMaterialPeak,
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
}
/** One captured material phase: its gated spectrum, the located peak, and which phase it is. */
export interface MaterialCaptureResult {
  spectrum: Spectrum
  peak: DetectedMaterialPeak | null
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
  /** Every pipeline chunk, with its level and audio-clock value. The TapToneAnalyzer owns the
   *  pre-roll, the detector and the capture window (Swift's split), so this is the whole seam
   *  between the device and the model (#17 F30). */
  onAudioFrame?: (samples: Float32Array, levelDb: number, audioTime: number) => void
  /** Edge-triggered input clipping (peak ≥ 0.99 or RMS ≥ 0 dBFS, 1.5 s hold). */
  onClipping?: (clipping: boolean) => void
  /** Continuous session recording for the "Dump Capture Audio" diagnostic — fired ONCE at the end of a
   *  measurement with every chunk that flowed through the pipeline while recording (minus paused
   *  segments and redone phases), so replaying it reproduces the session. `label` identifies the
   *  measurement ("Guitar_8tap" / "Plate_LC" / "Plate_LCF" / "Brace"). Mirrors Swift finishSessionRecording. */
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
   *  same cadence as the spectrum + Peak, mirroring Swift `displayLevelDB` (readoutLevelDB gated by the
   *  graph publish rate), NOT the fast per-chunk `onLevel` (which drives the responsive threshold meter).
   *  True digital silence is -Infinity here; every other consumer of the level gets Swift's -100. */
  displayLevelDB: number
  /** The live spectrum's loudest bin — Swift `peakFrequency` / `peakMagnitude`, owned by the FFT
   *  analyzer and computed on the same frame. A silent input is -Infinity dB @ 0 Hz. */
  peakFrequency: number
  peakMagnitude: number
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
  /** True while a file is playing through the pipeline (mic chunks are ignored meanwhile). */
  playingFile = false
  /** Test seam: when true, the pure pipeline (playFile/arm/capture) runs without a browser
   *  AudioContext (no mic). The web equivalent of Swift TapToneAnalyzer.forTesting(). */
  private headless = false
  /** Applied mic-track settings (AGC/EC/NS etc.) — for diagnosing capture gain. */
  audioSettings: MediaTrackSettings | null = null
  /** Label of the active input device (track.label), for the Settings panel. */
  deviceLabel = ''
  /** Called at the end of file playback, before live audio resumes — the analyzer flushes its gated
   *  capture here. Swift `preMicRestartHandler`. */
  preMicRestartHandler: (() => void) | null = null

  /** deviceId of the active input (for the device picker + per-device calibration mapping). */
  inputDeviceId: string | null = null
  /** Last-enumerated input deviceIds — baseline for detecting attach (new id) vs detach (id gone). */
  private knownDevices: string[] = []

  // Active mic calibration, applied to the continuous and guitar-capture spectra and, inside
  // computeGatedFFT, to the material gated spectrum at the moment it is computed. guitarCorr caches
  // the per-bin corrections for the fixed guitar FFT bins; null = recompute on next use.
  private calibration: Calibration | null = null
  private guitarCorr: number[] | null = null

  // Continuous live spectrum (0% overlap).
  private readonly accum = new Float32Array(GUITAR_FFT_SIZE)
  private accumIdx = 0

  // Ring-out (decay) tracking — guitar only; fed the broadband level per chunk on an audio clock.
  private decay = new DecayTracker()

  // ── Services the TapToneAnalyzer calls while IT owns detection + gated capture ─────────────
  // Swift's split: the analyzer holds the pre-roll, the capture window and the detector, and calls
  // RealtimeFFTAnalyzer for the raw transform and the calibration corrections — applying them
  // itself. The FFT primitive stays here in both editions; only the work around it is the
  // analyzer's (#17 F30).

  /** This chunk's audio-clock value — the detector's warm-up anchor (Swift `fftAnalyzer.audioElapsed`). */
  get audioTime(): number {
    return this.audioElapsed
  }

  /** Peak-held input level, the ring-out decay seed (Swift `recentPeakLevelDB`). */
  get recentPeakLevelDb(): number {
    return this.recentPeakDb
  }

  /** Per-bin calibration corrections for the current input, or null. The analyzer APPLIES these,
   *  mirroring Swift reading `fftAnalyzer.calibrationCorrections` in finishGuitarGatedCapture. */
  get calibrationCorrections(): number[] | null {
    return this.guitarCorr
  }

  /** The analysis window size, so the analyzer can align and pad to it (Swift `fftAnalyzer.fftSize`). */
  get fftSize(): number {
    return GUITAR_FFT_SIZE
  }




  /** Seed the ring-out decay from the peak-held level (guitar only; Swift `decay.start`). */
  startDecayFromPeak(): void {
    this.decay.start(this.audioElapsed, this.recentPeakDb)
  }
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
  // Bounded pre-roll for the session WAV (FILE-PATHS-AND-NAMES-SPEC §6). True from
  // startSessionRecording until the first capture begins, then false for the rest of the session:
  // while true, only the last SESSION_PRE_ROLL_SECONDS of audio is kept; after the first tap the
  // buffer grows straight through. Mirrors Swift sessionPreRollActive.

  /** Latest measured ring-out time (s), read into the measurement at save (Swift currentDecayTime). */
  get decayTime(): number | null {
    return this.decay.decayTime
  }

  // Guitar tap counter. The device no longer accumulates per-tap spectra (6-TEST 3c-C2a — the
  // TapToneAnalyzer owns accumulation + averaging); it keeps only this lightweight count to know
  // when the sequence is done (re-arm vs complete) and to label the session WAV.
  private guitarTapCount = 0

  // Clipping detection.
  private lastClipTime: number | null = null
  private clipState = false
  // Latest per-chunk input level (dBFS), sampled into the FFT-frame metrics as displayLevelDB.
  private readoutLevelDb = -100

  // Buffer-delivery watchdog (mirrors Swift RealtimeFFTAnalyzer+Watchdog / Python).
  // Recovers from a silently-starved mic stream: the worklet stops posting chunks with
  // no error (the active track ends/mutes, the OS reconfigures the device, another app
  // takes it). A timer detects the silence and re-acquires the stream with bounded backoff.
  private lastChunkTime = 0
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private engineStartTime = 0
  private isRecovering = false
  private recoveryAttempts = 0
  // Thresholds are owned by deadInput.ts so the rule and its constants are testable.
  private readonly watchdogSilenceMs = BUFFER_DELIVERY_TIMEOUT_MS
  private readonly watchdogMaxAttempts = 6
  private readonly watchdogBackoffsMs = [500, 1000, 2000, 4000]

  // Dead-input watchdog (mirrors Swift RealtimeFFTAnalyzer+Watchdog / Python).
  // A second, distinct failure mode: chunks keep arriving on schedule but carry NO
  // SIGNAL. Delivery looks healthy — `lastChunkTime` is stamped by every chunk
  // regardless of content — so the delivery watchdog above is blind to it, the
  // spectrum keeps updating, and every reading is silence. This is MORE likely in
  // the browser than natively: a MediaStreamTrack that goes `muted` (device removed
  // or switched by the OS, permission revoked, another app taking an exclusive
  // device, sleep/wake) keeps the graph running and simply feeds zeros forever.
  //
  // The discriminator is "impossibly quiet", never merely "quiet": any real
  // microphone clears this floor on its own self-noise, so a silent room can never
  // trigger a re-acquire.
  private lastSignalTime = 0
  private readonly watchdogDeadInputMs = DEAD_INPUT_DWELL_MS
  /** True once recovery has exhausted its attempts. Re-acquire attempts stop, but the
   *  watchdog keeps WATCHING, so the app heals itself the moment audio returns instead
   *  of staying deaf until the page is reloaded. Mirrors Swift/Python. */
  private watchdogRecoveryExhausted = false
  /** True while the input delivers chunks carrying no signal. Surfaced to the user
   *  rather than only auto-healed: a device-level failure cannot be fixed by
   *  re-acquiring the stream, so recovery exhausts its attempts and stops. */
  inputAppearsDead = false

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
  }

  /** Set (or clear) the active mic calibration. Adds interpolated per-bin dB corrections to every
   *  spectrum before it leaves the engine — continuous, guitar capture, and the gated material
   *  transform (`computeGatedFFT`) — mirroring Swift's vDSP_vadd. */
  setCalibration(cal: Calibration | null): void {
    this.calibration = cal
    this.guitarCorr = null
  }

  /** The active mic calibration (Swift `activeCalibration`), read for a saved measurement's provenance. */
  get activeCalibration(): Calibration | null {
    return this.calibration
  }

  /** The gated transform every plate/brace capture runs, calibrated: `gatedHannFFT` plus the active
   *  calibration at the bin frequencies, read at the moment of the call. Mirrors Swift
   *  `computeGatedFFT(samples:sampleRate:)` and Python `compute_gated_fft`, which apply the
   *  calibration inside the transform. The web used to leave it to the caller, which took a copy of
   *  the calibration when the phase was armed (#17 F49). */
  computeGatedFFT(samples: Float32Array | Float64Array | number[], sampleRate: number): GatedFFTResult {
    return this.applyCal(gatedHannFFT(samples, sampleRate))
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










  /** Seconds of audio retained before the first tap (>= the 0.5 s warm-up, with margin). */





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
    // The pre-roll ring and capture windows are the analyzer's, sized from this rate when it sees
    // the first frame (#17 F30).
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
    this.lastSignalTime = performance.now() // measure the no-signal window from the start
    this.watchdogRecoveryExhausted = false  // a deliberate (re)start gets full attempts again
    this.watchdogTimer = setInterval(() => this.checkBufferWatchdog(), 1000)
  }

  /** Edge-triggered dead-input state change, forwarded to the UI. */
  private setInputAppearsDead(dead: boolean): void {
    if (this.inputAppearsDead === dead) return
    this.inputAppearsDead = dead
    this.onInputAppearsDeadChange?.(dead)
  }

  /** Set by the owner to surface "no audio input" in the status line. */
  onInputAppearsDeadChange: ((dead: boolean) => void) | null = null

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
    const now = performance.now()

    // The rule itself lives in deadInput.ts as a pure function, so the whole truth
    // table is unit-testable without an AudioContext. This tick only carries out the
    // decision.
    switch (
      watchdogDecision(
        now,
        this.lastChunkTime,
        this.lastSignalTime,
        this.watchdogRecoveryExhausted,
        this.watchdogSilenceMs,
        this.watchdogDeadInputMs,
      )
    ) {
      case 'starved':
        console.warn(`[engine] buffer watchdog: no audio for ${Math.round(now - this.lastChunkTime)}ms — re-acquiring input`)
        this.isRecovering = true
        void this.attemptWatchdogRecovery()
        return

      case 'deadInput':
        console.warn(`[engine] dead-input watchdog: chunks arriving but no signal for ${Math.round(now - this.lastSignalTime)}ms — re-acquiring input`)
        this.setInputAppearsDead(true)
        this.isRecovering = true
        void this.attemptWatchdogRecovery()
        return

      case 'deadInputExhausted':
        // Out of attempts: keep the warning up and keep watching, so the app heals
        // itself the moment audio returns instead of staying deaf until a reload.
        this.setInputAppearsDead(true)
        return

      case 'healthy':
        // Signal is flowing again. Clear the warning, the recovery streak and the
        // exhausted latch, so a later failure gets a full set of attempts.
        this.setInputAppearsDead(false)
        if (this.watchdogRecoveryExhausted) {
          console.warn('[engine] audio input returned — dead-input warning cleared, recovery re-armed')
          this.watchdogRecoveryExhausted = false
        }
        if (this.recoveryAttempts !== 0) this.recoveryAttempts = 0
        return
    }
  }

  private async attemptWatchdogRecovery(): Promise<void> {
    this.recoveryAttempts += 1
    if (this.recoveryAttempts > this.watchdogMaxAttempts) {
      // Stop RE-ACQUIRING, but keep WATCHING. Stopping the timer here left the app
      // permanently deaf: nothing remained to notice the input coming back, so a user
      // who fixed the microphone — reconnected it, un-muted it, raised an input level —
      // saw no change until they reloaded. The tick is cheap; it now keeps evaluating
      // and clears the warning as soon as signal returns.
      console.error(`[engine] buffer watchdog: gave up on re-acquiring after ${this.watchdogMaxAttempts} attempts — still watching; will clear as soon as audio returns`)
      this.isRecovering = false
      this.watchdogRecoveryExhausted = true
      return
    }
    const backoff = this.watchdogBackoffsMs[Math.min(this.recoveryAttempts - 1, this.watchdogBackoffsMs.length - 1)]!
    await new Promise((r) => setTimeout(r, backoff))
    try {
      // Re-acquire the current input (exact device, else default) and reconnect the
      // source to the existing worklet node — the context/worklet survive.
      await this.applyStream(await this.acquireStream(this.inputDeviceId), this.inputDeviceId)
      this.lastChunkTime = performance.now() // give the fresh stream a grace window
      // NOT lastSignalTime: it means "signal was last OBSERVED", and re-acquiring a stream observes
      // nothing. Stamping it here made the next tick read 'healthy', which cleared the warning and
      // reset the attempt streak — so 'deadInputExhausted' was unreachable and the input was
      // re-acquired every 15 s forever, strobing the warning. Found on a BlackHole 2ch virtual
      // input during the #17 run-review; any permanently silent input does it. Only a chunk that
      // carries signal moves this stamp (see the onAudioFrame path). Mirrors Swift
      // start(isWatchdogRecovery:) and Python start_buffer_watchdog(is_watchdog_recovery=True).
      this.engineStartTime = performance.now()
      console.warn('[engine] buffer watchdog: input re-acquired')
      this.isRecovering = false
    } catch (e) {
      console.warn('[engine] buffer watchdog: re-acquire failed, retrying', e)
      void this.attemptWatchdogRecovery() // bounded retry
    }
  }

  private onChunk(data: ChunkMessage): void {
    const now = performance.now()
    this.lastChunkTime = now // watchdog liveness stamp (the mic worklet is alive)
    // Dead-input stamp: reuses the rms the worklet already computed, so this costs
    // nothing. A dead track feeds exact zeros, giving rms 0.
    if (chunkCarriesSignal(data.rms)) this.lastSignalTime = now
    // While a file plays, the mic's samples are ignored — but each chunk is still a tick of the AUDIO
    // clock, and that is what paces the file (#19).
    if (this.playingFile) {
      this.renderedSeconds += data.samples.length / (this.context?.sampleRate ?? this.sampleRate)
      this.wakePlaybackPacer()
      return
    }
    this.processChunk(data.samples, data.rms)
  }

  /** Wire a fresh input track's loss signals. `ended` (device truly gone) forces the watchdog
   *  to recover on its next tick. `mute` means the track is still live but now produces
   *  SILENCE — the browser keeps delivering zero-filled chunks, so the delivery watchdog
   *  never fires; it is the dead-input watchdog that must catch it. A brief mute is normal
   *  (device switches, glitches), so rather than re-acquiring immediately this back-dates
   *  the signal clock: a mute that self-resolves within the window costs nothing, and one
   *  that persists trips the dead-input threshold on the next tick. */
  private watchTrack(track: MediaStreamTrack): void {
    track.onended = () => {
      this.lastChunkTime = 0 // force "starved" so the next watchdog tick re-acquires
    }
    track.onmute = () => {
      console.warn('[engine] input track muted — silence until it unmutes; dead-input watchdog is armed')
      // Leave most of the window intact so a transient mute self-resolves.
      this.lastSignalTime = Math.min(this.lastSignalTime, performance.now() - this.watchdogDeadInputMs / 2)
    }
    track.onunmute = () => {
      console.warn('[engine] input track unmuted')
      this.lastSignalTime = performance.now()
    }
  }

  // The shared per-chunk core, fed by BOTH the live mic (onChunk) and file playback (playFile),
  // so a played file runs the exact same level-crossing + FFT + capture path as the mic.
  private processChunk(s: Float32Array, rms: number): void {
    // Silence is -100, exactly as Swift (`rms > 0 ? 20*log10(rms) : -100`). This was
    // `max(rms, 1e-10)`, i.e. -200 — copied from Python, not Swift — so detection saw a different
    // level on true digital silence than Swift's did.
    const db = rms > 0 ? 20 * Math.log10(rms) : -100
    // The READOUT's level — Swift readoutLevelDB: the same value, except true silence is -Infinity,
    // because -100 dB is a real level a quiet UMIK-1 reaches. Sampled into the FFT-frame metrics
    // (displayLevelDB) at the graph rate. Detection, the meter and decay keep `db`.
    this.readoutLevelDb = rms > 0 ? db : -Infinity
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

    this.feedContinuous(s)
    // Detection and gated capture belong to the TapToneAnalyzer, as they do in Swift — this layer is
    // the microphone, the FFT and the watchdogs. Hand the chunk up (#17 F30).
    this.callbacks.onAudioFrame?.(s, db, this.audioElapsed)
  }

  // @parity util/timing-activity
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
    const saved = { rate: this.sampleRate, cal: this.calibration }
    this.sampleRate = fileSampleRate
    if (opts && 'calibration' in opts) this.setCalibration(opts.calibration ?? null)
    this.accumIdx = 0
    // Material: set the device calibration to the file's, so every phase's gated transform
    // (`computeGatedFFT`, which reads it at the moment of the call) applies the right corrections.
    // Restored after the loop. The PHASE MACHINE is the analyzer's: the caller arms before playback and recordMaterialTap
    // auto-advances L→C→FLC, exactly as Swift's analyzer does (#17 F30).
    if (opts?.material) this.setCalibration(opts.material.calibration ?? null)

    const pace = opts?.pace ?? true
    const CHUNK = 1024
    const chunkMs = (CHUNK / fileSampleRate) * 1000
    // Pace from the AUDIO clock when there is one: feed the next chunk once the audio device has
    // rendered as much audio as the file has played. A browser throttles a hidden tab's timers — Chrome
    // to about one a minute after 5 minutes — but keeps rendering audio, so this pacing stays at real
    // time where `setTimeout` pacing slowed to a crawl (#19). This is the web's counterpart to the
    // natives' timing activity (Swift holdTimingActivity). Headless (tests, no AudioContext) paces with
    // `setTimeout` as before.
    const audioClock = !this.headless && this.context !== null
    const renderedAtStart = this.renderedSeconds
    for (let i = 0; i < samples.length && this.playingFile; i += CHUNK) {
      const chunk = samples.subarray(i, Math.min(i + CHUNK, samples.length))
      let sumSq = 0
      for (let k = 0; k < chunk.length; k++) sumSq += chunk[k]! * chunk[k]!
      this.processChunk(chunk, Math.sqrt(sumSq / Math.max(1, chunk.length)))
      if (!pace) continue
      if (audioClock) await this.untilRendered(renderedAtStart + (i + chunk.length) / fileSampleRate)
      else await new Promise((r) => setTimeout(r, chunkMs))
    }
    // File end: let the analyzer finish a capture the file stopped filling, before live audio could
    // reach it (Swift preMicRestartHandler → flushGatedCaptureOnFileEnd).
    if (this.playingFile) this.preMicRestartHandler?.()
    // Restore live state; the mic worklet kept running, so clearing the flag resumes it.
    this.sampleRate = saved.rate
    this.setCalibration(saved.cal)
    this.playingFile = false
  }

  /** Seconds of audio the device has rendered while files played — the file pacer's clock. */
  private renderedSeconds = 0
  private playbackPacerWaiters: { until: number; resolve: () => void }[] = []

  /** Resolve once the device has rendered up to `until` seconds of audio. If no audio arrives at all
   *  for a while (the input stopped), it gives up waiting after 250 ms so playback cannot hang — pacing
   *  is then as slow as the timer allows, which changes speed, not results. */
  private untilRendered(until: number): Promise<void> {
    if (this.renderedSeconds >= until) return Promise.resolve()
    return new Promise((resolve) => {
      const waiter = { until, resolve }
      this.playbackPacerWaiters.push(waiter)
      setTimeout(() => {
        const k = this.playbackPacerWaiters.indexOf(waiter)
        if (k >= 0) {
          this.playbackPacerWaiters.splice(k, 1)
          resolve()
        }
      }, 250)
    })
  }

  private wakePlaybackPacer(): void {
    const ready = this.playbackPacerWaiters.filter((w) => this.renderedSeconds >= w.until)
    this.playbackPacerWaiters = this.playbackPacerWaiters.filter((w) => this.renderedSeconds < w.until)
    for (const w of ready) w.resolve()
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
        const peak = spectrumPeak(spectrum)
        this.callbacks.onMetrics?.({
          processingMs: this.processingMs,
          avgProcessingMs: this.avgProcessingMs,
          frameRate: this.sampleRate / GUITAR_FFT_SIZE,
          displayLevelDB: this.readoutLevelDb,
          peakFrequency: peak?.frequency ?? 0,
          peakMagnitude: peak?.magnitude ?? -100,
        })
        this.accumIdx = 0
      }
    }
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
    this.lastClipTime = null
    this.clipState = false
    await ctx?.close()
  }
}
