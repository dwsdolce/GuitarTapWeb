// @parity tooling/analyzer-steps
//
// The steps the shared scenario case files drive the analyzer with, each through the app's own path: the
// settings Settings writes, the Taps control, New Tap, Pause, Resume, Cancel, a capture finished on a
// synthetic tap, Accept, Redo, and audio fed through the analyzer's clock. A case file names its steps;
// this runs one. Mirrors Swift GuitarTapTests/AnalyzerSteps.swift and Python tests/analyzer_steps.py.
import { TapToneAnalyzer, type MaterialTapPhase } from '../src/state/tapToneAnalyzer'
import { readFileSync } from 'node:fs'
import { MEASUREMENT_TYPE_FROM_RAW, parseGuitarTapFile } from '../src/measurement'
import { settingsStore } from '../src/settingsStore'
import { setMaxFrequency, setMinFrequency } from '../src/settings'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'
import { advanceAudio, AUDIO_FEED_CHUNK_SECONDS, ManualWallClock } from './audioClockFeed'
import { syntheticTap } from './syntheticTap'
import { spectrum } from './spectrumSpec'
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'

export type AnalyzerStep = {
  settings?: { type?: string; measureFlc?: boolean; range?: [number, number, number, number] }
  setTaps?: number
  setThreshold?: number
  setPeakMin?: number
  newTap?: boolean
  /** The start a guitar file's playback makes. */
  newTapSkippingWarmUp?: boolean
  /** What the engine coming up does (its guarded auto-start). */
  engineStarted?: boolean
  /** A fixture every edition carries, loaded as the app loads a file. */
  loadFixture?: string
  pause?: boolean
  resume?: boolean
  cancel?: boolean
  guitarTap?: number
  materialTap?: { phase: 'L' | 'C' | 'FLC'; hz: number }
  accept?: boolean
  redo?: boolean
  advance?: 'tapCooldown' | 'captureWindow' | 'warmupPeriod' | number
  fraction?: number
  extra?: number
  level?: number
  /** Exactly n chunks of audio at `level`, each one chunk after the last (two loud ones are a tap). */
  audioChunks?: number
  /** That much wall time with no audio. */
  stall?: number
  /** The engine restarted on a device change. */
  routeChange?: boolean
  /** The engine stopped or started again, as a retry after a failed start does. */
  engineRunning?: boolean
  /** One FFT frame from the running engine, a spectrum as peaks.json describes one. */
  spectrumFrame?: Record<string, unknown>
  /** That much real audio (a 200 Hz tone at `level`) through the microphone's path. */
  liveAudio?: number
}

/** The analyzer's engine, running: a frame or a restart comes only from one. Attached on first use. */
function runningEngine(a: TapToneAnalyzer): void {
  if (a.device) return
  const engine = new RealtimeFFTAnalyzer()
  engine.initForTesting()
  a.setDevice(engine)
}

/** One chunk's samples; the level a chunk is fed at is given with it. */
const CHUNK_SAMPLES = new Float32Array(1024)

const MATERIAL_PHASES: Record<string, MaterialTapPhase> = { L: 'capturingL', C: 'capturingC', FLC: 'capturingFlc' }

/** The material phases by Swift's raw value, as the case files name them. */
export const PHASE_RAW: Record<MaterialTapPhase, string> = {
  notStarted: 'Not Started', capturingL: 'Capturing Longitudinal', reviewingL: 'Reviewing Longitudinal',
  capturingC: 'Capturing Cross-grain', reviewingC: 'Reviewing Cross-grain', waitingForFlcTap: 'Waiting for FLC Tap',
  capturingFlc: 'Capturing FLC', reviewingFlc: 'Reviewing FLC', complete: 'Complete',
}

/** A fresh analyzer as the shared scenario cases start one — threshold −40, Taps 1, and a wall clock that
 *  moves only when a step stalls it. The settings step writes the settings store, as Settings does. */
/** The sample count liveAudio has fed, so its tone runs on across steps. */
let liveAudioSample = 0

export function makeStepsAnalyzer(): TapToneAnalyzer {
  const a = new TapToneAnalyzer(null, new ManualWallClock())
  a.setNumberOfTaps(1)
  a.tapDetectionThreshold = -40
  return a
}

