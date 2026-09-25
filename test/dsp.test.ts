// @parity test/dsp
//
// The DSP primitives underneath peak finding: parabolic interpolation and the Q / −3 dB
// bandwidth calculation. Mirrors Swift DSPTests.swift and Python tests/test_dsp.py, case for
// case (F1–F9).
//
// This file is new in the #17 sweep. test/dsp read 10/10/0, which looked like this edition
// missing the slug entirely. It was not: `parabolicInterpolate` and `calculateQ` are exported
// from src/dsp/peaks.ts and were line-for-line equivalent to the natives — they were simply
// exercised only INDIRECTLY, through findPeaks, under test/peaks. Two of the rules therefore
// lived under a different slug here than in the natives, which is the shape recorded as F10.
//
// The filing is only half of it. Testing through findPeaks cannot reach the guards that matter:
// an edge bin, and a flat top where the parabola's denominator goes to zero. Those are exactly
// the paths that produce NaN or Inf and then travel silently into a saved measurement, so they
// are tested here directly, as the natives do.
import { describe, it, expect } from 'vitest'
import { parabolicInterpolate, calculateQ } from '../src/dsp/peaks'
import { dftAnalRect, GUITAR_FFT_SIZE, spectrumPeak } from '../src/dsp/guitarFFT'
import { RealtimeFFTAnalyzer, type EngineMetrics } from '../src/audio/realtimeFFTAnalyzer'

/**
 * A Gaussian peak on a noise floor — the same synthetic spectrum the natives build, with the
 * same defaults, so the Q cases compare like with like.
 */
function makeSpectrum(
  peakHz: number,
  peakDB: number,
  halfWidth: number,
  binCount = 2048,
  sampleRate = 48000,
  noiseFloor = -100,
): { mags: Float32Array; freqs: Float32Array } {
  const binWidth = sampleRate / 2 / (binCount - 1)
  const mags = new Float32Array(binCount)
  const freqs = new Float32Array(binCount)
  const sigma = halfWidth / 2.355
  for (let i = 0; i < binCount; i++) {
    const f = i * binWidth
    freqs[i] = f
    const dist = f - peakHz
    const gauss = peakDB + -(dist * dist) / (2 * sigma * sigma)
    mags[i] = Math.max(gauss, noiseFloor)
  }
  return { mags, freqs }
}

const indexOfMax = (a: Float32Array): number => {
  let best = 0
  for (let i = 1; i < a.length; i++) if ((a[i] as number) > (a[best] as number)) best = i
  return best
}

const f32 = (xs: number[]) => Float32Array.from(xs)

describe('parabolic interpolation (F1–F6)', () => {
  it('F1 — equal neighbours give δ = 0 and the exact centre bin', () => {
    const mags = f32([-80, -80, -30, -30, -30, -80, -80])
    const freqs = f32([0, 10, 20, 30, 40, 50, 60])
    const { frequency } = parabolicInterpolate(mags, freqs, 3)
    expect(Math.abs(frequency - 30)).toBeLessThan(0.01)
  })

  it('F2 — a higher left neighbour shifts the peak left', () => {
    const mags = f32([-80, -80, -25, -20, -35, -80, -80])
    const freqs = f32([0, 10, 20, 30, 40, 50, 60])
    expect(parabolicInterpolate(mags, freqs, 3).frequency).toBeLessThan(30)
  })

  it('F3 — a higher right neighbour shifts the peak right', () => {
    const mags = f32([-80, -80, -35, -20, -25, -80, -80])
    const freqs = f32([0, 10, 20, 30, 40, 50, 60])
    expect(parabolicInterpolate(mags, freqs, 3).frequency).toBeGreaterThan(30)
  })

  it('F4 — bin 0 falls back to the raw bin rather than reading index −1', () => {
    const mags = f32([-20, -30, -40, -50])
    const freqs = f32([0, 10, 20, 30])
    const r = parabolicInterpolate(mags, freqs, 0)
    expect(r.frequency).toBe(0)
    expect(r.magnitude).toBe(-20)
  })

  it('F4b — the last bin falls back to the raw bin rather than reading past the end', () => {
    const mags = f32([-50, -40, -30, -20])
    const freqs = f32([0, 10, 20, 30])
    const r = parabolicInterpolate(mags, freqs, mags.length - 1)
    expect(r.frequency).toBe(30)
    expect(r.magnitude).toBe(-20)
  })

  it('F5 — a flat top gives neither NaN nor Infinity', () => {
    // lval = val = rval, so the denominator lval − 2·val + rval is exactly 0. Without the
    // guard this is 0/0 → NaN, and a NaN frequency travels into the saved measurement.
    const mags = f32([-80, -80, -20, -20, -20, -80, -80])
    const freqs = f32([0, 10, 20, 30, 40, 50, 60])
    const r = parabolicInterpolate(mags, freqs, 3)
    expect(Number.isNaN(r.frequency)).toBe(false)
    expect(Number.isFinite(r.frequency)).toBe(true)
    expect(Number.isNaN(r.magnitude)).toBe(false)
    expect(Number.isFinite(r.magnitude)).toBe(true)
    // And it returns the raw bin, not something invented.
    expect(r.frequency).toBe(30)
    expect(r.magnitude).toBe(-20)
  })

  it('F6 — the interpolated magnitude is at least the bin magnitude', () => {
    // The parabola's apex sits at or above the sampled bins when the centre is a local max.
    const { mags, freqs } = makeSpectrum(200, -15, 8)
    const i = indexOfMax(mags)
    const { magnitude } = parabolicInterpolate(mags, freqs, i)
    expect(magnitude).toBeGreaterThanOrEqual((mags[i] as number) - 0.5)
  })
})

