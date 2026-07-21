// @parity test/classify
import { describe, it, expect } from 'vitest'
import { classifySingle, classifyAll, getPeak } from '../src/dsp/classify'
import type { Peak } from '../src/dsp/peaks'

const peak = (id: number, frequency: number, magnitude: number): Peak => ({
  id,
  frequency,
  magnitude,
  quality: 0,
  bandwidth: 0,
})

describe('G4c — flamenco classification', () => {
  // PARITY GAP closed 2026-07-19: Swift (GuitarModeTests) and Python (test_guitar_mode)
  // both covered flamenco here; the web did not, which is why it alone showed no failure
  // when the flamenco bands were corrected. See section 7c of
  // Development/PEAK-FINDING-DUPLICATE-PEAKS.md.
  //
  // Corrected bands: top 180–220, back 200–250 (overlapping on 200–220). The old bands were
  // top 190–250 / back 180–240 — the back range sitting BELOW the top range, so Back sorted
  // first, classifyAll's "Back above Top" guard never fired, and flamenco inverted Top/Back.

  it('185 Hz is in top only', () => {
    expect(classifySingle(185, 'flamenco')).toBe('top')
  })

  it('240 Hz is in back only (above the 200–220 overlap)', () => {
    expect(classifySingle(240, 'flamenco')).toBe('back')
  })

  it('the 200–220 overlap resolves to top by lookup order', () => {
    // classifySingle is the naive first-match lookup; classifyAll is what disambiguates.
    expect(classifySingle(210, 'flamenco')).toBe('top')
  })

  it('REGRESSION — top is claimed below back', () => {
    // Two peaks straddling the overlap must resolve Top-below-Back, as on every other
    // guitar type. Under the old inverted bands the STRONGEST peak was labelled back.
    const low = peak(0, 190, -40) // strongest
    const high = peak(1, 230, -50)
    const m = classifyAll([low, high], 'flamenco')
    expect(m.get(0)).toBe('top')
    expect(m.get(1)).toBe('back')
  })

  it('matches the other guitar types on identical input', () => {
    // The inversion showed up as flamenco disagreeing with classical and generic on the
    // same two peaks. They must now agree.
    const peaks = [peak(0, 200, -40), peak(1, 230, -50)]
    for (const gt of ['flamenco', 'classical', 'generic'] as const) {
      const m = classifyAll(peaks, gt)
      expect(m.get(0), `${gt} top`).toBe('top')
      expect(m.get(1), `${gt} back`).toBe('back')
    }
  })
})

describe('G4c — mode classification (Top/Back overlap)', () => {
  it('classifySingle resolves the first containing band (Top before Back)', () => {
    // Generic: Top 140–260, Back 180–300 overlap on 180–260.
    expect(classifySingle(95, 'generic')).toBe('air')
    expect(classifySingle(250, 'generic')).toBe('top') // overlap → Top wins (naive)
    expect(classifySingle(290, 'generic')).toBe('back') // above Top band
    expect(classifySingle(1000, 'generic')).toBe('upper')
    expect(classifySingle(40, 'generic')).toBe('unknown')
  })

  it('classifyAll disambiguates the overlap: a peak above the claimed Top goes to Back', () => {
    const peaks = [peak(0, 95, -30), peak(1, 190, -25), peak(2, 250, -35)]
    const m = classifyAll(peaks, 'generic')
    expect(m.get(0)).toBe('air')
    expect(m.get(1)).toBe('top') // strongest in Top band
    expect(m.get(2)).toBe('back') // in the overlap but above claimed Top → Back (not Top)
    expect(getPeak(peaks, 'back', 'generic')?.frequency).toBe(250)
    expect(getPeak(peaks, 'top', 'generic')?.frequency).toBe(190)
  })

  it('claims the strongest peak per band', () => {
    const peaks = [peak(0, 200, -40), peak(1, 205, -20)] // both in Top band
    expect(getPeak(peaks, 'top', 'generic')?.frequency).toBe(205) // louder one
  })
})
