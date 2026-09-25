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
import { RealtimeFFTAnalyzer, type MaterialCaptureResult } from '../src/audio/realtimeFFTAnalyzer'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import { DEFAULT_SETTINGS } from '../src/settings'
import { modePeaksFromSpectrum } from '../src/dsp/guitarFFT'
import {
  loadCal,
  loadWav,
  oracle,
  playGuitar,
  playMaterial,
  type PeakRef,
  type RegSettings,
} from './parityRunner'

// End-to-end regression of the FULL audio chain through the SAME engine.playFile path the app
// uses — WAV → chunk pacing → RMS → level-crossing tap detection → gated/guitar FFT → peak
// selection / mode classification → (material) auto-advanced phase machine. The web mirror of
// Swift's FilePlaybackRegressionTests (TapToneAnalyzer.forTesting() + playFileForTesting): same
// fixtures, same parity-oracle.json values, same ±1 tolerances. `initForTesting()` runs the engine
// headlessly (no AudioContext/mic).
//
// PLAYBACK IS REAL-TIME PACED (`pace: true`, the default) — deliberately, and it must stay that way.
// Swift and Python pace their playback in real time (`Thread.sleep` / `time.sleep(chunk_duration)`).
// The web used to run `pace: false` (as fast as it could), which made it the ONLY platform not running
// the same thing — and anything wall-clock-dependent (the detection warm-up, which is what establishes
// the noise floor for plate/brace) could not be exercised here at all. Running un-paced silently skipped
// the detection path live users take. See GuitarTapWeb/Development/OUT-4-DETECTION-SPEC.md.
//
// The cost is real (~90 s of fixture audio) and accepted: it is the price of the three platforms
// actually running the same code path. Tests carry explicit timeouts sized to their fixture.

// playGuitar/playMaterial live in parityRunner.ts, shared with the self-baseline mint and the
// zero-tolerance regression check. The parity assertions below and that baseline are therefore
// measurements of the same code — a separate copy here could drift, and the drift would be
// invisible precisely where it matters.
const TOL = oracle.tolerances as { freqHz: number; magDb: number; q: number }

