// @parity test/peaks
import { describe, it, expect } from 'vitest'
import { findPeaks, removeDuplicatePeaks, type Peak } from '../src/dsp/peaks'
import { averageSpectra } from '../src/dsp/spectrumAverage'
import type { Spectrum } from '../src/dsp/guitarFFT'

// Mirrors the Swift makeSpectrum helper: a Gaussian bump (a downward parabola in
// dB) on a noise floor. Because the peak is a true parabola in frequency,
// parabolic interpolation recovers its vertex essentially exactly.
function makeSpectrum(
  peakHz: number,
  peakDB = -20,
  halfWidthHz = 5,
  binCount = 2048,
  sampleRate = 48000,
  noiseFloor = -100,
): { mags: number[]; freqs: number[] } {
  const binWidth = sampleRate / 2 / (binCount - 1)
  const sigma = halfWidthHz / 2.355
  const mags = new Array<number>(binCount)
  const freqs = new Array<number>(binCount)
  for (let i = 0; i < binCount; i++) {
    const f = i * binWidth
    freqs[i] = f
    const d = f - peakHz
    mags[i] = Math.max(noiseFloor, peakDB + (-d * d) / (2 * sigma * sigma))
  }
  return { mags, freqs }
}

function combine(a: { mags: number[]; freqs: number[] }, b: { mags: number[]; freqs: number[] }) {
  return { mags: a.mags.map((v, i) => Math.max(v, b.mags[i]!)), freqs: a.freqs }
}

function p(frequency: number, magnitude: number, id = 0): Peak {
  return { id, frequency, magnitude, quality: 0, bandwidth: 0 }
}

describe('G2 — peak finding', () => {
  it('single pure tone → one peak, vertex recovered to <0.1 Hz', () => {
    const { mags, freqs } = makeSpectrum(1000, -20, 20)
    const peaks = findPeaks(mags, freqs, { minHz: 50, maxHz: 2000, peakMinThreshold: -60 })
    expect(peaks.length).toBeGreaterThanOrEqual(1)
    const closest = peaks.reduce((a, b) =>
      Math.abs(a.frequency - 1000) < Math.abs(b.frequency - 1000) ? a : b,
    )
    expect(Math.abs(closest.frequency - 1000)).toBeLessThan(0.1) // parabola vertex
    expect(Math.abs(closest.magnitude - -20)).toBeLessThan(0.1)
  })

  it('silence spectrum → empty', () => {
    const mags = new Array<number>(1024).fill(-100)
    const freqs = Array.from({ length: 1024 }, (_, i) => i * 23.4375)
    expect(findPeaks(mags, freqs, { minHz: 50, maxHz: 1000, peakMinThreshold: -80 })).toHaveLength(0)
  })

  it('clipped flat spectrum → empty (no strict local max)', () => {
    const mags = new Array<number>(1024).fill(0)
    const freqs = Array.from({ length: 1024 }, (_, i) => i * 23.4375)
    expect(findPeaks(mags, freqs, { minHz: 50, maxHz: 1000, peakMinThreshold: -80 })).toHaveLength(0)
  })

  it('three distinct tones → exactly 3 peaks, each near target', () => {
    let s = combine(makeSpectrum(400, -20, 15), makeSpectrum(700, -22, 15))
    s = combine(s, makeSpectrum(1000, -25, 15))
    const peaks = findPeaks(s.mags, s.freqs, { minHz: 50, maxHz: 2000, peakMinThreshold: -60 })
    expect(peaks).toHaveLength(3)
    for (const target of [400, 700, 1000]) {
      expect(peaks.some((pk) => Math.abs(pk.frequency - target) < 2)).toBe(true)
    }
  })

  it('all below threshold → empty', () => {
    const { mags, freqs } = makeSpectrum(1000, -30, 20)
    expect(findPeaks(mags, freqs, { minHz: 50, maxHz: 2000, peakMinThreshold: -20 })).toHaveLength(0)
  })

  it('dedup keeps higher magnitude within 2 Hz; keeps both when separated', () => {
    expect(removeDuplicatePeaks([p(100.5, -30, 1), p(101.5, -20, 2)])).toEqual([
      p(101.5, -20, 2),
    ])
    expect(removeDuplicatePeaks([p(100, -30, 1), p(110, -20, 2)])).toHaveLength(2)
  })

  it('Q / −3 dB bandwidth computed correctly (exact, hand-checked)', () => {
    // binWidth 10 Hz, peak at bin 35 (350 Hz) = −20 dB, −1 dB per bin falloff.
    // −3 dB at ±3 bins → lower bin 32 (320 Hz), upper bin 38 (380 Hz),
    // bandwidth 60 Hz, Q = 350 / 60 = 5.8333…
    const binCount = 64
    const freqs = Array.from({ length: binCount }, (_, i) => i * 10)
    const mags = Array.from({ length: binCount }, (_, i) => -20 - Math.abs(i - 35))
    const peaks = findPeaks(mags, freqs, { minHz: 50, maxHz: 2000, peakMinThreshold: -60 })
    expect(peaks).toHaveLength(1)
    expect(peaks[0]!.frequency).toBeCloseTo(350, 6)
    expect(peaks[0]!.bandwidth).toBeCloseTo(60, 6)
    expect(peaks[0]!.quality).toBeCloseTo(350 / 60, 4)
  })
})

// Spectrum averaging lives with peak-finding to mirror Swift PeakFindingTests
// (which holds the SpectrumAveraging suite) / Python test_peak_finding.
const spec = (mags: number[]): Spectrum => ({ magnitudesDb: mags, frequencies: mags.map((_, i) => i * 10) })

describe('averageSpectra — power averaging (mirrors Python average_spectra)', () => {
  it('returns a single tap unchanged', () => {
    const s = spec([-10, -20, -30])
    expect(averageSpectra([s])).toBe(s)
  })

  it('averages identical spectra to the same dB', () => {
    const r = averageSpectra([spec([-10, -40]), spec([-10, -40])])
    expect(r.magnitudesDb[0]).toBeCloseTo(-10, 10)
    expect(r.magnitudesDb[1]).toBeCloseTo(-40, 10)
  })

  it('power-averages differing bins: avg(-10,-20) = 10·log10((0.1+0.01)/2)', () => {
    const r = averageSpectra([spec([-10]), spec([-20])])
    const expected = 10 * Math.log10((0.1 + 0.01) / 2) // ≈ -12.596
    expect(r.magnitudesDb[0]).toBeCloseTo(expected, 10)
  })

  it('falls back to the first tap on bin-count mismatch', () => {
    const a = spec([-10, -20])
    const r = averageSpectra([a, spec([-10])])
    expect(r).toBe(a)
  })
})
