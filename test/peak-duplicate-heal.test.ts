// @parity test/peak-heal
//
// Healing files saved with a duplicate peak, against the shared case file `peak-heal.json` — the same cases the
// Swift and Python suites run.
//
// Loaded peaks are authoritative — never re-derived — so a file saved with a duplicate peak would keep it forever.
// The repair happens at decode (decodeMeasurement), and the IndexedDB store, which holds decoded objects, runs
// it on read. Rule: collapse peaks closer than the proximity window, keeping (1) the peak whose id is selected,
// else (2) the higher magnitude, else (3) the first. findPeaks' own spacing keeps saved peaks at least that far
// apart, so any closer pair is corruption.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGuitarTapFile, serializeGuitarTapFile, type TapToneMeasurementModel } from '../src/measurement'

type Row = { fixture: string; peakCount: number; twinHz: number; twinTolerance: number; proximityHz: number }
const CASES = (JSON.parse(readFileSync('test/fixtures/peak-heal.json', 'utf8')) as { cases: Row[] }).cases

function decode(row: Row): TapToneMeasurementModel {
  const all = parseGuitarTapFile(readFileSync(`test/fixtures/${row.fixture}.guitartap`, 'utf8'))
  expect(all.length, 'fixture decoded to no measurements').toBeGreaterThan(0)
  return all[0]!
}

describe('duplicate-peak heal on decode — shared cases', () => {
  for (const row of CASES) {
    it(`${row.fixture}: no two peaks closer than ${row.proximityHz} Hz, ${row.peakCount} peaks`, () => {
      const m = decode(row)
      const offenders: string[] = []
      m.peaks.forEach((a, i) => {
        for (const b of m.peaks.slice(i + 1)) {
          const delta = Math.abs(a.frequency - b.frequency)
          if (delta < row.proximityHz) offenders.push(`${a.frequency.toFixed(5)} Hz / ${b.frequency.toFixed(5)} Hz (${delta.toFixed(5)} apart)`)
        }
      })
      expect(offenders, 'decode must collapse duplicate peaks').toEqual([])
      expect(m.peaks.length).toBe(row.peakCount)
    })

    it(`${row.fixture}: the surviving twin is the selected one`, () => {
      const m = decode(row)
      const survivors = m.peaks.filter((p) => Math.abs(p.frequency - row.twinHz) < row.twinTolerance)
      expect(survivors.length).toBe(1)
      expect(new Set(m.selectedPeakIDs ?? []).has(survivors[0]!.id), 'the heal kept the unselected twin — selection now dangles').toBe(true)
    })

    it(`${row.fixture}: the heal leaves no dangling ids`, () => {
      const m = decode(row)
      const ids = new Set(m.peaks.map((p) => p.id))
      for (const id of m.selectedPeakIDs ?? []) expect(ids.has(id), `selectedPeakIDs references a removed peak: ${id}`).toBe(true)
      for (const id of Object.keys(m.peakAnnotationOffsets ?? {})) expect(ids.has(id), `peakAnnotationOffsets references a removed peak: ${id}`).toBe(true)
      for (const id of Object.keys(m.peakModeOverrides ?? {})) expect(ids.has(id), `peakModeOverrides references a removed peak: ${id}`).toBe(true)
    })

    it(`${row.fixture}: the heal is reported`, () => {
      expect(decode(row).wasHealed).toBe(true)
    })

    it(`${row.fixture}: the heal flag is not serialised, and the corrected peaks are`, () => {
      const m = decode(row)
      const encoded = serializeGuitarTapFile([m])
      expect(encoded.includes('wasHealed'), 'the heal marker must not round-trip into the format').toBe(false)
      expect(parseGuitarTapFile(encoded)[0]!.peaks.length).toBe(m.peaks.length)
    })
  }
})