describe('G11 — file playback through the live engine (parity REG-*)', () => {
  it('REG-G1: generic-guitar single tap → Air/Top/Back match the oracle', async () => {
    const reg = oracle.filePlayback['REG-G1']
    const cap = await playGuitar(reg)
    expect(cap, 'no capture emitted').not.toBeNull()
    const peaks = modePeaksFromSpectrum(cap!.spectrum, {
      peakMinThreshold: reg.settings.peakMinThreshold,
      guitarType: 'generic',
    })
    for (const exp of reg.peaks as PeakRef[]) {
      const p = peaks[exp.role as 'air' | 'top' | 'back']
      expect(p, `${exp.role} peak not found`).toBeDefined()
      expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
    }
  }, 20_000)

  it('REG-G2: generic-guitar 8 taps → 8 captured + averaged Air/Top/Back', async () => {
    const reg = oracle.filePlayback['REG-G2']
    const cap = await playGuitar(reg)
    expect(cap, 'no capture emitted').not.toBeNull()
    expect(cap!.taps?.length).toBe(reg.settings.numberOfTaps) // 8 per-tap spectra
    const peaks = modePeaksFromSpectrum(cap!.spectrum, {
      peakMinThreshold: reg.settings.peakMinThreshold,
      guitarType: 'generic',
    })
    for (const exp of reg.averagedPeaks as PeakRef[]) {
      const p = peaks[exp.role as 'air' | 'top' | 'back']
      expect(p, `averaged ${exp.role} peak not found`).toBeDefined()
      expect(Math.abs(p!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(p!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
    }
  }, 60_000)

  // Per-tap Air/Top/Back for all 8 taps, from the oracle's REG-G2.perTap. These used to be a
  // hand-copied transcript of the Swift constants sitting in this file; the oracle carries them
  // now, so a change in Swift arrives here through sync-oracle.sh instead of through retyping.
  // Taps 1 and 7 pin Back at ~296.5 Hz rather than ~240.6 — real selection behaviour on this
  // fixture, pinned deliberately (see _perTapNote in the oracle).
  it('REG-G2: each of the 8 taps → Air/Top/Back match the oracle', async () => {
    const reg = oracle.filePlayback['REG-G2']
    const perTap = reg.perTap as { tap: number; peaks: PeakRef[] }[]
    const cap = await playGuitar(reg)
    expect(cap!.taps?.length).toBe(perTap.length)
    cap!.taps!.forEach((tapSpectrum, i) => {
      const modes = modePeaksFromSpectrum(tapSpectrum, {
        peakMinThreshold: reg.settings.peakMinThreshold,
        guitarType: 'generic',
      })
      for (const role of ['air', 'top', 'back'] as const) {
        const want = perTap[i]!.peaks.find((pk) => pk.role === role)!
        const got = modes[role]
        expect(got, `tap ${i + 1} ${role}`).toBeDefined()
        expect(Math.abs(got!.frequency - want.frequency), `tap ${i + 1} ${role} freq`).toBeLessThan(
          TOL.freqHz,
        )
        expect(Math.abs(got!.magnitude - want.magnitude), `tap ${i + 1} ${role} mag`).toBeLessThan(
          TOL.magDb,
        )
      }
    })
  }, 60_000)

  // REG-B2 — the brace counterpart to REG-P2: three taps, averaged. Captured live 2026-09-19 to
  // close the gap that let a claimed 2 dB Swift/Python divergence sit unexamined for two months
  // (project issue #5): REG-P2 pinned PLATE multi-tap and REG-B1 is single-tap brace, so brace
  // averaging was exercised by nothing. Deliberately harder than the other material fixtures — the
  // UMIK-1 is on its 18 dB gain path, so the peak sits at -65.5 dB against a -63.9 dB threshold.
  // The peak must come off the AVERAGED spectrum, not the last tap: the three taps differ by ~6 dB,
  // so a regression to last-tap selection lands well outside the bar rather than hiding inside it.
  it('REG-B2: brace session, 3 taps → fL off the averaged spectrum', async () => {
    const reg = oracle.filePlayback['REG-B2']
    const caps = await playMaterial(reg, true)
    expect(caps.length).toBe(1)
    const cap = caps.find((c) => c.phase === 'longitudinal')!
    expect(cap?.peak, 'no fL peak').toBeTruthy()
    const exp = reg.peaks[0] as PeakRef
    expect(Math.abs(cap.peak!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
    expect(Math.abs(cap.peak!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
    expect(Math.abs(cap.peak!.quality - exp.q!)).toBeLessThan(TOL.q)
  }, 30_000)

  it('REG-B1: brace session → fL via the engine material session', async () => {
    const reg = oracle.filePlayback['REG-B1']
    const caps = await playMaterial(reg, true)
    expect(caps.length).toBe(1)
    const cap = caps.find((c) => c.phase === 'longitudinal')!
    expect(cap?.peak, 'no fL peak').toBeTruthy()
    const exp = reg.peaks[0] as PeakRef
    expect(Math.abs(cap.peak!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
    expect(Math.abs(cap.peak!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
    expect(Math.abs(cap.peak!.quality - exp.q!)).toBeLessThan(TOL.q)
  }, 30_000)

  it('REG-P1: plate full session → fL/fC/fLC via the engine auto-advancing phases', async () => {
    const reg = oracle.filePlayback['REG-P1']
    const caps = await playMaterial(reg, false)
    // The engine should auto-advance through all three phases and emit one capture each.
    expect(caps.length).toBe(3)
    for (const exp of reg.peaks as PeakRef[]) {
      const cap = caps.find((c) => c.phase === exp.role)
      expect(cap, `phase ${exp.role} not captured`).toBeDefined()
      expect(cap!.peak, `${exp.role} peak null`).toBeTruthy()
      expect(Math.abs(cap!.peak!.frequency - exp.frequency)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(cap!.peak!.magnitude - exp.magnitude)).toBeLessThan(TOL.magDb)
      expect(Math.abs(cap!.peak!.quality - exp.q!)).toBeLessThan(TOL.q)
    }
  }, 90_000)

  // ── OUT-4: the one test that can tell the two detection models apart ────────────────────────────
  //
  // Swift/Python detect material taps against an EMA-tracked noise floor; the web uses a fixed
  // absolute dBFS threshold. The relative rule reduces to
  //     rising = max(tapDetectionThreshold, noiseFloor + 10 dB)
  // so the two are the SAME FUNCTION until the floor climbs within 10 dB of the threshold. Every other
  // fixture sits at -64..-69 dBFS, far below that — which is why no test has ever separated them.
  //
  // This fixture is the clean plate session with its noise floor raised to -52 dBFS (above the -53.34
  // threshold). At that floor the ABSOLUTE detector SATURATES: the level never falls below the
  // FALLING threshold, so the hysteresis latch never clears, nothing ever counts, and NO tap is
  // confirmed — it captures nothing. The RELATIVE detector floats its threshold to floor+10 = -42 and still catches every tap
  // (they peak at -24..-27 dBFS chunk-RMS). That is exactly the failure the relative model exists to
  // prevent: "keeps detection working when ambient noise is elevated".
  //
  // Assert the PHASE COUNT, not peak values: the added noise sums into the gated FFT, so fL/fC/fLC
  // shift slightly. A tight peak assertion here would be measuring the noise, not the detector. The
  // clean fixtures keep the strict peak assertions.
  //
  // Regenerate the fixture with `python3 tooling/make-noisy-fixture.py` (deterministic, seeded).
  // Full analysis: Development/OUT-4-DETECTION-SPEC.md
  it('OUT-4: noisy plate (floor -52 dBFS) → relative noise-floor detection still captures all 3 phases', async () => {
    const reg = oracle.filePlayback['REG-P1']
    const caps = await playMaterial({ ...reg, fixture: 'plate-umik-1-noisy-52.wav' }, false)
    expect(
      caps.length,
      'absolute-threshold detection saturates on an elevated noise floor and captures nothing; ' +
        'the noise-floor-relative detector still finds all three taps',
    ).toBe(3)
  }, 90_000)
})

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
  engine.setCalibration(loadCal(reg.calibration))
  analyzer.setDevice(engine)
  // The analyzer owns detection and therefore the session's start and finish (#17 F30).
  analyzer.startTapSequence({ skipWarmup: true })
  await engine.playFile(wav.samples, wav.sampleRate, { calibration: loadCal(reg.calibration) })
  const sessions = dumped.map((d) => ({ samples: d.samples, rate: d.rate, label: d.label.replace(/^session_/, '') }))
  return { wav, sessions }
}

describe('G11 — continuous session recording (6f)', () => {
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
})
// 6k: multi-tap averaging per MATERIAL phase. plate-umik-1-web-mac-3-taps.wav is a 3-taps-per-phase
// plate session recorded by the web app (Chrome, UMIK-1). Replaying it at numberOfTaps=3 averages each
// phase (L/C/FLC) and finds the dominant peak ON THE AVERAGED spectrum — exactly as guitar multi-tap
// does. Expected values are the averaged-spectrum peaks (the web app's saved .guitartap, same
// recording). NB: Swift/Python historically read material peaks off the LAST tap (a buildAllPeaks
// UUID-hack side-effect) — a latent bug fixed alongside this so all three read the averaged peak.
describe('G11 — multi-tap averaging per material phase (6k)', () => {
  const reg = oracle.filePlayback['REG-P2']
  // REG-P2 pins magnitudes tighter than the generic tolerance, and says so in the oracle:
  // the averaged values are deterministic across editions, so they agree far more closely
  // than a single tap would. 0.5 dB still leaves headroom for FFT-library differences while
  // reliably catching a regression to last-tap selection (masked deltas: fL 0.94, fC 0.81,
  // fLC 2.62 dB).
  const P2_MAG_TOL: number = reg.tolerances?.magDb ?? TOL.magDb

  it('REG-P2: averages numberOfTaps per phase → one capture/phase, matches the canonical baseline', async () => {
    const caps = await playMaterial(reg, false)
    expect(caps.length).toBe(3) // ONE averaged capture per phase (not per tap)
    for (const phase of ['longitudinal', 'cross', 'flc'] as const) {
      const cap = caps.find((c) => c.phase === phase)
      expect(cap?.peak, `phase ${phase} not captured`).toBeTruthy()
      const want = (reg.peaks as PeakRef[]).find((pk) => pk.role === phase)!
      expect(Math.abs(cap!.peak!.frequency - want.frequency), `${phase} freq`).toBeLessThan(
        TOL.freqHz,
      )
      expect(Math.abs(cap!.peak!.magnitude - want.magnitude), `${phase} mag`).toBeLessThan(
        P2_MAG_TOL,
      )
      expect(Math.abs(cap!.peak!.quality - want.q!), `${phase} Q`).toBeLessThan(TOL.q)
    }
  }, 120_000)
})