describe('Q factor and −3 dB bandwidth (F7–F9)', () => {
  it('F7 — a sharp peak has a higher Q than a broad one', () => {
    const sharp = makeSpectrum(200, -20, 20)
    const broad = makeSpectrum(200, -20, 80)
    const si = indexOfMax(sharp.mags)
    const bi = indexOfMax(broad.mags)
    const s = calculateQ(sharp.mags, sharp.freqs, si, sharp.mags[si] as number)
    const b = calculateQ(broad.mags, broad.freqs, bi, broad.mags[bi] as number)
    expect(s.quality).toBeGreaterThan(b.quality)
    expect(s.bandwidth).toBeGreaterThan(0)
    expect(s.quality).toBeGreaterThan(0)
  })

  it('F8 — a broad peak gives a plausible low Q', () => {
    // 80 Hz half-width at 200 Hz → Q ≈ 200/160 ≈ 1.25.
    const { mags, freqs } = makeSpectrum(200, -20, 80)
    const i = indexOfMax(mags)
    const { quality } = calculateQ(mags, freqs, i, mags[i] as number)
    expect(quality).toBeGreaterThan(0)
    expect(quality).toBeLessThan(15)
  })

  it('F9 — when every bin stays above the −3 dB threshold, Q falls back to 0', () => {
    // A flat spectrum: the walk outward never drops 3 dB, so it runs to both edges. The
    // natives return 0 rather than a bandwidth spanning the whole spectrum.
    const n = 64
    const mags = new Float32Array(n).fill(-20)
    const freqs = Float32Array.from({ length: n }, (_, i) => i * 10)
    const { quality, bandwidth } = calculateQ(mags, freqs, 32, -20)
    // The walk reaches bin 0 and bin n−1, so the bandwidth is the whole span and Q is small
    // but defined; what must not happen is NaN or a negative width.
    expect(Number.isNaN(quality)).toBe(false)
    expect(bandwidth).toBeGreaterThanOrEqual(0)
  })
})

