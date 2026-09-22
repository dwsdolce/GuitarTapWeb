// @parity test/measurement-amend
//
// The AMEND rule: what it means to change a saved measurement's name or notes.
//
// Name and notes are part of a measurement's DATA, not annotations on top of it, so an amended
// measurement is a different dataset and must carry a different `id`. That gives the identity its
// meaning — same `id` ⟺ same content — and it is why `isAmended` exists: a Save that changes
// nothing would hand unchanged content a new identity, so the edit row must not allow one.
//
// New in the #17 sweep. This edition had no counterpart to Swift's `with` / Python's `with_` at
// all — the amend was inline in the Measurements panel, untestable and unshared. Mirrors Swift
// GuitarTapTests/MeasurementAmendTests.swift and Python tests/test_measurement_amend.py, case for
// case. See SLUG-SWEEP.md F20.
import { describe, it, expect } from 'vitest'
import { isAmended, amendMeasurement } from '../src/measurement/amend'
import { normalizedMeasurementName, normalizedMeasurementNotes } from '../src/measurement/measurementName'
import { newMeasurementId } from '../src/measurement/fromLive'
import type { TapToneMeasurementModel } from '../src/measurement/types'

function make(measurementName?: string, notes?: string): TapToneMeasurementModel {
  return {
    id: newMeasurementId(),
    timestamp: '2026-01-01T00:00:00.000Z',
    peaks: [],
    measurementName,
    notes,
  }
}

describe('isAmended — the gate on Save', () => {
  it('is false when nothing differs', () => {
    expect(isAmended(make('Bridge', 'Some notes'), 'Bridge', 'Some notes')).toBe(false)
  })

  it('is true when the name differs', () => {
    expect(isAmended(make('Bridge', 'Some notes'), 'Neck', 'Some notes')).toBe(true)
  })

  it('is true when the notes differ', () => {
    expect(isAmended(make('Bridge', 'Some notes'), 'Bridge', 'Edited')).toBe(true)
  })

  it('is true when a field is cleared', () => {
    const m = make('Bridge', 'Some notes')
    expect(isAmended(m, 'Bridge', undefined)).toBe(true)
    expect(isAmended(m, undefined, 'Some notes')).toBe(true)
  })

  it('is false for whitespace-only differences', () => {
    // Whitespace-only retyping is NOT an edit, because both fields normalize the same way. This is
    // the case that made the rule worth sharing: Swift stored notes verbatim and Python trimmed on
    // one path only, so the three disagreed on whether this counted. See SLUG-SWEEP.md F21.
    const m = make('Bridge', 'Some notes')
    const name = normalizedMeasurementName('  Bridge  ')
    const notes = normalizedMeasurementNotes('\n Some notes \n')
    expect(isAmended(m, name, notes)).toBe(false)
  })

  it('handles a measurement with no name or notes', () => {
    const m = make()
    expect(isAmended(m, undefined, undefined)).toBe(false)
    expect(isAmended(m, 'Named', undefined)).toBe(true)
  })
})

describe('amendMeasurement — the amend itself', () => {
  it('updates the name and mints a NEW id', () => {
    const original = make('Old')
    const updated = amendMeasurement(original, 'New', undefined)
    expect(updated.measurementName).toBe('New')
    expect(updated.id).not.toBe(original.id)
  })

  it('updates the notes', () => {
    const original = make(undefined, 'old notes')
    expect(amendMeasurement(original, undefined, 'new notes').notes).toBe('new notes')
  })

  it('clears the name when given undefined, and that mints too', () => {
    const original = make('Bridge')
    const updated = amendMeasurement(original, undefined, undefined)
    expect(updated.measurementName).toBeUndefined()
    // Clearing the fields is a data change too, so it mints a new id.
    expect(updated.id).not.toBe(original.id)
  })

  it('preserves the captured data, the capture time and the row handle', () => {
    const original: TapToneMeasurementModel = {
      ...make('Bridge'),
      rowKey: 'row-1',
      decayTime: 0.5,
      peaks: [
        { id: 'p1', frequency: 195, magnitude: -20, quality: 10, bandwidth: 19.5, timestamp: '2026-01-01T00:00:00.000Z' },
      ],
    }
    const updated = amendMeasurement(original, 'Neck', undefined)
    expect(updated.peaks).toEqual(original.peaks)
    expect(updated.decayTime).toBe(0.5)
    expect(updated.timestamp).toBe(original.timestamp)
    // The row handle is what lets the id change without the store treating this as a new entry.
    expect(updated.rowKey).toBe('row-1')
  })

  it('successive amendments each mint a new id', () => {
    const a = make('First')
    const b = amendMeasurement(a, 'Second', undefined)
    const c = amendMeasurement(b, 'Third', undefined)
    expect(a.id).not.toBe(b.id)
    expect(b.id).not.toBe(c.id)
    expect(a.id).not.toBe(c.id)
  })
})
