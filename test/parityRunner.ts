// @parity tooling/parity-runner
// Run every oracle case and report what THIS configuration computes.
//
// The oracle declares each case's *inputs* — fixture, calibration, settings — alongside
// the values canonical Swift produced for them. This module reads only the inputs, drives
// the same engine paths the app drives, and returns what the web edition produces in the
// oracle's own shape. It never reads an expected value, so nothing it returns is shaped
// by what the answer is supposed to be.
//
// Two callers share it, and the sharing is the point:
//   * mint-baseline.test.ts writes the result to this configuration's self-baseline
//   * self-regression.test.ts compares the result to that baseline at ZERO tolerance
// A mint and a check computed by two separate implementations could drift apart, and the
// drift would look exactly like "no regression". One implementation cannot.
//
// file-playback.test.ts imports playGuitar/playMaterial from here too, so the parity
// assertions and the regression baseline are measurements of the same code.

import { readFileSync } from 'node:fs'
import { RealtimeFFTAnalyzer, type MaterialCaptureResult, type MaterialPhaseName } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { decodeWav } from '../src/dsp/wav'
import { parseCalibration, type Calibration } from '../src/dsp/calibration'
import { modePeaksFromSpectrum, type Spectrum } from '../src/dsp/guitarFFT'
import { computeGatedFFT, magnitudeAtFrequency } from '../src/dsp/gatedFFT'
import { makeToneSignal, makeSilence, type Tone } from '../src/dsp/signal'
import { reviveNonFinite } from './selfBaseline'

export const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
  reviveNonFinite, // GFFT4's "-Infinity" → -Infinity
)

export interface RegSettings {
  peakMinThreshold?: number
  tapDetectionThreshold: number
  numberOfTaps?: number
  measureFlc?: boolean
}
export interface PeakRef {
  role: 'air' | 'top' | 'back' | 'longitudinal' | 'cross' | 'flc'
  frequency: number
  magnitude: number
  q?: number
}
export interface RegCase {
  fixture: string
  calibration: string | null
  settings: RegSettings
}

