// @parity test/frozen-peak-recalc
//
// Port of FrozenPeakRecalculationTests.swift / test_frozen_peak_recalculation.py.
//
// SCOPE (2026-07-12): this covers the ENGINE half the web analyzer owns after the 3c
// consolidation — `TapToneAnalyzer.recalculatePeaks` (Swift `recalculateFrozenPeaksIfNeeded`):
// the frozen-spectrum findPeaks path, the loaded-measurement threshold filter (loaded peaks are
// authoritative — filtered, never re-analysed), the live-spectrum path, and the material guard.
// That is the canonical PR-A1..A5 integration set + PR2 threshold filter.
//
// The selection / mode-override / annotation-offset remapping-by-frequency (Swift PR1/PR3–PR7,
// `applyFrozenPeakState`) is NOT covered here: that subsystem still lives in the VIEW (`useAnnotations`)
// on the web. Moving it onto the analyzer is **P3** (RESTRUCTURE-NOTES.md "Peak-selection & annotation
// ownership → analyzer"); the PR1/PR3–PR7 tests are appended to this suite when P3 lands. These
// PR-A/PR2 assertions test stable peak-computation behavior and are unaffected by P3.
import { describe, it, expect } from 'vitest'
import { TapToneAnalyzer } from '../src/state/tapToneAnalyzer'
import type { Peak } from '../src/dsp/peaks'
import type { Spectrum } from '../src/dsp/guitarFFT'

// A Gaussian bump (downward parabola in dB) on a noise floor — same helper as peaks.test.ts /
// the Swift makeGaussianSpectrum / Python _make_spectrum_with_peak.
function makeSpectrum(peakHz: number, peakDB = -20, halfWidthHz = 5, binCount = 2048, sampleRate = 48000, floor = -100) {
  const binWidth = sampleRate / 2 / (binCount - 1)
  const sigma = halfWidthHz / 2.355
  const mags = new Array<number>(binCount)
  const freqs = new Array<number>(binCount)
  for (let i = 0; i < binCount; i++) {
    const f = i * binWidth
    freqs[i] = f
    const d = f - peakHz
    mags[i] = Math.max(floor, peakDB + (-d * d) / (2 * sigma * sigma))
  }
  return { mags, freqs }
}
const combine = (a: { mags: number[]; freqs: number[] }, b: { mags: number[]; freqs: number[] }) => ({
  mags: a.mags.map((v, i) => Math.max(v, b.mags[i]!)),
  freqs: a.freqs,
})
const peak = (frequency: number, magnitude: number, id = frequency): Peak => ({ id, frequency, magnitude, quality: 0, bandwidth: 0 })
const near = (peaks: Peak[], hz: number, tol = 20) => peaks.some((p) => Math.abs(p.frequency - hz) < tol)

/** Drive recalculatePeaks with sensible defaults (guitar, generic, 80–1200 Hz, threshold -60). */
function recalc(a: TapToneAnalyzer, over: Partial<Parameters<TapToneAnalyzer['recalculatePeaks']>[0]> = {}) {
  a.recalculatePeaks({
    material: false,
    loadedPeaks: null,
    liveSpectrum: null,
    guitarType: 'generic',
    minHz: 80,
    maxHz: 1200,
    peakMin: -60,
    ...over,
  })
}
function frozen(a: TapToneAnalyzer, mags: number[], freqs: number[]) {
  a.frozenMagnitudes = mags
  a.frozenFrequencies = freqs
  a.isMeasurementComplete = true
}

describe('frozen-peak-recalc — recalculatePeaks integration (PR-A1..A5)', () => {
  it('PR-A1: frozen-spectrum path detects a known peak', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    frozen(a, mags, freqs)
    recalc(a)
    expect(a.peaks.length).toBeGreaterThanOrEqual(1)
    expect(near(a.peaks, 200)).toBe(true)
  })

  it('PR-A2: raising the threshold removes a weak peak on recalc', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -50)
    frozen(a, mags, freqs)
    recalc(a, { peakMin: -60 })
    expect(near(a.peaks, 200)).toBe(true)
    recalc(a, { peakMin: -40 })
    expect(near(a.peaks, 200)).toBe(false)
  })

  it('PR-A3: loaded-measurement path filters by threshold', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400]) // non-empty frozen (matches Swift guard); loaded path ignores it
    recalc(a, { loadedPeaks: [peak(200, -25), peak(400, -65)], peakMin: -60 })
    expect(a.peaks).toHaveLength(1)
    expect(near(a.peaks, 200, 1)).toBe(true)
  })

  it('PR-A4: all loaded peaks below threshold → empty', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [100, 200, 400], [100, 200, 400])
    recalc(a, { loadedPeaks: [peak(200, -70), peak(400, -65)], peakMin: -60 })
    expect(a.peaks).toHaveLength(0)
  })

  it('PR-A5: empty frozen magnitudes → no peaks (no crash)', () => {
    const a = new TapToneAnalyzer()
    frozen(a, [], [])
    expect(() => recalc(a)).not.toThrow()
    expect(a.peaks).toHaveLength(0)
  })
})

describe('frozen-peak-recalc — loaded peaks are authoritative (PR2c) + live/material paths', () => {
  it('PR2c: the loaded path returns saved peaks, does NOT re-analyse the frozen spectrum', () => {
    const a = new TapToneAnalyzer()
    frozen(a, new Array(512).fill(-100), Array.from({ length: 512 }, (_, i) => i * 47)) // flat → findPeaks would find nothing
    recalc(a, { loadedPeaks: [peak(300, -25)], peakMin: -80 })
    expect(near(a.peaks, 300, 1)).toBe(true) // survives — proves the saved peak is used, not the flat spectrum
  })

  it('PR2 (two peaks): raising the threshold drops the weaker of two frozen peaks', () => {
    const a = new TapToneAnalyzer()
    const s = combine(makeSpectrum(200, -20), makeSpectrum(400, -55))
    frozen(a, s.mags, s.freqs)
    recalc(a, { peakMin: -60 })
    expect(near(a.peaks, 200)).toBe(true)
    expect(near(a.peaks, 400)).toBe(true)
    recalc(a, { peakMin: -40 })
    expect(near(a.peaks, 200)).toBe(true) // strong survives
    expect(near(a.peaks, 400)).toBe(false) // weak dropped
  })

  it('live-spectrum path: peaks track the live spectrum while not complete (Swift analyzeMagnitudes / P1b)', () => {
    const a = new TapToneAnalyzer() // not complete, no frozen data
    const { mags, freqs } = makeSpectrum(200, -20)
    const live: Spectrum = { magnitudesDb: mags, frequencies: freqs }
    recalc(a, { liveSpectrum: live })
    expect(near(a.peaks, 200)).toBe(true)
  })

  it('material mode yields no guitar peaks (material uses matPeaks)', () => {
    const a = new TapToneAnalyzer()
    const { mags, freqs } = makeSpectrum(200, -20)
    recalc(a, { material: true, liveSpectrum: { magnitudesDb: mags, frequencies: freqs }, loadedPeaks: [peak(200, -20)] })
    expect(a.peaks).toHaveLength(0)
  })
})