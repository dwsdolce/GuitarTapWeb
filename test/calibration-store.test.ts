// @parity test/mic-selection
// The calibration store: with no device selected no calibration is applied (a device's own is MS18–MS19 in
// test/mic-selection.test.ts); stored calibrations that cannot be read are kept aside, as Swift's and Python's
// mic-selection tests; and a lowercase id is read as the same id (the web keeps ids as strings, where Swift's
// UUID and Python's uuid ignore case by nature).
import { describe, it, expect, beforeEach } from 'vitest'
import {
  listCalibrations,
  saveCalibration,
  setCalibrationForDevice,
  setActiveCalibrationId,
  resolveActiveCalibration,
} from '../src/measurement/calibrationStore'
import type { Calibration } from '../src/dsp/calibration'

// The store is localStorage-backed; the node test env has none, so install an in-memory mock.
beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
})

const cal = (name: string): Calibration => ({ name, sensitivityFactor: null, referenceLevel: null, points: [{ frequency: 1000, correction: 0 }] })

describe('the calibration a device resolves to', () => {
  it('with no device selected, no calibration — the last one chosen is not applied', () => {
    const umik = saveCalibration(cal('UMIK-1'))
    setActiveCalibrationId(umik.id)
    expect(resolveActiveCalibration(undefined)).toBeNull()
    expect(resolveActiveCalibration(null)).toBeNull()
  })
})

describe('stored calibrations that cannot be read', () => {
  // They are moved to a key of their own, the list starts empty, and a later save leaves them as they
  // were. Mirrors the Swift and Python tests of the same.
  it('are kept aside and not written over', () => {
    const damaged = JSON.stringify([{ id: 'not-a-uuid', name: 'Room' }])
    localStorage.setItem('gt.calibrations', damaged)
    const keptKeys = () =>
      Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).filter((k) => k.startsWith('gt.calibrations-unreadable-'))

    expect(listCalibrations()).toEqual([])
    const kept = keptKeys()
    expect(kept).toHaveLength(1)
    expect(localStorage.getItem(kept[0]!), 'kept as it was').toBe(damaged)

    saveCalibration(cal('Room'))
    expect(listCalibrations(), 'a new list is written').toHaveLength(1)
    expect(localStorage.getItem(kept[0]!), 'and the kept one is not touched').toBe(damaged)
  })

  it('a lowercase id is read as the same id, in the canonical case', () => {
    const id = '5e2a8c7d-0000-4000-8000-0000000000a1'
    localStorage.setItem('gt.calibrations', JSON.stringify([{ ...cal('Room'), id, importDate: 0 }]))
    expect(listCalibrations().map((c) => c.id)).toEqual([id.toUpperCase()])
  })
})

