// @parity test/frequency-format
//
// A frequency for display, the range line built from it, and whole hertz grouped by the locale, against the
// shared case file `frequency-format.json` — the same cases the Swift and Python suites run. Locales are
// written as Swift's identifiers (en_US); the web's are BCP 47 (en-US).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { displayRangeLabel, formattedAsFrequency, formattedAsWholeHertz } from '../src/presentation/frequencyFormat'

const DATA = JSON.parse(readFileSync('test/fixtures/frequency-format.json', 'utf8')) as {
  formattedAsFrequency: [number, string][]
  displayRangeLabel: [number, number, string][]
  formattedAsWholeHertz: [number, string, string][]
}

describe('frequency-format — shared cases', () => {
  for (const [hz, expected] of DATA.formattedAsFrequency) {
    it(`formattedAsFrequency ${hz}`, () => expect(formattedAsFrequency(hz)).toBe(expected))
  }
  for (const [lo, hi, expected] of DATA.displayRangeLabel) {
    it(`displayRangeLabel ${lo}–${hi}`, () => expect(displayRangeLabel(lo, hi)).toBe(expected))
  }
  for (const [hz, locale, expected] of DATA.formattedAsWholeHertz) {
    it(`formattedAsWholeHertz ${hz} ${locale}`, () => expect(formattedAsWholeHertz(hz, locale.replace('_', '-'))).toBe(expected))
  }
})
