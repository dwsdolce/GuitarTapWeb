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
