// @parity test/export-peaks
//
// The peaks a saved measurement's report shows are the peaks it shows on screen, against the shared case file
// `export-peaks.json` — the same cases the Swift and Python suites run. A guitar shows its peaks at or above
// its Peak Min, so a selected peak below Peak Min is left out of its report as it is off its screen; a plate or
// brace shows its identified peaks whatever the Peak Min. Each case reads a fixture with the Peak Min it names.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile } from '../src/measurement'
import { measurementDetectedPeaksInView, measurementPeaksAbovePeakMin, measurementReportPeaks } from '../src/measurement/types'
import { measurementToPdfData } from '../src/presentation/measurementImage'

type Row = { fixture: string; peakMinThreshold: number | null; peaksAbovePeakMin: number; detectedPeaksInView: number; reportRows: number[] | null }
const CASES = (JSON.parse(readFileSync('test/fixtures/export-peaks.json', 'utf8')) as { cases: Row[] }).cases

function measurement(row: Row) {
  const file = JSON.parse(readFileSync(`test/fixtures/${row.fixture}.guitartap`, 'utf8')) as Record<string, unknown>[]
  if (row.peakMinThreshold != null) file[0]!.peakMinThreshold = row.peakMinThreshold
  return parseGuitarTapFile(JSON.stringify(file))[0]!
}

describe('export-peaks — shared cases', () => {
  for (const row of CASES) {
    it(`${row.fixture} at Peak Min ${row.peakMinThreshold ?? 'as saved'}: the peaks above Peak Min`, () => {
      expect(measurementPeaksAbovePeakMin(measurement(row))).toHaveLength(row.peaksAbovePeakMin)
      // The export header's "Detected Peaks: N": the detected peaks in view (none for a plate or brace).
      expect(measurementDetectedPeaksInView(measurement(row))).toHaveLength(row.detectedPeaksInView)
    })
    if (row.reportRows != null) {
      it(`${row.fixture} at Peak Min ${row.peakMinThreshold ?? 'as saved'}: the report's rows`, () => {
        const rows = measurementToPdfData(measurement(row)).peaks.map((p) => Math.round(p.frequency * 10) / 10)
        expect(rows.sort((a, b) => a - b)).toEqual(row.reportRows)
      })
      it(`${row.fixture} at Peak Min ${row.peakMinThreshold ?? 'as saved'}: the summary's peaks are the report's rows`, () => {
        expect(measurementReportPeaks(measurement(row)).map((p) => Math.round(p.frequency * 10) / 10)).toEqual(row.reportRows)
      })
    }
  }
})