/** Run `step` if it is one of the shared steps, and say whether it was. */
export function runAnalyzerStep(step: AnalyzerStep, a: TapToneAnalyzer): boolean {
  if (step.settings) {
    if (step.settings.type !== undefined) settingsStore.update({ measurementType: MEASUREMENT_TYPE_FROM_RAW[step.settings.type]! })
    if (step.settings.measureFlc !== undefined) settingsStore.update({ measureFlc: step.settings.measureFlc })
    if (step.settings.range !== undefined) {
      // The measurement type's display range and the dB range, as Settings writes them.
      const [minHz, maxHz, minDb, maxDb] = step.settings.range
      const type = settingsStore.get().measurementType
      settingsStore.update(setMinFrequency(settingsStore.get(), minHz, type))
      settingsStore.update(setMaxFrequency(settingsStore.get(), maxHz, type))
      settingsStore.update({ minDb, maxDb })
    }
  } else if (step.setTaps !== undefined) a.setNumberOfTaps(step.setTaps)
  else if (step.setThreshold !== undefined) a.tapDetectionThreshold = step.setThreshold
  else if (step.setPeakMin !== undefined) a.peakMinThreshold = step.setPeakMin
  else if (step.newTap) a.startTapSequence()
  else if (step.newTapSkippingWarmUp) a.startTapSequence({ skipWarmup: true })
  else if (step.engineStarted) a.autoStartTapSequence()
  else if (step.loadFixture) a.loadMeasurement(parseGuitarTapFile(readFileSync(`test/fixtures/${step.loadFixture}`, 'utf8'))[0]!)
  else if (step.pause) a.pauseTapDetection()
  else if (step.resume) a.resumeTapDetection()
  else if (step.cancel) a.cancelTapSequence()
  else if (step.guitarTap !== undefined) a.finishGuitarGatedCapture(syntheticTap(step.guitarTap, GUITAR_FFT_SIZE / 48000), 48000)
  else if (step.materialTap) {
    a.finishGatedFFTCapture(syntheticTap(step.materialTap.hz, 0.5), 48000, MATERIAL_PHASES[step.materialTap.phase]!)
  } else if (step.accept) a.acceptCurrentPhase()
  else if (step.redo) a.redoCurrentPhase()
  else if (step.advance !== undefined) {
    const seconds =
      step.advance === 'tapCooldown' ? a.tapCooldown
        : step.advance === 'captureWindow' ? a.captureWindow
          : step.advance === 'warmupPeriod' ? a.warmupPeriod
            : step.advance
    advanceAudio(a, seconds * (step.fraction ?? 1) + (step.extra ?? 0), step.level ?? -90)
  } else if (step.engineRunning !== undefined) {
    runningEngine(a)
    ;(a.device as unknown as { headless: boolean }).headless = step.engineRunning
  } else if (step.routeChange) {
    runningEngine(a)
    a.handleRouteChangeRestart()
  } else if (step.spectrumFrame) {
    runningEngine(a)
    const { mags, freqs } = spectrum(step.spectrumFrame)
    a.onFftFrame(mags, freqs)
  } else if (step.stall !== undefined) {
    ;(a.wallClock as ManualWallClock).advance(step.stall)
  } else if (step.audioChunks !== undefined) {
    for (let i = 0; i < step.audioChunks; i++) {
      a.processAudioFrame(CHUNK_SAMPLES, step.level!, a.lastAudioTime + AUDIO_FEED_CHUNK_SECONDS)
    }
  } else if (step.liveAudio !== undefined) {
    // Real audio through the microphone's path: each chunk's samples to the capture, then its level.
    const amplitude = Math.SQRT2 * 10 ** (step.level! / 20)
    for (let c = 0; c < Math.round(step.liveAudio / AUDIO_FEED_CHUNK_SECONDS); c++) {
      const chunk = Float32Array.from({ length: 1024 }, (_, i) => amplitude * Math.sin((2 * Math.PI * 200 * (liveAudioSample + i)) / 48000))
      liveAudioSample += 1024
      a.processAudioFrame(chunk, step.level!, a.lastAudioTime + AUDIO_FEED_CHUNK_SECONDS)
    }
  }
  else return false
  return true
}
