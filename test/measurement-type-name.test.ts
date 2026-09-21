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

// ── Cases levelled across the editions (#17 F16) ───────────────────────────────────────────
//
// The six cases above were shared by all three editions; each had then grown extras the others
// never received. These are the ones this edition lacked.

describe('measurementTypeName — every type resolves to its short name', () => {
  // Mirrors Swift everyTypeResolvesToItsShortName. Only Swift pinned the 6-type table, so a
  // short name that drifted in one edition would have gone unnoticed. The tables agree today:
  // Generic, Acoustic, Classical, Flamenco, Plate, Brace.
  const cases: [string, string][] = [
    ['Generic Guitar', 'Generic'],
    ['Acoustic Guitar', 'Acoustic'],
    ['Classical Guitar', 'Classical'],
    ['Flamenco Guitar', 'Flamenco'],
    ['Material (Plate)', 'Plate'],
    ['Material (Brace)', 'Brace'],
  ]
  for (const [raw, short] of cases) {
    it(`${raw} → ${short}`, () => {
      expect(measurementTypeName(meas({ spectrumSnapshot: snap(raw) }))).toBe(short)
    })
  }
})

describe('measurementTypeName — fallbacks', () => {
  it('an unrecognised snapshot type falls back to an em-dash', () => {
    // Mirrors Python test_unrecognised_snapshot_type_falls_back_to_em_dash.
    expect(measurementTypeName(meas({ spectrumSnapshot: snap('Sousaphone') }))).toBe('—')
  })

  it('an undefined snapshot type falls back to an em-dash', () => {
    // Mirrors Swift nilSnapshotTypeFallsBackToEmDash / Python's None case.
    expect(measurementTypeName(meas({ spectrumSnapshot: snap(undefined) }))).toBe('—')
  })

  it('a LOADED measurement still resolves — the regression Python guards', () => {
    // The type is deliberately NOT written to a top-level field when a measurement is created;
    // the writer resolves it from the snapshot at save time. A resolver that read the top-level
    // field showed "—" for everything saved in the current session and only came right after a
    // restart re-read the file — session-scoped, which is why no test caught it. Python added
    // this case after that bug; this edition had no equivalent. See SLUG-SWEEP.md F16.
    const loaded = meas({
      spectrumSnapshot: snap('Classical Guitar'),
      measurementType: 'Classical Guitar',
    } as Partial<TapToneMeasurementModel>)
    expect(measurementTypeName(loaded)).toBe('Classical')
    // And with the top-level field absent, as an in-session save has it:
    expect(measurementTypeName(meas({ spectrumSnapshot: snap('Classical Guitar') }))).toBe('Classical')
  })
})
