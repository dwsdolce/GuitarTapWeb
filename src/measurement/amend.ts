// @parity model/measurement-amend tests=test/measurement-amend
//
// The AMEND rule: what it means to change a saved measurement's name or notes.
//
// Name and notes are part of a measurement's DATA, not annotations on top of it, so an amended
// measurement is a different dataset and must carry a different `id`. That is what gives the
// identity its meaning — same `id` ⟺ same content.
//
// This edition had no counterpart to Swift's `TapToneMeasurement.with` / Python's `with_`: the
// amend was written inline in the Measurements panel, so the rule could not be tested and could
// not be shared. See SLUG-SWEEP.md F20.

import type { TapToneMeasurementModel } from './types'
import { newMeasurementId } from './fromLive'

/**
 * Whether the supplied values differ from what this measurement stores — the gate on the edit
 * row's Save button.
 *
 * Both arguments must already be normalized (`normalizedMeasurementName` /
 * `normalizedMeasurementNotes`) so the comparison is against what would actually be written.
 * Amending mints a new `id`, so a Save that changes nothing must not be reachable — it would give
 * unchanged content a new identity. Single source of truth so all three platforms, and their
 * tests, agree; a view binds its Save button to this and never re-implements it, exactly as it
 * does for `isValidMeasurementName`.
 *
 * Mirrors Swift `TapToneMeasurement.isAmended(measurementName:notes:)` and Python `is_amended`.
 */
export function isAmended(
  m: TapToneMeasurementModel,
  measurementName: string | undefined,
  notes: string | undefined,
): boolean {
  return measurementName !== m.measurementName || notes !== m.notes
}

/**
 * A copy of the measurement with `measurementName` and `notes` replaced and a **new** `id`.
 *
 * `timestamp` is preserved — it records when the tap was captured, which amending does not change
 * — and so is `rowKey`, because this is still the same library row: the row handle is what lets
 * the id change without the store treating it as a new entry.
 *
 * Mirrors Swift `TapToneMeasurement.with(measurementName:notes:)` and Python `with_`.
 */
export function amendMeasurement(
  m: TapToneMeasurementModel,
  measurementName: string | undefined,
  notes: string | undefined,
): TapToneMeasurementModel {
  return { ...m, id: newMeasurementId(), measurementName, notes }
}