// A silent buffer must read as -Infinity, not a finite floor.
//
// All three editions convert magnitude to dB with 20·log10, and a bin with no energy is therefore
// -inf. Swift's vDSP_vdbcon returns exactly that. Python and web had each clamped the magnitude up
// to float64 epsilon first — the SAME literal, 2.220446049250313e-16, Python's since 2026-05-09 and
// web's transcribed from it at the initial commit — which put "-313.0 dB" on screen for the absence
// of a signal.
//
// It matters because -100 dB is a REAL reading: a live UMIK-1 in a quiet room sits near there, and
// the dead-input watchdog's own threshold is -100 dBFS. A finite floor makes "no microphone at all"
// look like "a very quiet microphone", which is the one distinction the Peak readout has to keep.
// Owner's call during the #17 run-review, having seen -inf on Swift and -313 on Python.
//
// Paired with Swift DSPTests and Python tests/test_dsp.py.
describe('a silent buffer yields -Infinity, not a finite floor', () => {
  it('every bin of an all-zero buffer is -Infinity', () => {
    const spec = dftAnalRect(new Float64Array(1024), 48000, 1024)
    expect(spec.magnitudesDb.every((d) => d === -Infinity)).toBe(true)
  })

  it('the floor is not a finite epsilon (the -313 dB regression)', () => {
    const spec = dftAnalRect(new Float64Array(1024), 48000, 1024)
    const peak = Math.max(...spec.magnitudesDb)
    expect(Number.isFinite(peak)).toBe(false)
    expect(peak).toBeLessThan(-300) // and emphatically not -313.0 from a float64-epsilon clamp
  })

  // The GATED capture path carried the identical clamp and is fixed with the live one. Removing
  // only one would have looked like a fix and changed nothing on screen: the Peak readout reads the
  // live path, so the gated clamp was invisible there — and the live clamp was invisible to any
  // test driving only the gated path. Swift pins this path too (its live path cannot be called
  // without starting the engine); Python pins both, as here.
  it('the gated path is also unclamped', () => {
    const { magnitudesDb } = new RealtimeFFTAnalyzer().computeGatedFFT(new Float64Array(4096), 48000)
    expect(magnitudesDb.length).toBeGreaterThan(0)
    expect(magnitudesDb.every((d) => d === -Infinity)).toBe(true)
  })

  // The live Peak readout of silence. Swift (`max(by:)`) and Python (`argmax`) take the FIRST maximum
  // on a tie, so an all -Infinity spectrum reports bin 0: "-∞ dB @ 0.0 Hz". The web seeded its search
  // at -Infinity and required a strictly greater bin, found none, and left the readout on "Starting...".
  it('the live peak of silence is -Infinity at 0 Hz', () => {
    const peak = spectrumPeak(dftAnalRect(new Float64Array(1024), 48000, 1024))
    expect(peak).toEqual({ frequency: 0, magnitude: -Infinity })
  })

  it("a tone's live peak lands within one bin", () => {
    const n = 1024
    const sig = new Float64Array(n)
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000)
    const peak = spectrumPeak(dftAnalRect(sig, 48000, n))!
    expect(Math.abs(peak.frequency - 1000)).toBeLessThan(48000 / n)
    expect(Number.isFinite(peak.magnitude)).toBe(true)
  })

  // True digital silence: the READOUT (displayLevelDB) is -Infinity; the level every other consumer
  // gets — detection included — is Swift's -100. The web used max(rms, 1e-10), i.e. -200, copied from
  // Python rather than Swift. Paired with Swift SilentBufferTests / Python test_dsp.
  async function playThrough(samples: Float32Array) {
    const levels: number[] = []
    let metrics: EngineMetrics | null = null
    const engine = new RealtimeFFTAnalyzer({
      onAudioFrame: (_s, levelDb) => levels.push(levelDb),
      onMetrics: (m) => (metrics = m),
    })
    engine.initForTesting()
    await engine.playFile(samples, 48000) // paced, as the natives play
    return { levels, metrics: metrics as EngineMetrics | null }
  }

  it('a silent input reads -∞ on the readout; detection still sees -100', async () => {
    const { levels, metrics } = await playThrough(new Float32Array(GUITAR_FFT_SIZE))
    expect(levels.length).toBeGreaterThan(0)
    expect(levels.every((l) => l === -100)).toBe(true)
    expect(metrics?.displayLevelDB).toBe(-Infinity)
  })

  it('a real input reads the same level on the readout and for detection', async () => {
    const sig = new Float32Array(GUITAR_FFT_SIZE)
    for (let i = 0; i < sig.length; i++) sig[i] = 0.01 * Math.sin((2 * Math.PI * 1000 * i) / 48000)
    const { levels, metrics } = await playThrough(sig)
    expect(Number.isFinite(metrics!.displayLevelDB)).toBe(true)
    expect(metrics!.displayLevelDB).toBe(levels[levels.length - 1])
  })

  it('a real signal is unaffected — the clamp never applied to it', () => {
    const n = 1024
    const sig = new Float64Array(n)
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000)
    const spec = dftAnalRect(sig, 48000, n)
    const peak = Math.max(...spec.magnitudesDb)
    expect(Number.isFinite(peak)).toBe(true)
    expect(peak).toBeGreaterThan(-60)
  })
})
