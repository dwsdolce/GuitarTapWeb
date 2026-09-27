// @parity test/file-playback
import { describe, it, expect, vi } from 'vitest'

// The analyzer writes the session WAV itself (Swift's shape); in Node there is no download, so the
// writer is mocked and the calls collected.
const dumped: { samples: Float32Array; rate: number; label: string }[] = []
vi.mock('../src/measurement/dumpWav', () => ({
  dumpCaptureWav: (samples: Float32Array, rate: number, label: string) => {
    dumped.push({ samples, rate, label })
  },
}))
import { RealtimeFFTAnalyzer } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Calibration } from '../src/dsp/calibration'
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
// flowed through the pipeline (arm → final tap). Off (default), nothing is buffered or emitted.
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

// The cases run in Swift's order (FilePlaybackRegressionTests), then the session-recording cases.
describe('G11 — file playback through the live engine (parity REG-*)', () => {
  // REG-B2 — the brace counterpart to REG-P2: three taps, averaged. REG-P2 pins PLATE multi-tap and
  // REG-B1 is single-tap brace, so this is the case that exercises brace averaging. Deliberately
  // harder than the other material fixtures — the UMIK-1 is on its 18 dB gain path, so the peak sits
  // at -65.5 dB against a -63.9 dB threshold.
  // The peak must come off the AVERAGED spectrum, not the last tap: the three taps differ by ~6 dB,
  // so a regression to last-tap selection lands well outside the bar rather than hiding inside it.
  it('REG-B2: brace session, 3 taps → fL off the averaged spectrum', async () => {
    const reg = oracle.filePlayback['REG-B2']
    const a = await playMaterial(reg, true)
    expect(a.materialTapPhase, 'materialTapPhase').toBe('complete')
    expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
    const p = a.selectedLongitudinalPeak
    expect(p, 'the fL peak should be identified').not.toBeNull()
    const exp = reg.peaks[0] as PeakRef
    expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThanOrEqual(TOL.freqHz)
    expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThanOrEqual(TOL.magDb)
    expect(Math.abs(p!.quality - exp.q!)).toBeLessThanOrEqual(TOL.q)
  }, 30_000)

  it('REG-B1: brace session → fL', async () => {
    const reg = oracle.filePlayback['REG-B1']
    const a = await playMaterial(reg, true)
    expect(a.materialTapPhase, 'materialTapPhase').toBe('complete')
    expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
    const p = a.selectedLongitudinalPeak
    expect(p, 'the fL peak should be identified').not.toBeNull()
    const exp = reg.peaks[0] as PeakRef
    expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThanOrEqual(TOL.freqHz)
    expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThanOrEqual(TOL.magDb)
    expect(Math.abs(p!.quality - exp.q!)).toBeLessThanOrEqual(TOL.q)
  }, 30_000)

  it('REG-G1: generic-guitar single tap → Air/Top/Back match the oracle', async () => {
    const reg = oracle.filePlayback['REG-G1']
    const a = await playGuitar(reg)
    expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
    expect(a.capturedTaps.length, 'one captured tap').toBe(1)
    // getPeak — the same API the Results panel uses (Swift getPeak(for:)).
    for (const exp of reg.peaks as PeakRef[]) {
      const p = a.getPeak(exp.role as 'air' | 'top' | 'back')
      expect(p, `${exp.role} peak not found`).toBeDefined()
      expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThanOrEqual(TOL.freqHz)
      expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThanOrEqual(TOL.magDb)
    }
  }, 20_000)

  // REG-G ring-out: Recording 5.wav's post-tap level decays to peak−15 dB, on the audio clock. The REG-G1
  // playback; the value is the oracle's, shared by all three editions.
  it('REG-G: generic-guitar ring-out matches the oracle', async () => {
    const reg = oracle.filePlayback['REG-G1']
    const a = await playGuitar(reg)
    expect(a.currentDecayTime, 'no ring-out measured').not.toBeNull()
    expect(Math.abs(a.currentDecayTime! - reg.ringOutSec!)).toBeLessThanOrEqual(oracle.tolerances.ringOutSec)
  }, 20_000)

  // REG-G2: 8 taps — the averaged Air/Top/Back (getPeak, the Results panel) and each tap's Air/Top/Back
  // (TapEntry.resolvedModePeaks, the multi-tap view), in one case as in Swift/Python. The per-tap values
  // come from the oracle's REG-G2.perTap (a change in Swift arrives through sync-oracle.sh). Taps 1 and 7
  // pin Back at ~296.5 Hz rather than ~240.6 — real selection behaviour on this fixture, pinned
  // deliberately (see _perTapNote in the oracle).
  it('REG-G2: generic-guitar 8 taps → averaged and per-tap Air/Top/Back match the oracle', async () => {
    const reg = oracle.filePlayback['REG-G2']
    const perTap = reg.perTap as { tap: number; peaks: PeakRef[] }[]
    const a = await playGuitar(reg)
    expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
    expect(a.tapEntries.length).toBe(reg.settings.numberOfTaps) // 8 per-tap entries
    for (const exp of reg.averagedPeaks as PeakRef[]) {
      const p = a.getPeak(exp.role as 'air' | 'top' | 'back')
      expect(p, `averaged ${exp.role} peak not found`).toBeDefined()
      expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThanOrEqual(TOL.freqHz)
      expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThanOrEqual(TOL.magDb)
    }
    a.tapEntries.forEach((entry, i) => {
      const modes = entry.resolvedModePeaks()
      for (const role of ['air', 'top', 'back'] as const) {
        const want = perTap[i]!.peaks.find((pk) => pk.role === role)!
        const got = modes.get(role)
        expect(got, `tap ${i + 1} ${role}`).toBeDefined()
        expect(Math.abs(got!.frequency - want.frequency), `tap ${i + 1} ${role} freq`).toBeLessThanOrEqual(TOL.freqHz)
        expect(Math.abs(got!.magnitude - want.magnitude), `tap ${i + 1} ${role} mag`).toBeLessThanOrEqual(TOL.magDb)
      }
    })
  }, 60_000)

  it('REG-P1: plate full session → fL/fC/fLC via the analyzer auto-advancing phases', async () => {
    const reg = oracle.filePlayback['REG-P1']
    const a = await playMaterial(reg, false)
    expect(a.materialTapPhase, 'materialTapPhase').toBe('complete')
    expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
    for (const exp of reg.peaks as PeakRef[]) {
      const p = identifiedPeak(a, exp.role)
      expect(p, `the ${exp.role} peak should be identified`).not.toBeNull()
      expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThanOrEqual(TOL.freqHz)
      expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThanOrEqual(TOL.magDb)
      expect(Math.abs(p!.quality - exp.q!)).toBeLessThanOrEqual(TOL.q)
    }
  }, 90_000)

  // ── OUT-4: the one test that can tell the two detection models apart ────────────────────────────
  //
  // All three editions detect material taps against an EMA-tracked noise floor, not a fixed absolute
  // dBFS threshold. The relative rule reduces to
  //     rising = max(tapDetectionThreshold, noiseFloor + 10 dB)
  // so the two are the SAME FUNCTION until the floor climbs within 10 dB of the threshold. Every other
  // fixture sits at -64..-69 dBFS, far below that, so no other test separates them.
  //
  // This fixture is the clean plate session with its noise floor raised to -52 dBFS (above the -53.34
  // threshold). At that floor an ABSOLUTE detector would SATURATE: the level never falls below the
  // FALLING threshold, so the hysteresis latch never clears, nothing ever counts, and NO tap is
  // confirmed — it captures nothing. The RELATIVE detector floats its threshold to floor+10 = -42 and
  // still catches every tap (they peak at -24..-27 dBFS chunk-RMS). That is exactly the failure the relative model exists to
  // prevent: "keeps detection working when ambient noise is elevated".
  //
  // Assert the PHASE COUNT, not peak values: the added noise sums into the gated FFT, so fL/fC/fLC
  // shift slightly. A tight peak assertion here would be measuring the noise, not the detector. The
  // clean fixtures keep the strict peak assertions.
  //
  // Regenerate the fixture with `python3 tooling/make-noisy-fixture.py` (deterministic, seeded).
  it('OUT-4: noisy plate (floor -52 dBFS) → relative noise-floor detection still captures all 3 phases', async () => {
    const reg = oracle.filePlayback['REG-P1']
    const a = await playMaterial({ ...reg, fixture: 'plate-umik-1-noisy-52.wav' }, false)
    const captured = [a.matSpectra.longitudinal, a.matSpectra.cross, a.matSpectra.flc].filter((sp) => sp != null)
    expect(
      captured.length,
      'absolute-threshold detection saturates on an elevated noise floor and captures nothing; ' +
        'the noise-floor-relative detector still finds all three taps',
    ).toBe(3)
    // The floor must have CONVERGED to the noisy ambient — pinned near its start, the relative model would
    // have silently degraded to the absolute one and this would pass for the wrong reason.
    expect(a.noiseFloorEstimate, 'noiseFloorEstimate converged to the ~-52 dBFS floor').toBeGreaterThan(-60)
    expect(a.noiseFloorEstimate, 'noiseFloorEstimate converged to the ~-52 dBFS floor').toBeLessThan(-40)
  }, 90_000)

  // 6k: multi-tap averaging per MATERIAL phase. plate-umik-1-web-mac-3-taps.wav is a 3-taps-per-phase
  // plate session recorded by the web app (Chrome, UMIK-1). Replaying it at numberOfTaps=3 averages each
  // phase (L/C/FLC) and finds the dominant peak ON THE AVERAGED spectrum — exactly as guitar multi-tap
  // does. The expected values are the oracle's, as for every case.
  it('REG-P2: averages numberOfTaps per phase → one capture/phase, matches the canonical baseline', async () => {
    const reg = oracle.filePlayback['REG-P2']
    const a = await playMaterial(reg, false)
    expect(a.materialTapPhase, 'materialTapPhase').toBe('complete')
    expect(a.isMeasurementComplete, 'isMeasurementComplete').toBe(true)
    for (const phase of ['longitudinal', 'cross', 'flc'] as const) {
      const p = identifiedPeak(a, phase)
      expect(p, `the ${phase} peak should be identified`).not.toBeNull()
      const want = (reg.peaks as PeakRef[]).find((pk) => pk.role === phase)!
      expect(Math.abs(p!.frequency - want.frequency), `${phase} freq`).toBeLessThanOrEqual(TOL.freqHz)
      expect(Math.abs(p!.magnitude - want.magnitude), `${phase} mag`).toBeLessThanOrEqual(TOL.magDb)
      expect(Math.abs(p!.quality - want.q!), `${phase} Q`).toBeLessThanOrEqual(TOL.q)
    }
  }, 120_000)

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

  it('Cancel during a playback clears the file name', async () => {
    const { analyzer } = await stopPlaybackAfterFirstTap((a) => a.cancelTapSequence())
    expect(analyzer.getSnapshot().playingFileName).toBeNull()
  }, 30_000)

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
