// @parity test/measurement-name
//
// The required-name rule — what enables Save and what is stored for the name and the notes — against the
// shared case file `measurement-name.json`, the same cases the Swift and Python suites run. null in the
// file is the web's undefined (no stored value).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isValidMeasurementName, normalizedMeasurementName, normalizedMeasurementNotes } from '../src/measurement/measurementName'

const DATA = JSON.parse(readFileSync('test/fixtures/measurement-name.json', 'utf8')) as {
  isValidName: [string, boolean][]
  normalizedName: [string, string | null][]
  normalizedNotes: [string, string | null][]
}

describe('measurement-name — shared cases', () => {
  for (const [text, expected] of DATA.isValidName) {
    it(`isValidName ${JSON.stringify(text)}`, () => expect(isValidMeasurementName(text)).toBe(expected))
  }
  for (const [text, expected] of DATA.normalizedName) {
    it(`normalizedName ${JSON.stringify(text)}`, () => expect(normalizedMeasurementName(text)).toBe(expected ?? undefined))
  }
  for (const [text, expected] of DATA.normalizedNotes) {
    it(`normalizedNotes ${JSON.stringify(text)}`, () => expect(normalizedMeasurementNotes(text)).toBe(expected ?? undefined))
  }
})
