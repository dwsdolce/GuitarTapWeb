// @parity test/file-playback
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

// The analyzer writes the session WAV itself (Swift's shape); in Node there is no download, so the
// writer is mocked and the calls collected.
const dumped: { samples: Float32Array; rate: number; label: string }[] = []
vi.mock('../src/measurement/dumpWav', () => ({
  dumpCaptureWav: (samples: Float32Array, rate: number, label: string) => {
    dumped.push({ samples, rate, label })
    return `web_${label}.wav`
  },
}))
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Calibration } from '../src/dsp/calibration'
import type { ResonantPeak } from '../src/measurement/types'
import {
  loadCal,
  loadWav,
  oracle,
  identifiedPeak,
  playGuitar,
  playMaterial,
  type PeakRef,
  type RegSettings,
} from './parityRunner'

// End-to-end regression of the FULL audio chain through the SAME analyzer.playFile path the app
// uses — WAV → chunk pacing → RMS → level-crossing tap detection → gated/guitar FFT → peak
// selection / mode classification → (material) auto-advanced phase machine. The web mirror of
// Swift's FilePlaybackRegressionTests (TapToneAnalyzer.forTesting() + playFileAndWait): same
// fixtures, same parity-oracle.json values, asserted at the oracle's cross-edition `tolerances`
// (whether the web agrees with Swift, which mints them and asserts them at zero — the web's own zero-bar
// check is its self-regression). `initForTesting()` runs the engine
// headlessly (no AudioContext/mic).
//
// PLAYBACK IS REAL-TIME PACED (`pace: true`, the default) — deliberately, and it must stay that way.
// Swift and Python pace their playback in real time (`Thread.sleep` / `time.sleep(chunk_duration)`), so
// this does too, and runs the detection path live users take — the warm-up that establishes the noise
// floor for plate/brace included.
//
// The cost is real (~90 s of fixture audio) and accepted: it is the price of the three platforms
// actually running the same code path. Tests carry explicit timeouts sized to their fixture.

// playGuitar/playMaterial live in parityRunner.ts, shared with the self-baseline mint and the
// zero-tolerance regression check. The parity assertions below and that baseline are therefore
// measurements of the same code — a separate copy here could drift, and the drift would be
// invisible precisely where it matters.
const TOL = oracle.tolerances as { freqHz: number; magDb: number; q: number }

// 6f: continuous session recording (Swift finishSessionRecording). When the dump-capture diagnostic
// is on, a guitar measurement emits ONE session WAV labeled "Guitar_<n>tap" covering every chunk that
// flowed through the pipeline (arm → final tap). Off (default), nothing is emitted.
async function playGuitarSession(
  reg: { fixture: string; calibration: string | null; settings: RegSettings },
  dumpCaptureAudio: boolean,
): Promise<{ wav: { samples: Float32Array; sampleRate: number }; sessions: { samples: Float32Array; rate: number; label: string }[] }> {
  const wav = loadWav(reg.fixture)
  dumped.length = 0
  const analyzer = new TapToneAnalyzer()
  analyzer.setNumberOfTaps(reg.settings.numberOfTaps ?? 1)
  analyzer.tapDetectionThreshold = reg.settings.tapDetectionThreshold
  // The analyzer owns the session WAV now and writes it itself, as Swift's analyzer does — so the
  // switch is a SETTING on the analyzer, not engine config, and the write is captured by the mock.
  analyzer.setSettings({ ...DEFAULT_SETTINGS, dumpCaptureAudio })
  const engine = new RealtimeFFTAnalyzer(
    { onAudioFrame: (samples, levelDb, audioTime) => analyzer.processAudioFrame(samples, levelDb, audioTime) },
    {
      tapDetectionThreshold: reg.settings.tapDetectionThreshold,
      numberOfTaps: reg.settings.numberOfTaps ?? 1,
    },
  )
  engine.initForTesting()
  analyzer.setDevice(engine)
  // The analyzer owns detection and therefore the session's start and finish.
  await analyzer.playFile(wav.samples, wav.sampleRate, loadCal(reg.calibration))
  const sessions = dumped.map((d) => ({ samples: d.samples, rate: d.rate, label: d.label.replace(/^session_/, '') }))
  return { wav, sessions }
}

