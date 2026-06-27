import { dftAnalRect, GUITAR_FFT_SIZE, type Spectrum } from '../dsp/guitarFFT'
import { applyCalibration, interpolateToBins, type Calibration } from '../dsp/calibration'
import { averageSpectra } from '../dsp/spectrumAverage'
import { gatedCaptureResult, GATED_CAPTURE_DURATION, type MaterialPeak } from '../dsp/gatedCapture'

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
  /** Live-FFT performance, emitted once per continuous spectrum (FFTAnalysisMetricsView). */
  onMetrics?: (m: EngineMetrics) => void
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
  /** Applied mic-track settings (AGC/EC/NS etc.) — for diagnosing capture gain. */
  audioSettings: MediaTrackSettings | null = null
  /** Label of the active input device (track.label), for the Settings panel. */
  deviceLabel = ''
  /** deviceId of the active input (for the device picker + per-device calibration mapping). */
  inputDeviceId: string | null = null

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
    return this.context !== null
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

  /** Enumerate available audio input devices (labels are populated once permission is granted). */
  async listInputs(): Promise<{ deviceId: string; label: string }[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label }))
  }

  /** Switch the live input to `deviceId`, re-acquiring the stream and reconnecting the source
   *  while keeping the same AudioContext/worklet (so the sample rate and DSP state are intact).
   *  The web equivalent of RealtimeFFTAnalyzer.setInputDevice. */
  async setInputDevice(deviceId: string): Promise<void> {
    if (!this.context || !this.node) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: this.baseAudio(deviceId) })
    const track = stream.getAudioTracks()[0]!
    try {
      await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
    } catch {
      /* not all browsers support applyConstraints on these */
    }
    // Swap the source node; stop the old stream's tracks.
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = stream
    this.source = this.context.createMediaStreamSource(stream)
    this.source.connect(this.node)
    this.audioSettings = track.getSettings() ?? null
    this.deviceLabel = track.label ?? ''
    this.inputDeviceId = track.getSettings().deviceId ?? deviceId
  }

  async start(deviceId?: string | null): Promise<void> {
    if (this.context) return
    // Don't force a rate: browsers expose no device "nominal" rate (no constraint →
    // system default; getCapabilities → device MAX), so we let the OS decide. The rate
    // is set in macOS Audio MIDI Setup (the AudioContext follows the default OUTPUT
    // device, so input AND output must be set to the same rate). The DSP reads the
    // actual ctx.sampleRate; the UI warns if it isn't EXPECTED_SAMPLE_RATE.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.baseAudio(deviceId) })
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

    this.feedContinuous(s)
    this.feedPreroll(s)
    if (this.state === 'capturing') this.feedCapture(s)
    else if (this.state === 'listening') this.detectTap(db)
  }

  /** Play decoded mono samples through the live guitar pipeline (no mic), real-time paced —
   *  the web equivalent of Swift startFromFile/processFileData. The file defines the analysis
   *  sample rate; an optional calibration is applied for the playback then restored. Mic chunks
   *  are ignored meanwhile (the worklet keeps running; clearing the flag resumes it). */
  async playFile(
    samples: Float32Array,
    fileSampleRate: number,
    opts?: { calibration?: Calibration | null },
  ): Promise<void> {
    if (!this.context || this.playingFile) return
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
    // Fresh guitar tap sequence (mirrors startTapSequence before startFromFile).
    this.accumIdx = 0
    this.prerollIdx = 0
    this.prerollFilled = 0
    this.captureKind = 'guitar'
    this.capture = this.guitarCapture
    this.captureIdx = 0
    this.collected = []
    this.prevAbove = true
    this.consecutive = 0
    this.setState('listening')
    this.callbacks.onProgress?.(0, this.config.numberOfTaps)

    const CHUNK = 1024
    const chunkMs = (CHUNK / fileSampleRate) * 1000
    for (let i = 0; i < samples.length && this.playingFile; i += CHUNK) {
      const chunk = samples.subarray(i, Math.min(i + CHUNK, samples.length))
      let sumSq = 0
      for (let k = 0; k < chunk.length; k++) sumSq += chunk[k]! * chunk[k]!
      this.processChunk(chunk, Math.sqrt(sumSq / Math.max(1, chunk.length)))
      await new Promise((r) => setTimeout(r, chunkMs))
    }
    // Flush a partial in-flight capture so a tap near the end still emits a result.
    if (this.playingFile && this.state === 'capturing' && this.captureIdx > 0) {
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
      this.captureIdx = 0
      this.setState('idle')
      this.callbacks.onMaterialCapture?.({ spectrum: { magnitudesDb, frequencies }, peak })
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
    this.setState('idle')
    this.callbacks.onCapture?.(result, taps)
  }

  async stop(): Promise<void> {
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
