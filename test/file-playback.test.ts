// @parity test/file-playback
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { AudioEngine, type MaterialCaptureResult } from '../src/audio/engine'
import { decodeWav } from '../src/dsp/wav'
import { parseCalibration, type Calibration } from '../src/dsp/calibration'
import { modePeaksFromSpectrum, type Spectrum } from '../src/dsp/guitarFFT'

// End-to-end regression of the FULL audio chain through the SAME engine.playFile path the app
// uses — WAV → chunk pacing → RMS → level-crossing tap detection → gated/guitar FFT → peak
// selection / mode classification → (material) auto-advanced phase machine. The web mirror of
// Swift's FilePlaybackRegressionTests (TapToneAnalyzer.forTesting() + playFileForTesting): same
// fixtures, same parity-oracle.json values, same ±1 tolerances. `initForTesting()` runs the engine
// headlessly (no AudioContext/mic) and `pace:false` runs the chunk pump synchronously.

const oracle = JSON.parse(
  readFileSync(new URL('./fixtures/parity-oracle.json', import.meta.url), 'utf8'),
)
const TOL = oracle.tolerances as { freqHz: number; magDb: number; q: number }

// Always downmix to mono (matches Swift readAudioFileAsMonoFloat32 + the mono live-mic path); a
// no-op for already-mono files. Guitar fixtures are stereo, material fixtures are mono.
function loadWav(name: string) {
  return decodeWav(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))), {
    downmix: true,
  })
}
function loadCal(name: string | null): Calibration | null {
  if (!name) return null
  return parseCalibration(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'), name)
}

interface RegSettings {
  peakMinThreshold?: number
  tapDetectionThreshold: number
  numberOfTaps?: number
  measureFlc?: boolean
}
interface PeakRef {
  role: 'air' | 'top' | 'back' | 'longitudinal' | 'cross' | 'flc'
  frequency: number
  magnitude: number
  q?: number
}

/** Run a guitar recording through engine.playFile (headless) → averaged spectrum + per-tap spectra. */
async function playGuitar(
  reg: { fixture: string; calibration: string | null; settings: RegSettings },
): Promise<{ spectrum: Spectrum; taps?: Spectrum[] } | null> {
  const wav = loadWav(reg.fixture)
  let captured: { spectrum: Spectrum; taps?: Spectrum[] } | null = null
  const engine = new AudioEngine(
    { onCapture: (spectrum, taps) => (captured = { spectrum, taps }) },
    { tapDetectionThreshold: reg.settings.tapDetectionThreshold, numberOfTaps: reg.settings.numberOfTaps ?? 1 },
  )
  engine.initForTesting()
  await engine.playFile(wav.samples, wav.sampleRate, { calibration: loadCal(reg.calibration), pace: false })
  return captured
}

/** Run a plate/brace session through engine.playFile (headless) → one capture per phase (the engine
 *  auto-advances L→C→FLC). */
async function playMaterial(
  reg: { fixture: string; calibration: string | null; settings: RegSettings },
  brace: boolean,
) {
  const wav = loadWav(reg.fixture)
  const caps: MaterialCaptureResult[] = []
  const engine = new AudioEngine(
    { onMaterialCapture: (r) => caps.push(r) },
    { tapDetectionThreshold: reg.settings.tapDetectionThreshold, numberOfTaps: reg.settings.numberOfTaps ?? 1 },
  )
  engine.initForTesting()
  await engine.playFile(wav.samples, wav.sampleRate, {
    material: { brace, measureFlc: reg.settings.measureFlc ?? false, calibration: loadCal(reg.calibration) },
    pace: false,
  })
  return caps
}

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
  })

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
  })

  // Per-tap Air/Top/Back for all 8 taps. The web parity-oracle.json carries only averagedPeaks for
  // REG-G2, so these references are the hardcoded values from Swift FilePlaybackRegressionTests
  // (guitarPerTap) — [airFreq, airMag, topFreq, topMag, backFreq, backMag] per tap.
  it('REG-G2: each of the 8 taps → Air/Top/Back match the Swift references', async () => {
    const reg = oracle.filePlayback['REG-G2']
    const perTap: [number, number, number, number, number, number][] = [
      [87.20365, -46.083164, 164.15787, -37.15723, 296.5797, -57.117817],
      [87.22049, -43.714653, 163.98953, -34.96168, 240.6308, -54.930405],
      [87.21567, -44.400375, 164.00642, -36.064285, 240.54478, -56.384575],
      [87.23355, -43.930878, 164.02281, -34.72927, 240.58727, -55.048416],
      [87.23911, -44.447514, 164.09766, -36.650166, 240.52957, -54.569893],
      [87.258545, -44.08946, 164.05678, -34.239933, 240.63478, -54.847008],
      [87.2434, -43.969948, 164.05476, -33.775253, 296.5151, -54.0257],
      [87.24372, -44.523045, 164.0366, -34.412136, 240.49031, -54.849174],
    ]
    const cap = await playGuitar(reg)
    expect(cap!.taps?.length).toBe(perTap.length)
    cap!.taps!.forEach((tapSpectrum, i) => {
      const modes = modePeaksFromSpectrum(tapSpectrum, {
        peakMinThreshold: reg.settings.peakMinThreshold,
        guitarType: 'generic',
      })
      const [airF, airM, topF, topM, backF, backM] = perTap[i]!
      expect(modes.air, `tap ${i + 1} Air`).toBeDefined()
      expect(Math.abs(modes.air!.frequency - airF)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(modes.air!.magnitude - airM)).toBeLessThan(TOL.magDb)
      expect(modes.top, `tap ${i + 1} Top`).toBeDefined()
      expect(Math.abs(modes.top!.frequency - topF)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(modes.top!.magnitude - topM)).toBeLessThan(TOL.magDb)
      expect(modes.back, `tap ${i + 1} Back`).toBeDefined()
      expect(Math.abs(modes.back!.frequency - backF)).toBeLessThan(TOL.freqHz)
      expect(Math.abs(modes.back!.magnitude - backM)).toBeLessThan(TOL.magDb)
    })
  })

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
  })

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
  })
})

