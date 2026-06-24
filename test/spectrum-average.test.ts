import { describe, expect, it } from 'vitest'
import { averageSpectra } from '../src/dsp/spectrumAverage'
import type { Spectrum } from '../src/dsp/guitarFFT'

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
