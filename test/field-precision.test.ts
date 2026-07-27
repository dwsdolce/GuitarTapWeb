// @parity test/field-precision
import { describe, it, expect } from 'vitest'
import { FieldPrecision } from '../src/precision'

// Mirror of Swift FieldPrecisionTests / Python test_field_precision.py. Pins the numeric-precision
// single source of truth: the per-field decimal table, the restrict-on-entry predicate
// (decimalsWithin), half-away-from-zero rounding (rounded), and display formatting (string). Keep
// these cases identical across the three editions.

describe('FieldPrecision — precision table', () => {
  it('matches the canonical per-field decimal counts', () => {
    expect(FieldPrecision.linearDimensionMM).toBe(2)
    expect(FieldPrecision.massG).toBe(1)
    expect(FieldPrecision.bodyDimensionMM).toBe(0)
    expect(FieldPrecision.frequencyHz).toBe(0)
    expect(FieldPrecision.magnitudeDB).toBe(0)
    expect(FieldPrecision.stiffness).toBe(0)
    expect(FieldPrecision.peakFrequencyHz).toBe(1)
    expect(FieldPrecision.peakMagnitudeDB).toBe(1)
    expect(FieldPrecision.qFactor).toBe(1)
    expect(FieldPrecision.youngsModulusGPa).toBe(2)
    expect(FieldPrecision.speedOfSoundMS).toBe(0)
    expect(FieldPrecision.densityGPerCm3).toBe(3)
    expect(FieldPrecision.decayRatio).toBe(2)
  })
})

describe('FieldPrecision.decimalsWithin — restrict-on-entry predicate', () => {
  it('accepts entries within precision', () => {
    expect(FieldPrecision.decimalsWithin('29.35', 2)).toBe(true)
    expect(FieldPrecision.decimalsWithin('29.3', 2)).toBe(true)
    expect(FieldPrecision.decimalsWithin('29', 2)).toBe(true)
  })
  it('rejects entries over precision', () => {
    expect(FieldPrecision.decimalsWithin('29.356', 2)).toBe(false)
    expect(FieldPrecision.decimalsWithin('29.35', 1)).toBe(false)
  })
  it('accepts a trailing dot while typing', () => {
    expect(FieldPrecision.decimalsWithin('29.', 2)).toBe(true)
  })
  it('rejects the decimal point entirely at zero decimals', () => {
    expect(FieldPrecision.decimalsWithin('495.', 0)).toBe(false)
    expect(FieldPrecision.decimalsWithin('495.5', 0)).toBe(false)
    expect(FieldPrecision.decimalsWithin('495', 0)).toBe(true)
  })
  it('accepts in-progress empty and minus', () => {
    expect(FieldPrecision.decimalsWithin('', 2)).toBe(true)
    expect(FieldPrecision.decimalsWithin('-', 2)).toBe(true)
    expect(FieldPrecision.decimalsWithin('', 0)).toBe(true)
    expect(FieldPrecision.decimalsWithin('-', 0)).toBe(true)
  })
  it('accepts negative values', () => {
    expect(FieldPrecision.decimalsWithin('-45', 0)).toBe(true)
    expect(FieldPrecision.decimalsWithin('-45.5', 1)).toBe(true)
    expect(FieldPrecision.decimalsWithin('-45.55', 1)).toBe(false)
  })
  it('rejects non-numeric input', () => {
    expect(FieldPrecision.decimalsWithin('4a', 0)).toBe(false)
    expect(FieldPrecision.decimalsWithin('abc', 2)).toBe(false)
    expect(FieldPrecision.decimalsWithin('2..5', 2)).toBe(false)
  })
})

describe('FieldPrecision.rounded — half away from zero', () => {
  it('rounds a half away from zero', () => {
    expect(FieldPrecision.rounded(2.5, 0)).toBe(3)
    expect(FieldPrecision.rounded(0.5, 0)).toBe(1)
    expect(FieldPrecision.rounded(-2.5, 0)).toBe(-3)
    expect(FieldPrecision.rounded(-0.5, 0)).toBe(-1)
  })
  it('rounds to the field precision', () => {
    expect(FieldPrecision.rounded(29.356, 2)).toBeCloseTo(29.36, 5)
    expect(FieldPrecision.rounded(29.354, 2)).toBeCloseTo(29.35, 5)
    expect(FieldPrecision.rounded(29.35, 2)).toBeCloseTo(29.35, 5)
  })
  it('rounds negatives away from zero', () => {
    expect(FieldPrecision.rounded(-29.356, 2)).toBeCloseTo(-29.36, 5)
  })
})

describe('FieldPrecision.string — display formatting', () => {
  it('formats at the field precision', () => {
    expect(FieldPrecision.string(29.4, 2)).toBe('29.40')
    expect(FieldPrecision.string(29, 0)).toBe('29')
    expect(FieldPrecision.string(-100, 0)).toBe('-100')
    expect(FieldPrecision.string(2.5, 1)).toBe('2.5')
  })
  it('rounds for display', () => {
    expect(FieldPrecision.string(2.678, 2)).toBe('2.68')
  })
})