// 6f: continuous session recording (Swift finishSessionRecording). When the dump-capture diagnostic
// is on, a guitar measurement emits ONE session WAV labeled "Guitar_<n>tap" covering every chunk that
// flowed through the pipeline (arm → final tap). Off (default), nothing is buffered or emitted.
async function playGuitarSession(
  reg: { fixture: string; calibration: string | null; settings: RegSettings },
  dumpCaptureAudio: boolean,
): Promise<{ wav: { samples: Float32Array; sampleRate: number }; sessions: { samples: Float32Array; rate: number; label: string }[] }> {
  const wav = loadWav(reg.fixture)
  const sessions: { samples: Float32Array; rate: number; label: string }[] = []
  const engine = new AudioEngine(
    { onSessionAudio: (samples, rate, label) => sessions.push({ samples, rate, label }) },
    {
      tapDetectionThreshold: reg.settings.tapDetectionThreshold,
      numberOfTaps: reg.settings.numberOfTaps ?? 1,
      dumpCaptureAudio,
    },
  )
  engine.initForTesting()
  await engine.playFile(wav.samples, wav.sampleRate, { calibration: loadCal(reg.calibration), pace: false })
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
  })

  it('REG-G2 multi-tap: session labeled by the tap count (Guitar_8tap)', async () => {
    const { sessions } = await playGuitarSession(oracle.filePlayback['REG-G2'], true)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.label).toBe('Guitar_8tap')
  })

  it('dump off (default): no session WAV is emitted or buffered', async () => {
    const { sessions } = await playGuitarSession(oracle.filePlayback['REG-G1'], false)
    expect(sessions).toHaveLength(0)
  })
})
// 6k: multi-tap averaging per MATERIAL phase. plate-umik-1-web-mac-3-taps.wav is a 3-taps-per-phase
// plate session recorded by the web app (Chrome, UMIK-1). Replaying it at numberOfTaps=3 averages each
// phase (L/C/FLC) and finds the dominant peak ON THE AVERAGED spectrum — exactly as guitar multi-tap
// does. Expected values are the averaged-spectrum peaks (the web app's saved .guitartap, same
// recording). NB: Swift/Python historically read material peaks off the LAST tap (a buildAllPeaks
// UUID-hack side-effect) — a latent bug fixed alongside this so all three read the averaged peak.
describe('G11 — multi-tap averaging per material phase (6k)', () => {
  const reg = {
    fixture: 'plate-umik-1-web-mac-3-taps.wav',
    calibration: '7108913.txt',
    settings: { tapDetectionThreshold: -40, numberOfTaps: 3, measureFlc: true },
  }
  // [frequency Hz, magnitude dB, Q] — peaks read off the AVERAGED spectrum per phase.
  const EXPECTED = {
    longitudinal: [68.2587, -71.5858, 15.667],
    cross: [117.4681, -56.5436, 26.667],
    flc: [35.3011, -63.6008, 6.0],
  } as const
  // Tighter than the generic magDb tolerance: the averaged values are deterministic
  // across platforms, so they agree far more closely than a single tap. 0.5 dB still
  // leaves headroom for FFT-library differences while reliably catching a regression
  // to last-tap selection (the masked deltas were fL 0.94, fC 0.81, fLC 2.62 dB).
  const P2_MAG_TOL = 0.5

  it('REG-P2: averages numberOfTaps per phase → one capture/phase, matches the canonical baseline', async () => {
    const caps = await playMaterial(reg, false)
    expect(caps.length).toBe(3) // ONE averaged capture per phase (not per tap)
    for (const phase of ['longitudinal', 'cross', 'flc'] as const) {
      const cap = caps.find((c) => c.phase === phase)
      expect(cap?.peak, `phase ${phase} not captured`).toBeTruthy()
      const [ef, em, eq] = EXPECTED[phase]
      expect(Math.abs(cap!.peak!.frequency - ef), `${phase} freq`).toBeLessThan(TOL.freqHz)
      expect(Math.abs(cap!.peak!.magnitude - em), `${phase} mag`).toBeLessThan(P2_MAG_TOL)
      expect(Math.abs(cap!.peak!.quality - eq), `${phase} Q`).toBeLessThan(TOL.q)
    }
  })
})
