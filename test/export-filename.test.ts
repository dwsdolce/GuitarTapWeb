// @parity test/export-filename
//
// Pins the shared export-filename rule (FILE-PATHS-AND-NAMES-SPEC §2b): one stem function,
// per-artifact default word, integer-second discriminator, name slugged (spaces and "/" → "-",
// lowercased). Three-way with Swift ExportFilenameTests.swift and Python test_export_filename.py.
import { describe, it, expect } from 'vitest'
import { exportStem } from '../src/measurement/exportFilename'
import { guitarTapFilename } from '../src/measurement/fromLive'
import type { TapToneMeasurementModel } from '../src/measurement/types'

const TS = 1784060789 // a fixed instant, so the discriminator is deterministic

describe('export-filenames — the core rule (PR §2b)', () => {
  it('named: uses the name for every artifact', () => {
    expect(exportStem('Martin 000-28', TS, 'measurement')).toBe('martin-000-28-1784060789')
    expect(exportStem('Martin 000-28', TS, 'report')).toBe('martin-000-28-1784060789')
    expect(exportStem('Martin 000-28', TS, 'spectrum')).toBe('martin-000-28-1784060789')
  })

  it('unnamed: uses the artifact word, never an infix', () => {
    expect(exportStem(null, TS, 'measurement')).toBe('measurement-1784060789')
    expect(exportStem(null, TS, 'report')).toBe('report-1784060789')
    expect(exportStem(undefined, TS, 'spectrum')).toBe('spectrum-1784060789')
    expect(exportStem('', TS, 'measurement')).toBe('measurement-1784060789')
  })

  it('slugs spaces AND slashes, lowercased — and preserves Unicode (unlike the old [^\\w] regex)', () => {
    expect(exportStem('Bridge/Plate Top', TS, 'report')).toBe('bridge-plate-top-1784060789')
    // The old web PNG/PDF slug used [^\w.-] and mangled this to "ram-rez"; Swift/Python keep it.
    expect(exportStem('RAMÍREZ 1975', TS, 'measurement')).toBe('ramírez-1975-1784060789')
  })

  it('the discriminator is the integer seconds passed in', () => {
    expect(exportStem('x', 1784060789, 'measurement')).toBe('x-1784060789')
  })
})

describe('export-filenames — guitarTapFilename wires "measurement" + the measurement timestamp', () => {
  const base = (over: Partial<TapToneMeasurementModel>): TapToneMeasurementModel =>
    ({ id: 'x', timestamp: '2026-07-14T00:00:00.000Z', peaks: [], measurementName: undefined, ...over }) as TapToneMeasurementModel

  it('named → slug-<measurement ts>.guitartap', () => {
    const f = guitarTapFilename(base({ measurementName: 'Martin 000-28', timestamp: '2026-07-14T00:00:00.000Z' }))
    expect(f).toMatch(/^martin-000-28-\d+\.guitartap$/)
  })

  it('unnamed → measurement-<ts>.guitartap (no leading dash)', () => {
    const f = guitarTapFilename(base({ measurementName: undefined }))
    expect(f).toMatch(/^measurement-\d+\.guitartap$/)
  })
})