// What each REG case checks is the shared case file, file-playback.json (the same cases the Swift and
// Python suites run); the expected values are the oracle's.
interface PlaybackCheck {
  kind: string
  count?: number
  expected?: 'peaks' | 'averagedPeaks'
  roles?: PeakRef['role'][]
  fields?: ('frequency' | 'magnitude' | 'q')[]
  min?: number
  max?: number
}
interface PlaybackCase {
  id: string
  oracle: string
  fixture?: string
  checks: PlaybackCheck[]
}
const PLAYBACK_CASES = (
  JSON.parse(readFileSync(new URL('./fixtures/file-playback.json', import.meta.url), 'utf8')) as {
    cases: PlaybackCase[]
  }
).cases

// A case-file field → the tolerance it is compared at.
const FIELD_TOLERANCE = { frequency: TOL.freqHz, magnitude: TOL.magDb, q: TOL.q }

function value(p: ResonantPeak | PeakRef, field: 'frequency' | 'magnitude' | 'q'): number {
  if (field === 'q') return 'quality' in p ? p.quality : p.q!
  return p[field]
}

/** The peak the app identifies for a role: the selected fL / fC / fLC for a material, the peak for the
 *  mode for a guitar. */
function rolePeak(a: TapToneAnalyzer, role: PeakRef['role']): ResonantPeak | null | undefined {
  return role === 'air' || role === 'top' || role === 'back' ? a.getPeak(role) : identifiedPeak(a, role)
}

function expectPeak(
  label: string,
  actual: ResonantPeak | null | undefined,
  expected: PeakRef,
  fields: ('frequency' | 'magnitude' | 'q')[],
) {
  expect(actual, `${label}: no peak identified`).toBeTruthy()
  for (const field of fields) {
    expect(Math.abs(value(actual!, field) - value(expected, field)), `${label} ${field}`).toBeLessThanOrEqual(
      FIELD_TOLERANCE[field],
    )
  }
}

function byRole(peaks: PeakRef[]): Map<string, PeakRef> {
  return new Map(peaks.map((p) => [p.role, p]))
}

describe('file playback through the live engine (file-playback.json)', () => {
  it.each(PLAYBACK_CASES.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const entry = oracle.filePlayback[c.oracle]
    const reg = c.fixture ? { ...entry, fixture: c.fixture } : entry
    const type = entry.settings.measurementType as string
    const a =
      type === 'Material (Plate)' || type === 'Material (Brace)'
        ? await playMaterial(reg, type === 'Material (Brace)')
        : await playGuitar(reg)

    for (const check of c.checks) {
      switch (check.kind) {
        case 'materialPhaseComplete':
          expect(a.materialTapPhase, 'materialTapPhase').toBe('complete')
          break
        case 'measurementComplete':
          expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
          break
        case 'capturedTaps':
          expect(a.capturedTaps.length, 'captured taps').toBe(check.count)
          break
        case 'tapEntries':
          expect(a.tapEntries.length, 'tap entries').toBe(check.count)
          break
        case 'peaks': {
          const expected = byRole(entry[check.expected!] as PeakRef[])
          for (const role of check.roles!) expectPeak(role, rolePeak(a, role), expected.get(role)!, check.fields!)
          break
        }
        case 'perTapPeaks': {
          const perTap = entry.perTap as { tap: number; peaks: PeakRef[] }[]
          expect(a.tapEntries.length, 'tap entries').toBe(perTap.length)
          a.tapEntries.forEach((tap, i) => {
            const modes = tap.resolvedModePeaks()
            const expected = byRole(perTap[i]!.peaks)
            for (const role of check.roles!) {
              expectPeak(
                `tap ${i + 1} ${role}`,
                modes.get(role as 'air' | 'top' | 'back'),
                expected.get(role)!,
                check.fields!,
              )
            }
          })
          break
        }
        case 'ringOut':
          expect(a.currentDecayTime, 'no ring-out measured').not.toBeNull()
          expect(Math.abs(a.currentDecayTime! - entry.ringOutSec)).toBeLessThanOrEqual(oracle.tolerances.ringOutSec)
          break
        case 'phasesCaptured': {
          const captured = [a.matSpectra.longitudinal, a.matSpectra.cross, a.matSpectra.flc].filter((sp) => sp != null)
          expect(captured.length, `phases captured (noiseFloorEstimate ${a.noiseFloorEstimate})`).toBe(check.count)
          break
        }
        case 'noiseFloorBetween':
          expect(a.noiseFloorEstimate, 'noiseFloorEstimate').toBeGreaterThan(check.min!)
          expect(a.noiseFloorEstimate, 'noiseFloorEstimate').toBeLessThan(check.max!)
          break
        default:
          throw new Error(`unknown check kind ${check.kind}`)
      }
    }
  }, 120_000)
})

