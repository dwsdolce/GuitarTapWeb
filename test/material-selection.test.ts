// @parity test/material-selection
//
// A material (plate / brace) measurement's effective selection ignores the saved selection, against the shared
// case file `material-selection.json` — the same cases the Swift and Python suites run. Material has no
// per-peak selection: the identified L / C / FLC are the peaks. The case is a genuine iPad-saved plate whose
// saved selection was clobbered to the cross peak alone; reading it resolves all three, healing the file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile } from '../src/measurement'
import { effectiveSelectedPeakIDs, isMaterialMeasurement } from '../src/measurement/types'

type Row = { fixture: string; isMaterial: boolean; peakCount: number; savedSelectionCount: number; effectiveSelectionCount: number }
const CASES = (JSON.parse(readFileSync('test/fixtures/material-selection.json', 'utf8')) as { cases: Row[] }).cases

describe('material-selection — shared cases', () => {
  for (const row of CASES) {
    it(`${row.fixture}: the effective selection is every material peak`, () => {
      const m = parseGuitarTapFile(readFileSync(`test/fixtures/${row.fixture}.guitartap`, 'utf8'))[0]!
      expect(isMaterialMeasurement(m)).toBe(row.isMaterial)
      expect(m.peaks).toHaveLength(row.peakCount)
      expect(m.selectedPeakIDs?.length ?? 0).toBe(row.savedSelectionCount)
      expect(effectiveSelectedPeakIDs(m)).toEqual(new Set(m.peaks.map((p) => p.id)))
      expect(effectiveSelectedPeakIDs(m).size).toBe(row.effectiveSelectionCount)
    })
  }
})