// Always downmix to mono (matches Swift readAudioFileAsMonoFloat32 + the mono live-mic path); a
// no-op for already-mono files. Guitar fixtures are stereo, material fixtures are mono.
export function loadWav(name: string) {
  return decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))), {
    downmix: true,
  })
}
export function loadCal(name: string | null): Calibration | null {
  if (!name) return null
  return parseCalibration(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'), name)
}

/** Run a guitar recording through engine.playFile (headless), wired to a real TapToneAnalyzer exactly
 *  as the app wires them (6-TEST 3c-C2a): the device delivers each per-tap spectrum RAW; the analyzer
 *  accumulates + power-averages them into the frozen result. Mirrors Swift's TapToneAnalyzer.forTesting()
 *  driving playFileForTesting → the averaged spectrum + per-tap spectra come from the analyzer. */
export async function playGuitar(
  reg: RegCase,
): Promise<{ spectrum: Spectrum; taps?: Spectrum[] } | null> {
  const wav = loadWav(reg.fixture)
  const analyzer = new TapToneAnalyzer()
  analyzer.setNumberOfTaps(reg.settings.numberOfTaps ?? 1)
  analyzer.tapDetectionThreshold = reg.settings.tapDetectionThreshold
  const engine = new RealtimeFFTAnalyzer(
    { onAudioFrame: (samples, levelDb, audioTime) => analyzer.processAudioFrame(samples, levelDb, audioTime) },
    { tapDetectionThreshold: reg.settings.tapDetectionThreshold, numberOfTaps: reg.settings.numberOfTaps ?? 1 },
  )
  engine.initForTesting()
  analyzer.setDevice(engine)
  // Arm, then play — Swift's order. Guitar playback skips the warm-up (absolute threshold).
  analyzer.startTapSequence({ skipWarmup: true })
  await engine.playFile(wav.samples, wav.sampleRate, { calibration: loadCal(reg.calibration) })
  analyzer.flushPartialGuitarCapture()
  if (!analyzer.isMeasurementComplete) return null
  const spectrum: Spectrum = { magnitudesDb: analyzer.frozenMagnitudes, frequencies: analyzer.frozenFrequencies }
  const taps =
    analyzer.capturedTaps.length > 1
      ? analyzer.capturedTaps.map((t) => ({ magnitudesDb: t.magnitudes, frequencies: t.frequencies }))
      : undefined
  return { spectrum, taps }
}

/** Run a plate/brace session through engine.playFile (headless), wired to a real TapToneAnalyzer as the
 *  app wires them (6-TEST 3c-C4 Option C): the device emits each raw gated tap; the analyzer owns the
 *  per-tap validity gate, the tap count, the re-arm, and the L→C→FLC auto-advance (recordMaterialTap),
 *  averaging + findDominantPeak at each phase end. One result per completed phase is read off the analyzer. */
export async function playMaterial(
  reg: RegCase,
  brace: boolean,
): Promise<MaterialCaptureResult[]> {
  const wav = loadWav(reg.fixture)
  const analyzer = new TapToneAnalyzer()
  analyzer.measurementType = brace ? 'brace' : 'plate'
  analyzer.measureFlc = reg.settings.measureFlc ?? false
  analyzer.setNumberOfTaps(reg.settings.numberOfTaps ?? 1) // analyzer owns the material tap count now
  analyzer.tapDetectionThreshold = reg.settings.tapDetectionThreshold
  const engine = new RealtimeFFTAnalyzer(
    { onAudioFrame: (samples, levelDb, audioTime) => analyzer.processAudioFrame(samples, levelDb, audioTime) },
    { tapDetectionThreshold: reg.settings.tapDetectionThreshold, numberOfTaps: reg.settings.numberOfTaps ?? 1 },
  )
  engine.initForTesting()
  // The analyzer's per-phase search reads the DEVICE's active calibration, as it does in the app
  // (App applies it per input) — so set it here rather than passing it through playFile.
  engine.setCalibration(loadCal(reg.calibration))
  analyzer.setDevice(engine)
  // Arm, then play — Swift's order. Material always runs the warm-up (relative noise-floor detector).
  analyzer.startTapSequence()
  await engine.playFile(wav.samples, wav.sampleRate, {
    material: { brace, measureFlc: reg.settings.measureFlc ?? false, calibration: loadCal(reg.calibration) },
  })
  // Collect one result per completed phase off the analyzer (the engine auto-advanced L→C→(FLC)).
  const phases: MaterialPhaseName[] = brace
    ? ['longitudinal']
    : reg.settings.measureFlc
      ? ['longitudinal', 'cross', 'flc']
      : ['longitudinal', 'cross']
  const caps: MaterialCaptureResult[] = []
  for (const ph of phases) {
    if (analyzer.matSpectra[ph]) caps.push({ spectrum: analyzer.matSpectra[ph]!, peak: analyzer.matPeaks[ph], phase: ph })
  }
  return caps
}

const ROLE_TO_PHASE: Record<string, MaterialPhaseName> = {
  longitudinal: 'longitudinal',
  cross: 'cross',
  flc: 'flc',
}

function record(
  source: { frequency: number; magnitude: number; quality?: number } | undefined | null,
  want: PeakRef,
  where: string,
): Record<string, unknown> {
  if (!source) throw new Error(`${where}: no ${want.role} peak was produced`)
  const out: Record<string, unknown> = { role: want.role, frequency: source.frequency, magnitude: source.magnitude }
  if (want.q !== undefined) out.q = source.quality
  return out
}

/** Ring-out for REG-G1, computed the way decay-tracking.test.ts computes it. */
async function ringOutSec(reg: RegCase): Promise<number> {
  const wav = loadWav(reg.fixture)
  const analyzer = new TapToneAnalyzer()
  analyzer.setNumberOfTaps(1)
  analyzer.tapDetectionThreshold = reg.settings.tapDetectionThreshold
  const engine = new RealtimeFFTAnalyzer(
    { onAudioFrame: (samples, levelDb, audioTime) => analyzer.processAudioFrame(samples, levelDb, audioTime) },
    { tapDetectionThreshold: reg.settings.tapDetectionThreshold, numberOfTaps: 1 },
  )
  engine.initForTesting()
  analyzer.setDevice(engine)
  analyzer.startTapSequence({ skipWarmup: true })
  await engine.playFile(wav.samples, wav.sampleRate, { pace: false })
  if (engine.decayTime === null) throw new Error('REG-G1: no ring-out was measured')
  return engine.decayTime
}

export async function computeFilePlayback(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const [name, specRaw] of Object.entries(oracle.filePlayback)) {
    const spec = specRaw as RegCase & Record<string, unknown>
    const guitar = (spec.settings as unknown as { measurementType: string }).measurementType === 'Generic Guitar'
    const computed: Record<string, unknown> = {}

    if (guitar) {
      const cap = await playGuitar(spec)
      if (!cap) throw new Error(`${name}: no capture emitted`)
      const modes = modePeaksFromSpectrum(cap.spectrum, {
        peakMinThreshold: spec.settings.peakMinThreshold!,
        guitarType: 'generic',
      })
      for (const block of ['peaks', 'averagedPeaks'] as const) {
        if (!spec[block]) continue
        computed[block] = (spec[block] as PeakRef[]).map((want) =>
          record(modes[want.role as 'air' | 'top' | 'back'], want, name),
        )
      }
      if (spec.perTap) {
        const perTap = spec.perTap as { tap: number; peaks: PeakRef[] }[]
        computed.perTap = perTap.map((entry, i) => {
          const modesForTap = modePeaksFromSpectrum(cap.taps![i]!, {
            peakMinThreshold: spec.settings.peakMinThreshold!,
            guitarType: 'generic',
          })
          return {
            tap: entry.tap,
            peaks: entry.peaks.map((want) =>
              record(modesForTap[want.role as 'air' | 'top' | 'back'], want, `${name} tap ${entry.tap}`),
            ),
          }
        })
      }
      if (spec.ringOutSec !== undefined) computed.ringOutSec = await ringOutSec(spec)
    } else {
      const brace = (spec.settings as unknown as { measurementType: string }).measurementType === 'Material (Brace)'
      const caps = await playMaterial(spec, brace)
      computed.peaks = (spec.peaks as PeakRef[]).map((want) =>
        record(caps.find((c) => c.phase === ROLE_TO_PHASE[want.role])?.peak, want, name),
      )
    }
    out[name] = computed
  }
  return out
}

