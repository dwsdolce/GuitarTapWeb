// @parity test/saved-measurements-order
// The order Saved Measurements shows the library in — `shownOrder` — against the shared case file
// saved-measurements-order.json, the same cases the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { duplicates, shownOrder, type OrderKey, type SavedMeasurementsSort } from '../src/measurement/savedMeasurementsOrder'

type Row = { id: string; name: string; sort: SavedMeasurementsSort; ascending: boolean; filter: string | null; expect: number[] }
const DATA = JSON.parse(readFileSync('test/fixtures/saved-measurements-order.json', 'utf8')) as {
  measurements: { name: string; timestamp: string; type: string }[]
  cases: Row[]
  duplicates: { id: string; name: string; ids: string[]; expect: number[] }[]
}
const KEYS: OrderKey[] = DATA.measurements.map((m) => ({ name: m.name, date: Date.parse(m.timestamp), type: m.type }))

describe('saved-measurements order', () => {
  for (const row of DATA.cases) {
    it(`${row.id} ${row.name}`, () => {
      expect(shownOrder(KEYS, row.sort, row.ascending, row.filter)).toEqual(row.expect)
    })
  }
})

describe('saved-measurements duplicates', () => {
  for (const row of DATA.duplicates) {
    it(`${row.id} ${row.name}`, () => {
      expect(duplicates(row.ids)).toEqual(row.expect)
    })
  }
})
