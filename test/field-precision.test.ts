// @parity test/field-precision
//
// The numeric-precision table and its helpers (FieldPrecision) against the shared case file,
// `field-precision.json` — the same cases the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { FieldPrecision } from '../src/precision'

const DATA = JSON.parse(readFileSync('test/fixtures/field-precision.json', 'utf8')) as {
  table: [string, number][]
  decimalsWithin: [string, number, boolean][]
  rounded: { value: number; decimals: number; expect: number; tolerance?: number }[]
  string: [number | string, number, string][]
}

const number = (v: number | string) => (v === '-Infinity' ? -Infinity : v === 'Infinity' ? Infinity : Number(v))

describe('field-precision — shared cases', () => {
  for (const [name, decimals] of DATA.table) {
    it(`table ${name}`, () => {
      expect((FieldPrecision as unknown as Record<string, number>)[name]).toBe(decimals)
    })
  }
  for (const [text, decimals, expected] of DATA.decimalsWithin) {
    it(`decimalsWithin ${JSON.stringify(text)} at ${decimals}`, () => {
      expect(FieldPrecision.decimalsWithin(text, decimals)).toBe(expected)
    })
  }
  for (const row of DATA.rounded) {
    it(`rounded ${row.value} at ${row.decimals}`, () => {
      const result = FieldPrecision.rounded(row.value, row.decimals)
      if (row.tolerance !== undefined) expect(Math.abs(result - row.expect)).toBeLessThan(row.tolerance)
      else expect(result).toBe(row.expect)
    })
  }
  for (const [value, decimals, expected] of DATA.string) {
    it(`string ${value} at ${decimals}`, () => {
      expect(FieldPrecision.string(number(value), decimals)).toBe(expected)
    })
  }
})
