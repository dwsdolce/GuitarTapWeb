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
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import type { ResonantPeak } from '../src/measurement/types'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { decodeWav } from '../src/dsp/wav'
import { parseCalibration, type Calibration } from '../src/dsp/calibration'
import { makeGatedTestSignal, gatedMagnitudeAt, type Tone } from './gatedSignal'
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

/** Run a generic-guitar recording through analyzer.playFile — the app's Play File path (headless), wired to a real TapToneAnalyzer
 *  exactly as the app wires them: the device delivers each per-tap spectrum RAW; the analyzer
 *  accumulates + power-averages them into the frozen result and builds the per-tap entries. Returns the
 *  completed analyzer, whose peaks are read the way the app reads them — `getPeak(mode)` (the Results
 *  panel) and `tapEntries[i].resolvedModePeaks()` (the multi-tap view). Mirrors Swift's
 *  TapToneAnalyzer.forTesting() driving playFileAndWait(measurementType: .generic). */
export async function playGuitar(reg: RegCase): Promise<TapToneAnalyzer> {
  const wav = loadWav(reg.fixture)
  const analyzer = new TapToneAnalyzer()
  analyzer.measurementType = 'generic'
  analyzer.peakMinThreshold = reg.settings.peakMinThreshold!
  analyzer.setNumberOfTaps(reg.settings.numberOfTaps ?? 1)
  analyzer.tapDetectionThreshold = reg.settings.tapDetectionThreshold
  const engine = new RealtimeFFTAnalyzer(
    { onAudioFrame: (samples, levelDb, audioTime) => analyzer.processAudioFrame(samples, levelDb, audioTime) },
    { tapDetectionThreshold: reg.settings.tapDetectionThreshold, numberOfTaps: reg.settings.numberOfTaps ?? 1 },
  )
  engine.initForTesting()
  analyzer.setDevice(engine)
  await analyzer.playFile(wav.samples, wav.sampleRate, loadCal(reg.calibration))
  // A capture the file stopped filling is flushed by the engine at file end.
  // The last tap is averaged `captureWindow` (0.2 s) later, as in Swift/Python — so wait for it the way
  // Swift's playFileAndWait polls, rather than read a result that has not been produced yet.
  await waitForCompletion(analyzer)
  return analyzer
}

/** Run a plate/brace session through analyzer.playFile — the app's Play File path (headless), wired to a real TapToneAnalyzer as the
 *  app wires them: the device emits each raw gated tap; the analyzer owns the per-tap validity gate, the tap
 *  count, the re-arm, and the L→C→FLC auto-advance, averaging + findDominantPeak at each phase end. Returns
 *  the analyzer, whose identified peaks are read as the app reads them (`selectedLongitudinalPeak` /
 *  `selectedCrossPeak` / `selectedFlcPeak`). Mirrors Swift's TapToneAnalyzer.forTesting() driving
 *  playFileAndWait(measurementType: .plate / .brace). */
export async function playMaterial(reg: RegCase, brace: boolean): Promise<TapToneAnalyzer> {
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
  analyzer.setDevice(engine)
  await analyzer.playFile(wav.samples, wav.sampleRate, loadCal(reg.calibration))
  return analyzer
}

/** A material role's identified peak on the analyzer (Swift `selected…Peak`). */
export function identifiedPeak(analyzer: TapToneAnalyzer, role: string): ResonantPeak | null {
  return role === 'longitudinal'
    ? analyzer.selectedLongitudinalPeak
    : role === 'cross'
      ? analyzer.selectedCrossPeak
      : role === 'flc'
        ? analyzer.selectedFlcPeak
        : null
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

/** Poll until the analyzer completes its measurement, or give up after `timeoutMs` — the web's
 *  counterpart of Swift playFileAndWait polling until processMultipleTaps has run. */
export async function waitForCompletion(analyzer: TapToneAnalyzer, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!analyzer.isMeasurementComplete && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

export async function computeFilePlayback(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const [name, specRaw] of Object.entries(oracle.filePlayback)) {
    const spec = specRaw as RegCase & Record<string, unknown>
    const guitar = (spec.settings as unknown as { measurementType: string }).measurementType === 'Generic Guitar'
    const computed: Record<string, unknown> = {}

    if (guitar) {
      const analyzer = await playGuitar(spec)
      if (!analyzer.isMeasurementComplete) throw new Error(`${name}: the measurement did not complete`)
      for (const block of ['peaks', 'averagedPeaks'] as const) {
        if (!spec[block]) continue
        computed[block] = (spec[block] as PeakRef[]).map((want) =>
          record(analyzer.getPeak(want.role as 'air' | 'top' | 'back'), want, name),
        )
      }
      if (spec.perTap) {
        const perTap = spec.perTap as { tap: number; peaks: PeakRef[] }[]
        computed.perTap = perTap.map((entry, i) => {
          const modesForTap = analyzer.tapEntries[i]!.resolvedModePeaks()
          return {
            tap: entry.tap,
            peaks: entry.peaks.map((want) =>
              record(modesForTap.get(want.role as 'air' | 'top' | 'back'), want, `${name} tap ${entry.tap}`),
            ),
          }
        })
      }
      // The ring-out is read off the same playback, as file-playback's REG-G case reads it.
      if (spec.ringOutSec !== undefined) {
        if (analyzer.currentDecayTime === null) throw new Error(`${name}: no ring-out was measured`)
        computed.ringOutSec = analyzer.currentDecayTime
      }
    } else {
      const brace = (spec.settings as unknown as { measurementType: string }).measurementType === 'Material (Brace)'
      const analyzer = await playMaterial(spec, brace)
      computed.peaks = (spec.peaks as PeakRef[]).map((want) => record(identifiedPeak(analyzer, want.role), want, name))
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
    // Silence is the signal with no tones. The same builder the GFFT tests use, through the same
    // calibrated transform the app runs.
    const signal = makeGatedTestSignal(spec.signal === 'silence' ? [] : spec.tones!, SR)
    const { magnitudesDb, frequencies } = new RealtimeFFTAnalyzer().computeGatedFFT(signal, SR)
    const computed: Record<string, unknown> = {}
    if (spec.expected) {
      const got = spec.expected.map((e) => ({
        hz: e.hz,
        db: gatedMagnitudeAt(e.hz, magnitudesDb, frequencies)!,
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
