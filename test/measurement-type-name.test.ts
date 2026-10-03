// @parity test/measurement-type-name
//
// The Details pane's measurement type (measurementTypeName) and the material flag (isMaterialMeasurement), both
// resolved from the snapshots — the type lives only there in memory — against the shared case file
// `measurement-type-name.json`, the same cases the Swift and Python suites run.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { measurementTypeName } from '../src/measurement/fromLive'
import { isMaterialMeasurement, type TapToneMeasurementModel, type SpectrumSnapshotModel } from '../src/measurement/types'

type Row = { id?: string; spectrum: string | null; longitudinal: string | null; isComparison?: boolean; topLevelType?: string; expect: string | boolean; editions?: string[] }
const DATA = JSON.parse(readFileSync('test/fixtures/measurement-type-name.json', 'utf8')) as { shortName: Row[]; isMaterial: Row[] }

/** A snapshot as the file describes it: "absent" is none, null is one with no type. */
const snap = (v: string | null) => (v === 'absent' ? undefined : ({ measurementType: v ?? undefined } as unknown as SpectrumSnapshotModel))
const meas = (r: Row): TapToneMeasurementModel =>
  ({
    id: 'x', timestamp: '2026-07-16T00:00:00Z', peaks: [],
    spectrumSnapshot: snap(r.spectrum), longitudinalSnapshot: snap(r.longitudinal),
    ...(r.isComparison ? { comparisonEntries: [] } : {}),
    ...(r.topLevelType ? { measurementType: r.topLevelType } : {}),
  }) as unknown as TapToneMeasurementModel

describe('measurement-type-name — shared cases', () => {
  for (const r of DATA.shortName.filter((r) => (r.editions ?? ['web']).includes('web'))) {
    it(`${r.id} → ${String(r.expect)}`, () => expect(measurementTypeName(meas(r))).toBe(r.expect))
  }
  for (const r of DATA.isMaterial) {
    it(`isMaterial → ${String(r.expect)}`, () => expect(isMaterialMeasurement(meas(r))).toBe(r.expect))
  }
})
