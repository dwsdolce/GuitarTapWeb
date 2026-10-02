// @parity test/settings-store
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  defaultMinFrequency,
  defaultMaxFrequency,
  minFrequency,
  maxFrequency,
  setMinFrequency,
  setMaxFrequency,
  validateFrequencyRange,
  validateMagnitudeRange,
  type Settings,
} from '../src/settings'
import { FieldPrecision } from '../src/precision'
import { enteredValue } from '../src/presentation/displayRange'

// The per-measurement-type display frequency range store: each type has its own default and its
// own stored minimum and maximum, a bound never stored reads the default, a stored bound keeps its exact
// value at Swift's Float precision (Save Current View comes back as saved; an untouched Settings field
// never rounds it), and an entered range is validated before it is stored.

const fresh = (): Settings => ({ ...DEFAULT_SETTINGS, displayRanges: {} })

describe('settings-store — per-type display frequency range', () => {
  it('per-type defaults match the canonical values', () => {
    for (const t of ['generic', 'acoustic', 'classical', 'flamenco'] as const) {
      expect(defaultMinFrequency(t)).toBe(75)
      expect(defaultMaxFrequency(t)).toBe(350)
    }
    expect(defaultMinFrequency('plate')).toBe(20)
    expect(defaultMaxFrequency('plate')).toBe(200)
    expect(defaultMinFrequency('brace')).toBe(30)
    expect(defaultMaxFrequency('brace')).toBe(1000)
  })

  it('a type with nothing stored reads its default', () => {
    const s = fresh()
    expect(minFrequency(s, 'flamenco')).toBe(75)
    expect(maxFrequency(s, 'flamenco')).toBe(350)
  })

  it('a stored range reads back', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 15, 'plate') }
    s = { ...s, ...setMaxFrequency(s, 180, 'plate') }
    expect(minFrequency(s, 'plate')).toBe(15)
    expect(maxFrequency(s, 'plate')).toBe(180)
  })

  it('storing one type does not change another', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 18, 'plate') }
    s = { ...s, ...setMinFrequency(s, 40, 'brace') }
    expect(minFrequency(s, 'plate')).toBe(18)
    expect(minFrequency(s, 'brace')).toBe(40)
  })

  it('storing one bound leaves the other', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 15, 'plate') }
    s = { ...s, ...setMaxFrequency(s, 250, 'plate') }
    expect(minFrequency(s, 'plate')).toBe(15)
    expect(maxFrequency(s, 'plate')).toBe(250)
  })

  it('a stored range keeps its exact value', () => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 15.37, 'plate') }
    s = { ...s, ...setMaxFrequency(s, 180.43, 'plate') }
    // Exactly, at Swift's Float precision.
    expect(minFrequency(s, 'plate')).toBe(Math.fround(15.37))
    expect(maxFrequency(s, 'plate')).toBe(Math.fround(180.43))
  })

  it('a Settings range field left untouched keeps the exact stored value', () => {
    const shown = FieldPrecision.string(23.37, FieldPrecision.frequencyHz) // "23"
    expect(enteredValue(shown, 23.37, FieldPrecision.frequencyHz)).toBe(23.37)
  })

  it('a Settings range field edited is the number typed', () => {
    expect(enteredValue('30', 23.37, FieldPrecision.frequencyHz)).toBe(30)
  })

  it('a Settings range field that is not a number is null', () => {
    expect(enteredValue('abc', 23.37, FieldPrecision.frequencyHz)).toBeNull()
  })
})

describe('settings-store — an entered range is validated: each bound clamped, at least 10 apart, else the saved range', () => {
  const t = 'generic' as const
  const withSaved = (): Settings => {
    let s = fresh()
    s = { ...s, ...setMinFrequency(s, 100, t) }
    s = { ...s, ...setMaxFrequency(s, 8000, t) }
    return { ...s, minDb: -100, maxDb: -10 }
  }

  it('frequency range: valid is unchanged', () => {
    expect(validateFrequencyRange(fresh(), 200, 3000, t)).toEqual({ minHz: 200, maxHz: 3000 })
  })
  it('frequency range: below 1 Hz is clamped', () => {
    expect(validateFrequencyRange(fresh(), 0, 3000, t)).toEqual({ minHz: 1, maxHz: 3000 })
  })
  it('frequency range: above 5 kHz is clamped', () => {
    expect(validateFrequencyRange(fresh(), 200, 6000, t)).toEqual({ minHz: 200, maxHz: 5000 })
  })
  it('frequency range: inverted reads the saved range', () => {
    expect(validateFrequencyRange(withSaved(), 5000, 200, t)).toEqual({ minHz: 100, maxHz: 8000 })
  })
  it('frequency range: too narrow reads the saved range', () => {
    expect(validateFrequencyRange(withSaved(), 1000, 1005, t)).toEqual({ minHz: 100, maxHz: 8000 })
  })
  it('frequency range: exactly 10 Hz apart is accepted', () => {
    expect(validateFrequencyRange(fresh(), 100, 110, t)).toEqual({ minHz: 100, maxHz: 110 })
  })
  it('magnitude range: valid is unchanged', () => {
    expect(validateMagnitudeRange(fresh(), -80, -20)).toEqual({ minDb: -80, maxDb: -20 })
  })
  it('magnitude range: below -120 dB is clamped', () => {
    expect(validateMagnitudeRange(fresh(), -150, -20)).toEqual({ minDb: -120, maxDb: -20 })
  })
  it('magnitude range: above 20 dB is clamped', () => {
    expect(validateMagnitudeRange(fresh(), -80, 50)).toEqual({ minDb: -80, maxDb: 20 })
  })
  it('magnitude range: inverted reads the saved range', () => {
    expect(validateMagnitudeRange(withSaved(), -20, -80)).toEqual({ minDb: -100, maxDb: -10 })
  })
  it('magnitude range: too narrow reads the saved range', () => {
    expect(validateMagnitudeRange(withSaved(), -50, -45)).toEqual({ minDb: -100, maxDb: -10 })
  })
  it('magnitude range: exactly 10 dB apart is accepted', () => {
    expect(validateMagnitudeRange(fresh(), -60, -50)).toEqual({ minDb: -60, maxDb: -50 })
  })
})

