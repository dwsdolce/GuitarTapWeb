// @parity test/pitch
//
// Equal-temperament pitch against the shared case file, `pitch.json` — the same cases the Swift and Python
// suites run. Pitch is a general package: pitchRange, formattedNote and isInTune have no call site in the
// app, and are tested because the package's API is the contract.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Pitch } from '../src/dsp/pitch'

type Row = Record<string, unknown>
const DATA = JSON.parse(readFileSync('test/fixtures/pitch.json', 'utf8')) as Record<string, unknown>
const rows = (key: string) => DATA[key] as Row[]
const TOLERANCE = DATA.tolerance as number

/** A number from the file: NaN and the infinities are written as strings. */
function num(value: unknown): number {
  if (value === 'NaN') return NaN
  if (value === 'Infinity') return Infinity
  if (value === '-Infinity') return -Infinity
  return value as number
}

function expectClose(actual: number, expected: unknown, label: string) {
  expect(Math.abs(actual - num(expected)), `${label}: ${actual}`).toBeLessThanOrEqual(TOLERANCE)
}

describe('pitch — shared cases', () => {
  for (const row of rows('frequencies')) {
    it(`${row.id as string}`, () => {
      const e = row.expect as Row
      const p = new Pitch(num(row.a4))
      const f = num(row.frequency)
      const range = p.pitchRange(f)
      const expectedRange = e.pitchRange as Row
      expect(p.hasPitch(f), 'hasPitch').toBe(e.hasPitch)
      expect(p.pitch(f), 'pitch').toEqual(e.pitch)
      expect(p.note(f), 'note').toBe(e.note)
      expectClose(p.cents(f), e.cents, 'cents')
      expectClose(p.freq0(f), e.freq0, 'freq0')
      expectClose(range.upper, expectedRange.upper, 'pitchRange upper')
      expectClose(range.lower, expectedRange.lower, 'pitchRange lower')
      expect(p.formattedNote(f), 'formattedNote').toBe(e.formattedNote)
      expect(p.isInTune(f), 'isInTune').toBe(e.isInTune)
    })
  }

  for (const row of rows('isInTune')) {
    it(`isInTune: ${row.id as string}`, () => {
      const p = new Pitch(num(row.a4))
      expect(p.isInTune(num(row.frequency), num(row.threshold))).toBe(row.expect)
    })
  }

  for (const row of rows('isInTuneAtOwnCents')) {
    it(`isInTune: ${row.id as string}`, () => {
      const p = new Pitch(num(row.a4))
      const f = num(row.frequency)
      const cents = p.cents(f)
      expectClose(cents, row.cents, 'cents')
      expect(p.isInTune(f, cents), 'at its cents').toBe(row.expectAtCents)
      expect(p.isInTune(f, cents - 1e-9), 'just under').toBe(row.expectJustUnder)
    })
  }

  for (const row of rows('freq')) {
    it(`freq: ${row.id as string}`, () => {
      const p = new Pitch(num(row.a4))
      expectClose(p.freq(row.note as number, row.octave as number), row.expect, 'freq')
    })
  }

  it('formatCents', () => {
    for (const row of rows('formatCents')) {
      expect(Pitch.formatCents(num(row.cents)), `${row.cents as number}`).toBe(row.expect)
    }
  })
})
