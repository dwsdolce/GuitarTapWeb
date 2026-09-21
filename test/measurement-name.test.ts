// @parity test/measurement-name
//
// Pin the required-name rule (FILE-PATHS-AND-NAMES-SPEC §3): a measurement name must be non-empty
// after trimming before Save is allowed, and the stored name is trimmed. Three-way with Swift
// MeasurementNameTests.swift and Python test_measurement_name.py.
import { describe, it, expect } from 'vitest'
import {
  isValidMeasurementName,
  normalizedMeasurementName,
  normalizedMeasurementNotes,
} from '../src/measurement/measurementName'

describe('measurement-name — isValidMeasurementName (what enables Save)', () => {
  it('empty and whitespace are invalid', () => {
    expect(isValidMeasurementName('')).toBe(false)
    expect(isValidMeasurementName('   ')).toBe(false)
    expect(isValidMeasurementName('\t\n ')).toBe(false)
  })

  it('any real text is valid', () => {
    expect(isValidMeasurementName('x')).toBe(true)
    expect(isValidMeasurementName('Martin 000-28')).toBe(true)
    expect(isValidMeasurementName('  padded  ')).toBe(true)
  })
})

describe('measurement-name — normalizedMeasurementName (what gets stored)', () => {
  it('trims, and blanks become undefined', () => {
    expect(normalizedMeasurementName('  Martin 000-28  ')).toBe('Martin 000-28')
    expect(normalizedMeasurementName('Ramírez')).toBe('Ramírez')
    expect(normalizedMeasurementName('')).toBeUndefined()
    expect(normalizedMeasurementName('   ')).toBeUndefined()
  })
})

describe('measurement-name — validity agrees with storage', () => {
  it('valid iff normalized is defined', () => {
    for (const c of ['', '  ', '\n', 'a', '  a  ', 'Spruce Top']) {
      expect(isValidMeasurementName(c)).toBe(normalizedMeasurementName(c) !== undefined)
    }
  })
})
describe('normalizedMeasurementNotes — the other user-entered field', () => {
  it('trims and blanks to undefined, exactly as the name does', () => {
    // Swift stored notes verbatim and Python trimmed in the edit dialog but not on the save path,
    // so the three disagreed on whether retyping whitespace was an edit. See SLUG-SWEEP.md F21.
    expect(normalizedMeasurementNotes('  Tapped cold  ')).toBe('Tapped cold')
    expect(normalizedMeasurementNotes('line one\nline two')).toBe('line one\nline two')
    expect(normalizedMeasurementNotes('')).toBeUndefined()
    expect(normalizedMeasurementNotes('   \n  ')).toBeUndefined()
  })

  it('normalizes identically to the name rule', () => {
    // Or a round trip through one of them looks like an edit.
    for (const c of ['', '  ', '\n', 'a', '  a  ', 'Spruce Top', ' multi word \n']) {
      expect(normalizedMeasurementNotes(c)).toBe(normalizedMeasurementName(c))
    }
  })
})
