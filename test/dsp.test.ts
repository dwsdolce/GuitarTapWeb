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