// The playback rules — sequences of actions, in Swift's order (FilePlaybackRegressionTests).
describe('file playback rules', () => {
  // 6f: continuous session recording — see playGuitarSession above.
  it('REG-G1 + dump on: one session WAV labeled Guitar_1tap, continuous & bounded by the file', async () => {
    const { wav, sessions } = await playGuitarSession(oracle.filePlayback['REG-G1'], true)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.label).toBe('Guitar_1tap')
    expect(sessions[0]!.rate).toBe(wav.sampleRate)
    // Covers the arm→tap→capture span: a continuous run of many chunks (not empty / single-chunk),
    // and never more than the whole file. (Exact length is deterministic but not pinned, to stay
    // robust to capture-window/detection-timing tweaks.)
    expect(sessions[0]!.samples.length).toBeGreaterThan(8192)
    expect(sessions[0]!.samples.length).toBeLessThanOrEqual(wav.samples.length)
  }, 20_000)

  it('REG-G2 multi-tap: session labeled by the tap count (Guitar_8tap)', async () => {
    const { sessions } = await playGuitarSession(oracle.filePlayback['REG-G2'], true)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.label).toBe('Guitar_8tap')
  }, 60_000)

  it('dump off (default): no session WAV is emitted or buffered', async () => {
    const { sessions } = await playGuitarSession(oracle.filePlayback['REG-G1'], false)
    expect(sessions).toHaveLength(0)
  }, 20_000)

  // Cancel during a playback stops the file and restarts the sequence on live input; a measurement-type
  // change stops it before arming the new type. Nothing from the rest of the file reaches the new
  // sequence, and the playback ends (the input's calibration returns). Twins of Swift's
  // stopping-a-playback cases.
  async function stopPlaybackAfterFirstTap(stop: (a: TapToneAnalyzer) => void) {
    const reg = oracle.filePlayback['REG-G2']
    const wav = loadWav(reg.fixture)
    const input = loadCal(oracle.filePlayback['REG-B1'].calibration)
    const analyzer = new TapToneAnalyzer()
    analyzer.measurementType = 'generic'
    analyzer.peakMinThreshold = reg.settings.peakMinThreshold!
    analyzer.setNumberOfTaps(8)
    analyzer.tapDetectionThreshold = reg.settings.tapDetectionThreshold
    const engine = new RealtimeFFTAnalyzer({ onAudioFrame: (s, db, t) => analyzer.processAudioFrame(s, db, t) })
    engine.initForTesting()
    analyzer.setDevice(engine)
    engine.setCalibration(input)
    let ended = false
    const playing = analyzer.playFile(wav.samples, wav.sampleRate, null, 'Recording').then(() => {
      ended = true
    })
    const deadline = Date.now() + 20_000
    while (analyzer.currentTapCount < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5))
    expect(analyzer.currentTapCount, 'precondition: a tap before the stop').toBeGreaterThanOrEqual(1)
    stop(analyzer)
    await playing
    return { analyzer, engine, ended, input }
  }
  const runOnFor = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('Cancel during a playback stops the file and restarts on live input', async () => {
    const { analyzer, engine, ended, input } = await stopPlaybackAfterFirstTap((a) => a.cancelTapSequence())
    expect(engine.playingFile, 'the file is stopped').toBe(false)
    expect(analyzer.isPlayingFile, 'the view sees no playback').toBe(false)
    expect(analyzer.getSnapshot().playingFileName, 'the chart no longer names the file').toBeNull()
    expect(ended, 'the playback ended').toBe(true)
    expect(engine.activeCalibration, "the input's calibration is back").toBe(input)
    expect(analyzer.detectionState, 'a fresh sequence is armed').toBe('listening')
    expect(analyzer.currentTapCount, 'the partial result is discarded').toBe(0)
    // The rest of the file must not reach the fresh sequence.
    await runOnFor(2000)
    expect(analyzer.currentTapCount, 'no tap from the abandoned file').toBe(0)
    expect(analyzer.isMeasurementComplete).toBe(false)
  }, 30_000)

  it('a measurement-type change during a playback stops the file before arming the new type', async () => {
    const { analyzer, engine, ended } = await stopPlaybackAfterFirstTap((a) => {
      a.measurementType = 'plate'
      a.requestStartTapSequence() // what App's type-change arm does
    })
    expect(engine.playingFile, 'the file is stopped').toBe(false)
    expect(ended, 'the playback ended').toBe(true)
    expect(analyzer.materialTapPhase, 'the plate sequence is armed').toBe('capturingL')
    await runOnFor(2000)
    expect(analyzer.selectedLongitudinalPeak, 'no guitar tap from the abandoned file reaches the plate measurement').toBeNull()
    expect(analyzer.currentTapCount).toBe(0)
  }, 30_000)

  // The chart title names the file being played, and still names it when the file ends; a new sequence or
  // a Cancel mid-playback clears it. Mirrors Swift playingFileName (chartTitle: playingFileName ??
  // loadedMeasurementName ?? "New").
  it('a played file is named while it plays and after it ends; a new sequence clears the name', async () => {
    const reg = oracle.filePlayback['REG-G1']
    const wav = loadWav(reg.fixture)
    const analyzer = new TapToneAnalyzer()
    analyzer.measurementType = 'generic'
    const engine = new RealtimeFFTAnalyzer({ onAudioFrame: (s, db, t) => analyzer.processAudioFrame(s, db, t) })
    engine.initForTesting()
    analyzer.setDevice(engine)
    const playing = analyzer.playFile(wav.samples, wav.sampleRate, null, 'Recording 5')
    expect(analyzer.getSnapshot().playingFileName, 'named while it plays').toBe('Recording 5')
    await playing
    expect(analyzer.getSnapshot().playingFileName, 'still named when it ends').toBe('Recording 5')
    analyzer.requestStartTapSequence()
    expect(analyzer.getSnapshot().playingFileName, 'a new sequence clears it').toBeNull()
  }, 20_000)


  // A result made from a played file is saved with the file's provenance: the calibration it was played
  // with (or none), the file's sample rate, and no microphone — the microphone that recorded a file is
  // unknown. A new sequence listens to the input again, and saves the input's. Twins of Swift's cases.
  const VIEW = { minHz: 100, maxHz: 1200, minDb: -100, maxDb: 0 }

  it('a save after a playback records the file provenance and an unknown microphone', async () => {
    const reg = oracle.filePlayback['REG-B1']
    const analyzer = await playMaterial(reg, true)
    expect(analyzer.materialTapPhase, 'precondition: the brace completed').toBe('complete')
    const m = analyzer.buildMeasurement('', '', VIEW)
    expect(m, 'a measurement to save').not.toBeNull()
    expect(m!.microphoneName, 'the microphone is unknown').toBeUndefined()
    expect(m!.microphoneUID).toBeUndefined()
    expect(m!.calibrationName, "the file's calibration").toBe(loadCal(reg.calibration)!.name)
    expect(m!.sampleRate, "the file's sample rate").toBe(loadWav(reg.fixture).sampleRate)
    expect(m!.selectedLongitudinalPeakID, "fL's role, read by the save").toBe(analyzer.selectedLongitudinalPeak!.id)
  }, 30_000)

  it('a loaded measurement reports its recorded provenance, and a re-save keeps it', async () => {
    // A played-file result built with an unknown microphone and the file's calibration and rate.
    const reg = oracle.filePlayback['REG-B1']
    const source = await playMaterial(reg, true)
    const saved = source.buildMeasurement('', '', VIEW)!

    // Loaded by an analyzer whose input has no calibration: the loaded result reports the file's.
    const sut = new TapToneAnalyzer()
    const engine = new RealtimeFFTAnalyzer({ onAudioFrame: (s, db, t) => sut.processAudioFrame(s, db, t) })
    engine.initForTesting()
    sut.setDevice(engine)
    sut.loadMeasurement(saved)
    expect(sut.resultProvenance, 'a loaded result has provenance').not.toBeNull()
    expect(sut.captureMicrophoneName, 'the microphone is unknown').toBeUndefined()
    expect(sut.captureCalibrationName, 'the recorded calibration').toBe(saved.calibrationName)
    expect(sut.captureSampleRate, 'the recorded sample rate').toBe(saved.sampleRate)

    sut.measurementType = 'brace' // App applies the loaded measurement's type (loadedSettings)
    const reSaved = sut.buildMeasurement('', '', VIEW)!
    expect(reSaved.microphoneName, 'a re-save keeps the unknown microphone').toBeUndefined()
    expect(reSaved.calibrationName, 'and the recorded calibration').toBe(saved.calibrationName)
    expect(reSaved.sampleRate, 'and the recorded sample rate').toBe(saved.sampleRate)
  }, 30_000)

  it('a new sequence after a playback saves the input provenance', async () => {
    const reg = oracle.filePlayback['REG-G1']
    const input = loadCal(oracle.filePlayback['REG-B1'].calibration)
    const analyzer = new TapToneAnalyzer()
    analyzer.measurementType = 'generic'
    const engine = new RealtimeFFTAnalyzer({ onAudioFrame: (s, db, t) => analyzer.processAudioFrame(s, db, t) })
    engine.initForTesting()
    analyzer.setDevice(engine)
    engine.setCalibration(input)
    const wav = loadWav(reg.fixture)
    await analyzer.playFile(wav.samples, wav.sampleRate, null)
    expect(analyzer.captureCalibrationName, 'precondition: the file played uncalibrated').toBeUndefined()

    analyzer.startTapSequence({ arm: false })
    expect(analyzer.captureCalibrationName, "the input's calibration again").toBe(input!.name)
  }, 30_000)

  // A file plays with the calibration given for it, or with none: the microphone it was recorded with
  // is unknown, so the live input's calibration never applies to it. The input's calibration is back
  // once playback ends. Twins of Swift's playback-calibration cases.
  async function playbackCalibrations(input: Calibration | null, calibration: Calibration | null) {
    const reg = oracle.filePlayback['REG-G1']
    const wav = loadWav(reg.fixture)
    const analyzer = new TapToneAnalyzer()
    analyzer.measurementType = 'generic'
    const engine = new RealtimeFFTAnalyzer({ onAudioFrame: (s, db, t) => analyzer.processAudioFrame(s, db, t) })
    engine.initForTesting()
    analyzer.setDevice(engine)
    engine.setCalibration(input)
    const playing = analyzer.playFile(wav.samples, wav.sampleRate, calibration)
    const during = engine.activeCalibration
    await playing
    return { during, after: engine.activeCalibration }
  }

  it('playback without a calibration file is uncalibrated, and the input calibration returns', async () => {
    const input = loadCal(oracle.filePlayback['REG-B1'].calibration)
    const { during, after } = await playbackCalibrations(input, null)
    expect(during, 'no calibration file → uncalibrated').toBeNull()
    expect(after, "the input's calibration is restored after playback").toBe(input)
  }, 20_000)

  it('playback with a calibration file uses it, and the input calibration returns', async () => {
    const fileCalibration = loadCal(oracle.filePlayback['REG-B1'].calibration)
    const { during, after } = await playbackCalibrations(null, fileCalibration)
    expect(during, "the file's calibration is applied").toBe(fileCalibration)
    expect(after, "the input's (absent) calibration is restored after playback").toBeNull()
  }, 20_000)
})
