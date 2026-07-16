// @parity test/measurement-type-name
//
// Pin the Details-pane Measurement Type resolution (parity group `view/measurement-detail`).
//
// The type is stored ONLY inside the SpectrumSnapshot — never as a top-level measurement field.
// Swift MeasurementDetailView.measurementTypeName is canonical:
//
//     let mt = measurement.spectrumSnapshot?.measurementType
//         ?? measurement.longitudinalSnapshot?.measurementType
//     return mt?.shortName ?? "—"
//
// The web already resolves this way; these tests lock it in. The Python port did NOT — it read the
// top-level `measurement_type`, which is None in memory by design, so every measurement saved in the
// current session showed "—" in Details (found in the 1.0.2 run-review, 2026-07-16; fixed in
// measurement_detail_view.py `_type_name`, three-way with tests/test_measurement_type_name.py).
//
// A round-trip test cannot catch that class of bug: loading from a dict populates the top-level
// field, so only an IN-MEMORY measurement (snapshot-only) exposes it. Hence the shape used here.
//
// Swift counterpart deferred: `measurementTypeName` is `private` inside the View struct and is
// unreachable from a test without an application change. See
// GuitarTapWeb/Development/MATERIAL-MULTITAP-DISCREPANCIES.md §2.

import { describe, it, expect } from 'vitest'
import { measurementTypeName } from '../src/measurement/fromLive'
import type { TapToneMeasurementModel, SpectrumSnapshotModel } from '../src/measurement/types'

/** Minimal snapshot carrying only the field the resolver reads. */
const snap = (measurementType?: string): SpectrumSnapshotModel =>
  ({ measurementType } as unknown as SpectrumSnapshotModel)

/** A measurement as built in memory: the type lives in the snapshot, nowhere else. */
const meas = (m: Partial<TapToneMeasurementModel>): TapToneMeasurementModel =>
  ({ id: 'x', timestamp: '2026-07-16T00:00:00Z', peaks: [], ...m }) as TapToneMeasurementModel

describe('measurementTypeName — resolves from the snapshot (Swift parity)', () => {
  it('resolves a brace from longitudinalSnapshot', () => {
    expect(measurementTypeName(meas({ longitudinalSnapshot: snap('Material (Brace)') }))).toBe('Brace')
  })

  it('resolves a plate from longitudinalSnapshot', () => {
    expect(measurementTypeName(meas({ longitudinalSnapshot: snap('Material (Plate)') }))).toBe('Plate')
  })

  it('resolves a guitar from spectrumSnapshot', () => {
    expect(measurementTypeName(meas({ spectrumSnapshot: snap('Classical Guitar') }))).toBe('Classical')
  })

  it('prefers spectrumSnapshot over longitudinalSnapshot (Swift ?? order)', () => {
    expect(
      measurementTypeName(
        meas({ spectrumSnapshot: snap('Generic Guitar'), longitudinalSnapshot: snap('Material (Brace)') }),
      ),
    ).toBe('Generic')
  })

  it('short-circuits to Comparison before any snapshot lookup', () => {
    expect(
      measurementTypeName(
        meas({ spectrumSnapshot: snap('Generic Guitar'), comparisonEntries: [] as never }),
      ),
    ).toBe('Comparison')
  })

  it('falls back to an em-dash when no snapshot carries a type', () => {
    expect(measurementTypeName(meas({}))).toBe('—')
    expect(measurementTypeName(meas({ spectrumSnapshot: snap(undefined) }))).toBe('—')
  })
})