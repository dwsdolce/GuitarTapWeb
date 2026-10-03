// @parity test/measurement-amend
//
// The AMEND rule: what it means to change a saved measurement's name or notes.
//
// Name and notes are part of a measurement's DATA, not annotations on top of it, so an amended
// measurement is a different dataset and must carry a different `id`. That gives the identity its
// meaning — same `id` ⟺ same content — and it is why `isAmended` exists: a Save that changes
// nothing would hand unchanged content a new identity, so the edit row must not allow one.
//
// The web's counterpart to Swift's `with` / Python's `with_`. Mirrors Swift
// GuitarTapTests/MeasurementAmendTests.swift and Python tests/test_measurement_amend.py, case for
// case.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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

type AmendRow = {
  stored: { name: string | null; notes: string | null }
  candidate: { name: string | null; notes: string | null }
  normalize?: boolean
  expect: boolean
}
const IS_AMENDED = (JSON.parse(readFileSync('test/fixtures/measurement-amend.json', 'utf8')) as { isAmended: AmendRow[] }).isAmended

describe('isAmended — the gate on Save (the shared cases in measurement-amend.json)', () => {
  IS_AMENDED.forEach((row, i) => {
    it(`case ${i + 1}`, () => {
      const m = make(row.stored.name ?? undefined, row.stored.notes ?? undefined)
      let name = row.candidate.name ?? undefined
      let notes = row.candidate.notes ?? undefined
      if (row.normalize) {
        name = name === undefined ? undefined : normalizedMeasurementName(name)
        notes = notes === undefined ? undefined : normalizedMeasurementNotes(notes)
      }
      expect(isAmended(m, name, notes)).toBe(row.expect)
    })
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
