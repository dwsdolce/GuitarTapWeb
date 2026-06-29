import { dftAnalRect, GUITAR_FFT_SIZE, type Spectrum } from '../dsp/guitarFFT'
import { applyCalibration, interpolateToBins, type Calibration } from '../dsp/calibration'
import { averageSpectra } from '../dsp/spectrumAverage'
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

export interface MaterialSearch {
  minHz: number
  maxHz: number
  preferLowestSignificant: boolean
  /** Active mic calibration applied to the gated spectrum before peak-finding (see gatedCapture). */
  calibration?: Calibration | null
}
export interface MaterialCaptureResult {
  spectrum: Spectrum
  peak: MaterialPeak | null
  /** Which phase this capture is for. Set by the engine during a file-playback material session
   *  (auto-advance); undefined during live capture, where the App derives it from its phase state. */
  phase?: MaterialPhaseName
}

// Live audio engine. The mic feeds an AudioWorklet that posts 1024-sample chunks
// (+ RMS) to the main thread, where the tested src/dsp core runs:
//   • continuous live spectrum (accumulate 65536 → dftAnalRect; 0% overlap),
//   • tap detection (2-chunk level-crossing), always-on once started (matching
//     GuitarTap) → 65536 capture → the captured spectrum is emitted and the view
//     freezes. New Tap simply re-arms a frozen result. Peak-finding/classification
//     happen in the UI so Peak Min / guitar type re-analyze the frozen spectrum live.
// Sample rate is read from the live AudioContext (PLAN.md risk #1).

export type EngineState = 'idle' | 'listening' | 'capturing' | 'paused'

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
  /** Raw captured buffer for the "Dump Capture Audio" diagnostic — fired per guitar tap and
   *  per material phase with the exact samples that were analyzed. `kind` is the capture kind;
   *  the caller adds context (phase/tap) + decides whether to write the WAV (setting-gated). */
  onCaptureAudio?: (samples: Float32Array, sampleRate: number, kind: 'guitar' | 'material') => void
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

export interface AudioEngineConfig {
  /** Level-crossing threshold for tap onset (dBFS). */
  tapDetectionThreshold: number
  /** Number of taps to average (1–10). */
  numberOfTaps: number
}

const DEFAULT_CONFIG: AudioEngineConfig = {
  tapDetectionThreshold: -40,
  numberOfTaps: 1,
}

const CLIP_HOLD_SECONDS = 1.5
// Decay-seed peak hold (Swift `peakHoldDuration`): how long recentPeakDb latches its max before
// releasing to the current level. Canonical value is Swift's CODE (2.0 s); the Swift "0.5 s" comment
// was stale (never updated after the value changed during testing).
const PEAK_HOLD_SECONDS = 2.0

const CONFIRM_CHUNKS = 2

// The rate the whole pipeline + oracle are defined at (Swift/Python run at 48 kHz).
// We do NOT force it — the OS/Audio MIDI Setup defines the actual capture rate and we
// let it flow through — but we WARN if the live AudioContext rate differs, since the
// DSP results only match the canonical apps at 48 kHz.
export const EXPECTED_SAMPLE_RATE = 48000

interface ChunkMessage {
  samples: Float32Array
  rms: number
}

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

  // Multi-tap accumulation.
  private collected: Spectrum[] = []

  // Clipping detection.
  private lastClipTime: number | null = null
  private clipState = false

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
    this.config = { ...this.config, ...config }
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
    this.setState('listening')
  }

  /** Arm one gated material capture (a single plate/brace phase) with a search range. */
  armMaterial(search: MaterialSearch): void {
    if (!this.running || this.state === 'capturing') return
    this.captureKind = 'material'
    this.materialSearch = search
    this.capture = this.materialCapture
    this.prevAbove = true
    this.consecutive = 0
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
    if (this.state === 'listening') this.setState('paused')
  }

  /** Resume after a pause, continuing the sequence from the current tap count. Resets the
   *  level-crossing warm-up (so the first chunk after resume can't false-trigger), exactly
   *  like Swift `resumeTapDetection()`. No-op unless paused. */
  resume(): void {
    if (this.state !== 'paused') return
    this.prevAbove = true
    this.consecutive = 0
    this.setState('listening')
  }

  /** Abort the current sequence (guitar multi-tap or material), discarding any partial
   *  captures, and return to idle so New Tap re-arms. Mirrors Swift `cancelTapSequence()`. */
  cancel(): void {
    this.collected = []
    this.materialSearch = null
    this.captureKind = 'guitar'
    this.capture = this.guitarCapture
    this.captureIdx = 0
    this.prevAbove = true
    this.consecutive = 0
    this.setState('idle')
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
    // actual ctx.sampleRate; the UI warns if it isn't EXPECTED_SAMPLE_RATE.
    this.stream = await this.acquireStream(deviceId) // exact saved device, else default (Safari stale ids)
    const track = this.stream.getAudioTracks()[0]!
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

    this.arm() // listen immediately (GuitarTap is always-on; New Tap only re-arms a frozen result)

    // Baseline the device list + watch for hot-plug changes (attach → auto-select, unplug → fall back).
    this.knownDevices = (await this.listInputs()).map((d) => d.deviceId)
    navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange)
  }

  private onChunk(data: ChunkMessage): void {
    if (this.playingFile) return // mic chunks are ignored while a file plays through the pipeline
    this.processChunk(data.samples, data.rms)
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
      const { magnitudesDb, frequencies, peak } = gatedCaptureResult(
        this.capture,
        this.sampleRate,
        this.materialSearch!,
      )
      this.callbacks.onCaptureAudio?.(this.capture.slice(), this.sampleRate, 'material')
      this.captureIdx = 0
      this.setState('idle')
      const sess = this.materialSession
      this.callbacks.onMaterialCapture?.({
        spectrum: { magnitudesDb, frequencies },
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

    this.callbacks.onCaptureAudio?.(this.capture.slice(0, GUITAR_FFT_SIZE), this.sampleRate, 'guitar')
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
    this.setState('idle')
    this.callbacks.onCapture?.(result, taps)
  }

  async stop(): Promise<void> {
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
    this.lastClipTime = null
    this.clipState = false
    this.setState('idle')
    await ctx?.close()
  }
}
