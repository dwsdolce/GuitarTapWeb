// @parity test/analysis-quality
//
// The guitar tap-tone quality helpers: the per-type ring-out (decay) thresholds and their labels and
// colours, the tap-tone-ratio bands, values outside every band, and the pinned palette the colours come
// from (dsp/analysisQuality.ts, decayThresholds in dsp/guitarModes.ts, presentation/palette.ts). Mirrors
// Swift AnalysisQualityTests; the Python suite has the same cases.
import { describe, it, expect } from 'vitest'
import { decayQuality, decayQualityColor, tapToneRatioQuality, tapToneRatioQualityColor } from '../src/dsp/analysisQuality'
import { decayThresholds, type GuitarTypeName } from '../src/dsp/guitarModes'
import { PALETTE } from '../src/presentation/palette'

describe('thresholds', () => {
  it('every guitar type', () => {
    const expected: [GuitarTypeName, number[]][] = [
      ['classical', [0.15, 0.35, 0.6, 1.0]],
      ['flamenco', [0.08, 0.2, 0.35, 0.55]],
      ['acoustic', [0.1, 0.25, 0.45, 0.75]],
      ['generic', [0.1, 0.25, 0.45, 0.75]],
    ]
    for (const [type, values] of expected) {
      const t = decayThresholds(type)
      expect([t.veryShort, t.short, t.moderate, t.good], type).toEqual(values)
    }
  })
})

describe('decay labels', () => {
  it('classical at every boundary', () => {
    const cases: [number, string][] = [
      [0, 'Very Short'], [0.14, 'Very Short'], [0.15, 'Short'], [0.34, 'Short'], [0.35, 'Moderate'],
      [0.59, 'Moderate'], [0.6, 'Good'], [0.99, 'Good'], [1.0, 'Excellent'], [2.0, 'Excellent'],
    ]
    for (const [value, label] of cases) expect(decayQuality(value, 'classical'), String(value)).toBe(label)
  })
  it('each type at its thresholds', () => {
    const labels = ['Short', 'Moderate', 'Good', 'Excellent']
    for (const type of ['flamenco', 'acoustic', 'generic'] as GuitarTypeName[]) {
      const t = decayThresholds(type)
      ;[t.veryShort, t.short, t.moderate, t.good].forEach((threshold, i) =>
        expect(decayQuality(threshold, type), `${type} ${threshold}`).toBe(labels[i]),
      )
      expect(decayQuality(0, type), type).toBe('Very Short')
    }
  })
})

describe('decay colours', () => {
  it('every band', () => {
    const cases: [number, (typeof PALETTE)[keyof typeof PALETTE]][] = [
      [0.1, PALETTE.gray], [0.2, PALETTE.orange], [0.5, PALETTE.yellow], [0.8, PALETTE.green], [1.2, PALETTE.blue],
    ]
    for (const [value, color] of cases) expect(decayQualityColor(value, 'classical'), String(value)).toBe(color)
  })
})

describe('ratio', () => {
  it('labels at every boundary', () => {
    const cases: [number, string][] = [
      [0, 'Low'], [1.69, 'Low'], [1.7, 'Below Target'], [1.89, 'Below Target'], [1.9, 'Ideal'], [2.0, 'Ideal'],
      [2.1, 'Ideal'], [2.2, 'Above Target'], [2.29, 'Above Target'], [2.3, 'High'], [3.0, 'High'],
    ]
    for (const [value, label] of cases) expect(tapToneRatioQuality(value), String(value)).toBe(label)
  })
  it('colours, every band', () => {
    const cases: [number, (typeof PALETTE)[keyof typeof PALETTE]][] = [
      [1.6, PALETTE.red], [1.8, PALETTE.orange], [2.0, PALETTE.green], [2.2, PALETTE.orange], [2.4, PALETTE.red],
    ]
    for (const [value, color] of cases) expect(tapToneRatioQualityColor(value), String(value)).toBe(color)
  })
})

describe('outside every band', () => {
  it('negative or NaN is Unknown and gray', () => {
    for (const value of [-0.1, NaN]) {
      expect(decayQuality(value, 'classical')).toBe('Unknown')
      expect(decayQualityColor(value, 'classical')).toBe(PALETTE.gray)
      expect(tapToneRatioQuality(value)).toBe('Unknown')
      expect(tapToneRatioQualityColor(value)).toBe(PALETTE.gray)
    }
  })
})

describe('palette', () => {
  it('light and dark values', () => {
    expect(PALETTE).toEqual({
      gray: { light: '#8E8E93', dark: '#8E8E93' },
      orange: { light: '#FF9500', dark: '#FF9F0A' },
      yellow: { light: '#FFCC00', dark: '#FFD60A' },
      green: { light: '#34C759', dark: '#30D158' },
      blue: { light: '#007AFF', dark: '#0A84FF' },
      red: { light: '#FF3B30', dark: '#FF453A' },
    })
  })
})
