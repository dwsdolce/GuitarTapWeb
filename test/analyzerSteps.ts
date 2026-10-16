// @parity tooling/analyzer-steps
//
// The steps the shared scenario case files drive the analyzer with, each through the app's own path: the
// settings Settings writes, the Taps control, New Tap, Pause, Resume, Cancel, a capture finished on a
// synthetic tap, Accept, Redo, and audio fed through the analyzer's clock. A case file names its steps;
// this runs one. Mirrors Swift GuitarTapTests/AnalyzerSteps.swift and Python tests/analyzer_steps.py.
import { TapToneAnalyzer, type MaterialTapPhase } from '../src/state/tapToneAnalyzer'
import { MEASUREMENT_TYPE_FROM_RAW } from '../src/measurement'
import { SettingsStore } from '../src/settingsStore'
import { DEFAULT_SETTINGS } from '../src/settings'
import { GUITAR_FFT_SIZE } from '../src/dsp/guitarFFT'
import { advanceAudio, AUDIO_FEED_CHUNK_SECONDS } from './audioClockFeed'
import { syntheticTap } from './syntheticTap'

export type AnalyzerStep = {
  settings?: { type?: string; measureFlc?: boolean }
  setTaps?: number
  setThreshold?: number
  setPeakMin?: number
  newTap?: boolean
  /** The start a guitar file's playback makes. */
  newTapSkippingWarmUp?: boolean
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

/** A fresh analyzer as the shared scenario cases start one — threshold −40, Taps 1 — attached to its own
 *  settings store, which the settings step writes as Settings does. */
export function makeStepsAnalyzer(): { a: TapToneAnalyzer; store: SettingsStore } {
  const store = new SettingsStore({ ...DEFAULT_SETTINGS, tapDetectionThreshold: -40 })
  const a = new TapToneAnalyzer()
  a.attachSettingsStore(store)
  a.setNumberOfTaps(1)
  return { a, store }
}

/** Run `step` if it is one of the shared steps, and say whether it was. */
export function runAnalyzerStep(step: AnalyzerStep, a: TapToneAnalyzer, store: SettingsStore): boolean {
  if (step.settings) {
    if (step.settings.type !== undefined) store.update({ measurementType: MEASUREMENT_TYPE_FROM_RAW[step.settings.type]! })
    if (step.settings.measureFlc !== undefined) store.update({ measureFlc: step.settings.measureFlc })
  } else if (step.setTaps !== undefined) a.setNumberOfTaps(step.setTaps)
  else if (step.setThreshold !== undefined) store.update({ tapDetectionThreshold: step.setThreshold })
  else if (step.setPeakMin !== undefined) store.update({ peakMinThreshold: step.setPeakMin })
  else if (step.newTap) a.startTapSequence()
  else if (step.newTapSkippingWarmUp) a.startTapSequence({ skipWarmup: true })
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
  } else if (step.audioChunks !== undefined) {
    for (let i = 0; i < step.audioChunks; i++) {
      a.processAudioFrame(CHUNK_SAMPLES, step.level!, a.lastAudioTime + AUDIO_FEED_CHUNK_SECONDS)
    }
  }
  else return false
  return true
}
