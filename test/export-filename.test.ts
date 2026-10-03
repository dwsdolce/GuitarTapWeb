// @parity test/export-filename
//
// The export filename stem (exportStem) and a saved measurement's base filename against the shared case file
// `export-filename.json`, the same cases the Swift and Python suites run. The web composes a measurement's
// filename with its extension (guitarTapFilename), so its base is the filename less `.guitartap`.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { exportStem } from '../src/measurement/exportFilename'
import { guitarTapFilename } from '../src/measurement/fromLive'
import type { TapToneMeasurementModel } from '../src/measurement/types'

const DATA = JSON.parse(readFileSync('test/fixtures/export-filename.json', 'utf8')) as {
  stem: { name: string | null; seconds: number; unnamed: string; expect: string }[]
  measurementBaseFilename: { name: string | null; timestamp: string; expect: string }[]
}

describe('export-filename — shared cases', () => {
  for (const row of DATA.stem) {
    it(`stem ${row.name} ${row.seconds} ${row.unnamed}`, () => expect(exportStem(row.name, row.seconds, row.unnamed)).toBe(row.expect))
  }
  for (const row of DATA.measurementBaseFilename) {
    it(`measurement ${row.name} ${row.timestamp}`, () => {
      const m = { id: 'x', timestamp: row.timestamp, peaks: [], measurementName: row.name ?? undefined } as TapToneMeasurementModel
      expect(guitarTapFilename(m)).toBe(`${row.expect}.guitartap`)
    })
  }
})
