// @parity test/analysis-quality
import { describe, it, expect } from 'vitest'
import {
  decayQuality,
  decayQualityColor,
  tapToneRatioQuality,
  tapToneRatioQualityColor,
} from '../src/dsp/analysisQuality'

// Reference boundaries from the canonical Swift Float.decayQuality(for:) /
// tapToneRatioQuality and GuitarType.decayThresholds — pinned so the PDF report's
// analysis labels stay in lock-step with the native apps.

describe('decayQuality — classical thresholds (0.15 / 0.35 / 0.60 / 1.0)', () => {
  const cases: [number, string][] = [
    [0.1, 'Very Short'],
    [0.15, 'Short'], // boundary is inclusive of the upper tier (Swift `case veryShort..<short`)
    [0.34, 'Short'],
    [0.35, 'Moderate'],
    [0.59, 'Moderate'],
    [0.6, 'Good'],
    [0.99, 'Good'],
    [1.0, 'Excellent'],
    [2.0, 'Excellent'],
  ]
  for (const [v, label] of cases) {
    it(`${v}s → ${label}`, () => expect(decayQuality(v, 'classical')).toBe(label))
  }
})

describe('decayQuality — flamenco shorter thresholds (0.08 / 0.20 / 0.35 / 0.55)', () => {
  it('0.5s is Good for flamenco but Moderate for classical', () => {
    expect(decayQuality(0.5, 'flamenco')).toBe('Good')
    expect(decayQuality(0.5, 'classical')).toBe('Moderate')
  })
})

describe('decayQualityColor', () => {
  it('progresses gray → orange → yellow → green → blue', () => {
    expect(decayQualityColor(0.05, 'classical')).toBe('#8a8a8e')
    expect(decayQualityColor(0.2, 'classical')).toBe('#e08a00')
    expect(decayQualityColor(0.4, 'classical')).toBe('#c0a000')
    expect(decayQualityColor(0.7, 'classical')).toBe('#2c9c3c')
    expect(decayQualityColor(1.5, 'classical')).toBe('#0a6cd8')
  })
})

describe('tapToneRatioQuality (target 1.9–2.1)', () => {
  const cases: [number, string][] = [
    [1.5, 'Low'],
    [1.7, 'Below Target'],
    [1.85, 'Below Target'],
    [1.9, 'Ideal'],
    [2.0, 'Ideal'],
    [2.1, 'Ideal'],
    [2.2, 'Above Target'],
    [2.3, 'High'],
  ]
  for (const [v, label] of cases) {
    it(`${v} → ${label}`, () => expect(tapToneRatioQuality(v)).toBe(label))
  }
  it('colors: ideal green, near-ideal orange, out-of-range red', () => {
    expect(tapToneRatioQualityColor(2.0)).toBe('#2c9c3c')
    expect(tapToneRatioQualityColor(1.8)).toBe('#e08a00')
    expect(tapToneRatioQualityColor(2.5)).toBe('#d83a30')
  })
})

// The tap-tone ratio VALUE moved to the definitive resolver (analyzer.tapToneRatio /
// measurementTapToneRatio); its tests live in test/annotation-state + test/measurement-codable. This
// file keeps only the qualitative label/color mapping that the PDF report reads.