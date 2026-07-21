// @parity test/peaks
import { describe, it, expect } from 'vitest'
import { findPeaks, removeDuplicatePeaks, type Peak } from '../src/dsp/peaks'
import { averageSpectra } from '../src/dsp/spectrumAverage'
import { classifyAll, resolvedModePeaks } from '../src/dsp/classify'
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

// ---------------------------------------------------------------------------
// Duplicate-peak regression  (D1, D2, D4)
//
// Development/PEAK-FINDING-DUPLICATE-PEAKS.md.
//
// findPeaks must never return two peaks for one spectral feature. It did: the
// per-mode scan visited a bin once per overlapping mode range, minting a fresh id
// each time, and the final assembly reconciled two independently deduplicated
// lists **by id** — so the twin survived.
//
// Authored against the UNFIXED code; expected to fail until detection stops being
// interleaved with classification.
// ---------------------------------------------------------------------------

const PEAK_PROXIMITY_HZ = 2

/** D1 — the uniqueness invariant. */
function expectNoDuplicatePeaks(peaks: Peak[], label: string): void {
  const offenders: string[] = []
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const delta = Math.abs(peaks[i]!.frequency - peaks[j]!.frequency)
      if (delta < PEAK_PROXIMITY_HZ) {
        offenders.push(
          `${peaks[i]!.frequency.toFixed(5)} Hz @ ${peaks[i]!.magnitude.toFixed(2)} dB and ` +
            `${peaks[j]!.frequency.toFixed(5)} Hz @ ${peaks[j]!.magnitude.toFixed(2)} dB ` +
            `(${delta.toFixed(5)} apart)`,
        )
      }
    }
  }
  expect(offenders, `${label}: findPeaks must return one peak per spectral feature`).toEqual([])
}

describe('D — duplicate-peak regression', () => {
  // Generic ranges: Top 140–260 Hz, Back 180–300 Hz — overlapping at 180–260.
  // Every duplicate observed in the field sits in that band.
  //
  // Resolution matters. The suite's default 2048-bin spectrum has a ~11.7 Hz bin
  // width, so the ±5-bin local-max window spans ±58 Hz and two peaks 7 Hz apart can
  // never both be detected. Real captures use 32768 bins (±3.7 Hz), which is why the
  // field data shows adjacent overlap peaks the synthetic suite could not produce.
  // Do NOT "simplify" binCount back to the default — it disarms the test.
  //
  // The weak peak must be far enough from the Back winner to survive as its own local
  // maximum. An earlier version placed it at 232 Hz with halfWidth 8, where the 240 Hz
  // peak's tail reaches -52.8 dB and buries a -56 dB peak entirely — so the spectrum only
  // ever held TWO features, and `length === 3` passed only because the duplicate made up
  // the number. That assertion would have masked the fix.
  function overlapSpectrum() {
    const bins = 32768
    const top = makeSpectrum(195, -40, 4, bins) // Top winner
    const weak = makeSpectrum(210, -56, 4, bins) // overlap, loser
    const back = makeSpectrum(240, -50, 4, bins) // overlap, Back winner
    return combine(combine(top, weak), back)
  }

  const opts = { guitarType: 'generic' as const, peakMinThreshold: -60, minHz: 30, maxHz: 2000 }

  it('D2 — overlap zone returns one peak per spectral feature', () => {
    const { mags, freqs } = overlapSpectrum()
    const peaks = findPeaks(mags, freqs, opts)

    expectNoDuplicatePeaks(peaks, 'Top/Back overlap')
    expect(peaks.length, `got ${peaks.map((x) => x.frequency.toFixed(2)).join(', ')}`).toBe(3)
  })

  it('D2b — overlap zone still classifies Top and Back correctly', () => {
    const { mags, freqs } = overlapSpectrum()
    const peaks = findPeaks(mags, freqs, opts)
    const modeMap = classifyAll(peaks, 'generic')

    const top = peaks.find((x) => modeMap.get(x.id) === 'top')
    const back = peaks.find((x) => modeMap.get(x.id) === 'back')

    expect(top, 'no Top peak identified').toBeDefined()
    expect(back, 'no Back peak identified').toBeDefined()
    expect(Math.abs(top!.frequency - 195)).toBeLessThan(5)
    expect(Math.abs(back!.frequency - 240)).toBeLessThan(5)
  })

  it('D1 — three distinct tones contain no duplicates', () => {
    const p1 = makeSpectrum(400, -20, 15)
    const p2 = makeSpectrum(700, -22, 15)
    const p3 = makeSpectrum(1000, -25, 15)
    const { mags, freqs } = combine(combine(p1, p2), p3)

    expectNoDuplicatePeaks(
      findPeaks(mags, freqs, { peakMinThreshold: -60, minHz: 50, maxHz: 2000 }),
      'three distinct tones',
    )
  })

  it('D4 — winner invariants hold on the overlap spectrum', () => {
    const { mags, freqs } = overlapSpectrum()
    const peaks = findPeaks(mags, freqs, opts)
    const modeMap = classifyAll(peaks, 'generic')
    const winners = resolvedModePeaks(peaks, 'generic')

    // At most one peak per named mode is SELECTED.
    //
    // Note this counts *selected* peaks, not *labelled* ones. classifyAll deliberately
    // labels additional peaks: an unclaimed peak above the claimed Top and inside the Back
    // range resolves to 'back' too, so several peaks can carry the same label while only one
    // is claimed as that mode's winner. An earlier version asserted at most one *labelled*
    // peak per mode, which is not an invariant of the algorithm — it only appeared to hold
    // because the overlap spectrum had a swamped third peak that was never detected.
    const selectedIds = new Set([...winners.values()].map((w) => w.id))
    const perMode = new Map<string, number>()
    for (const pk of peaks) {
      if (!selectedIds.has(pk.id)) continue
      const m = modeMap.get(pk.id)
      if (!m || m === 'unknown') continue
      perMode.set(m, (perMode.get(m) ?? 0) + 1)
    }
    for (const [mode, count] of perMode) {
      expect(count, `${mode} selected ${count} peaks; at most 1 expected`).toBeLessThanOrEqual(1)
    }

    // Back must be strictly above Top.
    const top = peaks.find((x) => modeMap.get(x.id) === 'top')
    const back = peaks.find((x) => modeMap.get(x.id) === 'back')
    if (top && back) expect(back.frequency).toBeGreaterThan(top.frequency)

    // Selection must be a subset of the returned peaks.
    const ids = new Set(peaks.map((x) => x.id))
    for (const w of winners.values()) {
      expect(ids.has(w.id), 'selected peak absent from the peak list').toBe(true)
    }
  })
})