export function computeGatedFft(): Record<string, unknown> {
  const SR = 48000
  const out: Record<string, unknown> = {}
  for (const [name, specRaw] of Object.entries(oracle.gatedFft)) {
    const spec = specRaw as {
      tones?: Tone[]
      expected?: { hz: number; db: number }[]
      deltaDb?: number
      maxDb?: number
      signal?: string
    }
    const signal = spec.signal === 'silence' ? makeSilence(SR) : makeToneSignal(spec.tones!, SR)
    const { magnitudesDb, frequencies } = computeGatedFFT(signal, SR)
    const computed: Record<string, unknown> = {}
    if (spec.expected) {
      const got = spec.expected.map((e) => ({
        hz: e.hz,
        db: magnitudeAtFrequency(e.hz, magnitudesDb, frequencies)!,
      }))
      computed.expected = got
      if (spec.deltaDb !== undefined) computed.deltaDb = got[got.length - 1]!.db - got[0]!.db
    }
    if (spec.maxDb !== undefined) {
      let max = -Infinity
      for (const v of magnitudesDb) if (v > max) max = v
      computed.maxDb = max
    }
    out[name] = computed
  }
  return out
}

/** Everything this configuration computes, in the oracle's own shape. */
export async function computeAll(): Promise<Record<string, unknown>> {
  return { filePlayback: await computeFilePlayback(), gatedFft: computeGatedFft() }
}
